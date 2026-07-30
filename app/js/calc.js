// Расчётное ядро. Порт moex_sync.py — формулы те же, чтобы цифры
// в приложении и в старой связке Notion + скрипт сходились до копейки.
//
// Главное отличие: скрипт считал раз в сутки и складывал результат в поля
// Notion, здесь всё считается на лету при каждом открытии экрана. Хранить
// нечего — источник истины это активы и операции, остальное производная.

import * as D from './dates.js';
import * as F from './fmt.js';

export const STATUS_ACTIVE = 'Активен';
export const STATUS_FROZEN = 'Заморожен';
export const STATUS_SOLD = 'Продан';
export const STATUS_PLANNED = 'Планируется';

export const TYPE_MONEY = 'Деньги';
export const TYPE_INVESTMENT = 'Инвестиции';

export const LIQUIDITY_INSTANT = 'Мгновенная';

export const OP_CONTRIBUTION = 'Взнос';
export const OP_INCOME = 'Доход';
export const OP_EXPENSE = 'Расход';

export const SOURCE_MANUAL = 'Вручную';
export const SOURCE_COMPUTED = 'Расчёт';

/**
 * Классы портфеля. Список закрытый и задаётся у каждого актива вручную.
 *
 * Раньше класс выводился из тикера через таблицу соответствий, и это давало
 * две беды сразу. Актив без тикера — вклад, накопительный счёт — в портфель
 * попасть не мог вовсе, хотя это такие же денежные активы. А актив с типом
 * «Инвестиции», но без тикера — машина, квартира — наоборот проваливался
 * в запасной класс «Прочее» и перекашивал доли на миллионы.
 *
 * Пустой класс означает «не входит в расчёт долей». Это и есть место
 * для машины: она часть капитала, но не часть портфеля.
 */
export const ASSET_CLASSES = ['Акции', 'Фонды', 'Облигации', 'Вклады'];

export const GOAL_ACTIVE = 'Активна';
export const GOAL_PAUSED = 'На паузе';
export const GOAL_DONE = 'Достигнута';

/** Взнос и доход прибавляют, расход отнимает. */
export function signed(op) {
  const amount = op.amount || 0;
  return op.type === OP_EXPENSE ? -amount : amount;
}

// --------------------------------------------------------------------------
// Стоимость и капитал
// --------------------------------------------------------------------------

/**
 * Повторяет формулу «Стоимость» из Notion: актив с тикером стоит
 * Количество × Цена, остальные — начальный остаток плюс движение по операциям.
 */
export function assetValue(asset, operations) {
  if (asset.ticker) {
    return (asset.quantity || 0) * (asset.price || 0);
  }
  let movement = 0;
  for (const op of operations) {
    if (op.assetId === asset.id) movement += signed(op);
  }
  return (asset.opening || 0) + movement;
}

export function netWorth(assets, operations) {
  const alive = assets.filter((a) => a.status !== STATUS_SOLD);
  let total = 0;
  let liquid = 0;
  let invested = 0;
  for (const a of alive) {
    const v = assetValue(a, operations);
    total += v;
    if (a.liquidity === LIQUIDITY_INSTANT) liquid += v;
    if (a.type === TYPE_INVESTMENT) invested += v;
  }
  return { total, liquid, invested };
}

/**
 * Доли по классам. В базу входит только то, чему класс задан явно.
 *
 * Замороженные не в счёт намеренно: актив, который не продаётся и не
 * докупается, перекосил бы доли навсегда, а колонка «Действие» превратилась
 * бы в бесполезное «докупить» по всем остальным классам.
 */
export function portfolioShares(assets, operations) {
  const byClass = new Map();
  for (const name of ASSET_CLASSES) byClass.set(name, 0);

  for (const a of assets) {
    if (a.status !== STATUS_ACTIVE) continue;
    if (!ASSET_CLASSES.includes(a.assetClass)) continue;
    byClass.set(a.assetClass, byClass.get(a.assetClass) + assetValue(a, operations));
  }

  let total = 0;
  for (const v of byClass.values()) total += v;
  return { total, byClass };
}

/**
 * Строки портфеля: по одной на каждый класс, всегда все четыре.
 *
 * Класс без денег не прячется: нулевая строка с целевой долей — это и есть
 * сообщение «сюда ничего не вложено», и оно нужнее пустого места.
 */
export function portfolioRows(assets, operations, portfolio) {
  const { total, byClass } = portfolioShares(assets, operations);
  const targets = new Map((portfolio || []).map((r) => [r.class, r]));

  const rows = ASSET_CLASSES.map((name) => {
    const row = targets.get(name);
    const value = byClass.get(name) || 0;
    const share = total > 0 ? (value / total) * 100 : null;
    return {
      id: row?.id || `cls-${name}`,
      class: name,
      targetShare: row?.targetShare ?? null,
      value,
      share,
      action: action(row?.targetShare ?? null, share),
    };
  });

  return { rows, total };
}

function action(target, share) {
  if (target == null) return 'цель не задана';
  if (share == null) return 'нет данных';
  const gap = share - target;
  if (Math.abs(gap) < 1) return 'в норме';
  return gap > 0 ? 'продать' : 'докупить';
}

// --------------------------------------------------------------------------
// Проценты
// --------------------------------------------------------------------------

/**
 * Учитывает короткие месяцы: если капитализация 31-го, а в месяце 30 дней,
 * начисление происходит в последний день месяца — иначе в феврале
 * оно не сработало бы вовсе.
 */
export function isCapitalisationDay(day, capDay) {
  const { y, m, d } = D.parts(day);
  const last = D.lastDayOfMonth(y, m);
  return capDay > last ? d === last : d === capDay;
}

/**
 * Проценты на ежедневный остаток с последней капитализации.
 *
 * Остаток восстанавливается из операций, поэтому ежедневные пополнения
 * учитываются корректно: каждый взнос начинает работать со следующего дня.
 * Год фактический, 365 или 366 дней.
 *
 * При ежедневной капитализации начисленное сразу причисляется к остатку
 * и дальше само приносит доход.
 */
export function accrue(asset, operations, day) {
  if (!asset.rate) return 0;

  const own = operations.filter((op) => op.assetId === asset.id && D.isValid(op.date));

  let start = asset.lastCap;
  if (!start) {
    const dates = own.map((op) => op.date).sort();
    start = dates.length ? dates[0] : day;
  }
  if (D.diffDays(start, day) >= 0) return 0;

  const byDay = new Map();
  let balance = asset.opening || 0;
  for (const op of own) {
    if (D.diffDays(op.date, start) <= 0) {
      balance += signed(op);
    } else {
      byDay.set(op.date, (byDay.get(op.date) || 0) + signed(op));
    }
  }

  let accrued = 0;
  let cursor = D.toDays(start) + 1;
  const end = D.toDays(day);
  while (cursor <= end) {
    const current = D.fromDays(cursor);
    balance += byDay.get(current) || 0;
    const interest = (balance * asset.rate) / 100 / D.yearDays(D.parts(current).y);
    accrued += interest;
    if (asset.capDaily) balance += interest;
    cursor += 1;
  }

  // Вычитаем проценты, уже записанные внутри периода.
  //
  // Раньше этого не было, и не было нужно: операцию «Доход» создавал скрипт
  // ровно в день капитализации, внутри периода записей не появлялось.
  // Как только доход записывается посреди периода — руками или кнопкой
  // «Записать разницу» — формула насчитывает его заново, и в день
  // капитализации те же деньги предлагаются к записи второй раз.
  // Проверено расчётом: 3,96 записанные 25 июля давали 3,97 лишних.
  //
  // Начисление на сам записанный доход при этом остаётся: деньги лежат
  // на счёте и работают, это новые проценты, а не те же самые.
  //
  // Операции в день капитализации и раньше не трогаем — они уже вошли
  // в начальный остаток периода.
  let recorded = 0;
  for (const op of own) {
    if (op.type !== OP_INCOME) continue;
    if (D.diffDays(op.date, start) <= 0) continue;
    recorded += op.amount || 0;
  }

  return Math.max(0, accrued - recorded);
}

/** Начисляет ли скрипт проценты по этому активу вообще. */
export function accrues(asset) {
  if (asset.ticker) return false;
  if (!asset.rate) return false;
  if (asset.status === STATUS_SOLD) return false;
  // В «Начальном остатке» сумма при закрытии — проценты уже внутри.
  // Начислять их ещё раз значило бы посчитать доход дважды.
  if (asset.maturitySum) return false;
  return true;
}

/**
 * Что должно произойти с процентами на дату: просто накопиться
 * или превратиться в операцию «Доход».
 *
 * Операция создаётся одна в месяц даже при ежедневной капитализации:
 * 365 записей «Доход» в год сделали бы журнал и календарь нечитаемыми,
 * а на итоговую сумму формат записи не влияет — она посчитана по дням.
 */
export function pendingAccruals(assets, operations, day) {
  const out = [];
  for (const asset of assets) {
    if (!accrues(asset)) continue;
    const accrued = accrue(asset, operations, day);
    const capDay = asset.capDay ? Number(asset.capDay) : null;
    const fires =
      capDay != null &&
      isCapitalisationDay(day, capDay) &&
      asset.lastCap !== day &&
      round2(accrued) > 0;
    out.push({ asset, accrued, fires });
  }
  return out;
}

// --------------------------------------------------------------------------
// Налог на проценты
// --------------------------------------------------------------------------

/** Проценты, полученные в календарном году. Взносы не доход и сюда не идут. */
export function interestReceived(operations, year) {
  let sum = 0;
  for (const op of operations) {
    if (op.type !== OP_INCOME) continue;
    if (!D.isValid(op.date)) continue;
    if (D.parts(op.date).y !== year) continue;
    sum += op.amount || 0;
  }
  return sum;
}

/** Ставка, действовавшая на конкретную дату — последняя не позже дня. */
export function rateOn(series, day) {
  let value = null;
  for (const point of [...series].sort((a, b) => (a.date < b.date ? -1 : 1))) {
    if (D.diffDays(point.date, day) <= 0) value = point.rate;
    else break;
  }
  return value;
}

/**
 * Необлагаемый лимит = 1 млн × макс. ключевая ставка на 1-е число месяца.
 * Считаются первые числа всех прошедших месяцев года. Лимит в течение года
 * может только расти, поэтому за основу берётся максимум.
 */
export function taxLimit(series, day, base = 1000000) {
  if (!series || !series.length) return null;
  const { y, m } = D.parts(day);
  const rates = [];
  for (let i = 1; i <= m; i += 1) {
    const first = D.iso(y, i, 1);
    if (D.diffDays(first, day) > 0) continue;
    const value = rateOn(series, first);
    if (value != null) rates.push(value);
  }
  if (!rates.length) return null;
  const max = Math.max(...rates);
  return { limit: (base * max) / 100, maxRate: max };
}

export function taxRow(tax, operations, keyRate, day, settings) {
  const year = D.parts(day).y;
  const row = tax.find((t) => t.year === year) || {
    year,
    ndflRate: 13,
    limit: null,
    limitManual: false,
  };
  const received = interestReceived(operations, year);

  let limit = row.limit;
  if (!row.limitManual) {
    const computed = taxLimit(keyRate, day, settings.taxLimitBase || 1000000);
    // Лимит может только расти в течение года — берём больший из известных.
    if (computed && (limit == null || computed.limit > limit)) limit = computed.limit;
  }

  const taxable = limit == null ? null : Math.max(0, received - limit);
  const tax_ = taxable == null ? null : (taxable * (row.ndflRate || 0)) / 100;
  return { ...row, limit, received, taxable, tax: tax_ };
}

// --------------------------------------------------------------------------
// Цели
// --------------------------------------------------------------------------

export function goalAssets(goal, assets) {
  return assets.filter((a) => (a.goalIds || []).includes(goal.id));
}

/**
 * Дата, к которой цель наберёт нужную сумму при текущем темпе.
 *
 * Темп = план взносов плюс дневной процент по накопительным активам цели.
 * Проекция помесячная со сложным процентом, потолок — 10 лет, чтобы
 * бесконечный цикл не случился при нулевом темпе.
 *
 * Проекция линейная по плану: она не знает, что вы можете пропустить взнос
 * или поменять сумму. Это оценка «если так же, как сейчас», не обещание.
 */
export function goalMetrics(goal, assets, operations, day) {
  const linked = goalAssets(goal, assets);
  const current = linked.reduce((sum, a) => sum + assetValue(a, operations), 0);
  const target = goal.target || 0;
  const plan = goal.planPerDay || 0;

  const rates = linked.map((a) => a.rate).filter((r) => r);
  const yearRate = rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : 0;
  const dailyGrowth = plan + (yearRate ? (current * yearRate) / 100 / 365 : 0);

  let forecast = null;
  if (current >= target && target > 0) {
    forecast = day;
  } else if (dailyGrowth > 0) {
    let balance = current;
    let cursor = D.toDays(day);
    for (let i = 0; i < 3660; i += 1) {
      cursor += 1;
      balance += plan;
      if (yearRate) balance += (balance * yearRate) / 100 / 365;
      if (balance >= target) {
        forecast = D.fromDays(cursor);
        break;
      }
    }
  }

  const daysLeft = goal.deadline ? D.diffDays(goal.deadline, day) : null;
  const needPerDay =
    daysLeft != null && daysLeft > 0 ? Math.max(0, (target - current) / daysLeft) : null;
  const reserveDays = goal.deadline && forecast ? D.diffDays(goal.deadline, forecast) : null;

  return {
    goal,
    assets: linked,
    current,
    target,
    progress: target > 0 ? current / target : null,
    dailyGrowth,
    forecast,
    daysLeft,
    needPerDay,
    reserveDays,
    planCompletion: planCompletion(goal, operations, day),
  };
}

/**
 * Какая доля плана этого месяца уже внесена. 100% — идёте ровно.
 *
 * Считаются только взносы: проценты банка увеличивают остаток и прогресс,
 * но в дисциплину не попадают, иначе она выглядела бы лучше, чем есть.
 */
export function planCompletion(goal, operations, day) {
  const plan = goal.planPerDay || 0;
  if (!plan) return null;
  const m = D.month(day);
  const elapsed = D.parts(day).d;
  let done = 0;
  for (const op of operations) {
    if (op.goalId !== goal.id) continue;
    if (op.type !== OP_CONTRIBUTION) continue;
    if (!D.isValid(op.date) || D.month(op.date) !== m) continue;
    done += op.amount || 0;
  }
  const expected = plan * elapsed;
  return expected > 0 ? done / expected : null;
}

// --------------------------------------------------------------------------
// Сигналы
// --------------------------------------------------------------------------

/**
 * Что требует внимания. Пусто — система в порядке.
 * Первые три правила повторяют формулу «Сигнал» из Notion, остальные
 * добавлены здесь: в Notion их проверить было нечем.
 */
export function signals(assets, operations, day) {
  const out = [];
  // extra — то, что нужно не для показа, а для действия по сигналу. Пока это
  // только величина расхождения: считать её второй раз во вьюхе значило бы
  // держать формулу в двух местах.
  const push = (asset, kind, text, level = 'warn', extra = null) =>
    out.push({ asset, kind, text, level, ...(extra || {}) });

  for (const a of assets) {
    if (a.status === STATUS_SOLD) continue;

    if (a.type === TYPE_MONEY && a.status === STATUS_ACTIVE) {
      if (!a.rate) push(a, 'no-rate', 'ставка не заполнена — проценты не начисляются');
      if (!a.reconciledAt) push(a, 'never-reconciled', 'ни разу не сверялся с банком');
      else if (D.diffDays(day, a.reconciledAt) > 31) {
        push(a, 'reconcile-overdue', `сверка просрочена на ${D.diffDays(day, a.reconciledAt) - 31} дн.`);
      }
    }

    if (a.bankBalance != null) {
      const gap = a.bankBalance - assetValue(a, operations);
      if (Math.abs(gap) >= 1) {
        // Форматирование здесь, а не сырое число: текст сигнала человек читает,
        // и «+3.96 ₽» рядом с кнопкой «Записать разницу 3,96 ₽» выглядело бы
        // как два разных числа.
        push(a, 'bank-gap', `расхождение с банком ${gap > 0 ? '+' : ''}${F.money2(round2(gap))}`, 'warn', {
          gap: round2(gap),
        });
      }
    }

    if ((a.goalIds || []).length > 1) {
      push(
        a,
        'multi-goal',
        `привязан к нескольким целям (${a.goalIds.length}) — деньги считаются дважды`,
        'error',
      );
    }

    if (a.ticker && a.updated && D.diffDays(day, a.updated) > 5) {
      push(a, 'stale-price', `цена не обновлялась ${D.diffDays(day, a.updated)} дн.`, 'info');
    }
    if (a.ticker && !a.price) push(a, 'no-price', 'нет цены — стоимость считается нулевой');

    if (a.maturityDate && D.diffDays(a.maturityDate, day) >= 0 && D.diffDays(a.maturityDate, day) <= 30) {
      push(a, 'maturity', `погашение через ${D.diffDays(a.maturityDate, day)} дн.`, 'info');
    }
  }
  return out;
}

/**
 * Опознавательный ключ сигнала: актив и вид правила.
 *
 * Формулировка в ключ не входит — она меняется вместе с цифрами. Зато
 * скрытие хранит её отдельно, и по ней видно, тот же это сигнал или уже
 * другой: расхождение на 4 ₽ и расхождение на 4000 ₽ — не одно и то же.
 */
export function signalKey(signal) {
  return `${signal.asset.id}:${signal.kind}`;
}

/**
 * Разложить сигналы на видимые и скрытые.
 *
 * Скрытие — это «я это видел и согласен», а не «не показывай никогда».
 * Поэтому сигнал возвращается, если формулировка изменилась: иначе однажды
 * скрытое расхождение на копейку молча прикрыло бы расхождение на сто тысяч.
 */
export function splitSignals(list, muted) {
  const byKey = new Map();
  for (const m of muted || []) {
    if (typeof m === 'string') byKey.set(m, null);
    else if (m && m.key) byKey.set(m.key, m.text == null ? null : m.text);
  }

  const shown = [];
  const hidden = [];
  for (const s of list) {
    const key = signalKey(s);
    if (byKey.has(key) && (byKey.get(key) === null || byKey.get(key) === s.text)) hidden.push(s);
    else shown.push(s);
  }
  return { shown, hidden };
}

// --------------------------------------------------------------------------

export function round2(x) {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

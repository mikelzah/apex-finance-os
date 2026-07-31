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

/**
 * Сделки по бумагам. Отдельный вид операции, а не «взнос на актив».
 *
 * У вклада операция это движение денег: внёс — остаток вырос. У бумаги так
 * не выходит: её стоимость считается как количество × цена, и записанный
 * на неё взнос не менял ровным счётом ничего — количество оставалось
 * прежним, а деньги пропадали. Сделка меняет то, что у бумаги меняется
 * на самом деле: количество.
 */
export const OP_BUY = 'Покупка';
export const OP_SELL = 'Продажа';

/**
 * Выплаты по бумаге. Тоже отдельно, и по той же причине, что сделки.
 *
 * Дивиденд не «доход» в смысле этого приложения. «Доход» здесь — проценты
 * банка: они входят в необлагаемый лимит по вкладам и вычитаются из
 * начисления, чтобы не посчитаться дважды. Дивиденд не делает ни того,
 * ни другого: налог с него удерживает брокер, и к вкладу он отношения
 * не имеет. Назвать его доходом значило бы испортить оба расчёта разом.
 */
export const OP_DIVIDEND = 'Дивиденд';
export const OP_COUPON = 'Купон';

export const OP_TYPES = [
  OP_CONTRIBUTION, OP_INCOME, OP_EXPENSE, OP_BUY, OP_SELL, OP_DIVIDEND, OP_COUPON,
];

export function isTrade(op) {
  return Boolean(op) && (op.type === OP_BUY || op.type === OP_SELL);
}

export function isPayout(op) {
  return Boolean(op) && (op.type === OP_DIVIDEND || op.type === OP_COUPON);
}

/** Всё, что записывается на бумагу, а не на счёт. */
export function isPaperOp(op) {
  return isTrade(op) || isPayout(op);
}

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

/**
 * Цели в том порядке, в каком их расставили.
 *
 * Поле sort ставится при перетаскивании и при заведении цели. У цели без него
 * порядок берётся по статусу — тем же правилом, что действовало раньше:
 * так список из старых данных выглядит ровно как выглядел, пока его не тронут.
 */
export function orderedGoals(goals) {
  const byStatus = { [GOAL_ACTIVE]: 0, [GOAL_PAUSED]: 1, [GOAL_DONE]: 2 };
  return [...goals].sort((a, b) => {
    const x = Number.isFinite(a.sort) ? a.sort : 100 + (byStatus[a.status] ?? 3);
    const y = Number.isFinite(b.sort) ? b.sort : 100 + (byStatus[b.status] ?? 3);
    return x - y;
  });
}

/**
 * Взнос и доход прибавляют, расход отнимает.
 *
 * Операции по бумаге дают ноль не по недосмотру, а по существу. Сделка —
 * обмен: бумаг стало больше, денег на счёте меньше. Выплата — приход, но
 * приходит он на счёт, а не в бумагу. И в том, и в другом случае деньги
 * двигает отдельная операция по самому счёту, привязанная к этой. Считай
 * приложение деньгами обе — и одна покупка уменьшила бы капитал дважды.
 */
export function signed(op) {
  if (isPaperOp(op)) return 0;
  const amount = op.amount || 0;
  return op.type === OP_EXPENSE ? -amount : amount;
}

/** Деньги по сделке: комиссия удорожает покупку и уменьшает выручку. */
export function tradeAmount(op) {
  const gross = (op.quantity || 0) * (op.unitPrice || 0);
  const fee = op.fee || 0;
  return op.type === OP_SELL ? gross - fee : gross + fee;
}

/**
 * Сколько денег прошло по операции с бумагой.
 *
 * У сделки считается из количества и цены — так исправление цены сразу
 * меняет сумму. У выплаты сумма и есть исходные данные: делить её обратно
 * на бумаги незачем, в отчёте брокера она стоит одной строкой.
 */
export function paperAmount(op) {
  return isTrade(op) ? tradeAmount(op) : op.amount || 0;
}

// --------------------------------------------------------------------------
// Стоимость и капитал
// --------------------------------------------------------------------------

// --------------------------------------------------------------------------
// Облигации
// --------------------------------------------------------------------------

/**
 * Облигация — это номинал.
 *
 * Признак не «класс = Облигации», а заполненный номинал, и это не придирка.
 * От номинала зависит, как читать цену: у облигации биржа котирует её
 * в процентах от номинала, а не в рублях. Пока номинал не задан, приложение
 * не имеет права толковать 98,4 как 984 рубля — с тем же успехом это могли
 * бы быть 98 рублей 40 копеек. Заполненный номинал и есть то самое разрешение.
 */
export function isBond(asset) {
  return Boolean(asset && asset.faceValue);
}

/** Сколько платят за одну бумагу в один купон. */
export function couponAmount(asset) {
  if (!isBond(asset) || !asset.couponRate) return 0;
  const perYear = asset.couponsPerYear || 2;
  return (asset.faceValue * asset.couponRate) / 100 / perYear;
}

/** Купон до и купон после указанного дня. */
export function couponAround(asset, day) {
  if (!isBond(asset) || !D.isValid(asset.nextCoupon)) return { prev: null, next: null };
  const step = 12 / (asset.couponsPerYear || 2);
  let next = asset.nextCoupon;
  let prev = D.addMonths(next, -step);

  // Отматываем вперёд, пока купон не окажется в будущем: дата в карточке
  // могла быть заполнена год назад и с тех пор не трогалась.
  //
  // Сам день выплаты считается уже прошедшим: купон в этот день выплачен,
  // и накопленный доход начинает копиться заново с нуля. Оставь здесь строгое
  // сравнение — и в день купона приложение показало бы полный НКД, то есть
  // деньги, которые только что ушли на счёт, вторым разом внутри бумаги.
  let guard = 0;
  while (D.diffDays(next, day) <= 0 && guard < 400) {
    prev = next;
    next = D.addMonths(next, step);
    guard += 1;
  }
  while (D.diffDays(prev, day) > 0 && guard < 400) {
    next = prev;
    prev = D.addMonths(prev, -step);
    guard += 1;
  }
  if (D.isValid(asset.maturityDate) && D.diffDays(next, asset.maturityDate) > 0) {
    next = asset.maturityDate;
  }
  return { prev, next };
}

/**
 * Накопленный купонный доход на одну бумагу.
 *
 * Купон капает каждый день, а платится раз в квартал или полугодие. НКД —
 * то, что уже накопилось, но ещё не выплачено: покупатель платит его продавцу
 * сверх цены, и в стоимости бумаги он лежит на равных с самой ценой.
 */
export function accruedCoupon(asset, day) {
  const { prev, next } = couponAround(asset, day);
  if (!prev || !next) return 0;
  const span = D.diffDays(next, prev);
  if (span <= 0) return 0;
  const passed = Math.min(span, Math.max(0, D.diffDays(day, prev)));
  return (couponAmount(asset) * passed) / span;
}

/** Чистая цена одной облигации в рублях: котировка в процентах от номинала. */
export function bondClean(asset) {
  return ((asset.price || 0) / 100) * (asset.faceValue || 0);
}

/** Полная цена одной бумаги — с накопленным купоном. */
export function bondFull(asset, day) {
  return bondClean(asset) + accruedCoupon(asset, day);
}

/**
 * Ближайшие выплаты по всем облигациям набора.
 *
 * Сколько и когда придёт — единственное, ради чего облигацию и держат.
 * Без этого списка дата ближайшего купона лежит в карточке актива и никем
 * не читается.
 */
export function couponCalendar(assets, operations, day, horizonDays = 400) {
  const out = [];
  for (const a of assets) {
    if (!isBond(a) || a.status === STATUS_SOLD) continue;
    const qty = assetQuantity(a, operations);
    if (qty <= 0) continue;
    const step = 12 / (a.couponsPerYear || 2);
    let date = couponAround(a, day).next;
    const per = couponAmount(a);
    let guard = 0;
    while (date && D.diffDays(date, day) >= 0 && D.diffDays(date, day) <= horizonDays && guard < 40) {
      const last = D.isValid(a.maturityDate) && D.diffDays(date, a.maturityDate) >= 0;
      out.push({
        asset: a,
        date,
        amount: per * qty,
        // В день погашения вместе с купоном возвращается номинал —
        // и это самая крупная выплата за всю жизнь бумаги.
        redemption: last ? a.faceValue * qty : 0,
      });
      if (last) break;
      date = D.addMonths(date, step);
      guard += 1;
    }
  }
  return out.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
}

/**
 * Сколько бумаг на руках: начальное количество плюс сделки.
 *
 * Количество в карточке актива — начальное, как opening у счёта. Держать
 * его как «текущее» и править при каждой сделке значило бы хранить
 * производную величину: правка или удаление сделки её бы уже не поправили,
 * и остаток тихо разошёлся бы с историей.
 */
export function assetQuantity(asset, operations) {
  let q = asset.quantity || 0;
  for (const op of operations) {
    if (op.assetId !== asset.id || !isTrade(op)) continue;
    q += op.type === OP_BUY ? op.quantity || 0 : -(op.quantity || 0);
  }
  return q;
}

/**
 * Повторяет формулу «Стоимость» из Notion: актив с тикером стоит
 * Количество × Цена, остальные — начальный остаток плюс движение по операциям.
 */
export function assetValue(asset, operations, day = null) {
  if (asset.ticker) {
    const qty = assetQuantity(asset, operations);
    // У облигации котировка идёт в процентах от номинала, и к цене
    // добавляется накопленный купон: он уже заработан и при продаже
    // достанется владельцу вместе с ценой.
    if (isBond(asset)) return qty * bondFull(asset, day || D.today());
    return qty * (asset.price || 0);
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
    const targetShare = row?.targetShare ?? null;
    return {
      id: row?.id || `cls-${name}`,
      class: name,
      targetShare,
      value,
      share,
      // Отклонение в рублях, а не в процентах: «33,49% из 30%» — это диагноз,
      // а «продать на 45 000 ₽» — назначение. Второе можно выполнить.
      gap: targetShare == null || total <= 0 ? null : round2((targetShare / 100) * total - value),
      action: action(targetShare, share),
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

/**
 * Ребалансировка довложением: сколько докупить, ничего не продавая.
 *
 * «Продать» — плохой совет по умолчанию. Продажа тянет за собой налог
 * и обнуляет срок владения, а докупка не делает ни того, ни другого. Если
 * деньги на взносы есть, перекос лечится ими, и вопрос только в том, сколько
 * и куда.
 *
 * Считается так: перевес есть у того класса, у которого отношение нынешней
 * стоимости к целевой доле самое большое, — им и определяется будущий размер
 * портфеля, потому что уменьшать его нельзя, не продавая. Остальные классы
 * добираются до своих долей от этого размера.
 */
export function rebalanceByAdding(rows) {
  const known = rows.filter((r) => r.targetShare != null && r.targetShare > 0);
  if (!known.length) return null;

  // Размер портфеля, при котором ни один класс не окажется выше своей доли.
  let futureTotal = 0;
  for (const r of known) {
    futureTotal = Math.max(futureTotal, (r.value / r.targetShare) * 100);
  }

  const items = known
    .map((r) => ({ class: r.class, add: round2((r.targetShare / 100) * futureTotal - r.value) }))
    .filter((x) => x.add >= 1)
    .sort((x, y) => y.add - x.add);

  const total = round2(items.reduce((s, x) => s + x.add, 0));
  return total >= 1 ? { total, items, futureTotal: round2(futureTotal) } : null;
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
// Лоты и льгота за долгое владение
// --------------------------------------------------------------------------

/** Полных лет между датами — как их считает налоговая, а не делением на 365. */
export function fullYears(from, to) {
  if (!D.isValid(from) || !D.isValid(to)) return 0;
  const a = D.parts(from);
  const b = D.parts(to);
  let years = b.y - a.y;
  if (b.m < a.m || (b.m === a.m && b.d < a.d)) years -= 1;
  return Math.max(0, years);
}

// Льгота за долгое владение: три полных года, 3 миллиона за каждый год.
export const LDV_YEARS = 3;
export const LDV_PER_YEAR = 3000000;

/**
 * Открытые лоты по бумаге, в порядке покупки.
 *
 * Продажи гасят самые старые покупки — так же, как считает налоговая, и так же,
 * как это делает брокер в отчёте. Порядок здесь не техническая деталь: от него
 * зависит и цена входа оставшегося, и срок владения, а значит и льгота.
 *
 * Начальное количество, заведённое без сделки, попадает в отдельный лот
 * с неизвестной ценой: выбросить его нельзя — бумаги-то есть, — а придумать
 * ему цену значило бы соврать про прибыль при продаже.
 */
export function lotsOf(asset, operations) {
  const own = operations
    .filter((op) => op.assetId === asset.id && isTrade(op) && D.isValid(op.date))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const open = [];
  if (asset.quantity) {
    open.push({
      date: asset.openingDate || null,
      quantity: asset.quantity,
      unitCost: null,
      unknown: true,
    });
  }

  for (const op of own) {
    if (op.type === OP_BUY) {
      const qty = op.quantity || 0;
      if (!qty) continue;
      open.push({
        date: op.date,
        quantity: qty,
        // Комиссия — часть цены входа: она уплачена за то, чтобы бумага
        // оказалась на счету, и при продаже уменьшает прибыль.
        unitCost: tradeAmount(op) / qty,
        unknown: false,
      });
      continue;
    }
    let left = op.quantity || 0;
    for (const lot of open) {
      if (left <= 0) break;
      const take = Math.min(lot.quantity, left);
      lot.quantity -= take;
      left -= take;
    }
  }

  return open.filter((lot) => lot.quantity > 0.0000001);
}

/** Дошёл ли лот до льготы, и сколько осталось. */
export function ldvStatus(lot, day) {
  if (!lot.date || !D.isValid(lot.date)) return { known: false, eligible: false, daysLeft: null, years: 0 };
  const years = fullYears(lot.date, day);
  const target = D.addYears(lot.date, LDV_YEARS);
  const daysLeft = Math.max(0, D.diffDays(target, day));
  return { known: true, eligible: years >= LDV_YEARS, daysLeft, years, ready: target };
}

/**
 * Что будет, если продать столько-то бумаг по такой-то цене.
 *
 * Гасятся старые лоты, из выручки вычитается их цена входа, к прибыли
 * применяется льгота — три миллиона за каждый полный год владения, но только
 * к тем лотам, которые до трёх лет дожили. Лот с неизвестной ценой входа
 * считается отдельно: прибыль по нему неизвестна, и вид, будто она нулевая,
 * занизил бы налог.
 */
export function saleOutcome(asset, operations, quantity, unitPrice, day, ndflRate = 13) {
  const lots = lotsOf(asset, operations).map((lot) => ({ ...lot }));
  const proceeds = (quantity || 0) * (unitPrice || 0);

  let left = quantity || 0;
  let cost = 0;
  let profit = 0;
  let exemptLimit = 0;
  let exemptProfit = 0;
  let unknownQty = 0;
  const touched = [];

  for (const lot of lots) {
    if (left <= 0) break;
    const take = Math.min(lot.quantity, left);
    left -= take;
    touched.push({ ...lot, taken: take });

    if (lot.unknown) {
      unknownQty += take;
      continue;
    }
    const lotCost = lot.unitCost * take;
    const lotProfit = take * (unitPrice || 0) - lotCost;
    cost += lotCost;
    profit += lotProfit;

    const st = ldvStatus(lot, day);
    if (st.eligible && lotProfit > 0) {
      exemptProfit += lotProfit;
      exemptLimit += LDV_PER_YEAR * st.years;
    }
  }

  const exempt = Math.min(exemptProfit, exemptLimit);
  const taxable = Math.max(0, profit - exempt);
  return {
    proceeds,
    cost,
    profit,
    exempt,
    taxable,
    tax: (taxable * (ndflRate || 0)) / 100,
    unknownQty,
    short: left,
    lots: touched,
  };
}

// --------------------------------------------------------------------------
// Доходность
// --------------------------------------------------------------------------

/**
 * Денежно-взвешенная доходность, годовых.
 *
 * «Прибыль» на странице бумаги отвечает на вопрос «сколько я заработал»,
 * но не на вопрос «а стоило ли»: сто рублей за месяц и сто рублей за пять лет
 * — совсем разные вложения. Доходность учитывает, когда именно деньги были
 * вложены, и потому сравнима между бумагами и с любым вкладом.
 *
 * Считается как ставка, при которой сегодняшняя стоимость всех потоков равна
 * нулю. Уравнение решается делением отрезка, а не касательными: у Ньютона
 * на денежных потоках с чередующимися знаками бывает по нескольку корней,
 * и он уходит то в минус бесконечность, то в расходимость. Деление отрезка
 * медленнее на сотые доли миллисекунды и всегда сходится.
 */
export function xirr(flows, day) {
  const list = flows.filter((f) => f && D.isValid(f.date) && f.amount);
  if (list.length < 2) return null;
  // Нужны потоки обоих знаков: без вложения нечего окупать, без возврата
  // нечему окупаться — в обоих случаях ставки не существует.
  if (!list.some((f) => f.amount > 0) || !list.some((f) => f.amount < 0)) return null;

  const t0 = D.toDays(list[0].date);
  const npv = (rate) => {
    let sum = 0;
    for (const f of list) {
      const years = (D.toDays(f.date) - t0) / 365;
      sum += f.amount / (1 + rate) ** years;
    }
    return sum;
  };

  // Разумные границы: −99,99% это «потеряно всё», 100 000% — потолок, за
  // которым число уже ничего не сообщает, кроме «очень много».
  let lo = -0.9999;
  let hi = 1000;
  let flo = npv(lo);
  let fhi = npv(hi);
  if (!Number.isFinite(flo) || !Number.isFinite(fhi) || flo * fhi > 0) return null;

  for (let i = 0; i < 200; i += 1) {
    const mid = (lo + hi) / 2;
    const f = npv(mid);
    if (!Number.isFinite(f)) return null;
    if (Math.abs(f) < 1e-7 || hi - lo < 1e-9) return mid;
    if (flo * f <= 0) { hi = mid; fhi = f; } else { lo = mid; flo = f; }
  }
  return (lo + hi) / 2;
}

/**
 * Денежные потоки набора активов — то, что пересекло его границу.
 *
 * Правило одно и работает на любом уровне: считается только то, что вошло
 * в набор извне или вышло наружу. Покупка бумаги со счёта, который тоже
 * в наборе, даёт минус по бумаге и плюс по счёту — в сумме ноль, и это
 * верно: деньги не появились и не исчезли, они переложились. А та же покупка
 * при взгляде на одну бумагу — настоящее вложение, и границу она пересекает.
 *
 * Проценты банка потоком не считаются никогда: это рост внутри набора,
 * он уже сидит в конечной стоимости. Посчитать их ещё и потоком значило бы
 * потребовать, чтобы они окупились сами собой.
 */
export function flowsOf(assets, operations, day) {
  const ids = new Set(assets.map((a) => a.id));
  const flows = [];
  for (const op of operations) {
    if (!ids.has(op.assetId) || !D.isValid(op.date)) continue;
    const amount = isPaperOp(op) ? paperAmount(op) : op.amount || 0;
    if (!amount) continue;
    if (op.type === OP_BUY || op.type === OP_CONTRIBUTION) flows.push({ date: op.date, amount: -amount });
    else if (op.type === OP_SELL || op.type === OP_EXPENSE || isPayout(op)) flows.push({ date: op.date, amount });
  }

  // Начальный остаток счёта — тоже вложение, просто без операции. Без него
  // у счёта, заведённого «как есть», доходность вышла бы бесконечной:
  // возврат без вложения.
  //
  // У бумаги начального количества здесь нет намеренно: сколько за него
  // заплатили, неизвестно, а взять текущую цену значило бы объявить, что
  // куплено ровно по сегодняшней, — и выдать ноль процентов за правду.
  // Такие наборы отсекает returnKnown, сюда они не доходят.
  for (const a of assets) {
    if (a.ticker) continue;
    const openDate = a.openingDate;
    if (a.opening && D.isValid(openDate)) flows.push({ date: openDate, amount: -a.opening });
  }

  flows.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));

  // Замыкающий поток: сегодняшняя стоимость — это то, что можно было бы
  // забрать прямо сейчас, и без неё уравнение не о чем.
  const value = assets.reduce((s, a) => s + assetValue(a, operations), 0);
  if (value) flows.push({ date: day, amount: value });
  return flows;
}

/**
 * Можно ли вообще посчитать доходность этого набора.
 *
 * Нельзя, если в нём есть бумага с начальным количеством: цена её покупки
 * неизвестна, и любая доходность получилась бы придуманной. То же правило,
 * что и у прибыли на странице бумаги, — иначе одно и то же приложение
 * в одном месте отказывалось бы считать, а в другом бодро выдавало число
 * из ниоткуда.
 */
export function returnKnown(assets) {
  return assets.every((a) => !(a.ticker && (a.quantity || 0) > 0));
}

/** Доходность набора активов, годовых в процентах. Null — посчитать нельзя. */
export function returnOf(assets, operations, day) {
  if (!returnKnown(assets)) return null;
  const r = xirr(flowsOf(assets, operations, day), day);
  return r == null ? null : r * 100;
}

// --------------------------------------------------------------------------
// Вложено и наросло
// --------------------------------------------------------------------------

/**
 * Сколько своих денег вложено к этому дню.
 *
 * Капитал растёт по двум причинам, и это принципиально разные вещи: одну
 * я сделал сам, вторая случилась. Пока они смешаны в одной сумме, нельзя
 * понять ни насколько хорошо копится, ни насколько удачно вложено.
 *
 * Вложенное — то, что пришло извне: взносы на счета, покупки бумаг, за которые
 * не списано с внутреннего счёта. Внутренние переводы не считаются: покупка
 * со своего же счёта не добавляет ни рубля, она перекладывает. Проценты
 * и дивиденды тоже не вложение — это как раз то, что наросло.
 */
export function investedAt(assets, operations, day) {
  const ids = new Set(assets.map((a) => a.id));
  let sum = 0;

  for (const a of assets) {
    if (a.ticker || !a.opening) continue;
    // Начальный остаток — деньги, которые уже лежали на момент заведения.
    //
    // Дата тут нужна только для того, чтобы разложить вложения по времени.
    // Требовать её для самого зачёта было ошибкой: у вклада на 1 800 000
    // с незаполненной датой сумма известна прекрасно, а расчёт делал вид,
    // что этих денег не вкладывали вовсе, и записывал их в прирост.
    if (D.isValid(a.openingDate) && D.diffDays(day, a.openingDate) < 0) continue;
    sum += a.opening;
  }

  // Внутренний перевод состоит из двух половин: операции по бумаге и списания
  // со счёта. Выбросить надо обе. Выбросишь одну — и покупка со своего же
  // счёта запишется как вложение новых денег, которых не было.
  const paired = new Set();
  for (const op of operations) {
    if (op.linkedTo && ids.has(op.assetId)) paired.add(op.linkedTo);
  }

  for (const op of operations) {
    if (!ids.has(op.assetId) || !D.isValid(op.date)) continue;
    if (D.diffDays(day, op.date) < 0) continue;
    if (op.linkedTo || paired.has(op.id)) continue;
    if (op.type === OP_CONTRIBUTION || op.type === OP_BUY) sum += op.amount || 0;
    else if (op.type === OP_EXPENSE || op.type === OP_SELL || isPayout(op)) sum -= op.amount || 0;
  }
  return sum;
}

/**
 * Разложение истории капитала на вложенное и наросшее.
 *
 * Капитал берётся из снимков — пересчитать его задним числом нельзя: цены
 * бумаг за прошлые месяцы известны не всегда, а придумывать их значило бы
 * рисовать историю, которой не было. Вложенное, наоборот, считается точно:
 * операции записаны с датами.
 */
export function investedKnown(assets) {
  return returnKnown(assets);
}

export function growthSeries(assets, operations, snapshots, day, liveTotal) {
  // Бумага с начальным количеством ломает весь расчёт: сколько за неё
  // заплатили, неизвестно, а посчитать её вложением по нынешней цене значит
  // объявить прирост нулевым. Не посчитать вовсе — ещё хуже: тогда вся её
  // стоимость уезжает в «наросло», и приложение сообщает 29 283% прироста.
  //
  // Правило то же, что у прибыли и доходности: где входа не знаем, там
  // молчим. Число, которое нельзя посчитать, не заменяется числом, которое
  // можно.
  if (!investedKnown(assets)) return null;

  const rows = [...(snapshots || [])]
    .filter((r) => D.isValid(r.date))
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((r) => ({
      date: r.date,
      month: r.month,
      total: r.total || 0,
      invested: round2(investedAt(assets, operations, r.date)),
    }));

  // Сегодняшний день дописывается живым значением: снимок за текущий месяц
  // мог быть сделан первого числа, а с тех пор всё изменилось.
  if (liveTotal != null && (!rows.length || rows[rows.length - 1].date !== day)) {
    rows.push({
      date: day,
      month: D.month(day),
      total: liveTotal,
      invested: round2(investedAt(assets, operations, day)),
    });
  }

  for (const r of rows) r.growth = round2(r.total - r.invested);
  return rows;
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

    // Погашенная облигация не исчезает со счёта сама: деньги пришли, бумаги
    // больше нет, а в приложении она так и висит по последней котировке
    // и продолжает считаться капиталом. Пока продажа по номиналу не записана,
    // капитал завышен ровно на её стоимость.
    if (isBond(a) && D.isValid(a.maturityDate) && D.diffDays(day, a.maturityDate) > 0
        && assetQuantity(a, operations) > 0) {
      push(a, 'matured', `погашена ${F.date(a.maturityDate)} — запишите продажу по номиналу, иначе капитал завышен`, 'error');
    }
  }
  return out;
}

/**
 * Проверка данных: что посчитано не так и почему.
 *
 * Отличие от сигналов в том, на что они отвечают. Сигнал говорит «пора
 * что-то сделать»: сверить счёт, обновить цену. Проверка говорит «цифры,
 * которые ты видишь, неверны» — и это тише и опаснее. Актив, привязанный
 * к двум целям, не подаёт никаких признаков: обе цели просто показывают
 * прогресс, которого нет, а сумма по ним больше капитала.
 *
 * Каждая находка знает, куда идти чинить: проверка без адреса заставляет
 * искать виноватого руками.
 */
export function dataHealth(state, day) {
  const out = [];
  const add = (level, title, detail, go) => out.push({ level, title, detail, go });
  const alive = state.assets.filter((a) => a.status !== STATUS_SOLD);

  for (const a of alive) {
    const goals = (a.goalIds || []).filter((id) => state.goals.some((g) => g.id === id));
    if (goals.length > 1) {
      add('error', a.name,
        `привязан к ${goals.length} целям — его деньги засчитаны каждой, и сумма целей больше капитала`,
        `more/assets`);
    }
    if (a.type === TYPE_INVESTMENT && a.ticker && !ASSET_CLASSES.includes(a.assetClass)) {
      add('warn', a.name, 'бумага без класса — не входит в доли портфеля', `portfolio/${a.id}`);
    }
    if (a.ticker && (a.quantity || 0) > 0) {
      add('warn', a.name,
        'количество заведено без сделки — цена входа неизвестна, прибыль и доходность по ней не считаются',
        `portfolio/${a.id}`);
    }
    if (a.assetClass === 'Облигации' && !isBond(a)) {
      add('warn', a.name, 'облигация без номинала — цена считается рублями, а биржа даёт проценты', `portfolio/${a.id}`);
    }
    if (isBond(a) && !D.isValid(a.nextCoupon)) {
      add('warn', a.name, 'не задана дата купона — накопленный доход не считается', `portfolio/${a.id}`);
    }
    if (a.ticker && a.updated && D.diffDays(day, a.updated) > 14) {
      add('warn', a.name, `цена от ${F.date(a.updated)} — стоимость показана по устаревшей`, `portfolio/${a.id}`);
    }
    if (a.type === TYPE_MONEY && !a.rate) {
      add('info', a.name, 'ставка не заполнена — проценты по счёту не начисляются', 'more/assets');
    }
  }

  for (const g of state.goals) {
    if (g.status === GOAL_DONE) continue;
    if (!goalAssets(g, alive).length) {
      add('warn', g.name, 'к цели не привязан ни один актив — прогресс всегда нулевой', 'goals');
    }
  }

  // Операция без актива нигде не видна: в капитал она не входит, в остатке
  // не участвует и живёт в журнале как строка ни о чём.
  const orphans = state.operations.filter(
    (op) => !op.assetId || !state.assets.some((a) => a.id === op.assetId),
  );
  if (orphans.length) {
    add('error', 'Операции без актива', `${orphans.length} шт — не влияют ни на капитал, ни на цели`, 'journal');
  }

  const rank = { error: 0, warn: 1, info: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
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

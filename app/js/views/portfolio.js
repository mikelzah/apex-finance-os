// Портфель: сколько всего, что лежит, и только потом — доли.
//
// Порядок именно такой. Первый вопрос при открытии портфеля — «сколько
// у меня», второй — «в чём это лежит», и лишь третий — «насколько я отклонился
// от целевой структуры». Доли это проверка плана: она нужна реже, чем сумма,
// и потому идёт последней.
//
// В расчёт долей входит только то, чему класс задан явно в карточке актива.
// Всё остальное — машина, квартира — перечислено отдельным списком: это
// часть капитала, но не часть портфеля.
//
// Замороженные активы в доли не входят: актив, который не продаётся
// и не докупается, перекосил бы структуру навсегда, а колонка «Действие»
// превратилась бы в бесполезное «докупить» по всем остальным классам.

import * as U from '../ui.js';
import * as F from '../fmt.js';
import * as C from '../calc.js';
import * as D from '../dates.js';
import * as charts from '../charts.js';
import * as forms from '../forms.js';
import * as journal from './journal.js';
import * as moex from '../moex.js';
import * as store from '../store.js';
import * as icons from '../icons.js';

const { h } = U;

/**
 * Портфель и журнал — два взгляда на одни и те же деньги: чем владею
 * и как к этому пришёл.
 *
 * Переключаются они переключателем разрезов «Денег» — тем самым, что стоит
 * первой строкой экрана. Своего переключателя здесь больше нет: два ряда
 * переключателей подряд, в которых слово «Портфель» стоит дважды, читаются
 * как поломка, а не как два уровня.
 */
let mode = 'assets';

/**
 * Заголовок раздела — «Деньги», а не «Портфель».
 *
 * Портфель и журнал — два разреза одного и того же, и слово «Портфель» стоит
 * прямо под заголовком в переключателе. Повторённое дважды подряд, крупным
 * и мелким, оно читается не как заголовок раздела, а как сбой отрисовки.
 *
 * Действие меняется вместе с разрезом: на портфеле заводят бумагу, в журнале
 * записывают операцию. Один плюс, который делает разное в зависимости от того,
 * что открыто, — это не двусмысленность, а ровно то, чего ждут: добавить сюда.
 */
export function head(ctx) {
  const add = mode === 'journal'
    ? { label: 'Записать операцию', open: () => forms.operationSheet(null, { onDone: ctx.refresh }) }
    : {
        label: 'Добавить бумагу',
        open: () => forms.assetSheet(null, {
          onDone: ctx.refresh,
          preset: { type: C.TYPE_INVESTMENT, liquidity: 'T+1', assetClass: 'Акции', lotSize: 1 },
        }),
      };

  return U.screenHead('Деньги', U.roundAction(add.label, icons.icon('plus'), add.open));
}

export function render(ctx) {
  if (ctx.sub) return instrument(ctx);
  return mode === 'journal' ? journal.body(ctx) : overview(ctx);
}

/** Открывает журнал снаружи — с переключателя разрезов и по старому адресу. */
export function showJournal() {
  mode = 'journal';
}

/** Возвращает к списку бумаг — с того же переключателя. */
export function showAssets() {
  mode = 'assets';
}

/** Какой из двух разрезов сейчас открыт. Нужен переключателю для подсветки. */
export function shownMode() {
  return mode;
}

/** Заголовок вложенной страницы — название бумаги. */
export function title(sub, ctx) {
  const asset = (ctx?.state?.assets || []).find((a) => a.id === sub);
  return asset ? asset.name : 'Бумага';
}

export function action(sub, ctx) {
  const asset = ctx.state.assets.find((a) => a.id === sub);
  if (!asset) return null;
  return U.button('Изменить', () => forms.assetSheet(asset, { onDone: ctx.refresh }));
}

// --------------------------------------------------------------------------
// Обзор
// --------------------------------------------------------------------------

function overview(ctx) {
  const { state, refresh } = ctx;
  const { rows, total } = C.portfolioRows(state.assets, state.operations, state.portfolio);
  const noClass = state.assets.filter(
    (a) => a.status === C.STATUS_ACTIVE && !C.ASSET_CLASSES.includes(a.assetClass),
  );
  const inPortfolio = state.assets.filter(
    (a) => C.ASSET_CLASSES.includes(a.assetClass) && a.status !== C.STATUS_SOLD,
  );

  return [
    total_(
      total,
      C.returnOf(inPortfolio, state.operations, ctx.today),
      inPortfolio,
      ctx,
      C.benchmark(inPortfolio, state.operations, state.keyRate, ctx.today),
    ),

    ...holdings(ctx, total),

    noClass.length
      ? U.card([
          // Не подсказка, а состояние: перечислены настоящие активы, которым
          // класс не задан, и потому в доли они не попали. Машина и квартира
          // живут здесь законно — им класс и не нужен.
          U.sectionTitle('Вне расчёта долей'),
          ...noClass.map((a) =>
            U.row(a.name, F.money(C.assetValue(a, state.operations)), {
              sub: a.type,
              onClick: () => ctx.go(`portfolio/${a.id}`),
            }),
          ),
        ])
      : null,

    payoutsCard(state, ctx.today),

    U.card([
      U.sectionTitle('Доли'),
      charts.allocation(rows, (row) => forms.portfolioSheet(row, { onDone: refresh })),
      addingCard(rows),
    ]),
  ];
}

/**
 * Сумма портфеля — первое на экране.
 *
 * Раньше она стояла в самом низу, над долями, и увидеть её можно было только
 * прокрутив весь список бумаг. Главное число экрана не должно требовать
 * прокрутки. Здесь же снята и вторая проблема того размещения: подпись
 * «В расчёте долей» объясняла сумму через механику расчёта, хотя человек
 * читает её как «сколько у меня в портфеле».
 */
function total_(total, rate, assets, ctx, bench) {
  // В плитке, а не голым числом на поле: вокруг теперь сетка плиток,
  // и одинокое число без коробки читается не «главным», а «забытым снаружи».
  return U.card([
    h('p', { class: 'hero-label', text: 'Портфель' }),
    h('p', { class: 'hero-value', text: F.money(total) }),
    // Доходность годовых — единственное число, которым портфель сравним
    // с вкладом и сам с собой год назад.
    rate != null
      ? h('p', { class: `hero-delta ${rate >= 0 ? 'is-up' : 'is-down'}` }, [
          h('span', { text: `${rate >= 0 ? '+' : ''}${F.percent(rate)}` }),
          h('span', { class: 'hero-delta-word', text: 'годовых' }),
        ])
      // Молча пропасть числу нельзя. Пустое место на его месте читается как
      // «сломалось», и вопрос «почему нет зелёного» возникает ровно один раз
      // — а потом человек перестаёт верить и остальным цифрам. Поэтому здесь
      // сказано, чего не хватает, и куда идти дозаполнять.
      : blockerLine(assets, ctx),
    rate == null ? null : benchLine(rate, bench),
  ], { class: 'card-hero' });
}

/**
 * Сравнение с безриском.
 *
 * «+12,84% годовых» само по себе не значит ни хорошо, ни плохо: значение
 * появляется рядом с тем, что можно было получить, ничего не делая. Отставание
 * от вклада — это не «чуть меньше», это риск, за который не заплатили.
 *
 * Разница в процентных пунктах, а не в процентах: 12,84 против 16,30 — это
 * отставание на 3,46 п.п., а не на 21%. Второе арифметически тоже верно
 * и в разговоре о доходности означает совсем другое.
 */
function benchLine(rate, bench) {
  if (!bench) return null;
  const gap = rate - bench.rate;
  const ahead = gap >= 0;
  return h('p', { class: 'hero-bench' }, [
    h('span', { text: `Ключевая за период ${F.percent(bench.rate, 1)}` }),
    h('span', { class: 'hero-bench-dot', text: '·' }),
    h('span', {
      class: ahead ? 'is-good' : 'is-bad',
      text: `${ahead ? 'опережаете' : 'отстаёте'} на ${F.num(Math.abs(gap), 1)} п.п.`,
    }),
  ]);
}

function blockerLine(assets, ctx) {
  const blocked = (assets || [])
    .map((a) => ({ name: a.name, why: C.returnBlocker(a) }))
    .filter((x) => x.why);
  if (!blocked.length) return null;

  const names = blocked.slice(0, 2).map((x) => x.name).join(', ');
  const rest = blocked.length > 2 ? ` и ещё ${blocked.length - 2}` : '';
  return h('button', {
    class: 'hero-note',
    type: 'button',
    onclick: () => ctx.go('more/health'),
  }, [
    h('span', { text: `Доходность не посчитать: ${names}${rest} — ${blocked[0].why}` }),
    h('span', { class: 'row-chevron', text: '›' }),
  ]);
}

/**
 * Как выправить доли, ничего не продавая.
 *
 * «Продать» — плохой совет по умолчанию: продажа тянет за собой налог
 * и обнуляет срок владения ради льготы, а докупка не делает ни того,
 * ни другого. Если деньги на взносы есть, перекос лечится ими — и тогда
 * единственный вопрос в том, сколько и куда.
 */
function addingCard(rows) {
  const plan = C.rebalanceByAdding(rows);
  if (!plan) return null;
  return h('div', { class: 'plan' }, [
    h('div', { class: 'plan-head' }, [
      h('span', { class: 'plan-title', text: 'Выправить довложением' }),
      h('span', { class: 'plan-total', text: F.money(plan.total) }),
    ]),
    ...plan.items.map((x) =>
      h('div', { class: 'plan-row' }, [
        h('span', { text: x.class }),
        h('span', { class: 'plan-amount', text: F.money(x.add) }),
      ]),
    ),
  ]);
}

/**
 * Ближайшие выплаты по облигациям.
 *
 * Сколько и когда придёт — единственное, ради чего облигацию и держат.
 * Без этого списка дата купона лежит в карточке актива и никем не читается,
 * а деньги приходят неожиданно.
 */
function payoutsCard(state, today) {
  const soon = C.couponCalendar(state.assets, state.operations, today, 180);
  if (!soon.length) return null;

  const total = soon.reduce((s, x) => s + x.amount + x.redemption, 0);
  return U.card([
    U.sectionTitle('Ближайшие выплаты', h('span', { class: 'section-sum', text: F.money(total) })),
    ...soon.slice(0, 6).map((x) =>
      U.row(x.asset.name, F.money(x.amount + x.redemption), {
        sub: [F.relativeDate(x.date, today), x.redemption ? 'купон и погашение' : 'купон']
          .filter(Boolean).join(' · '),
        tag: x.redemption ? 'погашение' : null,
        tagClass: 'ok',
      }),
    ),
  ]);
}

/**
 * Бумаги по классам — сразу под суммой.
 *
 * Все классы лежат в одной карточке группами, а не в четырёх карточках подряд.
 * Отдельная карточка на класс раздувала экран: на класс из одной бумаги
 * уходило втрое больше места, чем на саму строку, и список из четырёх бумаг
 * не помещался в экран. Группы внутри одной карточки читаются как один
 * список — чем он, по сути, и является.
 *
 * Пустые классы здесь не показываются: строка «Облигации: ничего» в списке
 * того, что у меня есть, сообщала бы ровно обратное своему смыслу. О недоборе
 * говорят доли ниже — там пустой класс на месте.
 */
function holdings(ctx, total) {
  const { state } = ctx;
  const ops = state.operations;
  const withTickers = state.assets.filter((a) => a.ticker && a.status !== C.STATUS_SOLD);

  const groups = [];
  for (const cls of C.ASSET_CLASSES) {
    const own = state.assets
      .filter((a) => a.assetClass === cls && a.status !== C.STATUS_SOLD)
      .map((a) => ({ asset: a, value: C.assetValue(a, ops) }))
      .sort((x, y) => y.value - x.value);
    if (!own.length) continue;

    const sum = own.reduce((s, r) => s + r.value, 0);
    // Доходность класса — рядом с его суммой, а не отдельной строкой: это
    // две характеристики одного и того же, и разносить их значило бы
    // заставить сверять глазами два места.
    const rate = C.returnOf(own.map((r) => r.asset), ops, ctx.today);
    groups.push(h('div', { class: 'group' }, [
      U.sectionTitle(cls, h('span', { class: 'section-sum' }, [
        h('span', { text: F.money(sum) }),
        rate == null ? null : h('span', {
          class: `section-rate ${rate >= 0 ? 'is-up' : 'is-down'}`,
          text: `${rate >= 0 ? '+' : ''}${F.percent(rate)}`,
        }),
      ])),
      // Доходность стоит и у класса, и у каждой бумаги. Это разные числа,
      // и одно другое не заменяет: класс отвечает «как идёт эта часть
      // портфеля», бумага — «что именно её тянет». Класс на плюс двенадцать
      // может состоять из бумаги на плюс сорок и бумаги на минус двенадцать,
      // и по одному общему числу этого не увидеть никогда.
      ...own.map((r) => paperRow(r, ctx, total, ops)),
    ]));
  }

  return [
    U.card(groups.length
      ? groups
      : [U.emptyState('Бумаг пока нет. Заведите первую — она появится здесь.')]),
    actions(ctx, withTickers),
  ];
}

/**
 * Служебное действие портфеля — обновить котировки.
 *
 * Завести бумагу отсюда ушло в круглое действие шапки. Прежде здесь стояли
 * обе кнопки в ряд, и главная из них — «Добавить бумагу» — оказывалась в самом
 * низу экрана, под всеми бумагами: чтобы завести первую, приходилось сперва
 * пролистать те, которых ещё нет. Действие раздела принадлежит шапке раздела.
 *
 * Обновление котировок осталось внизу и осталось обводкой: его делают после
 * того, как посмотрели на список, а не до.
 */
function actions(ctx, withTickers) {
  if (!withTickers.length) return null;
  const status = h('p', { class: 'quotes-status' });

  return h('div', { class: 'act' }, [
    U.button('Обновить котировки', () => updateQuotes(ctx, withTickers, status), { class: 'btn-wide btn-ghost' }),
    status,
  ]);
}

/**
 * Строка бумаги: значок, название, сколько и почём, стоимость и доходность.
 *
 * Значок ищется по тикеру среди файлов приложения: логотипов у Мосбиржи нет
 * вовсе — в описании бумаги двадцать семь полей, ни одного графического, —
 * а тянуть картинку со стороннего хоста значит сообщить этому хосту, чем
 * человек владеет. Приложение обещает обратное.
 *
 * Файла нет — рисуется монограмма. Это не аварийный случай, а обычный:
 * облигаций на бирже тысячи, и значка у них нет по существу.
 */
function paperRow(r, ctx, total, ops) {
  const asset = r.asset;
  const rate = C.returnOf([asset], ops, ctx.today);
  const frozen = asset.status !== C.STATUS_ACTIVE;

  return h('button', {
    class: 'paper',
    type: 'button',
    onclick: () => ctx.go(`portfolio/${asset.id}`),
  }, [
    paperMark(asset),
    h('span', { class: 'paper-text' }, [
      h('span', { class: 'paper-name', text: asset.name }),
      h('span', { class: 'paper-sub', text: holdingSub(asset, total, r.value, ops) || asset.type }),
    ]),
    h('span', { class: 'paper-value' }, [
      h('span', { class: 'paper-sum', text: F.money(r.value) }),
      rate == null
        ? (frozen ? h('span', { class: 'paper-rate is-quiet', text: asset.status.toLowerCase() }) : null)
        : h('span', {
            class: `paper-rate ${rate >= 0 ? 'is-up' : 'is-down'}`,
            text: `${rate >= 0 ? '+' : '−'}${F.percent(Math.abs(rate))}`,
          }),
    ]),
    h('span', { class: 'paper-chevron', text: '›' }),
  ]);
}

/**
 * Тикеры, у которых значка нет. Заполняется по ходу дела: список «у кого
 * значок есть» пришлось бы держать в двух местах сразу — в папке и в коде —
 * и однажды забыть про одно из них.
 *
 * Живёт до перезагрузки страницы, и этого достаточно. Без него экран портфеля
 * при каждой перерисовке заново просит файлы, которых нет: облигаций и фондов
 * тысячи, логотипов у них не бывает вовсе, и каждая перерисовка стоила бы
 * десятка запросов с заранее известным ответом.
 */
const noLogo = new Set();

/** Значок бумаги: файл по тикеру или монограмма из первых букв. */
function paperMark(asset) {
  const ticker = String(asset.ticker || '').trim().toUpperCase();
  if (ticker && /^[A-Z0-9]+$/.test(ticker) && !noLogo.has(ticker)) {
    const img = h('img', {
      src: `./icons/tickers/${ticker}.svg`,
      alt: '',
      loading: 'lazy',
    });
    const box = h('span', { class: 'paper-logo' }, [img]);
    // Файла может не быть — тогда чип превращается в монограмму прямо здесь.
    // Монограмма это штатный вид, а не сбой: у большинства бумаг значка нет
    // по существу.
    img.addEventListener('error', () => {
      noLogo.add(ticker);
      box.className = 'paper-mono';
      box.textContent = monogram(asset.name, ticker);
    });
    return box;
  }
  return h('span', { class: 'paper-mono', text: monogram(asset.name, ticker) });
}

function monogram(name, ticker) {
  if (ticker) return ticker.slice(0, 4);
  return String(name || '?').trim().slice(0, 3).toUpperCase();
}

function holdingSub(asset, total, value, ops) {
  const parts = [];
  if (C.isBond(asset)) parts.push(`${F.num(C.assetQuantity(asset, ops), 0)} × ${F.num(asset.price, 3)}%`);
  else if (asset.ticker) parts.push(`${F.num(C.assetQuantity(asset, ops), 0)} × ${F.num(asset.price, 4)} ₽`);
  else if (asset.rate) parts.push(`${F.percent(asset.rate)} годовых`);
  if (total > 0 && C.ASSET_CLASSES.includes(asset.assetClass)) {
    parts.push(`${F.percent((value / total) * 100)} портфеля`);
  }
  return parts.join(' · ') || null;
}

/** Обновление котировок сразу по всем бумагам с тикером. */
async function updateQuotes(ctx, tickers, status) {
  const { today, refresh } = ctx;
  status.textContent = 'Запрашиваю Мосбиржу…';
  const results = await moex.prices(tickers.map((a) => ({ ticker: a.ticker, board: a.board })));
  const ok = results.filter((r) => r.ok);
  if (ok.length) await saveQuotes(ok, today);

  const failed = results.filter((r) => !r.ok).map((r) => r.ticker);
  if (!ok.length) {
    status.textContent = 'Мосбиржа не ответила. Цену можно ввести руками в карточке бумаги.';
    U.toast('Котировки не обновились', 'error');
  } else if (failed.length) {
    status.textContent = `Обновлено: ${ok.length}. Без цены: ${failed.join(', ')}.`;
    refresh();
  } else {
    U.toast('Котировки обновлены');
    refresh();
  }
}

async function saveQuotes(ok, today) {
  await store.mutate((draft) => {
    for (const r of ok) {
      for (const asset of draft.assets) {
        if (asset.ticker !== r.ticker) continue;
        asset.price = r.price;
        asset.board = r.board;
        asset.updated = today;
      }
      // История цен идемпотентна: повторный запрос в тот же день не плодит
      // строки, а обновляет существующую.
      const i = draft.priceHistory.findIndex((p) => p.date === today && p.ticker === r.ticker);
      const point = { date: today, ticker: r.ticker, price: r.price, board: r.board, source: r.source };
      if (i === -1) draft.priceHistory.push(point);
      else draft.priceHistory[i] = point;
    }
  });
}

// --------------------------------------------------------------------------
// Страница бумаги
// --------------------------------------------------------------------------

function instrument(ctx) {
  const { state, today, refresh, sub } = ctx;
  const asset = state.assets.find((a) => a.id === sub);
  if (!asset) return [U.card([U.emptyState('Бумага не найдена.')])];

  const value = C.assetValue(asset, state.operations);
  const held = C.assetQuantity(asset, state.operations);
  const own = state.operations
    .filter((op) => op.assetId === asset.id)
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  return [
    U.card([
      // У счёта копейки на месте: именно эту цифру сверяют с банком.
      // У бумаги их нет — стоимость там произведение цены на количество,
      // и копейка в ней означает не деньги, а погрешность округления цены.
      U.stat('Стоимость', asset.ticker ? F.money(value) : F.moneyExact(value),
        { big: true, hint: valueHint(asset, held) }),
      h('div', { class: 'grid-2' }, [
        U.stat('Класс', asset.assetClass || 'не задан'),
        U.stat('Статус', asset.status),
      ]),
      asset.ticker ? singleQuote(ctx, asset) : null,
    ]),

    // Средняя цена есть только там, где сделки записаны. У бумаги, заведённой
    // одним начальным количеством, её взять неоткуда — и придумывать нечего.
    asset.ticker ? averageCard(asset, state.operations, value, held, today) : null,

    C.isBond(asset) ? bondCard(asset, state.operations, today) : null,

    asset.ticker ? lotsCard(asset, state.operations, today) : null,

    priceCard(state, asset),

    U.card([
      U.sectionTitle(asset.ticker ? 'Сделки и выплаты' : 'Операции', U.button('Добавить', () => forms.operationSheet(null, {
        assetId: asset.id,
        goalId: (asset.goalIds || [])[0] || null,
        onDone: refresh,
      }), { kind: 'primary' })),
      ...own.map((op) =>
        U.row(`${op.type} · ${F.relativeDate(op.date, today)}`, opValue(op), {
          sub: opSub(op),
          onClick: () => forms.operationSheet(op, { onDone: refresh }),
        }),
      ),
      own.length ? null : U.emptyState(asset.ticker ? 'Сделок и выплат по этой бумаге ещё не было.' : 'Операций по этой бумаге ещё нет.'),
    ]),
  ];
}

/** У операции по бумаге показываем её сумму, у денежной — знак движения. */
function opValue(op) {
  // Точные копейки: начисленные проценты — это 3,97 ₽, а не «+4 ₽»,
  // и сверить округлённое с выпиской банка нельзя.
  return C.isPaperOp(op) ? F.moneyExact(C.paperAmount(op)) : F.signedMoneyExact(C.signed(op));
}

function opSub(op) {
  if (C.isTrade(op)) {
    return [`${F.num(op.quantity, 0)} шт × ${F.num(op.unitPrice, 4)} ₽`, op.fee ? `комиссия ${F.money2(op.fee)}` : null, op.comment]
      .filter(Boolean).join(' · ');
  }
  if (C.isPayout(op)) {
    return [op.tax ? `налог ${F.money2(op.tax)}` : 'без налога', op.comment].filter(Boolean).join(' · ');
  }
  return [op.source === C.SOURCE_COMPUTED ? 'расчёт' : null, op.comment].filter(Boolean).join(' · ') || null;
}

/**
 * Средняя цена покупки и результат по позиции.
 *
 * Средняя считается по покупкам: продажи уменьшают количество, но цену входа
 * не меняют — иначе после частичной продажи она перестала бы что-либо значить.
 *
 * Прибыль показывается только тогда, когда все бумаги на руках пришли
 * сделками. Если часть количества задана начальным блоком, цена его покупки
 * неизвестна, и распространить на него среднюю по сделкам значило бы выдать
 * придуманное число за результат. В этом случае честнее сказать, чего
 * не хватает, чем показать красивую, но выдуманную прибыль.
 */
function averageCard(asset, operations, value, held, today) {
  let spent = 0;
  let clean = 0;
  let fees = 0;
  let bought = 0;
  for (const op of operations) {
    if (op.assetId !== asset.id || op.type !== C.OP_BUY) continue;
    spent += C.tradeAmount(op);
    clean += (op.quantity || 0) * (op.unitPrice || 0);
    fees += op.fee || 0;
    bought += op.quantity || 0;
  }
  if (!bought) return null;

  const average = spent / bought;
  const cleanAverage = clean / bought;
  const opening = asset.quantity || 0;
  const invested = average * held;
  const result = value - invested;

  // Выплаты — деньги, которые бумага уже принесла и которые больше в ней
  // не лежат. В стоимость они не входят и в «прибыль» тоже: та считается
  // от цены. Поэтому отдельной строкой, а не прибавкой к результату.
  let payouts = 0;
  for (const op of operations) {
    if (op.assetId !== asset.id || !C.isPayout(op)) continue;
    payouts += C.paperAmount(op);
  }

  return U.card([
    U.sectionTitle('Позиция'),
    h('div', { class: 'grid-2' }, [
      // Средняя считается по заплаченному, комиссия внутри: это и есть цена
      // входа — и по смыслу, и для налога, где комиссия уменьшает прибыль.
      // У брокера в приложении та же строка показывает цену самой бумаги,
      // без комиссии, и числа расходятся. Чтобы это не было загадкой, вторая
      // цена стоит рядом, а не остаётся на догадку.
      U.stat('Средняя цена', `${F.num(average, 4)} ₽`, {
        hint: fees > 0
          ? `с комиссией · сама бумага ${F.num(cleanAverage, 4)} ₽`
          : `куплено ${F.num(bought, 0)} шт`,
      }),
      // У облигации в price лежит котировка в процентах, а средняя цена —
      // в рублях. Поставить их рядом как есть значило бы сравнивать проценты
      // с рублями и подписать обоих значком рубля.
      U.stat('Сейчас', C.isBond(asset)
        ? `${F.num(C.bondFull(asset, today), 2)} ₽`
        : `${F.num(asset.price, 4)} ₽`,
      C.isBond(asset) ? { hint: `${F.num(asset.price, 3)}% с купоном` } : {}),
    ]),
    fees > 0
      ? U.stat('Комиссия', F.money2(fees), { hint: 'уплачена при покупке, входит в цену входа' })
      : null,
    payouts ? U.stat('Выплачено', F.money(payouts), { hint: 'дивиденды и купоны на руках' }) : null,
    (() => {
      // Доходность отвечает на «стоило ли», прибыль — только на «сколько».
      // Сто рублей за месяц и сто за пять лет — разные вложения, и различает
      // их именно эта строка.
      const rate = C.returnOf([asset], operations, today);
      return rate == null ? null : U.stat('Доходность', `${rate >= 0 ? '+' : ''}${F.percent(rate)} годовых`, {
        class: rate >= 0 ? 'is-good' : 'is-bad',
        hint: 'с учётом дат сделок и выплат',
      });
    })(),
    opening
      ? U.stat('Цена входа известна не для всей позиции', `${F.num(opening, 0)} шт`, {
          hint: 'начальное количество заведено без сделки — результат по позиции не посчитать',
        })
      : U.stat(result >= 0 ? 'Прибыль' : 'Убыток', F.signedMoney(result), {
          class: result >= 0 ? 'is-good' : 'is-bad',
          hint: invested ? `${F.percent((result / invested) * 100)} к вложенному` : null,
        }),
  ]);
}

/**
 * Лоты и льгота за долгое владение.
 *
 * Бумага на счету — не однородная куча: каждая покупка живёт своим сроком,
 * и от него зависят настоящие деньги. Три полных года владения освобождают
 * прибыль от налога, три миллиона за каждый год. Продать за месяц до срока —
 * значит подарить государству то, что можно было не платить, и узнать об этом
 * человек должен заранее, а не в отчёте за год.
 */
function lotsCard(asset, operations, today) {
  const lots = C.lotsOf(asset, operations);
  if (!lots.length) return null;

  const rows = lots.map((lot) => {
    const st = C.ldvStatus(lot, today);
    const value = `${F.num(lot.quantity, 0)} шт`;
    if (lot.unknown) {
      return U.row('Начальный блок', value, {
        sub: 'заведён без сделки — цена входа и срок владения неизвестны',
        tag: 'без цены',
        tagClass: 'muted',
      });
    }
    return U.row(F.date(lot.date), value, {
      sub: `по ${F.num(lot.unitCost, 4)} ₽ · ${F.money(lot.quantity * lot.unitCost)}`,
      tag: st.eligible
        ? 'льгота'
        : st.daysLeft > 0 ? `через ${F.days(st.daysLeft)}` : null,
      tagClass: st.eligible ? 'ok' : 'muted',
    });
  });

  const soon = lots
    .filter((lot) => !lot.unknown)
    .map((lot) => C.ldvStatus(lot, today))
    .filter((st) => st.known && !st.eligible && st.daysLeft > 0 && st.daysLeft <= 180)
    .sort((a, b) => a.daysLeft - b.daysLeft)[0];

  return U.card([
    U.sectionTitle('Лоты', h('span', { class: 'section-sum', text: `${F.num(C.assetQuantity(asset, operations), 0)} шт` })),
    ...rows,
    soon
      ? U.callout(`Ближайший лот выходит на льготу ${F.date(soon.ready)} — через ${F.days(soon.daysLeft)}. Продажа до этого дня лишает освобождения от налога.`, 'warn')
      : null,
  ]);
}

/**
 * Облигация: из чего сложена стоимость и когда следующая выплата.
 *
 * Цена в процентах и накопленный купон — две разные величины, и сумма без
 * них читается как случайная. Здесь они разложены, а рядом стоит ближайшая
 * выплата: это то, ради чего бумагу держат.
 */
function bondCard(asset, operations, today) {
  const qty = C.assetQuantity(asset, operations);
  const nkd = C.accruedCoupon(asset, today);
  const { next } = C.couponAround(asset, today);
  const per = C.couponAmount(asset);

  return U.card([
    U.sectionTitle('Облигация'),
    h('div', { class: 'grid-2' }, [
      U.stat('Номинал', F.money(asset.faceValue), { hint: `котировка ${F.num(asset.price, 3)}%` }),
      U.stat('Чистая цена', `${F.num(C.bondClean(asset), 2)} ₽`, { hint: 'за бумагу, без купона' }),
      U.stat('Накоплен купон', `${F.num(nkd, 2)} ₽`, { hint: qty ? `всего ${F.money(nkd * qty)}` : 'за бумагу' }),
      U.stat('Купон', F.money(per), { hint: `${F.percent(asset.couponRate)} годовых, ${timesPerYear(asset.couponsPerYear)}` }),
    ]),
    next
      ? U.row('Ближайшая выплата', F.money(per * qty), {
          sub: `${F.date(next)} · ${F.relativeDate(next, today)}`,
        })
      : null,
    D.isValid(asset.maturityDate)
      ? U.row('Погашение', F.money((asset.faceValue || 0) * qty), {
          sub: `${F.date(asset.maturityDate)} · ${F.relativeDate(asset.maturityDate, today)}`,
        })
      : null,
  ]);
}

function timesPerYear(n) {
  return { 1: 'раз в год', 2: 'дважды в год', 4: 'ежеквартально', 12: 'ежемесячно' }[n || 2] || 'дважды в год';
}

function valueHint(asset, held) {
  if (C.isBond(asset)) {
    return `${F.num(held, 0)} шт × ${F.num(asset.price, 3)}% от ${F.money(asset.faceValue)} с купоном`;
  }
  if (asset.ticker) {
    const price = `${F.num(held, 0)} шт × ${F.num(asset.price, 4)} ₽`;
    return asset.updated ? `${price} · цена от ${F.date(asset.updated)}` : `${price} · цена не обновлялась`;
  }
  if (asset.rate) return `${F.percent(asset.rate)} годовых`;
  return asset.type;
}

/** Обновление цены одной бумаги — с её же страницы. */
function singleQuote(ctx, asset) {
  const { today, refresh } = ctx;
  const status = h('p', { class: 'quotes-status' });

  return h('div', { class: 'act' }, [
    U.button('Обновить цену', async () => {
      status.textContent = 'Запрашиваю Мосбиржу…';
      const [r] = await moex.prices([{ ticker: asset.ticker, board: asset.board }]);
      if (!r || !r.ok) {
        status.textContent = 'Мосбиржа не ответила. Цену можно ввести руками кнопкой «Изменить».';
        U.toast('Цена не обновилась', 'error');
        return;
      }
      await saveQuotes([r], today);
      U.toast(`${asset.ticker} — ${F.num(r.price, 4)} ₽`);
      refresh();
    }, { class: 'btn-wide' }),
    status,
  ]);
}

/**
 * История цены этой бумаги. У актива без тикера её взять неоткуда, поэтому
 * карточка не появляется вовсе — пустой график хуже отсутствующего.
 */
function priceCard(state, asset) {
  if (!asset.ticker) return null;

  const points = state.priceHistory
    .filter((p) => p.ticker === asset.ticker && D.isValid(p.date))
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((p) => ({ x: p.date, y: p.price }));

  return U.card([
    U.sectionTitle('Цена'),
    charts.line(points, {
      label: `Цена ${asset.ticker}`,
      format: (v) => `${F.num(v, 2)} ₽`,
      hint: 'История наберётся по мере обновления котировок',
    }),
  ]);
}

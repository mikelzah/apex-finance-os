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
import * as moex from '../moex.js';
import * as store from '../store.js';

const { h } = U;

export function render(ctx) {
  return ctx.sub ? instrument(ctx) : overview(ctx);
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
    total_(total, C.returnOf(inPortfolio, state.operations, ctx.today)),

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

    U.card([
      U.sectionTitle('Доли'),
      charts.allocation(rows, (row) => forms.portfolioSheet(row, { onDone: refresh })),
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
function total_(total, rate) {
  return h('section', { class: 'hero' }, [
    h('p', { class: 'hero-label', text: 'Портфель' }),
    h('p', { class: 'hero-value', text: F.money(total) }),
    // Доходность годовых — единственное число, которым портфель сравним
    // с вкладом и сам с собой год назад. Пустоты под суммой на её месте
    // не остаётся: если посчитать нельзя, строки просто нет.
    rate == null ? null : h('p', { class: `hero-delta ${rate >= 0 ? 'is-up' : 'is-down'}` }, [
      h('span', { text: `${rate >= 0 ? '+' : ''}${F.percent(rate)}` }),
      h('span', { class: 'hero-delta-word', text: 'годовых' }),
    ]),
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
      ...own.map((r) =>
        U.row(r.asset.name, F.money(r.value), {
          sub: holdingSub(r.asset, total, r.value, ops),
          tag: r.asset.status === C.STATUS_ACTIVE ? null : r.asset.status.toLowerCase(),
          tagClass: 'muted',
          onClick: () => ctx.go(`portfolio/${r.asset.id}`),
        }),
      ),
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
 * Два действия портфеля стоят в строку, а не одно под другим.
 *
 * Стопкой они читались как один сплошной блок: две одинаковые капсулы во всю
 * ширину, вплотную, без всякого признака, что это разные вещи. В строке
 * разница видна сразу — и по месту, и по весу: завести бумагу это основное
 * действие, обновить котировки — служебное.
 */
function actions(ctx, withTickers) {
  const { refresh } = ctx;
  const status = h('p', { class: 'quotes-status' });

  return h('div', { class: 'act act-row' }, [
    U.button('Добавить бумагу', () => forms.assetSheet(null, {
      onDone: refresh,
      preset: { type: C.TYPE_INVESTMENT, liquidity: 'T+1', assetClass: 'Акции', lotSize: 1 },
    }), { kind: 'primary', class: 'btn-wide' }),
    withTickers.length ? U.button('Обновить котировки', () => updateQuotes(ctx, withTickers, status), { class: 'btn-wide' }) : null,
    withTickers.length ? status : null,
  ]);
}

function holdingSub(asset, total, value, ops) {
  const parts = [];
  if (asset.ticker) parts.push(`${F.num(C.assetQuantity(asset, ops), 0)} × ${F.num(asset.price, 4)} ₽`);
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
      U.stat('Стоимость', F.money(value), { big: true, hint: valueHint(asset, held) }),
      h('div', { class: 'grid-2' }, [
        U.stat('Класс', asset.assetClass || 'не задан'),
        U.stat('Статус', asset.status),
      ]),
      asset.ticker ? singleQuote(ctx, asset) : null,
    ]),

    // Средняя цена есть только там, где сделки записаны. У бумаги, заведённой
    // одним начальным количеством, её взять неоткуда — и придумывать нечего.
    asset.ticker ? averageCard(asset, state.operations, value, held, today) : null,

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
  return C.isPaperOp(op) ? F.money(C.paperAmount(op)) : F.signedMoney(C.signed(op));
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
  let bought = 0;
  for (const op of operations) {
    if (op.assetId !== asset.id || op.type !== C.OP_BUY) continue;
    spent += C.tradeAmount(op);
    bought += op.quantity || 0;
  }
  if (!bought) return null;

  const average = spent / bought;
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
      U.stat('Средняя цена', `${F.num(average, 4)} ₽`, { hint: `куплено ${F.num(bought, 0)} шт` }),
      U.stat('Сейчас', `${F.num(asset.price, 4)} ₽`),
    ]),
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

function valueHint(asset, held) {
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

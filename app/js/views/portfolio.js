// Портфель: что лежит, и только потом — как это соотносится с планом.
//
// Порядок именно такой. Открывая портфель, человек спрашивает «что у меня
// есть», а не «на сколько процентов я отклонился от целевой структуры».
// Доли — это проверка плана, она нужна реже и потому идёт ниже.
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

  return [
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
      U.stat('В расчёте долей', F.money(total), { big: true, hint: 'активы с заданным классом' }),
      charts.allocation(rows, (row) => forms.portfolioSheet(row, { onDone: refresh })),
    ]),
  ];
}

/**
 * Бумаги по классам — первое, что видно на экране.
 *
 * Пустые классы здесь не показываются: строка «Облигации: ничего» в списке
 * того, что у меня есть, сообщала бы ровно обратное своему смыслу. О недоборе
 * говорят доли ниже — там пустой класс на месте.
 */
function holdings(ctx, total) {
  const { state, refresh } = ctx;
  const ops = state.operations;
  const withTickers = state.assets.filter((a) => a.ticker && a.status !== C.STATUS_SOLD);

  const cards = [];
  for (const cls of C.ASSET_CLASSES) {
    const own = state.assets
      .filter((a) => a.assetClass === cls && a.status !== C.STATUS_SOLD)
      .map((a) => ({ asset: a, value: C.assetValue(a, ops) }))
      .sort((x, y) => y.value - x.value);
    if (!own.length) continue;

    const sum = own.reduce((s, r) => s + r.value, 0);
    cards.push(U.card([
      U.sectionTitle(cls, h('span', { class: 'section-sum', text: F.money(sum) })),
      ...own.map((r) =>
        U.row(r.asset.name, F.money(r.value), {
          sub: holdingSub(r.asset, total, r.value),
          tag: r.asset.status === C.STATUS_ACTIVE ? null : r.asset.status.toLowerCase(),
          tagClass: 'muted',
          onClick: () => ctx.go(`portfolio/${r.asset.id}`),
        }),
      ),
    ]));
  }

  if (!cards.length) {
    cards.push(U.card([U.emptyState('Бумаг пока нет. Заведите первую — она появится здесь.')]));
  }

  cards.push(h('div', { class: 'act' }, [
    U.button('Добавить бумагу', () => forms.assetSheet(null, {
      onDone: refresh,
      preset: { type: C.TYPE_INVESTMENT, liquidity: 'T+1', assetClass: 'Акции' },
    }), { class: 'btn-wide' }),
    withTickers.length ? quotesButton(ctx, withTickers) : null,
  ]));

  return cards;
}

function holdingSub(asset, total, value) {
  const parts = [];
  if (asset.ticker) parts.push(`${F.num(asset.quantity, 0)} × ${F.num(asset.price, 4)} ₽`);
  else if (asset.rate) parts.push(`${F.percent(asset.rate)} годовых`);
  if (total > 0 && C.ASSET_CLASSES.includes(asset.assetClass)) {
    parts.push(`${F.percent((value / total) * 100)} портфеля`);
  }
  return parts.join(' · ') || null;
}

/** Обновление котировок сразу по всем бумагам с тикером. */
function quotesButton(ctx, tickers) {
  const { today, refresh } = ctx;
  const status = h('span', { class: 'quotes-status' });

  const update = async () => {
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
  };

  return h('div', {}, [U.button('Обновить котировки', update, { class: 'btn-wide' }), status]);
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
  const own = state.operations
    .filter((op) => op.assetId === asset.id)
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  return [
    U.card([
      U.stat('Стоимость', F.money(value), { big: true, hint: valueHint(asset) }),
      h('div', { class: 'grid-2' }, [
        U.stat('Класс', asset.assetClass || 'не задан'),
        U.stat('Статус', asset.status),
      ]),
      asset.ticker ? h('div', { class: 'act' }, [singleQuote(ctx, asset)]) : null,
    ]),

    priceCard(state, asset),

    U.card([
      U.sectionTitle('Операции', U.button('Добавить', () => forms.operationSheet(null, {
        assetId: asset.id,
        goalId: (asset.goalIds || [])[0] || null,
        onDone: refresh,
      }), { kind: 'primary' })),
      ...own.map((op) =>
        U.row(`${op.type} · ${F.relativeDate(op.date, today)}`, F.signedMoney(C.signed(op)), {
          sub: [op.source === C.SOURCE_COMPUTED ? 'расчёт' : null, op.comment].filter(Boolean).join(' · ') || null,
          onClick: () => forms.operationSheet(op, { onDone: refresh }),
        }),
      ),
      own.length ? null : U.emptyState('Операций по этой бумаге ещё нет.'),
    ]),
  ];
}

function valueHint(asset) {
  if (asset.ticker) {
    const price = `${F.num(asset.quantity, 0)} шт × ${F.num(asset.price, 4)} ₽`;
    return asset.updated ? `${price} · цена от ${F.date(asset.updated)}` : `${price} · цена не обновлялась`;
  }
  if (asset.rate) return `${F.percent(asset.rate)} годовых`;
  return asset.type;
}

/** Обновление цены одной бумаги — с её же страницы. */
function singleQuote(ctx, asset) {
  const { today, refresh } = ctx;
  const status = h('span', { class: 'quotes-status' });

  return h('div', {}, [
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

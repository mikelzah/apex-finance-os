// Портфель: целевая структура против фактической.
//
// Замороженные активы в расчёт долей не входят. GMKN не продаётся и не
// докупается, и если включить его в базу расчёта, портфель навсегда останется
// «на 100% в акциях», а колонка «Действие» превратится в бесполезное
// «докупить» по всем остальным классам.

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
  const { state, today, refresh } = ctx;
  const { rows, total } = C.portfolioRows(state.assets, state.operations, state.portfolio, state.settings);

  return [
    U.card([
      U.stat('В расчёте долей', F.money(total), {
        big: true,
        hint: 'только активные инвестиции',
      }),
      charts.allocation(rows, (row) => forms.portfolioSheet(row, { onDone: refresh })),
      U.button('Добавить класс', () => forms.portfolioSheet(null, { onDone: refresh })),
    ]),

    rows.some((r) => r.unmapped)
      ? U.card([
          U.callout(
            'Класс без целевой доли появляется, когда актив не найден в списке «Классы по тикерам». Активы без тикера попадают в «Прочее».',
            'warn',
          ),
        ])
      : null,

    quotes(ctx),
    priceChart(state, today),
  ];
}

// --------------------------------------------------------------------------

function quotes(ctx) {
  const { state, today, refresh } = ctx;
  const tickers = state.assets.filter((a) => a.ticker && a.status !== C.STATUS_SOLD);
  if (!tickers.length) return null;

  const status = h('span', { class: 'quotes-status' });

  const update = async () => {
    status.textContent = 'Запрашиваю Мосбиржу…';
    const results = await moex.prices(tickers.map((a) => ({ ticker: a.ticker, board: a.board })));
    const ok = results.filter((r) => r.ok);

    if (ok.length) {
      await store.mutate((draft) => {
        for (const r of ok) {
          for (const asset of draft.assets) {
            if (asset.ticker !== r.ticker) continue;
            asset.price = r.price;
            asset.board = r.board;
            asset.updated = today;
          }
          // История цен идемпотентна: повторный запрос в тот же день
          // не плодит строки, а обновляет существующую.
          const i = draft.priceHistory.findIndex((p) => p.date === today && p.ticker === r.ticker);
          const point = { date: today, ticker: r.ticker, price: r.price, board: r.board, source: r.source };
          if (i === -1) draft.priceHistory.push(point);
          else draft.priceHistory[i] = point;
        }
      });
    }

    const failed = results.filter((r) => !r.ok).map((r) => r.ticker);
    if (!ok.length) {
      status.textContent = 'Мосбиржа не ответила. Введите цену вручную в карточке актива.';
      U.toast('Котировки не обновились', 'error');
    } else if (failed.length) {
      status.textContent = `Обновлено: ${ok.length}. Без цены: ${failed.join(', ')}.`;
      refresh();
    } else {
      status.textContent = `Обновлено ${F.date(today)}`;
      U.toast('Котировки обновлены');
      refresh();
    }
  };

  return U.card([
    U.sectionTitle('Котировки', U.button('Обновить', update, { kind: 'primary' })),
    ...tickers.map((a) =>
      U.row(a.ticker, F.num(a.price, 4), {
        sub: `${F.num(a.quantity, 0)} шт · ${F.money(C.assetValue(a, state.operations))}`,
        onClick: () => forms.assetSheet(a, { onDone: refresh }),
      }),
    ),
    status,
    U.callout(
      'Цены тянутся прямо с iss.moex.com. Если запрос не проходит, это ограничение браузера, а не поломка — цена вводится руками в карточке актива.',
      'info',
    ),
  ]);
}

function priceChart(state, today) {
  const tickers = [...new Set(state.priceHistory.map((p) => p.ticker))];
  if (!tickers.length) return null;

  const wrap = U.card([U.sectionTitle('Цены')]);
  let current = tickers[0];

  const chart = h('div');
  const draw = () => {
    U.clear(chart);
    const points = state.priceHistory
      .filter((p) => p.ticker === current && D.isValid(p.date))
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .map((p) => ({ x: p.date, y: p.price }));
    chart.appendChild(
      charts.line(points, {
        format: (v) => F.num(v, 2),
        hint: 'История цен наберётся по мере обновлений',
      }),
    );
  };

  const tabs = h('div', { class: 'chips' }, tickers.map((t) =>
    h('button', {
      class: `chip${t === current ? ' is-on' : ''}`,
      type: 'button',
      onclick: (e) => {
        current = t;
        for (const node of tabs.children) node.classList.toggle('is-on', node === e.currentTarget);
        draw();
      },
    }, [t]),
  ));

  wrap.appendChild(tabs);
  wrap.appendChild(chart);
  draw();
  return wrap;
}

// Портфель: целевая структура против фактической.
//
// В расчёт долей входит только то, чему класс задан явно в карточке актива.
// Всё остальное — машина, квартира — перечислено отдельным списком: это
// часть капитала, но не часть портфеля.
//
// Замороженные активы не в счёт: актив, который не продаётся и не докупается,
// перекосил бы доли навсегда, а колонка «Действие» превратилась бы
// в бесполезное «докупить» по всем остальным классам.

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
  const { rows, total } = C.portfolioRows(state.assets, state.operations, state.portfolio);
  const noClass = state.assets.filter(
    (a) => a.status === C.STATUS_ACTIVE && !C.ASSET_CLASSES.includes(a.assetClass),
  );

  return [
    U.card([
      U.stat('В расчёте долей', F.money(total), {
        big: true,
        hint: 'активы с заданным классом',
      }),
      charts.allocation(rows, (row) => forms.portfolioSheet(row, { onDone: refresh })),

      // Бумаги заводят отсюда, а не из «Ещё → Активы»: думают о них на этом
      // экране, и уходить за добавлением на другой — лишний шаг.
      U.button('Добавить бумагу', () => forms.assetSheet(null, {
        onDone: refresh,
        preset: { type: C.TYPE_INVESTMENT, liquidity: 'T+1', assetClass: 'Акции' },
      }), { class: 'btn-wide' }),
    ]),

    // Не подсказка, а состояние: перечислены настоящие активы, которым класс
    // не задан, и потому в доли они не попали. Машина и квартира живут здесь
    // законно — им класс и не нужен.
    noClass.length
      ? U.card([
          // Название класса рядом с суммой: чтобы стало видно, чего не хватает,
          // достаточно открыть актив и выбрать класс.
          U.sectionTitle('Вне расчёта долей'),
          ...noClass.map((a) =>
            U.row(a.name, F.money(C.assetValue(a, state.operations)), {
              sub: a.type,
              onClick: () => forms.assetSheet(a, { onDone: refresh }),
            }),
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
        label: `Цена ${current}`,
        format: (v) => `${F.num(v, 2)} ₽`,
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

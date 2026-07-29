// Журнал операций. Заполняется по факту, а не по плану.
//
// Два представления. Список удобен, чтобы пробежать глазами последние дни —
// он группирует по месяцам и держит крупные цели нажатия. Таблица нужна,
// когда операций накопились сотни и вопрос звучит как «покажи самые большие
// расходы за всё время»: список на такое не отвечает.

import * as U from '../ui.js';
import * as F from '../fmt.js';
import * as C from '../calc.js';
import * as D from '../dates.js';
import * as forms from '../forms.js';
import { table } from '../table.js';

const { h } = U;

const FILTERS = [
  { value: 'all', label: 'Все' },
  { value: C.OP_CONTRIBUTION, label: 'Взносы' },
  { value: C.OP_INCOME, label: 'Доходы' },
  { value: C.OP_EXPENSE, label: 'Расходы' },
];

// Выбор переживает перерисовку, но не перезапуск: это вид, а не настройка.
let filter = 'all';
let mode = 'list';

export function render(ctx) {
  const { state, today, refresh } = ctx;

  const all = [...state.operations]
    .filter((op) => D.isValid(op.date))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const visible = filter === 'all' ? all : all.filter((op) => op.type === filter);

  const month = D.month(today);
  const inMonth = all.filter((op) => D.month(op.date) === month);
  const sum = (type) => inMonth.filter((o) => o.type === type).reduce((s, o) => s + o.amount, 0);

  return [
    h('div', { class: 'screen-head' }, [
      h('h2', { text: 'Журнал' }),
      U.button('Добавить', () => forms.operationSheet(null, { onDone: refresh }), { kind: 'primary' }),
    ]),

    all.length
      ? U.card([
          h('div', { class: 'grid-3' }, [
            U.stat('Внесено', F.money(sum(C.OP_CONTRIBUTION)), { hint: 'за месяц' }),
            U.stat('Начислено', F.money(sum(C.OP_INCOME)), { hint: 'проценты' }),
            U.stat('Потрачено', F.money(sum(C.OP_EXPENSE)), { hint: 'расходы' }),
          ]),
          h('div', { class: 'chips' }, [
            ...FILTERS.map((f) =>
              h('button', {
                class: `chip${f.value === filter ? ' is-on' : ''}`,
                type: 'button',
                onclick: () => { filter = f.value; refresh(); },
              }, [f.label]),
            ),
          ]),
          // Фильтр и вид — разные по смыслу органы управления. Двумя
          // одинаковыми рядами кнопок они читались бы как один список.
          h('div', { class: 'segmented', role: 'tablist' }, [
            ['list', 'Список'],
            ['table', 'Таблица'],
          ].map(([value, label]) =>
            h('button', {
              class: `segment${mode === value ? ' is-on' : ''}`,
              type: 'button',
              role: 'tab',
              'aria-selected': String(mode === value),
              onclick: () => { mode = value; refresh(); },
            }, [label]),
          )),
        ])
      : null,

    ...(all.length === 0
      ? [U.card([U.emptyState('Операций нет. Первая появится, когда вы запишете взнос.')])]
      : mode === 'table'
        ? [tableView(visible, state, refresh)]
        : groups(visible, state, today, refresh)),

    visible.length || !all.length ? null : U.card([U.emptyState('По этому фильтру ничего нет.')]),
  ];
}

// --------------------------------------------------------------------------

function tableView(operations, state, refresh) {
  const assetName = (id) => state.assets.find((a) => a.id === id)?.name || '—';
  const goalName = (id) => state.goals.find((g) => g.id === id)?.name || '';

  return U.card([
    table({
      rows: operations,
      sortKey: 'date',
      dir: 'desc',
      onRow: (op) => forms.operationSheet(op, { onDone: refresh }),
      empty: 'По этому фильтру ничего нет.',
      // Сумма — четвёртая и последняя: на 440 пикселях пятая колонка
      // уводит её за край, и главное число приходится доскроливать.
      // Цель видна в списке и в карточке операции, здесь она лишняя.
      columns: [
        {
          key: 'date',
          title: 'Дата',
          value: (op) => op.date,
          render: (op) => F.dateShort(op.date),
          total: () => 'Итого',
        },
        { key: 'type', title: 'Тип', value: (op) => op.type },
        {
          key: 'asset',
          title: 'Актив',
          value: (op) => assetName(op.assetId),
          render: (op) => h('span', { class: 'dt-clip', text: assetName(op.assetId) }),
        },
        {
          key: 'amount',
          title: 'Сумма',
          align: 'right',
          value: (op) => C.signed(op),
          render: (op) => F.signedMoney(C.signed(op)),
          cellClass: (op) => (C.signed(op) >= 0 ? 'dt-plus' : 'dt-minus'),
          total: (rows) => F.signedMoney(rows.reduce((s, op) => s + C.signed(op), 0)),
        },
      ],
    }),
  ], { class: 'card-table' });
}

function groups(operations, state, today, refresh) {
  const byMonth = new Map();
  for (const op of operations) {
    const key = D.month(op.date);
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key).push(op);
  }

  const assetName = (id) => state.assets.find((a) => a.id === id)?.name || 'без актива';
  const goalName = (id) => state.goals.find((g) => g.id === id)?.name;

  return [...byMonth.entries()].map(([month, list]) => {
    const total = list.reduce((s, op) => s + C.signed(op), 0);
    return U.card([
      h('div', { class: 'month-head' }, [
        h('h2', { text: F.monthName(month) }),
        h('span', { class: `month-total ${total >= 0 ? 'is-plus' : 'is-minus'}`, text: F.signedMoney(total) }),
      ]),
      ...list.map((op) => {
        const goal = goalName(op.goalId);
        return h('button', {
          class: 'op',
          type: 'button',
          onclick: () => forms.operationSheet(op, { onDone: refresh }),
        }, [
          h('span', { class: `op-dot op-${kind(op.type)}` }),
          h('span', { class: 'op-main' }, [
            h('span', { class: 'op-title', text: `${op.type} · ${assetName(op.assetId)}` }),
            h('span', {
              class: 'op-sub',
              text: [F.relativeDate(op.date, today), goal, op.source === C.SOURCE_COMPUTED ? 'расчёт' : null, op.comment]
                .filter(Boolean)
                .join(' · '),
            }),
          ]),
          h('span', {
            class: `op-amount ${C.signed(op) >= 0 ? 'is-plus' : 'is-minus'}`,
            text: F.signedMoney(C.signed(op)),
          }),
        ]);
      }),
    ]);
  });
}

function kind(type) {
  if (type === C.OP_INCOME) return 'income';
  if (type === C.OP_EXPENSE) return 'expense';
  return 'contribution';
}

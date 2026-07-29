// Журнал операций. Заполняется по факту, а не по плану.

import * as U from '../ui.js';
import * as F from '../fmt.js';
import * as C from '../calc.js';
import * as D from '../dates.js';
import * as forms from '../forms.js';

const { h } = U;

const FILTERS = [
  { value: 'all', label: 'Все' },
  { value: C.OP_CONTRIBUTION, label: 'Взносы' },
  { value: C.OP_INCOME, label: 'Доходы' },
  { value: C.OP_EXPENSE, label: 'Расходы' },
];

let filter = 'all';

export function render(ctx) {
  const { state, today, refresh } = ctx;

  const all = [...state.operations]
    .filter((op) => D.isValid(op.date))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const visible = filter === 'all' ? all : all.filter((op) => op.type === filter);

  const month = D.month(today);
  const inMonth = all.filter((op) => D.month(op.date) === month);
  const contributed = inMonth.filter((o) => o.type === C.OP_CONTRIBUTION).reduce((s, o) => s + o.amount, 0);
  const earned = inMonth.filter((o) => o.type === C.OP_INCOME).reduce((s, o) => s + o.amount, 0);
  const spent = inMonth.filter((o) => o.type === C.OP_EXPENSE).reduce((s, o) => s + o.amount, 0);

  return [
    U.card([
      U.sectionTitle(
        'Журнал',
        U.button('Добавить', () => forms.operationSheet(null, { onDone: refresh }), { kind: 'primary' }),
      ),
      h('div', { class: 'grid-3' }, [
        U.stat('Внесено', F.money(contributed), { hint: 'за месяц' }),
        U.stat('Начислено', F.money(earned), { hint: 'проценты' }),
        U.stat('Потрачено', F.money(spent), { hint: 'расходы' }),
      ]),
      h('div', { class: 'chips' }, FILTERS.map((f) =>
        h('button', {
          class: `chip${f.value === filter ? ' is-on' : ''}`,
          type: 'button',
          onclick: () => {
            filter = f.value;
            refresh();
          },
        }, [f.label]),
      )),
    ]),

    ...groups(visible, state, today, refresh),

    visible.length ? null : U.card([U.emptyState('Операций нет.')]),
  ];
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
    const sum = list.reduce((s, op) => s + C.signed(op), 0);
    return U.card([
      h('div', { class: 'month-head' }, [
        h('h2', { text: F.monthName(month) }),
        h('span', { class: sum >= 0 ? 'is-plus' : 'is-minus', text: F.signedMoney(sum) }),
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

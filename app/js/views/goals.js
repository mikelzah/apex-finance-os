// Цели. Прогресс — это сумма стоимостей привязанных активов, а не отдельный
// кошелёк: цель здесь ярлык «на что отложено».

import * as U from '../ui.js';
import * as F from '../fmt.js';
import * as C from '../calc.js';
import * as charts from '../charts.js';
import * as forms from '../forms.js';
import * as store from '../store.js';
import * as reorder from '../reorder.js';

const { h } = U;

/**
 * Порядок целей задаёт человек, а не статус.
 *
 * Раньше список сортировался по статусу: активные, на паузе, достигнутые.
 * Правило разумное, но не то: что для меня главное сейчас — знаю только я,
 * и «на паузе» вовсе не значит «показывай ниже». Порядок хранится в самой
 * цели и меняется перетаскиванием за шапку карточки.
 */
export function render(ctx) {
  const { state, refresh } = ctx;
  const goals = C.orderedGoals(state.goals);
  const cards = goals.map((goal) => goalCard(goal, ctx));

  // Перетаскивание вешается после того, как карточки окажутся на экране:
  // до этого их не измерить, а без размеров жест не собрать.
  if (cards.length > 1) {
    requestAnimationFrame(() => {
      reorder.enable(cards, (card) => card.querySelector('.goal-head'), async (order) => {
        const ids = order.map((i) => goals[i].id);
        await store.mutate((draft) => {
          for (const g of draft.goals) {
            const at = ids.indexOf(g.id);
            if (at !== -1) g.sort = at;
          }
        });
        U.toast('Порядок сохранён');
        refresh();
      });
    });
  }

  return [
    // Карточка вокруг одного заголовка и кнопки была бы пустой рамой —
    // строка справляется с этим сама.
    h('div', { class: 'screen-head' }, [
      h('h2', { text: 'Цели' }),
      U.button('Добавить', () => forms.goalSheet(null, { onDone: refresh }), { kind: 'primary' }),
    ]),
    goals.length ? null : U.card([U.emptyState('Целей пока нет.')]),
    ...cards,
  ];
}

function goalCard(goal, ctx) {
  const { state, today, refresh } = ctx;
  const m = C.goalMetrics(goal, state.assets, state.operations, today);
  const overdue = m.reserveDays != null && m.reserveDays < 0;

  return U.card([
    h('div', { class: 'goal-head', onclick: () => forms.goalSheet(goal, { onDone: refresh }) }, [
      h('div', {}, [
        h('h2', { class: 'goal-name', text: goal.name }),
        h('div', { class: 'goal-sub', text: goal.deadline ? `до ${F.date(goal.deadline)}` : 'без срока' }),
      ]),
      h('span', { class: `tag tag-${goal.status === C.GOAL_ACTIVE ? 'ok' : 'muted'}`, text: goal.status }),
    ]),

    charts.progress(m.progress, { over: (m.progress || 0) >= 1 }),

    h('div', { class: 'goal-amounts' }, [
      h('span', { class: 'goal-current', text: F.money(m.current) }),
      h('span', { class: 'goal-target', text: `из ${F.money(m.target)} · ${F.share(m.progress)}` }),
    ]),

    h('div', { class: 'grid-2' }, [
      U.stat('Нужно в день', m.needPerDay != null ? F.money(m.needPerDay) : '—',
        { hint: m.daysLeft != null ? `осталось ${F.days(m.daysLeft)}` : 'срок не задан' }),
      U.stat('Дневной прирост', F.money(m.dailyGrowth), { hint: 'план плюс проценты' }),
      U.stat('Выполнение плана', m.planCompletion != null ? F.share(m.planCompletion) : '—',
        { hint: 'взносы за этот месяц' }),
      U.stat('Прогноз закрытия', m.forecast ? F.date(m.forecast) : 'не наберётся',
        {
          hint: m.reserveDays == null
            ? 'срок не задан'
            : overdue
              ? `опоздание на ${F.days(Math.abs(m.reserveDays))}`
              : `запас ${F.days(m.reserveDays)}`,
          class: overdue ? 'is-bad' : '',
        }),
    ]),

    m.assets.length
      ? h('div', { class: 'goal-assets' }, [
          h('h3', { text: 'Привязанные активы' }),
          ...m.assets.map((a) =>
            U.row(a.name, F.money(C.assetValue(a, state.operations)), {
              sub: a.goalIds.length > 1 ? `в ${a.goalIds.length} целях` : a.type,
              onClick: () => forms.assetSheet(a, { onDone: refresh }),
            }),
          ),
        ])
      : null,
  ]);
}

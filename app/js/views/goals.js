// Цели. Прогресс — это сумма стоимостей привязанных активов, а не отдельный
// кошелёк: цель здесь ярлык «на что отложено».

import * as U from '../ui.js';
import * as F from '../fmt.js';
import * as C from '../calc.js';
import * as charts from '../charts.js';
import * as forms from '../forms.js';
import * as store from '../store.js';
import * as reorder from '../reorder.js';
import * as icons from '../icons.js';

const { h } = U;

export function head(ctx) {
  return U.screenHead('Цели', U.roundAction(
    'Добавить цель',
    icons.icon('plus'),
    () => forms.goalSheet(null, { onDone: ctx.refresh }),
  ));
}

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
    goals.length ? null : U.card([U.emptyState('Целей пока нет.')]),
    ...cards,
  ];
}

function goalCard(goal, ctx) {
  const { state, today, refresh } = ctx;
  const m = C.goalMetrics(goal, state.assets, state.operations, today);
  const overdue = m.reserveDays != null && m.reserveDays < 0;
  const done = goal.status === C.GOAL_DONE;
  const idle = goal.status !== C.GOAL_ACTIVE;

  const tagKind = done ? 'done' : goal.status === C.GOAL_ACTIVE ? 'act' : 'pause';

  // Метрика — ячейка сетки два на два. В строку они не встают: подписи
  // под числами длиннее самих чисел.
  const metric = (label, value, hint, bad) => h('div', { class: `metric ${bad ? 'is-bad' : ''}`.trim() }, [
    h('span', { class: 'metric-label', text: label }),
    h('span', { class: 'metric-value', text: value }),
    h('span', { class: 'metric-hint', text: hint }),
  ]);

  return U.card([
    // Шапка — она же ручка перетаскивания. Ручка нарисована, а не угадывается:
    // порядок целей человек задаёт руками, и в списке без неё об этом
    // невозможно догадаться — долгое нажатие ничем себя не выдаёт.
    h('div', { class: 'goal-head', onclick: () => forms.goalSheet(goal, { onDone: refresh }) }, [
      h('span', { class: 'goal-grip', 'aria-hidden': 'true' }, [gripIcon()]),
      h('div', { class: 'goal-head-text' }, [
        h('h2', { class: 'goal-name', text: goal.name }),
        h('div', {
          class: 'goal-sub',
          text: done && m.forecast ? `закрыта ${F.date(m.forecast)}`
            : goal.deadline ? `до ${F.date(goal.deadline)}` : 'без срока',
        }),
      ]),
      h('span', { class: `goal-tag is-${tagKind}`, text: goal.status.toUpperCase() }),
    ]),

    // Кольцо вместо полосы: доля читается тем же одним взглядом, а место
    // рядом остаётся суммам, которым иначе не хватало бы строки.
    h('div', { class: 'goal-money' }, [
      charts.ring(m.progress, { size: 54, done: (m.progress || 0) >= 1, quiet: idle && !done }),
      h('div', { class: 'goal-money-text' }, [
        h('span', { class: 'goal-current', text: F.money(m.current) }),
        h('span', {
          class: 'goal-target',
          text: done ? `цель ${F.money(m.target)} · 100%` : `из ${F.money(m.target)}`,
        }),
      ]),
    ]),

    // У достигнутой цели метрик нет вовсе: считать ей уже нечего,
    // и четыре прочерка сообщали бы только о том, что блок не убрали.
    done ? null : h('div', { class: 'goal-metrics' }, [
      metric('Нужно в день', m.needPerDay != null ? F.money(m.needPerDay) : '—',
        m.daysLeft != null ? `осталось ${F.days(m.daysLeft)}` : 'срок не задан'),
      metric('Дневной прирост', F.money(m.dailyGrowth),
        idle ? 'взносы приостановлены' : 'план плюс проценты'),
      metric('Выполнение плана', m.planCompletion != null ? F.share(m.planCompletion) : '—',
        m.planCompletion != null ? 'взносы за этот месяц' : 'плана нет'),
      metric('Прогноз закрытия', m.forecast ? F.dateShort(m.forecast) : 'не наберётся',
        m.reserveDays == null ? 'срок не задан'
          : overdue ? `опоздание на ${F.days(Math.abs(m.reserveDays))}`
            : `запас ${F.days(m.reserveDays)}`,
        overdue),
    ]),

    m.assets.length ? linkedAssets(m.assets, state, refresh) : null,
  ], { class: `card-goal ${idle ? 'is-idle' : ''}`.trim() });
}

/**
 * Привязанные активы, свёрнутые в строку.
 *
 * Прогресс цели — это их сумма, и не показать их значит показать число,
 * взявшееся ниоткуда. Но и держать список раскрытым всегда неправильно:
 * у четырёх целей это два десятка строк, сквозь которые до следующей цели
 * приходится пролистывать.
 *
 * Число в свёрнутой строке обязательно: «Привязанные активы» без числа
 * не отличает цель с пятью активами от цели, к которой не привязано ничего,
 * — а второе приложение считает ошибкой и говорит о нём отдельно.
 */
function linkedAssets(assets, state, refresh) {
  const list = h('div', { class: 'linked-list', hidden: true },
    assets.map((a) => h('button', {
      class: 'linked-row',
      type: 'button',
      onclick: () => forms.assetSheet(a, { onDone: refresh }),
    }, [
      h('span', { class: 'linked-text' }, [
        h('span', { class: 'linked-name', text: a.name }),
        h('span', {
          class: 'linked-sub',
          text: a.goalIds.length > 1 ? `${a.type} · в ${a.goalIds.length} целях` : a.type,
        }),
      ]),
      h('span', { class: 'linked-sum', text: F.money(C.assetValue(a, state.operations)) }),
    ])),
  );

  const head = h('button', {
    class: 'linked-head',
    type: 'button',
    'aria-expanded': 'false',
    onclick: (e) => {
      list.hidden = !list.hidden;
      e.currentTarget.setAttribute('aria-expanded', String(!list.hidden));
    },
  }, [
    h('span', { class: 'linked-label', text: 'Привязанные активы' }),
    h('span', { class: 'linked-count', text: String(assets.length) }),
    h('span', { class: 'linked-chevron', text: '⌄' }),
  ]);

  return h('div', { class: 'linked' }, [head, list]);
}

/** Ручка перетаскивания. Контурами, а не символом: шрифт приложения —
 *  подмножество на 58 КБ, и точечных глифов в нём нет. */
function gripIcon() {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 10 16');
  svg.setAttribute('width', '10');
  svg.setAttribute('height', '16');
  svg.setAttribute('fill', 'currentColor');
  for (const [cx, cy] of [[2, 3], [8, 3], [2, 8], [8, 8], [2, 13], [8, 13]]) {
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', cx);
    c.setAttribute('cy', cy);
    c.setAttribute('r', '1.4');
    svg.appendChild(c);
  }
  return svg;
}

// Главный экран. Три вопроса, на которые он отвечает каждое утро:
// сколько у меня есть, иду ли я по графику, что делать сегодня.

import * as U from '../ui.js';
import * as F from '../fmt.js';
import * as C from '../calc.js';
import * as D from '../dates.js';
import * as charts from '../charts.js';
import * as store from '../store.js';
import * as forms from '../forms.js';

const { h } = U;

export function render(ctx) {
  const { state, today, refresh } = ctx;
  const { assets, operations, goals, settings } = state;
  const worth = C.netWorth(assets, operations);

  return [
    hero(worth, today),
    quickAdd(state, refresh),
    accrualBanner(state, today, refresh),
    attention(state, today, ctx),
    ritualCard(state, today),
    capitalChart(state, worth, today),
    goalsBrief(state, today, ctx),
  ];
}

// --------------------------------------------------------------------------

function hero(worth, today) {
  return U.card([
    h('div', { class: 'hero' }, [
      h('div', { class: 'hero-label', text: 'Чистый капитал' }),
      h('div', { class: 'hero-value', text: F.money(worth.total) }),
      h('div', { class: 'hero-date', text: F.date(today) }),
    ]),
    h('div', { class: 'hero-split' }, [
      U.stat('Доступно сегодня', F.money(worth.liquid), { hint: 'мгновенная ликвидность' }),
      U.stat('Инвестиции', F.money(worth.invested)),
    ]),
  ]);
}

function quickAdd(state, refresh) {
  const { settings, assets, goals } = state;
  const amount = settings.quickAmount;
  const asset = assets.find((a) => a.id === settings.quickAssetId);
  const goal = goals.find((g) => g.id === settings.quickGoalId);
  if (!amount || !asset) return null;

  return U.card(
    [
      h('button', {
        class: 'quick',
        type: 'button',
        onclick: async () => {
          await store.mutate((draft) => {
            draft.operations.push({
              id: store.newId('op'),
              date: D.today(),
              type: C.OP_CONTRIBUTION,
              amount,
              assetId: asset.id,
              goalId: goal?.id || null,
              source: C.SOURCE_MANUAL,
              comment: null,
            });
          });
          U.tap();
          U.toast(`Взнос ${F.money(amount)} записан`);
          refresh();
        },
      }, [
        h('span', { class: 'quick-amount', text: `Внести ${F.money(amount)}` }),
        h('span', { class: 'quick-target', text: `${asset.name}${goal ? ` · ${goal.name}` : ''}` }),
      ]),
      h('button', {
        class: 'quick-alt',
        type: 'button',
        onclick: () => forms.operationSheet(null, { onDone: refresh }),
      }, ['Другая сумма или тип']),
    ],
    { class: 'card-quick' },
  );
}

/**
 * Проценты не записываются молча: скрипт создавал операцию сам, здесь это
 * делает человек одним нажатием. Так остаётся момент, где сумму можно
 * сверить с приложением банка до того, как она попала в капитал.
 */
function accrualBanner(state, today, refresh) {
  const pending = C.pendingAccruals(state.assets, state.operations, today);
  const due = pending.filter((p) => p.fires);
  const growing = pending.filter((p) => !p.fires && C.round2(p.accrued) > 0);

  const children = [];

  for (const item of due) {
    children.push(
      h('div', { class: 'accrual' }, [
        h('div', {}, [
          h('div', { class: 'accrual-title', text: `${item.asset.name}: день капитализации` }),
          h('div', { class: 'accrual-sub', text: `Начислено с ${F.date(item.asset.lastCap || today)} — ${F.money2(item.accrued)}` }),
        ]),
        U.button('Записать', async () => {
          await store.mutate((draft) => {
            draft.operations.push({
              id: store.newId('op'),
              date: today,
              type: C.OP_INCOME,
              amount: C.round2(item.accrued),
              assetId: item.asset.id,
              goalId: (item.asset.goalIds || [])[0] || null,
              source: C.SOURCE_COMPUTED,
              comment: 'Проценты, расчёт',
            });
            const asset = draft.assets.find((a) => a.id === item.asset.id);
            if (asset) asset.lastCap = today;
          });
          U.toast('Проценты записаны — сверьте с банком');
          refresh();
        }, { kind: 'primary' }),
      ]),
    );
  }

  if (!children.length && growing.length) {
    const total = growing.reduce((s, p) => s + p.accrued, 0);
    const next = growing[0].asset;
    children.push(
      h('div', { class: 'accrual accrual-quiet' }, [
        h('div', {}, [
          h('div', { class: 'accrual-title', text: `Накоплено процентов: ${F.money2(total)}` }),
          h('div', {
            class: 'accrual-sub',
            text: next.capDay
              ? `Запишутся операцией ${next.capDay}-го числа`
              : 'День капитализации не задан — операция не создастся',
          }),
        ]),
      ]),
    );
  }

  if (!children.length) return null;
  return U.card([U.sectionTitle('Проценты'), ...children]);
}

function attention(state, today, ctx) {
  const list = C.signals(state.assets, state.operations, today);
  return U.card([
    U.sectionTitle('Требует внимания'),
    list.length
      ? h('div', { class: 'signals' }, list.map((s) =>
          h('button', {
            class: `signal signal-${s.level}`,
            type: 'button',
            onclick: () => forms.assetSheet(s.asset, { onDone: ctx.refresh }),
          }, [
            h('span', { class: 'signal-asset', text: s.asset.name }),
            h('span', { class: 'signal-text', text: s.text }),
          ]),
        ))
      : U.callout('Пусто — система в порядке.', 'ok'),
  ]);
}

function ritualCard(state, today) {
  const goalId = state.settings.quickGoalId;
  const goal = state.goals.find((g) => g.id === goalId);
  const { node, filled, elapsed, streak } = charts.ritual(state.operations, goalId, today);

  return U.card([
    U.sectionTitle('Дисциплина'),
    h('div', { class: 'ritual-stats' }, [
      U.stat('Подряд', `${streak} ${F.plural(streak, 'день', 'дня', 'дней')}`),
      U.stat('В этом месяце', `${filled} из ${elapsed}`),
    ]),
    node,
    h('p', {
      class: 'muted-note',
      text: goal
        ? `Пустая клетка — день без взноса по цели «${goal.name}». Это и есть весь чек-лист.`
        : 'Пустая клетка — день без взноса.',
    }),
  ]);
}

function capitalChart(state, worth, today) {
  // К истории добавляем сегодняшнюю точку: снимок за текущий месяц
  // перезаписывается по ходу дела, и без неё график отставал бы на месяц.
  const history = [...state.netWorth]
    .filter((r) => D.isValid(r.date))
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((r) => ({ x: r.date, y: r.total }));

  const points = [...history];
  if (!points.length || points[points.length - 1].x !== today) {
    points.push({ x: today, y: worth.total });
  } else {
    points[points.length - 1] = { x: today, y: worth.total };
  }

  return U.card([
    U.sectionTitle('История капитала'),
    charts.line(points, { hint: 'Первый снимок появится в конце месяца — графику нужны две точки' }),
  ]);
}

function goalsBrief(state, today, ctx) {
  const active = state.goals.filter((g) => g.status === C.GOAL_ACTIVE);
  if (!active.length) return null;

  return U.card([
    U.sectionTitle('Цели', U.button('Все', () => ctx.go('goals'))),
    ...active.map((goal) => {
      const m = C.goalMetrics(goal, state.assets, state.operations, today);
      return h('div', { class: 'goal-brief', onclick: () => ctx.go('goals') }, [
        h('div', { class: 'goal-brief-head' }, [
          h('span', { text: goal.name }),
          h('span', { class: 'goal-brief-share', text: F.share(m.progress) }),
        ]),
        charts.progress(m.progress),
        h('div', { class: 'goal-brief-foot' }, [
          h('span', { text: `${F.money(m.current)} из ${F.money(m.target)}` }),
          h('span', { text: m.needPerDay != null ? `нужно ${F.money(m.needPerDay)}/день` : '' }),
        ]),
      ]);
    }),
  ]);
}

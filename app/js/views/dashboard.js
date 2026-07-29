// Главный экран. Три вопроса, на которые он отвечает каждое утро:
// сколько у меня есть, иду ли я по графику, что делать сегодня.
//
// Спокойная композиция: одно число и одно действие наверху, всё остальное
// ниже по прокрутке. Приложение открывают ради одного нажатия — пусть оно
// и будет главным, а не соревнуется за внимание с шестью карточками.

import * as U from '../ui.js';
import * as F from '../fmt.js';
import * as C from '../calc.js';
import * as D from '../dates.js';
import * as charts from '../charts.js';
import * as store from '../store.js';
import * as forms from '../forms.js';
import { statusIcon } from '../icons.js';
import * as mascot from '../mascot.js';

const { h } = U;

export function render(ctx) {
  const { state, today } = ctx;
  if (!state.assets.length) return gettingStarted(ctx);

  const worth = C.netWorth(state.assets, state.operations);

  return [
    hero(state, worth, today),
    quickAdd(ctx),
    accruals(ctx),
    primaryGoal(ctx),
    attention(ctx),
    capitalChart(state, worth, today),
    ritualCard(state, today),
    secondaryGoals(ctx),
  ];
}

// --------------------------------------------------------------------------

/**
 * Пока активов нет, показывать нечего: капитал ноль, календарь дисциплины —
 * тридцать пустых клеток, а «Добавить операцию» ведёт в форму с пустым
 * списком активов. Вместо этого называем первый шаг.
 */
function gettingStarted(ctx) {
  const { refresh } = ctx;
  return [
    h('section', { class: 'hero' }, [
      h('p', { class: 'hero-label', text: 'Чистый капитал' }),
      h('p', { class: 'hero-value', text: F.money(0) }),
    ]),
    U.card([
      h('h2', { class: 'start-title', text: 'Начните с актива' }),
      h('p', { class: 'start-text', text: 'Деньги живут в активах: накопительный счёт, вклад, бумаги. Цели и операции опираются на них, поэтому первый актив — первый шаг.' }),
      U.button('Добавить актив', () => forms.assetSheet(null, { onDone: refresh }), {
        kind: 'primary',
        class: 'btn-wide',
      }),
    ]),
    U.card([
      U.callout('Если хочется сперва осмотреться — в «Ещё → Настройки» можно загрузить вымышленные демо-данные и стереть их в любой момент.', 'info'),
    ]),
  ];
}

function hero(state, worth, today) {
  // Изменение за день считается по записанным операциям, а не по переоценке:
  // «сегодня» здесь означает «сегодня я внёс», и это честнее, чем смешивать
  // собственные взносы с движением котировок.
  const delta = state.operations
    .filter((op) => op.date === today)
    .reduce((sum, op) => sum + C.signed(op), 0);

  return h('section', { class: 'hero' }, [
    h('p', { class: 'hero-label', text: 'Чистый капитал' }),
    h('p', { class: 'hero-value', text: F.money(worth.total) }),
    delta
      ? h('p', { class: `hero-delta ${delta > 0 ? 'is-up' : 'is-down'}` }, [
          h('span', { text: F.signedMoney(delta) }),
          h('span', { class: 'hero-delta-word', text: 'сегодня' }),
        ])
      : h('p', { class: 'hero-delta is-quiet', text: 'сегодня записей ещё не было' }),
    h('div', { class: 'hero-split' }, [
      h('div', {}, [
        h('span', { class: 'hero-split-label', text: 'Доступно' }),
        h('span', { class: 'hero-split-value', text: F.money(worth.liquid) }),
      ]),
      h('div', {}, [
        h('span', { class: 'hero-split-label', text: 'Инвестиции' }),
        h('span', { class: 'hero-split-value', text: F.money(worth.invested) }),
      ]),
    ]),
  ]);
}

function quickAdd(ctx) {
  const { state, refresh } = ctx;
  const { settings, assets, goals } = state;
  const amount = settings.quickAmount;
  const asset = assets.find((a) => a.id === settings.quickAssetId);
  const goal = goals.find((g) => g.id === settings.quickGoalId);

  if (!amount || !asset) {
    return h('div', { class: 'act' }, [
      U.button('Добавить операцию', () => forms.operationSheet(null, { onDone: refresh }), {
        kind: 'primary',
        class: 'btn-wide',
      }),
    ]);
  }

  return h('div', { class: 'act' }, [
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
        mascot.celebrate();
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
  ]);
}

/**
 * Проценты не записываются молча: скрипт создавал операцию сам, здесь это
 * делает человек одним нажатием. Так остаётся момент, где сумму можно
 * сверить с приложением банка до того, как она попала в капитал.
 */
function accruals(ctx) {
  const { state, today, refresh } = ctx;
  const pending = C.pendingAccruals(state.assets, state.operations, today);
  const due = pending.filter((p) => p.fires);

  if (due.length) {
    return U.card(
      due.map((item) =>
        h('div', { class: 'accrual' }, [
          h('div', { class: 'accrual-text' }, [
            h('div', { class: 'accrual-title', text: `${item.asset.name}: день капитализации` }),
            h('div', { class: 'accrual-sub', text: `Начислено ${F.money2(item.accrued)} с ${F.date(item.asset.lastCap || today)}` }),
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
      ),
      { class: 'card-accrual' },
    );
  }

  const growing = pending.filter((p) => C.round2(p.accrued) > 0);
  if (!growing.length) return null;

  const total = growing.reduce((s, p) => s + p.accrued, 0);
  const next = growing[0].asset;
  return h('p', { class: 'quiet-line' }, [
    h('span', { text: `Накоплено процентов ${F.money2(total)}` }),
    h('span', { class: 'quiet-line-dot', text: '·' }),
    h('span', {
      class: 'quiet-line-sub',
      text: next.capDay ? `запишутся ${next.capDay}-го числа` : 'день капитализации не задан',
    }),
  ]);
}

function primaryGoal(ctx) {
  const { state, today } = ctx;
  const goal = state.goals.find((g) => g.status === C.GOAL_ACTIVE);
  if (!goal) return null;

  const m = C.goalMetrics(goal, state.assets, state.operations, today);
  const late = m.reserveDays != null && m.reserveDays < 0;

  return U.card([
    h('div', { class: 'goal-line' }, [
      h('span', { class: 'goal-line-name', text: goal.name }),
      h('span', { class: 'goal-line-share', text: F.share(m.progress) }),
    ]),
    charts.progress(m.progress, { over: (m.progress || 0) >= 1 }),
    h('div', { class: 'goal-line-foot' }, [
      h('span', { text: `${F.money(m.current)} из ${F.money(m.target)}` }),
      h('span', {
        class: late ? 'is-late' : '',
        text: m.forecast ? `прогноз ${F.dateShort(m.forecast)}` : 'темпа не хватает',
      }),
    ]),
    m.needPerDay != null
      ? h('p', { class: 'goal-line-hint' }, [
          h('span', { text: `нужно ${F.money(m.needPerDay)}/день` }),
          h('span', { class: 'quiet-line-dot', text: '·' }),
          h('span', { text: `темп ${F.money(m.dailyGrowth)}` }),
        ])
      : null,
  ], { class: 'card-goal' });
}

/**
 * Сигналы. Если всё спокойно, блок сворачивается в одну строку: пустая
 * карточка «Требует внимания: пусто» каждый день занимала бы экран,
 * ничего не сообщая.
 */
function attention(ctx) {
  const { state, today, refresh } = ctx;
  const list = C.signals(state.assets, state.operations, today);
  if (!list.length) return h('p', { class: 'quiet-line' }, [h('span', { text: 'Всё в порядке — сигналов нет' })]);

  const errors = list.filter((s) => s.level === 'error');
  const open = errors.length > 0;

  const items = h('div', { class: 'signals', hidden: !open },
    list.map((s) =>
      h('button', {
        class: `signal signal-${s.level}`,
        type: 'button',
        onclick: () => forms.assetSheet(s.asset, { onDone: refresh }),
      }, [
        statusIcon(s.level),
        h('span', { class: 'signal-text' }, [
          h('span', { class: 'signal-asset', text: s.asset.name }),
          h('span', { class: 'signal-note', text: s.text }),
        ]),
      ]),
    ),
  );

  const toggle = h('button', {
    class: 'disclosure',
    type: 'button',
    'aria-expanded': String(open),
    onclick: (e) => {
      items.hidden = !items.hidden;
      e.currentTarget.setAttribute('aria-expanded', String(!items.hidden));
      e.currentTarget.querySelector('.disclosure-chevron').textContent = items.hidden ? '⌄' : '⌃';
    },
  }, [
    statusIcon(errors.length ? 'error' : 'warn'),
    h('span', { class: 'disclosure-label', text: `Требует внимания: ${list.length}` }),
    h('span', { class: 'disclosure-chevron', text: open ? '⌃' : '⌄' }),
  ]);

  return U.card([toggle, items], { class: 'card-signals' });
}

function capitalChart(state, worth, today) {
  // К истории добавляем сегодняшнюю точку: снимок за текущий месяц
  // перезаписывается по ходу дела, и без неё график отставал бы на месяц.
  const points = [...state.netWorth]
    .filter((r) => D.isValid(r.date))
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((r) => ({ x: r.date, y: r.total }));

  if (points.length && points[points.length - 1].x === today) points.pop();
  points.push({ x: today, y: worth.total });

  return U.card([
    U.sectionTitle('Капитал'),
    charts.line(points, {
      label: 'Капитал',
      hint: 'Первый снимок появится в конце месяца — графику нужны две точки',
    }),
  ]);
}

function ritualCard(state, today) {
  const goalId = state.settings.quickGoalId;
  const goal = state.goals.find((g) => g.id === goalId);
  const { node, filled, elapsed, streak } = charts.ritual(state.operations, goalId, today);

  return U.card([
    U.sectionTitle('Дисциплина'),
    h('div', { class: 'ritual-head' }, [
      h('span', { class: 'ritual-streak', text: `${streak} ${F.plural(streak, 'день', 'дня', 'дней')} подряд` }),
      h('span', { class: 'ritual-count', text: `${filled} из ${elapsed}` }),
    ]),
    node,
    h('p', {
      class: 'muted-note',
      text: goal
        ? `Пустая клетка — день без взноса по цели «${goal.name}».`
        : 'Пустая клетка — день без взноса.',
    }),
  ]);
}

function secondaryGoals(ctx) {
  const { state, today } = ctx;
  const rest = state.goals.filter((g) => g.status !== C.GOAL_ACTIVE);
  if (!rest.length) return null;

  return U.card([
    U.sectionTitle('Остальные цели', U.button('Все', () => ctx.go('goals'))),
    ...rest.map((goal) => {
      const m = C.goalMetrics(goal, state.assets, state.operations, today);
      return U.row(goal.name, F.share(m.progress), {
        sub: `${F.money(m.current)} из ${F.money(m.target)} · ${goal.status.toLowerCase()}`,
        onClick: () => ctx.go('goals'),
      });
    }),
  ]);
}

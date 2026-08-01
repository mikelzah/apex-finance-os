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
    advice(ctx),
    quickAdd(ctx),
    accruals(ctx),
    primaryGoal(ctx),
    attention(ctx),
    capitalChart(state, worth, today),
    balanceCard(ctx),
    ritualCard(state, today),
    secondaryGoals(ctx),
  ];
}

// --------------------------------------------------------------------------

/**
 * Одна фраза по делу от Кубыша.
 *
 * Ровно одна, и только когда есть что сказать. Приложение, которое советует
 * постоянно, перестают читать на третий день; приложение, которое молчит,
 * пока всё ровно, и говорит одну фразу, когда нет, — читают.
 *
 * Порядок правил — это порядок важности: сначала то, что стоит денег, потом
 * то, что мешает считать, и только потом дисциплина. Первое подошедшее
 * правило и есть фраза.
 */
function advice(ctx) {
  const { state, today, go } = ctx;
  const line = adviceText(state, today);
  if (!line) return null;

  return h('button', {
    class: 'advice',
    type: 'button',
    onclick: () => go(line.go),
  }, [
    mascot.portrait('advice-mascot'),
    h('span', { class: 'advice-text', text: line.text }),
    h('span', { class: 'row-chevron', text: '›' }),
  ]);
}

function adviceText(state, today) {
  const alive = state.assets.filter((a) => a.status !== C.STATUS_SOLD);

  // Деньги вперёд всего: лот, которому до льготы недолго, стоит реальных
  // процентов, и узнать о нём надо не в отчёте за год.
  for (const a of alive) {
    if (!a.ticker) continue;
    const soon = C.lotsOf(a, state.operations)
      .filter((lot) => !lot.unknown)
      .map((lot) => C.ldvStatus(lot, today))
      .filter((st) => st.known && !st.eligible && st.daysLeft > 0 && st.daysLeft <= 60)
      .sort((x, y) => x.daysLeft - y.daysLeft)[0];
    if (soon) {
      return { text: `${a.name}: до льготы ${F.days(soon.daysLeft)} — продавать сейчас невыгодно`, go: `portfolio/${a.id}` };
    }
  }

  const errors = C.dataHealth(state, today).filter((x) => x.level === 'error');
  if (errors.length) {
    return { text: `${errors[0].title}: ${errors[0].detail}`, go: 'more/health' };
  }

  const soonPay = C.couponCalendar(alive, state.operations, today, 14)[0];
  if (soonPay) {
    return { text: `${soonPay.asset.name}: выплата ${F.money(soonPay.amount + soonPay.redemption)} ${F.relativeDate(soonPay.date, today)}`, go: 'portfolio' };
  }

  // Дисциплина — последней: она про привычку, а не про деньги, и кричать
  // о ней поверх настоящих потерь неправильно.
  const goal = C.orderedGoals(state.goals).find((g) => g.status === C.GOAL_ACTIVE && g.planPerDay);
  if (goal) {
    const last = state.operations
      .filter((op) => op.type === C.OP_CONTRIBUTION && D.isValid(op.date))
      .map((op) => op.date)
      .sort()
      .pop();
    const idle = last ? D.diffDays(today, last) : null;
    if (idle != null && idle >= 3) {
      return { text: `${F.days(idle)} без взносов, а нужно ${F.money(goal.planPerDay)} в день`, go: 'goals' };
    }
  }
  return null;
}

/**
 * Пока активов нет, показывать нечего: капитал ноль, календарь дисциплины —
 * тридцать пустых клеток, а «Добавить операцию» ведёт в форму с пустым
 * списком активов. Вместо этого называем первый шаг.
 */
function gettingStarted(ctx) {
  const { refresh } = ctx;
  return [
    h('section', { class: 'hero' }, [
      h('p', { class: 'hero-label', text: 'Мой капитал' }),
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
    h('p', { class: 'hero-label', text: 'Мой капитал' }),
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
  const all = C.signals(state.assets, state.operations, today);
  const { shown, hidden } = C.splitSignals(all, state.settings.mutedSignals);

  if (!shown.length) {
    const line = [h('span', { text: 'Всё в порядке — сигналов нет' })];
    if (hidden.length) {
      line.push(h('span', { class: 'quiet-line-dot', text: '·' }));
      line.push(h('button', { class: 'link', type: 'button', onclick: () => hiddenSheet(ctx, hidden) },
        [h('span', { text: `скрыто ${hidden.length}` })]));
    }
    return h('p', { class: 'quiet-line' }, line);
  }

  const errors = shown.filter((s) => s.level === 'error');
  // Пока человек сам не свернул или не развернул блок, решает содержимое:
  // ошибку прятать нельзя, предупреждение того не стоит. Как только выбор
  // сделан, он сохраняется — иначе принятая ошибка раскрывала бы блок
  // каждый день, и свернуть его было бы невозможно.
  const pref = state.settings.signalsOpen;
  const open = pref == null ? errors.length > 0 : Boolean(pref);

  const items = h('div', { class: 'signals', hidden: !open },
    shown.map((s) => signalRow(ctx, s)),
  );

  const toggle = h('button', {
    class: 'disclosure',
    type: 'button',
    'aria-expanded': String(open),
    onclick: (e) => {
      items.hidden = !items.hidden;
      e.currentTarget.setAttribute('aria-expanded', String(!items.hidden));
      e.currentTarget.querySelector('.disclosure-chevron').textContent = items.hidden ? '⌄' : '⌃';
      // Без перерисовки: она бы схлопнула только что раскрытый блок обратно
      // в анимацию появления, а положение выбора и так уже на экране.
      store.mutate((draft) => { draft.settings.signalsOpen = !items.hidden; });
    },
  }, [
    statusIcon(errors.length ? 'error' : 'warn'),
    h('span', { class: 'disclosure-label', text: `Требует внимания: ${shown.length}` }),
    hidden.length ? h('span', { class: 'disclosure-hidden', text: `скрыто ${hidden.length}` }) : null,
    h('span', { class: 'disclosure-chevron', text: open ? '⌃' : '⌄' }),
  ]);

  const foot = hidden.length
    ? h('button', { class: 'signals-foot', type: 'button', onclick: () => hiddenSheet(ctx, hidden) }, [
        h('span', { text: `Скрытые сигналы: ${hidden.length}` }),
        h('span', { class: 'row-chevron', text: '›' }),
      ])
    : null;

  return U.card([toggle, items, foot], { class: 'card-signals' });
}

/**
 * Строка сигнала: слева — переход к активу, справа — «скрыть».
 *
 * Две отдельные кнопки, а не одна: кнопку внутри кнопки браузер разбирать
 * не обязан, да и промахнуться пальцем по такому было бы легко.
 */
function signalRow(ctx, s) {
  const { refresh } = ctx;
  return h('div', { class: `signal signal-${s.level}` }, [
    h('div', { class: 'signal-row' }, [
      h('button', {
        class: 'signal-main',
        type: 'button',
        onclick: () => forms.assetSheet(s.asset, { onDone: refresh }),
      }, [
        statusIcon(s.level),
        h('span', { class: 'signal-text' }, [
          h('span', { class: 'signal-asset', text: s.asset.name }),
          h('span', { class: 'signal-note', text: s.text }),
        ]),
      ]),
      h('button', {
        class: 'signal-mute',
        type: 'button',
        'aria-label': `Скрыть сигнал: ${s.asset.name}, ${s.text}`,
        onclick: async () => {
          await store.mutate((draft) => {
            const key = C.signalKey(s);
            const kept = (draft.settings.mutedSignals || []).filter((m) => (m.key || m) !== key);
            kept.push({ key, text: s.text });
            draft.settings.mutedSignals = kept;
          });
          U.toast('Сигнал скрыт — вернётся, если изменится');
          refresh();
        },
      }, [h('span', { text: '✕' })]),
    ]),
    signalAction(ctx, s),
  ]);
}

/**
 * Действие по сигналу, если оно однозначно.
 *
 * Пока такое одно: банк показывает больше, чем насчитало приложение. Разница
 * почти всегда — начисленные проценты, которые ещё не записаны, и закрыть её
 * можно только операцией «Доход»: приложение сравнивает банк с расчётом,
 * а не с прошлым значением сверки, поэтому переписать число сверки — не выход.
 *
 * Обратный случай — банк показывает меньше — кнопки не получает намеренно.
 * Там причина обычно другая: после сверки были взносы, а число осталось
 * старым. Записать расход на эту разницу значило бы стереть настоящие деньги,
 * и решать это должен человек, открыв карточку актива.
 */
function signalAction(ctx, s) {
  const { today, refresh } = ctx;
  if (s.kind !== 'bank-gap' || !(s.gap > 0)) return null;

  return h('div', { class: 'signal-actions' }, [
    U.button(`Записать разницу ${F.money2(s.gap)}`, async () => {
      await store.mutate((draft) => {
        draft.operations.push({
          id: store.newId('op'),
          date: today,
          type: C.OP_INCOME,
          amount: s.gap,
          assetId: s.asset.id,
          goalId: (s.asset.goalIds || [])[0] || null,
          source: C.SOURCE_COMPUTED,
          comment: 'Разница со сверкой',
        });
      });
      U.tap();
      U.toast(`Доход ${F.money2(s.gap)} записан`);
      refresh();
    }, { kind: 'primary', class: 'btn-wide' }),
  ]);
}

/**
 * Скрытые сигналы. Список нужен обязательно: скрытое, о котором нельзя
 * вспомнить, — это не скрытое, а потерянное.
 */
function hiddenSheet(ctx, hidden) {
  const { refresh } = ctx;
  U.sheet('Скрытые сигналы', (api) => {
    const unmute = async (keys) => {
      await store.mutate((draft) => {
        const drop = new Set(keys);
        draft.settings.mutedSignals = (draft.settings.mutedSignals || [])
          .filter((m) => !drop.has(m.key || m));
      });
      api.close();
      refresh();
    };

    api.setFooter([
      U.button('Закрыть', () => api.close()),
      U.button('Показать все', () => unmute(hidden.map((s) => C.signalKey(s))), { kind: 'primary' }),
    ]);

    return [
      ...hidden.map((s) =>
        U.row(s.asset.name, 'показать', {
          sub: s.text,
          onClick: () => unmute([C.signalKey(s)]),
        }),
      ),
      U.callout('Скрытый сигнал вернётся сам, если изменится формулировка: расхождение на копейку и расхождение на сто тысяч — разные сигналы, и второй не спрячется за первым.', 'info'),
    ];
  }, { focus: false });
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

/**
 * Равновесие между жизнью и накоплением.
 *
 * Стоит после графика капитала намеренно: сначала «сколько накоплено»,
 * сразу следом «какой ценой». Порознь эти два числа успокаивают по очереди —
 * капитал растёт, значит всё хорошо, — а вместе задают настоящий вопрос.
 *
 * Без выписки карточки нет вовсе: приглашать загрузить её с главного экрана
 * каждый день значит превратить совет в рекламу. Позвать один раз может
 * раздел «Ещё», где это и живёт.
 */
function balanceCard(ctx) {
  const { state, today, go } = ctx;
  if (!state.spending.length) return null;

  const stats = C.spendStats(state.spending, today, state.settings.spendMonths || C.SPEND_MONTHS);
  const cushion = C.cushionMonths(state.assets, state.operations, stats);
  const contributed = C.contributedBetween(state.operations, stats.from, today);
  const verdict = C.balanceVerdict(stats, cushion, contributed);

  return U.card([
    U.sectionTitle('Жизнь и накопления', U.button('Подробно', () => go('spending'))),
    h('div', { class: 'grid-3' }, [
      U.stat('Прожито', F.money(stats.spent), { hint: `за ${stats.months} мес.` }),
      U.stat('Отложено', F.signedMoney(stats.free), {
        hint: stats.rate == null ? 'нет доходов' : `${Math.round(stats.rate * 100)}% дохода`,
      }),
      U.stat('Подушка', cushion == null ? '—' : `${F.num(cushion, 1)} мес.`, { hint: 'мгновенные деньги' }),
    ]),
    U.callout(`${verdict.title}. ${verdict.text}`, verdict.level === 'ok' ? 'ok' : verdict.level === 'none' ? 'info' : 'warn'),
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

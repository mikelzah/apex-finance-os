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
import * as icons from '../icons.js';
import { statusIcon } from '../icons.js';
import { screenshotSheet } from '../import.js';
import * as mascot from '../mascot.js';

const { h } = U;

/**
 * Порядок блоков отвечает на три утренних вопроса по очереди: сколько у меня,
 * что нажать, иду ли я по графику. Ниже — то, что смотрят, а не делают.
 *
 * Блоки со второго по последний имеют постоянную высоту и вместе с первым
 * укладываются в экран без прокрутки. Прокрутка появляется только когда
 * приложению есть что сказать сверх обычного: день капитализации, сигнал,
 * фраза Кубыша. Это и правильно — такие дни редки, и лишний экран в них
 * стоит дешевле, чем свёрнутое в складку предупреждение о деньгах.
 */
export function render(ctx) {
  const { state, today } = ctx;
  if (!state.assets.length) return gettingStarted(ctx);

  const worth = C.netWorth(state.assets, state.operations);

  return [
    topBar(ctx),
    heroTile(ctx, worth),
    actionsRow(ctx),
    h('div', { class: 'tile-pair' }, [goalsTile(ctx), cushionTile(ctx)]),
    opsTile(ctx),
    trioTile(ctx),
  ];
}

/**
 * Шапка экрана: имя и колокольчик.
 *
 * Всё, что требует внимания, собрано под колокольчиком — сигналы, день
 * капитализации, фраза Кубыша. Прежде каждое из этого занимало на экране
 * свой блок, и в обычный день главная разъезжалась втрое: три полосы текста
 * между действиями и целями, ради которых приходилось прокручивать.
 *
 * Счётчик на колокольчике обязателен: колокольчик без числа сообщает,
 * что уведомления в принципе бывают, а с числом — что их сейчас два.
 * Разница между «можно зайти когда-нибудь» и «зайти сегодня» держится
 * ровно на этой цифре.
 */
function topBar(ctx) {
  const items = noticeList(ctx);
  const errors = items.filter((x) => x.level === 'error').length;

  return h('div', { class: 'top-bar' }, [
    h('h1', { class: 'top-title', text: mascot.NAME }),
    h('button', {
      class: 'bell',
      type: 'button',
      'aria-label': items.length ? `Требует внимания: ${items.length}` : 'Ничего не требует внимания',
      onclick: () => noticeSheet(ctx, items),
    }, [
      icons.icon('bell'),
      items.length
        ? h('span', { class: `bell-count ${errors ? 'is-error' : ''}`.trim(), text: String(items.length) })
        : null,
    ]),
  ]);
}

/**
 * Что показать под колокольчиком. Порядок — по цене вопроса: сперва то,
 * что стоит денег, потом то, что мешает считать, и только потом дисциплина.
 */
function noticeList(ctx) {
  const { state, today } = ctx;
  const out = [];

  const pending = C.pendingAccruals(state.assets, state.operations, today).filter((p) => p.fires);
  for (const item of pending) {
    out.push({
      level: 'warn',
      kind: 'accrual',
      title: `${item.asset.name}: день капитализации`,
      text: `Начислено ${F.money2(item.accrued)} с ${F.date(item.asset.lastCap || today)}`,
      accrual: item,
    });
  }

  const all = C.signals(state.assets, state.operations, today);
  const { shown } = C.splitSignals(all, state.settings.mutedSignals);
  for (const s of shown) {
    out.push({ level: s.level, kind: 'signal', title: s.asset.name, text: s.text, signal: s });
  }

  const line = adviceText(state, today);
  if (line) out.push({ level: 'info', kind: 'advice', title: mascot.NAME, text: line.text, go: line.go });

  return out;
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

/**
 * Шторка уведомлений. Каждое — со своим действием, а не просто текстом:
 * «банк показывает на 3,96 ₽ больше» без кнопки «записать разницу»
 * сообщает о проблеме и оставляет её решать вручную.
 */
function noticeSheet(ctx, items) {
  const { refresh, today } = ctx;

  U.sheet('Требует внимания', (api) => {
    api.setFooter([U.button('Закрыть', () => api.close(), { kind: 'primary' })]);

    if (!items.length) {
      return [U.emptyState('Всё в порядке — приложению нечего сказать.')];
    }

    return items.map((it) => {
      const act = [];

      if (it.kind === 'accrual') {
        act.push(U.button(`Записать ${F.money2(it.accrual.accrued)}`, async () => {
          await store.mutate((draft) => {
            draft.operations.push({
              id: store.newId('op'),
              date: today,
              type: C.OP_INCOME,
              amount: C.round2(it.accrual.accrued),
              assetId: it.accrual.asset.id,
              goalId: (it.accrual.asset.goalIds || [])[0] || null,
              source: C.SOURCE_COMPUTED,
              comment: 'Проценты, расчёт',
            });
            const asset = draft.assets.find((a) => a.id === it.accrual.asset.id);
            if (asset) asset.lastCap = today;
          });
          api.close();
          U.toast('Проценты записаны — сверьте с банком');
          refresh();
        }, { kind: 'primary', class: 'btn-wide' }));
      }

      if (it.kind === 'signal') {
        const s = it.signal;
        if (s.kind === 'bank-gap' && s.gap > 0) {
          act.push(U.button(`Записать разницу ${F.money2(s.gap)}`, async () => {
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
            api.close();
            U.toast(`Доход ${F.money2(s.gap)} записан`);
            refresh();
          }, { kind: 'primary', class: 'btn-wide' }));
        }
        act.push(U.button('Открыть актив', () => {
          api.close();
          forms.assetSheet(s.asset, { onDone: refresh });
        }, { class: 'btn-wide' }));
        act.push(U.button('Скрыть сигнал', async () => {
          await store.mutate((draft) => {
            const key = C.signalKey(s);
            const kept = (draft.settings.mutedSignals || []).filter((m) => (m.key || m) !== key);
            kept.push({ key, text: s.text });
            draft.settings.mutedSignals = kept;
          });
          api.close();
          U.toast('Сигнал скрыт — вернётся, если изменится');
          refresh();
        }, { class: 'btn-wide' }));
      }

      if (it.kind === 'advice') {
        act.push(U.button('Посмотреть', () => {
          api.close();
          ctx.go(it.go);
        }, { kind: 'primary', class: 'btn-wide' }));
      }

      return h('div', { class: `notice notice-${it.level}` }, [
        h('div', { class: 'notice-head' }, [
          statusIcon(it.level),
          h('div', { class: 'notice-text' }, [
            h('span', { class: 'notice-title', text: it.title }),
            h('span', { class: 'notice-body', text: it.text }),
          ]),
        ]),
        act.length ? h('div', { class: 'notice-acts' }, act) : null,
      ]);
    });
  }, { focus: false });
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

/**
 * Главная плитка: капитал, рост, кривая и разбивка.
 *
 * Кривая здесь — подложка под числом, а не график: значения с неё не читают
 * и не должны. Весь график с сеткой и касанием живёт на своём экране;
 * тут он отвечает на единственный вопрос — растёт или нет.
 */
function heroTile(ctx, worth) {
  const { state, today } = ctx;

  // Изменение за день считается по записанным операциям, а не по переоценке:
  // «сегодня» здесь означает «сегодня я внёс», и это честнее, чем смешивать
  // собственные взносы с движением котировок.
  const delta = state.operations
    .filter((op) => op.date === today)
    .reduce((sum, op) => sum + C.signed(op), 0);

  const points = capitalPoints(state, worth, today);
  // Рост за весь известный период — то же, что показывает кривая, только
  // числом. Без него наклон не с чем сопоставить: он зависит от масштаба.
  const first = points.length > 1 ? points[0].y : null;
  const growth = first ? ((worth.total - first) / first) * 100 : null;

  return U.card([
    h('div', { class: 'hero-top' }, [
      h('p', { class: 'hero-label', text: 'Мой капитал' }),
      // Период кривой. Без него наклон не с чем сопоставить: рост
      // на одиннадцать процентов за месяц и за год означают разное.
      points.length > 1
        ? h('span', { class: 'hero-period', text: periodWord(points) })
        : null,
    ]),
    h('p', { class: 'hero-value', text: F.money(worth.total) }),
    h('div', { class: 'hero-row' }, [
      growth == null ? null : h('span', {
        class: `hero-growth ${growth >= 0 ? 'is-up' : 'is-down'}`,
        text: `${growth >= 0 ? '+' : ''}${F.percent(growth)}`,
      }),
      delta
        ? h('span', { class: 'hero-delta-word', text: `${F.signedMoney(delta)} сегодня` })
        : h('span', { class: 'hero-delta-word', text: 'сегодня записей ещё не было' }),
    ]),
    charts.spark(points, { height: 24 }),
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
  ], { class: 'card-hero' });
}

/** Сколько времени охватывает кривая — словами, а не датами. */
function periodWord(points) {
  const days = D.diffDays(points[points.length - 1].x, points[0].x);
  if (days >= 640) return `${Math.round(days / 365)} года`;
  if (days >= 300) return 'год';
  if (days >= 45) return `${Math.round(days / 30)} мес.`;
  return `${F.days(days)}`;
}

/**
 * Точки капитала: снимки по месяцам плюс сегодняшняя.
 *
 * Снимок за текущий месяц перезаписывается по ходу дела, поэтому последняя
 * точка заменяется на сегодняшнюю — без этого кривая отставала бы на месяц.
 */
function capitalPoints(state, worth, today) {
  const points = [...state.netWorth]
    .filter((r) => D.isValid(r.date))
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((r) => ({ x: r.date, y: r.total }));

  if (points.length && points[points.length - 1].x === today) points.pop();
  points.push({ x: today, y: worth.total });
  return points;
}

/**
 * Ряд круглых действий под главным числом.
 *
 * Прежде здесь была одна кнопка во всю ширину — «Внести 5 000 ₽» — и вторая
 * строкой под ней. Полоса во всю ширину означает «действие тут одно»,
 * а их четыре, и выделено среди них главное краской, а не размером.
 *
 * Подпись у главного — «Внести взнос», без суммы. Сумма живёт в настройках
 * быстрого взноса и меняется; подпись кнопки от этого меняться не должна,
 * иначе кнопка каждый раз оказывается новой и её приходится перечитывать.
 * Сама сумма подписана мельче, второй строкой.
 */
function actionsRow(ctx) {
  const { state, refresh } = ctx;
  const { settings, assets, goals } = state;
  const amount = settings.quickAmount;
  const asset = assets.find((a) => a.id === settings.quickAssetId);
  const goal = goals.find((g) => g.id === settings.quickGoalId);

  // Подпись одна и в одну строку. Вторая строка под кружком удваивала высоту
  // ряда и ничего не добавляла: «Операция · любая», «Цель · новая» — это одно
  // и то же слово, сказанное дважды.
  const act = (label, icon, onClick, key) => h('button', {
    class: `act-round ${key ? 'is-key' : ''}`.trim(),
    type: 'button',
    onclick: onClick,
  }, [
    h('span', { class: 'act-round-icon' }, [icon]),
    h('span', { class: 'act-round-label', text: label }),
  ]);

  // Быстрый взнос не настроен — кружок ведёт в настройки, а не исчезает.
  // Пропавшее действие невозможно найти: о том, что оно бывает, узнать
  // больше неоткуда.
  const quick = amount && asset
    ? act(`Внести ${F.money(amount)}`, icons.icon('plus'), async () => {
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
      }, true)
    : act('Быстрый взнос', icons.icon('plus'), () => ctx.go('more/settings'), true);

  return h('div', { class: 'acts-round' }, [
    quick,
    act('Операция', icons.icon('swap'), () => forms.operationSheet(null, { onDone: refresh })),
    act('Цель', icons.icon('target'), () => forms.goalSheet(null, { onDone: refresh })),
    act('Снимок', icons.icon('shot'), () => screenshotSheet({ onDone: refresh })),
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

/**
 * Цели — лентой внутри одной плитки.
 *
 * Активных целей бывает одна, а бывает пять, и вертикали под них на главной
 * нет: экран держится тем, что не прокручивается. Прежде каждая цель занимала
 * отдельную карточку во всю ширину, и при четырёх целях всё остальное — траты,
 * дисциплина, операции — уезжало за нижний край.
 *
 * Порядок — тот, в каком цели расставлены руками на своём экране: главная
 * не решает за человека, что для него важнее.
 *
 * Целей на паузе и достигнутых здесь нет вовсе. Пауза — это решение отложить,
 * и место на первом экране такой цели не нужно; достигнутая не требует уже
 * ничего. И та и другая остаются на экране целей, где их видно целиком.
 */
function goalsTile(ctx) {
  const { state, today, go } = ctx;
  const active = C.orderedGoals(state.goals).filter((g) => g.status === C.GOAL_ACTIVE);

  if (!active.length) {
    return U.card([
      h('p', { class: 'tile-label', text: 'Цели' }),
      h('p', { class: 'tile-empty', text: 'ни одной активной' }),
    ], { class: 'card-tile' });
  }

  const slides = active.map((goal) => {
    const m = C.goalMetrics(goal, state.assets, state.operations, today);
    const late = m.reserveDays != null && m.reserveDays < 0;
    return h('button', {
      class: 'goal-slide',
      type: 'button',
      onclick: () => go('goals'),
    }, [
      charts.ring(m.progress, { done: (m.progress || 0) >= 1 }),
      h('span', { class: 'goal-slide-text' }, [
        h('span', { class: 'goal-slide-name', text: goal.name }),
        // Не «75,6 тыс из 180 тыс», а сколько осталось. Долю уже показывает
        // кольцо, повторять её числами незачем, а вот остаток нигде больше
        // не написан — и это единственное, что решает, хватит ли темпа.
        // В плитку в половину экрана длинная пара сумм всё равно не влезает.
        h('span', {
          class: 'goal-slide-sub',
          text: m.current >= m.target ? 'цель взята' : `ещё ${F.moneyShort(m.target - m.current)}`,
        }),
        h('span', {
          class: `goal-slide-sub ${late ? 'is-late' : ''}`.trim(),
          text: m.forecast ? F.dateShort(m.forecast) : 'темпа не хватает',
        }),
      ]),
    ]);
  });

  const strip = h('div', { class: 'goal-strip' }, slides);

  // Точки — единственный признак, что за краем есть ещё цели. Без них лента
  // выглядит обычной плиткой, и листать её никто не догадается. При одной
  // цели точек нет: точка в единственном числе ничего не сообщает.
  const dots = active.length > 1
    ? h('div', { class: 'goal-dots' }, active.map((_, i) =>
        h('i', { class: i === 0 ? 'is-on' : '' })))
    : null;

  if (dots) {
    strip.addEventListener('scroll', () => {
      const at = Math.round(strip.scrollLeft / strip.clientWidth);
      [...dots.children].forEach((d, i) => d.classList.toggle('is-on', i === at));
    }, { passive: true });
  }

  return U.card([strip, dots], { class: 'card-tile card-goals' });
}

/**
 * Подушка: на сколько месяцев хватит мгновенных денег.
 *
 * Без выписки её не посчитать — нужен месячный расход. Тогда плитка честно
 * говорит, чего не хватает, и ведёт туда, где это исправляется: пустое место
 * на месте числа читается как поломка.
 */
function cushionTile(ctx) {
  const { state, today, go } = ctx;

  if (!state.spending.length) {
    return h('button', {
      class: 'card card-tile card-tile-btn',
      type: 'button',
      onclick: () => go('spending'),
    }, [
      h('p', { class: 'tile-label', text: 'Подушка' }),
      h('p', { class: 'tile-empty', text: 'нужна выписка' }),
      h('p', { class: 'tile-hint', text: 'по ней считается месячный расход' }),
    ]);
  }

  const stats = C.spendStats(state.spending, today, state.settings.spendMonths || C.SPEND_MONTHS);
  const months = C.cushionMonths(state.assets, state.operations, stats);

  return h('button', {
    class: 'card card-tile card-tile-btn',
    type: 'button',
    onclick: () => go('spending'),
  }, [
    h('p', { class: 'tile-label', text: 'Подушка' }),
    h('p', { class: 'tile-value', text: months == null ? '—' : `${F.num(months, 1)} мес.` }),
    h('p', { class: 'tile-hint', text: 'мгновенные деньги' }),
  ]);
}

/**
 * Последние операции.
 *
 * На месте, где прежде висели сигналы: сигналы теперь показываются только
 * когда они есть, а это блок, которому есть что показать всегда. Две строки,
 * а не пять: главный экран отвечает «что происходит», а не «что происходило».
 */
function opsTile(ctx) {
  const { state, go } = ctx;
  const recent = [...state.operations]
    .filter((op) => D.isValid(op.date))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, 2);

  if (!recent.length) return null;

  const assetName = (id) => state.assets.find((a) => a.id === id)?.name || 'без актива';
  const goalName = (id) => state.goals.find((g) => g.id === id)?.name || null;

  return U.card([
    h('div', { class: 'tile-head' }, [
      h('span', { class: 'tile-label', text: 'Последние операции' }),
      h('button', { class: 'tile-more', type: 'button', onclick: () => go('journal') }, ['Все ›']),
    ]),
    ...recent.map((op) => {
      const sum = C.signed(op);
      const goal = goalName(op.goalId);
      return h('div', { class: 'op-line' }, [
        h('span', { class: 'op-line-text' }, [
          h('span', { class: 'op-line-name', text: `${op.type} · ${assetName(op.assetId)}` }),
          h('span', {
            class: 'op-line-sub',
            text: [F.relativeDate(op.date, ctx.today), goal].filter(Boolean).join(' · '),
          }),
        ]),
        h('span', {
          class: `op-line-sum ${sum > 0 ? 'is-plus' : sum < 0 ? 'is-minus' : ''}`.trim(),
          text: sum ? F.signedMoney(sum) : F.money(op.amount || 0),
        }),
      ]);
    }),
  ], { class: 'card-tile' });
}

/**
 * Три числа в ряд: прожито, отложено, дисциплина.
 *
 * Порознь они заняли бы три строки сетки, а строк ровно столько, сколько
 * помещается. Прожито и отложено без выписки не считаются — тогда в их
 * колонках прочерк, а дисциплина остаётся: она считается по операциям.
 */
function trioTile(ctx) {
  const { state, today, go } = ctx;
  const stats = state.spending.length
    ? C.spendStats(state.spending, today, state.settings.spendMonths || C.SPEND_MONTHS)
    : null;
  const { filled, elapsed, streak } = charts.ritual(state.operations, state.settings.quickGoalId, today);

  const cell = (label, value, hint, extra) => h('div', { class: `trio-cell ${extra || ''}`.trim() }, [
    h('span', { class: 'trio-label', text: label }),
    h('span', { class: 'trio-value', text: value }),
    h('span', { class: 'trio-hint', text: hint }),
  ]);

  return h('button', {
    class: 'card card-tile card-tile-btn trio',
    type: 'button',
    onclick: () => go('spending'),
  }, [
    cell('Прожито', stats ? F.moneyShort(stats.spent) : '—',
      stats ? `за ${stats.months} мес.` : 'нужна выписка'),
    cell('Отложено', stats ? F.signedMoney(stats.free) : '—',
      stats && stats.rate != null ? `${Math.round(stats.rate * 100)}% дохода` : 'нужна выписка',
      stats && stats.free > 0 ? 'is-good' : ''),
    cell('Дисциплина', `${filled} из ${elapsed}`,
      `${streak} ${F.plural(streak, 'день', 'дня', 'дней')} подряд`),
  ]);
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


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

  // Сетка, а не поток. Строки заданы явно, и пятая забирает всё, что осталось:
  // иначе остаток экрана собирается внизу чёрной полосой, и экран выглядит
  // недогруженным, хотя помещается ровно как надо. Плитке негде и уехать вниз —
  // строки под неё в сетке просто нет.
  return [
    h('div', { class: 'tile-grid' }, [
      topBar(ctx),
      heroTile(ctx, worth),
      actionsRow(ctx),
      h('div', { class: 'tile-pair' }, [goalsTile(ctx), cushionTile(ctx)]),
      opsTile(ctx),
      trioTile(ctx),
    ]),
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

/**
 * Шторка уведомлений. Каждое — со своим действием, а не просто текстом:
 * «банк показывает на 3,96 ₽ больше» без кнопки «записать разницу»
 * сообщает о проблеме и оставляет её решать вручную.
 */
function noticeSheet(ctx, items) {
  const { state, refresh, today } = ctx;

  U.sheet('Требует внимания', (api) => {
    api.setFooter([U.button('Закрыть', () => api.close(), { kind: 'primary' })]);

    // Скрытое, о котором нельзя вспомнить, — не скрытое, а потерянное.
    // Строка стоит и на пустой шторке: «сигналов нет» при трёх скрытых —
    // неправда, и разница между «всё в порядке» и «я сам велел молчать»
    // держится ровно на ней.
    const { hidden } = C.splitSignals(
      C.signals(state.assets, state.operations, today),
      state.settings.mutedSignals,
    );
    const hiddenRow = hidden.length
      ? U.row('Скрытые сигналы', String(hidden.length), {
          sub: 'вернутся сами, если изменится формулировка',
          onClick: () => { api.close(); hiddenSheet(ctx, hidden); },
        })
      : null;

    if (!items.length) {
      return [U.emptyState('Всё в порядке — приложению нечего сказать.'), hiddenRow];
    }

    return [...items.map((it) => {
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
    }), hiddenRow];
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
      points.length > 1 ? periodPicker(ctx, points) : null,
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

/**
 * Окна кривой капитала. Не произвольное число месяцев, а четыре ступени:
 * ползунок с любым значением между ними ничего не отвечает — вопрос
 * «как идут дела» задают кварталом, полугодием, годом или всей жизнью счёта.
 */
const CAPITAL_WINDOWS = [
  { months: 3, label: '3 месяца' },
  { months: 6, label: '6 месяцев' },
  { months: 12, label: 'год' },
  { months: null, label: 'всё время' },
];

/**
 * Выбор окна кривой.
 *
 * Шеврон здесь обязателен и обязан работать. Подпись «6 МЕСЯЦЕВ» без него —
 * сообщение о том, что показано; со шевроном — обещание, что показанное можно
 * сменить. Шеврон при неработающей подписи хуже обоих вариантов: по нему
 * нажимают и не получают ничего.
 */
function periodPicker(ctx, points) {
  const { state, refresh } = ctx;
  const chosen = capitalWindow(state);

  // Окно, за которое снимков нет вовсе, в списке не показывается: выбранное,
  // оно дало бы ту же кривую, что и «всё время», и это читается как несработавший
  // выбор. Последняя ступень остаётся всегда — она и есть «сколько есть».
  const offered = CAPITAL_WINDOWS.filter((w) => w.months == null || hasDepth(state, w.months));

  return h('button', {
    class: 'hero-period',
    type: 'button',
    'aria-label': `Период кривой: ${chosen.label}`,
    onclick: () => U.sheet('Период кривой', (api) => offered.map((w) =>
      U.row(w.label, sameWindow(w.months, chosen.months) ? '✓' : '', {
        onClick: async () => {
          await store.mutate((draft) => { draft.settings.capitalWindow = w.months; });
          api.close();
          refresh();
        },
      })), { focus: false }),
  }, [
    // Подпись — выбранное окно, а не охват точек. Прежде здесь стоял охват,
    // и он менялся сам по себе: появился снимок постарше — надпись стала
    // другой, хотя человек ничего не трогал.
    h('span', { text: chosen.label }),
    h('span', { class: 'hero-period-chevron', text: '⌄' }),
  ]);
}

/** Выбранное окно; по умолчанию полугодие — месяц шумит, год сглаживает. */
function capitalWindow(state) {
  const months = state.settings.capitalWindow === undefined ? 6 : state.settings.capitalWindow;
  return CAPITAL_WINDOWS.find((w) => sameWindow(w.months, months)) || CAPITAL_WINDOWS[3];
}

const sameWindow = (a, b) => (a == null && b == null) || a === b;

/** Есть ли снимки старше окна: иначе выбирать его нечего. */
function hasDepth(state, months) {
  const dates = state.netWorth.filter((r) => D.isValid(r.date)).map((r) => r.date);
  if (!dates.length) return false;
  return D.diffDays(D.today(), dates.sort()[0]) >= months * 30;
}

/**
 * Точки капитала: снимки по месяцам плюс сегодняшняя.
 *
 * Снимок за текущий месяц перезаписывается по ходу дела, поэтому последняя
 * точка заменяется на сегодняшнюю — без этого кривая отставала бы на месяц.
 *
 * Окно отрезает начало, а не конец: кривая всегда упирается правым краем
 * в сегодня. Хвост короче двух точек не отрезается вовсе — линия из одной
 * точки не линия, и лучше показать больше, чем ничего.
 */
function capitalPoints(state, worth, today) {
  let points = [...state.netWorth]
    .filter((r) => D.isValid(r.date))
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((r) => ({ x: r.date, y: r.total }));

  const { months } = capitalWindow(state);
  if (months != null) {
    const from = D.addMonths(today, -months);
    const inside = points.filter((p) => D.diffDays(p.x, from) >= 0);
    if (inside.length >= 1) points = inside;
  }

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
  // Подпись — «Внести взнос», а не сумма. Сумма живёт в настройках быстрого
  // взноса и меняется; подпись кнопки — нет. Кнопка, которая вчера звалась
  // «Внести 500 ₽», а сегодня «Внести 5 000 ₽», перестаёт быть тем же местом,
  // и её приходится каждый раз перечитывать. Сама сумма никуда не пропала:
  // она в сообщении после нажатия и в настройках, где её и меняют.
  const quick = amount && asset
    ? act('Внести взнос', icons.icon('plus'), async () => {
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
    spendStrip(state, today),
  ]);
}

/**
 * Столбики месячного расхода под числом подушки.
 *
 * Подушка — это частное от деления мгновенно доступного на месячный расход,
 * и в плитке видно только результат деления. Столбики показывают знаменатель:
 * из чего число получилось и в какую сторону оно поедет дальше.
 *
 * Меньше двух месяцев в данных — столбиков нет вовсе. Один столбик не ряд,
 * он ничего не сравнивает и читается как обрубленный график.
 */
function spendStrip(state, today) {
  const stats = C.spendStats(state.spending, today, STRIP_MONTHS);
  const months = stats.perMonth;
  if (months.length < 2) return null;

  const top = Math.max(...months.map((m) => m.spent));
  if (!top) return null;

  const current = D.month(today);
  return h('div', { class: 'tile-strip', 'aria-hidden': 'true' }, months.map((m) => h('i', {
    // Текущий месяц не закрашен: он ещё идёт, и его столбик заведомо ниже
    // прочих. Закрашенный наравне со всеми, он читался бы обвалом трат —
    // каждое первое число месяца.
    class: m.month === current ? '' : 'is-done',
    style: { height: `${Math.round((m.spent / top) * 100)}%` },
  })));
}

/** Сколько месяцев показывать столбиками. Больше не влезает в треть плитки. */
const STRIP_MONTHS = 7;

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
  ], { class: 'card-tile card-ops' });
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


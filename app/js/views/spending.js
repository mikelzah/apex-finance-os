// Быт: сколько приходит, сколько уходит на жизнь и что остаётся.
//
// Экран отвечает на один вопрос, которого не было во всём остальном
// приложении: какой ценой даются накопления. Портфель показывает результат,
// журнал — движения капитала, а расходы на жизнь до сих пор были слепым
// пятном — и без них нельзя сказать, разумно человек копит или в ущерб себе.
//
// Всё считается по выписке из банка. Ничего не спрашивается «примерно»:
// придуманный средний расход даёт придуманную подушку, а на неё потом
// опираются в решениях.

import * as U from '../ui.js';
import * as F from '../fmt.js';
import * as C from '../calc.js';
import * as D from '../dates.js';
import * as charts from '../charts.js';
import * as store from '../store.js';
import * as S from '../statement.js';
import { importSheet, screenshotSheet } from '../import.js';

const { h } = U;

// Что раскрыто на экране. Живёт в модуле, а не в состоянии: это вид,
// а не настройка, и переживать перезапуск ему незачем.
let openCategory = null;
let showAll = false;
let query = '';

const WINDOWS = [
  [1, 'Месяц'],
  [3, '3 месяца'],
  [6, 'Полгода'],
  [12, 'Год'],
];

export function render(ctx) {
  const { state, today, refresh } = ctx;
  const months = state.settings.spendMonths || C.SPEND_MONTHS;
  const stats = C.spendStats(state.spending, today, months);
  const cushion = C.cushionMonths(state.assets, state.operations, stats);
  const contributed = C.contributedBetween(state.operations, stats.from, today);
  const verdict = C.balanceVerdict(stats, cushion, contributed);

  const head = h('div', { class: 'screen-head' }, [
    h('h2', { text: 'Траты и жизнь' }),
    U.button('Загрузить', () => sourceSheet(ctx), { kind: 'primary' }),
  ]);

  if (!state.spending.length) return [head, empty(ctx)];

  return [
    head,
    U.card([
      h('div', { class: 'segmented', role: 'tablist' }, WINDOWS.map(([value, label]) =>
        h('button', {
          class: `segment${months === value ? ' is-on' : ''}`,
          type: 'button',
          role: 'tab',
          'aria-selected': String(months === value),
          onclick: async () => {
            await store.mutate((d) => { d.settings.spendMonths = value; });
            refresh();
          },
        }, [label]),
      )),
      h('div', { class: 'grid-3' }, [
        U.stat('Получено', F.money(stats.income), { hint: perMonthHint(stats.monthlyIncome) }),
        U.stat('Прожито', F.money(stats.spent), { hint: perMonthHint(stats.monthlySpend) }),
        U.stat('Свободно', F.signedMoney(stats.free), {
          hint: stats.rate == null ? 'нет доходов' : `${Math.round(stats.rate * 100)}% дохода`,
        }),
      ]),
    ]),

    outlookCard(state, today),

    // Когда доходов в выписке нет, вердикта нет тоже: приложение об этом
    // уже сказало под словом «Свободно», и повторять это блоком на четыре
    // строки при каждом заходе значит выпрашивать выписку, а не считать.
    verdict.level === 'none' ? null : U.card([
      U.callout(`${verdict.title}. ${verdict.text}`, level(verdict.level)),
    ]),

    U.card([
      U.sectionTitle('Жизнь и накопления'),
      U.row('Подушка', cushion == null ? '—' : `${F.num(cushion, 1)} мес.`, {
        sub: cushion == null
          ? 'нужны траты за период'
          : `мгновенные деньги при расходе ${F.money(stats.monthlySpend)} в месяц`,
      }),
      U.row('Отложено за период', F.signedMoney(stats.free), { sub: 'доход минус жизнь' }),
      // Разрыв между «осталось свободным» и «дошло до капитала» — это деньги,
      // которые человек считает отложенными, а они лежат на карте. Число
      // маленькое и неприятное, поэтому и нужное.
      U.row('Дошло до капитала', F.money(contributed), {
        sub: gapHint(stats.free, contributed),
      }),
      U.row('Переводы себе', F.money(stats.moved), {
        sub: 'из выписки, не считаются тратой',
      }),
    ]),

    regularCard(state, today, stats),

    stats.perMonth.length > 1
      ? U.card([
          U.sectionTitle('Доход и жизнь по месяцам'),
          charts.lines(
            stats.perMonth.map((m) => ({ x: `${m.month}-01`, y: m.income })),
            stats.perMonth.map((m) => ({ x: `${m.month}-01`, y: m.spent })),
            { label: 'Доход', mainLabel: 'Получено', secondLabel: 'Прожито', hint: 'Нужно минимум два месяца выписки' },
          ),
        ])
      : null,

    // Список записей закрыт, пока его не спросили. Разбор по категориям
    // отвечает на вопрос «куда уходит» целиком, а две сотни строк под ним
    // этот ответ заслоняют: до сравнения долей человек доходит, пролистав
    // весь месяц по одной операции.
    //
    // Пока не ищут — разбор по категориям. Как только ищут, категории
    // мешают: человек уже знает, что ему нужно, и хочет видеть найденное,
    // а не долю «Продуктов» в месяце.
    stats.categories.length
      ? U.card([
          U.sectionTitle(query ? 'Найдено' : 'На что уходит'),
          U.search(query, (value) => {
            query = value;
            openCategory = null;
            refresh();
          }, { key: 'spend-search', placeholder: 'Магазин, категория, сумма' }),
          ...(query
            ? found(stats.rows, query, refresh)
            : [
                ...stats.categories.map((c) => bar(c, stats.spent, stats.rows, refresh)),
                U.button(showAll ? 'Скрыть список' : 'Показать все траты', () => {
                  showAll = !showAll;
                  openCategory = null;
                  refresh();
                }, { class: 'btn-wide' }),
              ]),
        ])
      : null,

    showAll && !query ? U.card([
      U.sectionTitle('Записи'),
      ...allRows(stats.rows, refresh),
    ]) : null,
  ];
}

/**
 * Откуда брать операции. Два пути неравны: выписка точна и полна, скриншот
 * удобен и приблизителен — поэтому выписка стоит первой и названа первой,
 * а скриншот честно подписан как способ для одной-двух операций.
 */
function sourceSheet(ctx) {
  U.sheet('Добавить траты', (api) => [
    U.row('Выписка из банка', '', {
      sub: 'CSV или xlsx за период — точно и целиком',
      onClick: () => { api.close(); importSheet({ onDone: ctx.refresh }); },
    }),
    U.row('Со скриншота', '', {
      sub: 'текст со снимка экрана — быстро, для нескольких операций',
      onClick: () => { api.close(); screenshotSheet({ onDone: ctx.refresh }); },
    }),
  ]);
}

/** Найденное по запросу — тем же списком, что и все записи. */
function found(rows, text, refresh) {
  const hits = rows.filter((r) => U.matches(
    text, r.description, r.category, r.account, r.kind, String(Math.round(r.amount || 0)),
  ));
  if (!hits.length) return [U.emptyState(`По запросу «${text}» в этом периоде ничего нет.`)];
  return allRows(hits, refresh);
}

/**
 * Все записи периода списком, а не таблицей.
 *
 * Таблица на четыре колонки в ширину телефона не помещается, и уезжает
 * за край именно сумма — то единственное, ради чего в список смотрят.
 * Строка в две строчки влезает целиком: где и сколько сверху, дата
 * и категория подписью снизу.
 */
function allRows(rows, refresh) {
  const list = [...rows].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  if (!list.length) return [U.emptyState('За этот период записей нет.')];

  const total = list.reduce((sum, r) => sum + signedOf(r), 0);
  return [
    ...list.slice(0, 200).map((r) => h('button', {
      class: 'spend-op',
      type: 'button',
      onclick: () => rowSheet(r, refresh),
    }, [
      h('span', { class: 'spend-op-main' }, [
        h('span', { class: 'spend-op-name', text: r.description || '—' }),
        h('span', { class: 'spend-op-sub', text: `${F.dateShort(r.date)} · ${r.category || 'Прочее'}` }),
      ]),
      h('span', {
        class: `spend-op-sum ${r.kind === C.SPEND_MOVE ? 'is-neutral' : signedOf(r) >= 0 ? 'is-plus' : 'is-minus'}`,
        text: r.kind === C.SPEND_MOVE ? F.moneyExact(r.amount) : F.signedMoneyExact(signedOf(r)),
      }),
    ])),
    h('div', { class: 'spend-total' }, [
      h('span', { text: 'Итого' }),
      h('span', { class: total >= 0 ? 'is-plus' : 'is-minus', text: F.signedMoneyExact(total) }),
    ]),
  ];
}

// --------------------------------------------------------------------------

function signedOf(row) {
  if (row.kind === C.SPEND_IN) return row.amount;
  if (row.kind === C.SPEND_MOVE) return 0;
  return -row.amount;
}

function level(kind) {
  if (kind === 'ok') return 'ok';
  if (kind === 'none') return 'info';
  return 'warn';
}

function perMonthHint(value) {
  return value ? `${F.money(value)} в месяц` : null;
}

function gapHint(free, contributed) {
  if (free <= 0) return 'свободных денег не осталось';
  const gap = free - contributed;
  if (gap > free * 0.15) return `${F.money(gap)} осело на карте`;
  if (gap < -free * 0.15) return 'больше, чем осталось свободным — вкладывали из прошлых остатков';
  return 'сходится с отложенным';
}

/**
 * Полоса категории — она же раскрывающаяся группа.
 *
 * Доля показана длиной, а не только числом: сравнивать пять процентов
 * с двенадцатью глазами тяжело, а две полосы — мгновенно. Нажатие
 * раскрывает записи именно этой категории: вопрос «на что ушли эти
 * 2 597 ₽» возникает сразу за вопросом «сколько», и ответ на него должен
 * лежать под тем же числом, а не в общем списке ниже.
 */
function bar(row, total, all, refresh) {
  const share = total > 0 ? row.amount / total : 0;
  const name = row.category || 'Прочее';
  const open = openCategory === name;

  const head = h('button', {
    class: `cat${open ? ' is-open' : ''}`,
    type: 'button',
    'aria-expanded': String(open),
    onclick: () => {
      openCategory = open ? null : name;
      refresh();
    },
  }, [
    h('div', { class: 'cat-head' }, [
      h('span', { class: 'cat-name', text: name }),
      h('span', { class: 'cat-sum', text: F.money(row.amount) }),
    ]),
    h('div', { class: 'cat-track' }, [
      h('div', { class: 'cat-fill', style: { width: `${Math.max(share * 100, 1).toFixed(1)}%` } }),
    ]),
    h('span', { class: 'cat-share', text: `${F.num(share * 100, 0)}%` }),
  ]);

  if (!open) return head;

  const rows = all
    .filter((r) => r.kind === C.SPEND_OUT && (r.category || 'Прочее') === name)
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  return h('div', { class: 'cat-group' }, [
    head,
    ...rows.map((r) => h('button', {
      class: 'cat-op',
      type: 'button',
      onclick: () => rowSheet(r, refresh),
    }, [
      h('span', { class: 'cat-op-date', text: F.dateShort(r.date) }),
      h('span', { class: 'cat-op-name', text: r.description || '—' }),
      h('span', { class: 'cat-op-sum', text: F.moneyExact(r.amount) }),
    ])),
  ]);
}

/**
 * Хватит ли до конца месяца.
 *
 * Вопрос ближайших двух недель, и он не совпадает с остальным экраном:
 * подушка и норма сбережений говорят о годах. Человек, у которого «в среднем»
 * всё хорошо, вполне может не дожить до зарплаты — и узнать об этом лучше
 * заранее, а не двадцать восьмого числа.
 */
function outlookCard(state, today) {
  const out = C.monthOutlook(state.spending, state.assets, state.operations, today);
  if (!out || !out.daysLeft) return null;

  const short = out.left < 0;
  return U.card([
    U.sectionTitle('До конца месяца'),
    U.stat(short ? 'Не хватит' : 'Останется', F.money(Math.abs(out.left)), {
      big: true,
      class: short ? 'is-bad' : out.level === 'warn' ? 'is-warn' : '',
      hint: `${F.days(out.daysLeft)} по ${F.money(out.pace)} в день`,
    }),
    U.row('Сейчас доступно', F.money(out.liquid), { sub: 'мгновенные деньги' }),
    U.row('Уйдёт по нынешнему темпу', F.money(out.expectedSpend), {
      sub: `${F.days(out.daysLeft)} × ${F.money(out.pace)}`,
    }),
    // Приход показываем поимённо. «Ожидается 90 000» без источника — это
    // обещание, в которое остаётся только верить; со строкой «Зарплата,
    // 10 августа» человек сам решит, сбудется оно или нет.
    ...out.income.map((r) => U.row(`Ждём: ${r.name}`, F.money(r.amount), {
      sub: `${F.dateShort(r.nextDate)} · по прошлым месяцам`,
    })),
    out.level === 'ok' ? null : U.callout(short
      ? 'При нынешнем темпе денег до конца месяца не хватит. Это не приговор — '
        + 'но лучше знать сейчас, а не двадцать восьмого числа.'
      : 'Останется меньше недели трат. Запас на неожиданное — сломанный телефон, '
        + 'лекарства — в этот месяц тонкий.', short ? 'warn' : 'info'),
  ]);
}

/**
 * Что списывается само.
 *
 * Отдельным блоком, а не строкой в разборе по категориям, потому что это
 * другой род трат. Продукты человек покупает решением, подписку — один раз
 * решил и забыл, а деньги уходят каждый месяц. Разбор по категориям на этот
 * вопрос не отвечает: подписки лежат в разных категориях и в сумму не
 * собираются нигде.
 *
 * Доля от месячных трат важнее самой суммы: 3 400 ₽ звучит небольшим числом
 * ровно до того момента, когда выясняется, что это восьмая часть всей жизни.
 */
function regularCard(state, today, stats) {
  const list = C.recurring(state.spending, today);
  if (!list.length) return null;

  const total = C.recurringTotal(list);
  const share = stats.monthlySpend ? (total / stats.monthlySpend) * 100 : null;

  return U.card([
    U.sectionTitle('Списывается само'),
    U.stat('В месяц', F.money(total), {
      big: true,
      hint: share == null ? 'повторяющиеся платежи' : `${F.percent(share, 0)} месячных трат`,
    }),
    ...list.map((r) => U.row(r.name, F.money(r.amount), {
      // Число платежей — это мера уверенности. Два подряд ещё могут оказаться
      // совпадением, шесть — уже нет, и человек вправе видеть, на чём вывод.
      sub: `${r.category || 'без категории'} · ${platezhi(r.count)} · следующий ${F.dateShort(r.nextDate)}`,
    })),
    U.callout('Найдено по повторам в выписке: тот же магазин, та же сумма, шаг около месяца. '
      + 'Это не список ваших подписок из банка — приложение видит только то, что уже списывалось.', 'info'),
  ]);
}

function platezhi(n) {
  return `${n} ${F.plural(n, 'платёж', 'платежа', 'платежей')}`;
}

function empty(ctx) {
  return U.card([
    U.emptyState('Трат пока нет. Загрузите выписку из банка — CSV или xlsx, столбцы разберутся сами. Для пары операций хватит и текста со скриншота.'),
    U.button('Загрузить выписку', () => importSheet({ onDone: ctx.refresh }), { kind: 'primary', class: 'btn-wide' }),
    U.button('Со скриншота', () => screenshotSheet({ onDone: ctx.refresh }), { class: 'btn-wide' }),
    U.callout('Файл читается в телефоне и никуда не отправляется: сервера у приложения нет.', 'info'),
  ]);
}

// --------------------------------------------------------------------------

/**
 * Правка записи. Кроме категории здесь меняется вид: банк не знает, что
 * перевод на брокерский счёт — не трата, а для расчёта это решающее.
 */
function rowSheet(row, onDone) {
  const draft = { ...row };
  U.sheet('Запись', (api) => {
    const kindSelect = U.select([C.SPEND_OUT, C.SPEND_IN, C.SPEND_MOVE], draft.kind);
    // Категории берутся под вид записи: в трате нечего выбирать «Зарплату».
    // Общий список не просто длинный — из него легко молча записать доход
    // в расходную категорию, и разбор по категориям после этого врёт.
    //
    // Категория банка может не совпасть ни с одной нашей — тогда она
    // добавляется в список как есть. Иначе открытие записи молча меняло бы
    // её категорию на первую в списке.
    const was = { kind: draft.kind, category: draft.category };
    const optionsFor = (kind) => {
      const base = S.categoriesForKind(store.getState().settings, kind);
      if (kind === was.kind && was.category && !base.includes(was.category)) {
        return [was.category, ...base];
      }
      return base;
    };
    const catSelect = U.select(optionsFor(draft.kind), draft.category);
    // Сменили вид — список меняется вместе с ним. Прежняя категория
    // остаётся, если она подходит и новому виду; иначе запись уходит
    // в запасную, а не остаётся с чужим ярлыком.
    kindSelect.addEventListener('change', () => {
      const options = optionsFor(kindSelect.value);
      const keep = options.includes(catSelect.value) ? catSelect.value : S.fallbackForKind(kindSelect.value);
      U.clear(catSelect);
      U.append(catSelect, options.map((name) => h('option', { value: name, selected: name === keep }, [name])));
      catSelect.value = keep;
    });
    const rule = U.checkbox('Запомнить для похожих', false);
    const amount = U.numberInput(draft.amount);

    api.setFooter([
      U.button('Удалить', () => {
        U.confirmSheet('Удалить запись?', 'Она пропадёт из расчёта трат.', 'Удалить', async () => {
          await store.removeSpend(draft.id);
          api.close();
          onDone();
        });
      }, { kind: 'danger' }),
      U.button('Сохранить', async () => {
        const value = U.parseNumber(amount.value);
        if (value == null || value <= 0) return U.toast('Сумма должна быть больше нуля', 'error');
        draft.amount = value;
        draft.kind = kindSelect.value;
        draft.category = catSelect.value;
        await store.saveSpend(draft);

        const word = keyword(draft.description);
        if (rule.box.checked && word) {
          const touched = await store.addSpendRule(word, draft.category);
          U.toast(touched > 1 ? `Переложено записей: ${touched}` : 'Сохранено');
        } else {
          U.toast('Сохранено');
        }
        api.close();
        onDone();
      }, { kind: 'primary' }),
    ]);

    return [
      h('p', { class: 'sheet-note', text: `${F.date(draft.date)} · ${draft.description || 'без описания'}` }),
      U.field('Сумма, ₽', amount),
      U.field('Вид', kindSelect, 'Перевод себе не считается ни тратой, ни доходом'),
      U.field('Категория', catSelect),
      U.field('', rule.node, ruleHint(draft)),
    ];
  });
}

/**
 * Слово, по которому узнаётся такая же трата в будущем.
 *
 * Берём самое длинное слово описания: в «SUPERMARKET PYATEROCHKA 4512 MOSCOW»
 * узнаваемое — «PYATEROCHKA», а не «MOSCOW» и не номер точки. Правило
 * по номеру точки сработало бы ровно один раз.
 */
function keyword(description) {
  const words = String(description || '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 4 && !/^\d+$/.test(w));
  if (!words.length) return null;
  return words.sort((a, b) => b.length - a.length)[0];
}

function ruleHint(draft) {
  const word = keyword(draft.description);
  return word ? `Все записи со словом «${word}» получат эту категорию` : 'В описании нет слова, по которому узнать похожие';
}

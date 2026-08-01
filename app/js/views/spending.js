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

  if (!state.spending.length) return [empty(ctx)];

  return [
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
    stats.categories.length
      ? U.card([
          U.sectionTitle('На что уходит'),
          ...stats.categories.map((c) => bar(c, stats.spent, stats.rows, refresh)),
          U.button(showAll ? 'Скрыть список' : 'Показать все траты', () => {
            showAll = !showAll;
            openCategory = null;
            refresh();
          }, { class: 'btn-wide' }),
        ])
      : null,

    showAll ? U.card([
      U.sectionTitle('Записи'),
      ...allRows(stats.rows, refresh),
    ]) : null,
  ];
}

export function action(ctx) {
  return U.button('Загрузить', () => sourceSheet(ctx), { kind: 'primary' });
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
    // Категория банка может не совпасть ни с одной нашей — тогда она
    // добавляется в список как есть. Иначе открытие записи молча меняло бы
    // её категорию на первую в списке.
    const known = [...S.CATEGORIES, ...S.INCOME_CATEGORIES, 'Сбережения'];
    const catSelect = U.select(
      known.includes(draft.category) || !draft.category ? known : [draft.category, ...known],
      draft.category,
    );
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

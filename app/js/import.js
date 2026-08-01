// Загрузка банковской выписки.
//
// Два шага и оба обязательны. Первый — выбрать файл. Второй — подтвердить,
// что приложение поняло столбцы правильно: показывается разбор первых строк
// вместе с суммами и датами, какими они получились. Импорт «молча и сразу»
// на неверной раскладке пишет сотни строк с чужими датами, и найти это
// потом можно только вручную.
//
// Файл не покидает телефон: он читается через FileReader и разбирается тут же.

import * as U from './ui.js';
import * as F from './fmt.js';
import * as C from './calc.js';
import * as D from './dates.js';
import * as store from './store.js';
import * as S from './statement.js';
import * as xlsx from './xlsx.js';
import { parseScreen } from './screenshot.js';

const { h } = U;

async function tableOf(file) {
  if (/\.xlsx$/i.test(file.name)) return xlsx.readSheet(await file.arrayBuffer());
  const text = await S.readFile(file);
  return S.parseTable(text, S.sniffDelimiter(text));
}

const FIELDS = [
  ['date', 'Дата', true],
  ['amount', 'Сумма', false],
  ['income', 'Приход', false],
  ['outgo', 'Расход', false],
  ['description', 'Описание', false],
  ['category', 'Категория банка', false],
  ['status', 'Статус', false],
];

export function importSheet(options = {}) {
  const picker = h('input', {
    type: 'file',
    // xlsx первым: Альфа-Банк и ВТБ отдают выписку только таблицей Excel,
    // и требовать от человека пересохранить её в CSV на телефоне,
    // где нет Excel, значило бы не поддержать эти банки вовсе.
    accept: '.xlsx,.csv,.txt,.tsv,text/csv,text/plain',
    style: { display: 'none' },
  });
  picker.addEventListener('change', async () => {
    const file = picker.files && picker.files[0];
    picker.remove();
    if (!file) return;
    try {
      const rows = await tableOf(file);
      if (rows.length < 2) {
        U.toast('В файле не нашлось таблицы операций', 'error');
        return;
      }
      mappingSheet(rows, file.name, options);
    } catch (err) {
      U.toast(`Не удалось прочитать: ${err.message}`, 'error');
    }
  });
  document.body.appendChild(picker);
  picker.click();
}

// --------------------------------------------------------------------------

function mappingSheet(table, filename, options, forced = null) {
  // Шапка столбцов лежит не в первой строке, если банк напечатал сверху
  // реквизиты и итоги за период. Найденный номер строки показывается
  // и меняется руками: если догадка промахнулась, это первое, что нужно
  // поправить, и без этого файл не загрузить вовсе.
  const headerRow = forced != null ? forced : S.findHeaderRow(table);
  const header = table[headerRow] || [];
  const state = store.getState();
  const bank = guessBank(filename, table);
  const key = profileKey(header);
  const saved = state.settings.bankProfiles[key];
  // Сохранённая раскладка годится только для той же шапки: банк может
  // добавить столбец, и тогда прежние номера указывают не туда.
  const mapping = saved && sameShape(saved, header) ? { ...saved } : S.guessMapping(header);

  U.sheet('Выписка', (api) => {
    const preview = h('div', { class: 'preview' });
    const summary = h('p', { class: 'sheet-note' });

    const selects = {};
    for (const [key, label] of FIELDS.map((f) => [f[0], f[1]])) {
      selects[key] = U.select(
        [{ value: '', label: '— нет —' }, ...header.map((name, i) => ({ value: String(i), label: name || `столбец ${i + 1}` }))],
        mapping[key] != null ? String(mapping[key]) : '',
        { onchange: (e) => { setField(key, e.target.value); } },
      );
    }

    function setField(key, value) {
      if (value === '') delete mapping[key];
      else mapping[key] = Number(value);
      update();
    }

    function current() {
      const { rows, skipped } = S.toRows(table, mapping, { account: bank, headerRow });
      const withCategory = rows.map((r) => ({ ...r, category: S.categorise(r, state.settings.spendRules) }));
      const marked = S.markTransfers(withCategory, contributions(state));
      const fresh = S.newRows(marked, state.spending);
      return { rows: marked, fresh, skipped };
    }

    function update() {
      const { rows, fresh, skipped } = current();
      U.clear(preview);
      const lost = skipped.date + skipped.amount;
      summary.textContent = rows.length
        ? `Разобрано строк: ${rows.length}. Новых: ${fresh.length}.`
          + (skipped.status ? ` Отменённых пропущено: ${skipped.status}.` : '')
          + (lost ? ` Без даты или суммы: ${lost}.` : '')
        : 'Ни одной строки разобрать не вышло — проверьте, какой столбец где.';

      for (const row of rows.slice(0, 5)) {
        preview.appendChild(h('div', { class: 'preview-row' }, [
          h('span', { class: 'preview-date', text: F.dateShort(row.date) }),
          h('span', { class: 'preview-text', text: `${row.category} · ${row.description || '—'}` }),
          h('span', {
            class: `preview-sum ${row.kind === S.KIND_IN ? 'is-plus' : row.kind === S.KIND_MOVE ? 'is-neutral' : 'is-minus'}`,
            text: row.kind === S.KIND_MOVE ? F.money(row.amount) : F.signedMoney(row.kind === S.KIND_IN ? row.amount : -row.amount),
          }),
        ]));
      }
      if (!rows.length) {
        preview.appendChild(h('p', { class: 'field-hint', text: 'Проверьте строку с названиями столбцов — возможно, разбор взял не ту.' }));
      }
    }

    api.setFooter([
      U.button('Отмена', () => api.close()),
      U.button('Записать', async () => {
        const { fresh } = current();
        if (!fresh.length) {
          U.toast('Новых записей нет — эта выписка уже загружена');
          api.close();
          return;
        }
        await store.addSpending(fresh, bank, mapping, key);
        api.close();
        U.tap();
        U.toast(`Записей добавлено: ${fresh.length}`);
        options.onDone?.();
      }, { kind: 'primary' }),
    ]);

    update();

    // Переключение строки шапки перестраивает всё: и список столбцов,
    // и догадку о том, какой из них что значит. Проще открыть шторку заново,
    // чем чинить её по частям.
    const headerPick = U.select(
      table.slice(0, 30).map((cells, i) => ({
        value: String(i),
        label: `${i + 1}: ${cells.filter(Boolean).join(' · ').slice(0, 60) || 'пусто'}`,
      })),
      String(headerRow),
      { onchange: (e) => { api.close(true); mappingSheet(table, filename, options, Number(e.target.value)); } },
    );

    return [
      h('p', { class: 'sheet-note', text: `${bank} · ${filename.slice(0, 40)} · строк с операциями: ${Math.max(table.length - headerRow - 1, 0)}` }),
      summary,
      U.sectionTitle('Как понята таблица'),
      preview,
      U.sectionTitle('Столбцы'),
      U.field('Строка с названиями столбцов', headerPick, 'Выше неё у банка обычно реквизиты и итоги за период'),
      // Приход и расход отдельными столбцами — форма Сбера; одна сумма
      // со знаком — форма Т-Банка. Показываем оба набора: угадать по шапке
      // выходит не всегда, а перещёлкнуть руками — секунда.
      ...FIELDS.map(([key, label]) => U.field(label, selects[key], hintFor(key))),
      U.callout('Файл читается здесь, в телефоне. Никуда не отправляется.', 'info'),
    ];
  });
}

function hintFor(key) {
  return {
    amount: 'Одна колонка со знаком: минус — трата',
    income: 'Если приход и расход разнесены по разным колонкам',
    outgo: 'Заполняется вместе с «Приходом»',
    status: 'Отменённые и неуспешные строки пропускаются',
  }[key];
}

/**
 * Взносы за последний год — по ним ищутся переводы себе.
 *
 * Год, а не вся история: выписка старше года не загружается, а перебирать
 * тысячу операций на каждой строке файла незачем.
 */
function contributions(state) {
  const from = D.addYears(D.today(), -1);
  return state.operations.filter((op) => op.type === C.OP_CONTRIBUTION
    && !op.linkedTo && D.isValid(op.date) && D.diffDays(op.date, from) >= 0);
}

/**
 * Раскладка запоминается по названиям столбцов, а не по банку.
 *
 * Имя файла для этого не годится: Альфа-Банк называет выписку временем
 * выгрузки — «Выписка 2026-07-01T14:05:59.534+0300.xlsx», — и такой ключ
 * не совпадёт сам с собой уже через секунду. Названия столбцов, наоборот,
 * у одного банка одни и те же из месяца в месяц.
 */
function profileKey(header) {
  return header.map((x) => String(x).toLowerCase().replace(/\s+/g, ' ').trim()).join('|').slice(0, 300);
}

/**
 * Название банка — для подписи счёта у записей. Ищем сначала в самом файле:
 * в шапке выписки банк называет себя, а в имени файла его может не быть.
 */
function guessBank(filename, table = []) {
  const inside = table.slice(0, 15).map((r) => r.join(' ')).join(' ');
  const name = `${inside} ${filename || ''}`.toLowerCase();
  if (/tinkoff|tbank|т-банк|тинько/.test(name)) return 'Т-Банк';
  if (/sber|сбер/.test(name)) return 'Сбер';
  if (/alfa|альфа/.test(name)) return 'Альфа-Банк';
  if (/vtb|втб/.test(name)) return 'ВТБ';
  if (/ozon|озон/.test(name)) return 'Озон Банк';
  if (/yandex|яндекс/.test(name)) return 'Яндекс Банк';
  return String(filename || '').replace(/\.[^.]+$/, '').slice(0, 24) || 'Банк';
}

function sameShape(mapping, header) {
  return Object.values(mapping).every((i) => typeof i === 'number' && i < header.length);
}

// --------------------------------------------------------------------------
// Скриншот
// --------------------------------------------------------------------------

/**
 * Операции со снимка экрана банковского приложения.
 *
 * Распознаёт текст сам телефон — приложение получает уже готовые строки.
 * Так честнее и точнее: системное распознавание на iPhone читает рублёвые
 * суммы лучше любого движка, который поместился бы в офлайн-кэш, и не стоит
 * ни мегабайта загрузки.
 *
 * Разбор показывается до записи, как и у выписки: у списка на экране нет
 * ни статусов, ни знаков у части сумм, и догадка «без плюса — значит трата»
 * должна быть видимой, а не молчаливой.
 */
export function screenshotSheet(options = {}) {
  const state = store.getState();
  const today = D.today();

  U.sheet('Со скриншота', (api) => {
    const area = U.textarea('', { placeholder: 'Вставьте сюда текст со скриншота' });
    const preview = h('div', { class: 'preview' });
    const summary = h('p', { class: 'sheet-note' });
    let parsed = { rows: [], dated: false };

    function update() {
      parsed = parseScreen(area.value, today);
      const withCategory = parsed.rows.map((r) => ({ ...r, category: S.categorise(r, state.settings.spendRules) }));
      parsed.rows = S.markTransfers(withCategory, contributions(state));
      parsed.fresh = S.newRows(parsed.rows, state.spending);

      U.clear(preview);
      if (!area.value.trim()) {
        summary.textContent = 'Пока пусто.';
        preview.appendChild(h('p', { class: 'field-hint', text: 'Строки со суммами станут операциями.' }));
        return;
      }
      summary.textContent = parsed.rows.length
        ? `Нашлось операций: ${parsed.rows.length}. Новых: ${parsed.fresh.length}.`
          + (parsed.dated ? '' : ' Дата в тексте не найдена — всем записям встанет сегодняшнее число.')
        : 'Сумм в тексте не нашлось. Нужны строки вида «Пятёрочка −1 240,50 ₽».';

      for (const row of parsed.rows.slice(0, 8)) {
        preview.appendChild(h('div', { class: 'preview-row' }, [
          h('span', { class: 'preview-date', text: F.dateShort(row.date) }),
          h('span', { class: 'preview-text', text: `${row.category} · ${row.description || '—'}` }),
          h('span', {
            class: `preview-sum ${row.kind === S.KIND_IN ? 'is-plus' : row.kind === S.KIND_MOVE ? 'is-neutral' : 'is-minus'}`,
            text: row.kind === S.KIND_MOVE ? F.money(row.amount) : F.signedMoney(row.kind === S.KIND_IN ? row.amount : -row.amount),
          }),
        ]));
      }
    }

    area.addEventListener('input', update);

    api.setFooter([
      U.button('Отмена', () => api.close()),
      U.button('Записать', async () => {
        if (!parsed.fresh || !parsed.fresh.length) {
          U.toast(parsed.rows.length ? 'Все эти записи уже есть' : 'Разбирать нечего', parsed.rows.length ? 'ok' : 'error');
          return;
        }
        await store.addSpending(parsed.fresh, 'Со скриншота', null, null);
        api.close();
        U.tap();
        U.toast(`Записей добавлено: ${parsed.fresh.length}`);
        options.onDone?.();
      }, { kind: 'primary' }),
    ]);

    update();

    return [
      U.callout('На снимке в «Фото» удерживайте палец на списке операций, нажмите «Выделить всё», потом «Копировать» — и вставьте сюда. Текст распознаёт сам телефон, картинка никуда не уходит.', 'info'),
      U.button('Вставить из буфера', async () => {
        try {
          const text = await navigator.clipboard.readText();
          if (!text.trim()) return U.toast('В буфере пусто', 'error');
          area.value = text;
          update();
        } catch {
          // Safari разрешает чтение буфера только по прямому жесту и только
          // с разрешения — отказ здесь обычное дело, а не поломка.
          U.toast('Не удалось прочитать буфер — вставьте вручную', 'error');
        }
      }, { class: 'btn-wide' }),
      U.field('Текст со скриншота', area),
      summary,
      U.sectionTitle('Что получилось'),
      preview,
      U.callout('Без плюса сумма считается тратой. Поправить вид и категорию можно у каждой записи после загрузки.', 'warn'),
    ];
  });
}

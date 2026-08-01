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

const { h } = U;

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
    accept: '.csv,.txt,.tsv,text/csv,text/plain',
    style: { display: 'none' },
  });
  picker.addEventListener('change', async () => {
    const file = picker.files && picker.files[0];
    picker.remove();
    if (!file) return;
    try {
      const text = await S.readFile(file);
      const delimiter = S.sniffDelimiter(text);
      const rows = S.parseTable(text, delimiter);
      if (rows.length < 2) {
        U.toast('В файле не нашлось таблицы — нужен CSV из банка', 'error');
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

function mappingSheet(table, filename, options) {
  const header = table[0];
  const state = store.getState();
  const bank = guessBank(filename);
  const saved = state.settings.bankProfiles[bank];
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
      const { rows, skipped } = S.toRows(table, mapping, { account: bank });
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
        preview.appendChild(h('p', { class: 'field-hint', text: 'Первая строка файла считается шапкой.' }));
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
        await store.addSpending(fresh, bank, mapping);
        api.close();
        U.tap();
        U.toast(`Записей добавлено: ${fresh.length}`);
        options.onDone?.();
      }, { kind: 'primary' }),
    ]);

    update();

    return [
      h('p', { class: 'sheet-note', text: `${filename} · ${table.length - 1} строк` }),
      summary,
      U.sectionTitle('Как понята таблица'),
      preview,
      U.sectionTitle('Столбцы'),
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
 * Банк по имени файла: выгрузки называются «operations.csv», «movementList.csv»,
 * «report_2026.csv». Точное имя не важно — важно, чтобы раскладка столбцов
 * запомнилась под устойчивым ключом и в следующий раз подошла.
 */
function guessBank(filename) {
  const name = String(filename || '').toLowerCase();
  if (/tinkoff|tbank|т-банк|тинько/.test(name)) return 'Т-Банк';
  if (/sber|сбер/.test(name)) return 'Сбер';
  if (/alfa|альфа/.test(name)) return 'Альфа-Банк';
  if (/vtb|втб/.test(name)) return 'ВТБ';
  if (/ozon|озон/.test(name)) return 'Озон Банк';
  if (/yandex|яндекс/.test(name)) return 'Яндекс Банк';
  return name.replace(/\.[^.]+$/, '').slice(0, 24) || 'Банк';
}

function sameShape(mapping, header) {
  return Object.values(mapping).every((i) => typeof i === 'number' && i < header.length);
}

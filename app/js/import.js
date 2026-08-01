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
  const learned = S.learnCategories(state.spending);

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
      const withCategory = rows.map((r) => ({ ...r, category: S.categorise(r, state.settings.spendRules, learned) }));
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

      for (const row of fresh.slice(0, 5)) {
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
        const paired = await store.pairSelfTransfers();
        api.close();
        U.tap();
        U.toast(pairedText(fresh.length, paired));
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
  const learned = S.learnCategories(state.spending);
  // Правки категорий, сделанные до записи, живут по ключу записи —
  // как и снятые галочки: текст перечитывается на каждое нажатие.
  const edited = new Map();
  // Снятые галочки живут по ключу записи, а не по номеру строки: текст
  // перечитывается на каждое нажатие, и номера в нём разъезжаются.
  const unchecked = new Set();

  U.sheet('Со скриншота', (api) => {
    const area = U.textarea('', { placeholder: 'Вставьте сюда текст со скриншота' });
    const preview = h('div', { class: 'preview' });
    const summary = h('p', { class: 'sheet-note' });
    const checks = h('div', { class: 'checks' });
    let parsed = { rows: [], fresh: [], dated: false, totals: [] };

    const chosen = () => parsed.fresh.filter((row) => !unchecked.has(row.key));

    function update() {
      parsed = parseScreen(area.value, today);
      const withCategory = parsed.rows.map((r) => ({ ...r, category: S.categorise(r, state.settings.spendRules, learned) }));
      parsed.rows = S.markTransfers(withCategory, contributions(state));
      parsed.fresh = S.newRows(parsed.rows, state.spending)
        .map((r) => (edited.has(r.key) ? { ...r, category: edited.get(r.key) } : r));

      const known = parsed.rows.length - parsed.fresh.length;
      U.clear(preview);
      U.clear(checks);

      if (!area.value.trim()) {
        summary.textContent = 'Пока пусто.';
        preview.appendChild(h('p', { class: 'field-hint', text: 'Строки со суммами станут операциями.' }));
        refreshFooter();
        return;
      }

      // Уже записанные не показываются вовсе — выбирать из них нечего,
      // а в списке они выглядели бы как забытые и звали нажать ещё раз.
      summary.textContent = parsed.rows.length
        ? `Нашлось операций: ${parsed.rows.length}.`
          + (known ? ` Уже записано раньше: ${known}, они пропущены.` : '')
          + (parsed.dated ? '' : ' Дата в тексте не найдена — всем записям встанет сегодняшнее число.')
        : 'Сумм в тексте не нашлось. Нужны строки вида «Пятёрочка −1 240,50 ₽».';

      for (const line of controlLines(parsed)) {
        checks.appendChild(h('p', { class: `check ${line.ok ? 'is-ok' : 'is-bad'}`, text: line.text }));
      }

      if (!parsed.fresh.length && parsed.rows.length) {
        preview.appendChild(h('p', { class: 'field-hint', text: 'Все эти операции уже записаны.' }));
      }

      for (const row of parsed.fresh) {
        preview.appendChild(rowButton(row));
      }
      refreshFooter();
    }

    /**
     * Строка разбора — она же выключатель. Галочка нужна, потому что часть
     * строк с экрана операциями не является: подписи приложения, реклама,
     * подтверждения. Разбор старается их отсеять, но последнее слово
     * за человеком, и оно должно даваться одним касанием.
     */
    function rowButton(row) {
      const on = !unchecked.has(row.key);
      const toggle = h('button', {
        class: 'preview-pick',
        type: 'button',
        'aria-pressed': String(on),
        onclick: () => {
          if (unchecked.has(row.key)) unchecked.delete(row.key);
          else unchecked.add(row.key);
          update();
        },
      }, [
        h('span', { class: 'preview-mark', text: on ? '✓' : '' }),
        h('span', { class: 'preview-text', text: row.description || '—' }),
        h('span', {
          class: `preview-sum ${row.kind === S.KIND_IN ? 'is-plus' : row.kind === S.KIND_MOVE ? 'is-neutral' : 'is-minus'}`,
          // Копейки здесь показываются полностью: это экран сверки,
          // и «−1 240 ₽» вместо «−1 240,50 ₽» скрывает ровно то,
          // ради чего в него смотрят.
          text: row.kind === S.KIND_MOVE
            ? F.moneyExact(row.amount)
            : F.signedMoneyExact(row.kind === S.KIND_IN ? row.amount : -row.amount),
        }),
      ]);

      // Категория правится здесь же, а не после записи: разбор угадывает
      // по названию, а название после распознавания бывает любым — «Дикси»
      // читается как «КОИ», и правило по нему не срабатывает. Исправленная
      // категория запомнится и подтянется к таким же записям в следующий раз.
      const options = categoryOptions(row);
      const pick = U.select(options, row.category, {
        class: 'control preview-cat',
        onchange: (e) => { edited.set(row.key, e.target.value); update(); },
      });

      return h('div', { class: `preview-row is-pick${on ? '' : ' is-off'}` }, [
        toggle,
        h('div', { class: 'preview-meta' }, [
          h('span', { class: 'preview-date', text: F.dateShort(row.date) }),
          pick,
        ]),
      ]);
    }

    function refreshFooter() {
      const count = chosen().length;
      api.setFooter([
        U.button('Отмена', () => api.close()),
        U.button(count ? `Записать (${count})` : 'Записать', async () => {
          const list = chosen();
          if (!list.length) {
            U.toast(parsed.rows.length ? 'Ни одна запись не отмечена' : 'Разбирать нечего', 'error');
            return;
          }
          await store.addSpending(list, 'Со скриншота', null, null);
          const paired = await store.pairSelfTransfers();
          api.close();
          U.tap();
          U.toast(pairedText(list.length, paired));
          options.onDone?.();
        }, { kind: 'primary', disabled: !count }),
      ]);
    }

    area.addEventListener('input', update);

    const pickImage = () => {
      const picker = h('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
      picker.addEventListener('change', async () => {
        const file = picker.files && picker.files[0];
        picker.remove();
        if (!file) return;
        progress.textContent = 'Готовлю снимок…';
        try {
          const { recognise } = await import('./ocr.js');
          const text = await recognise(file, (label, done) => {
            progress.textContent = `${label}… ${Math.round((done || 0) * 100)}%`;
          });
          progress.textContent = '';
          if (!text.trim()) {
            U.toast('На снимке не нашлось текста', 'error');
            return;
          }
          area.value = text;
          update();
          U.tap();
        } catch (err) {
          progress.textContent = '';
          U.toast(`Распознать не вышло: ${err.message}`, 'error');
        }
      });
      document.body.appendChild(picker);
      picker.click();
    };

    // Полоса ожидания: распознавание идёт секунды, а в первый раз к ним
    // добавляется загрузка движка. Без полосы это выглядит как зависшая
    // кнопка, и человек жмёт её второй раз.
    const progress = h('p', { class: 'field-hint', text: '' });

    update();

    return [
      U.callout('Снимок распознаётся в телефоне и никуда не отправляется. В первый раз загрузится сам распознаватель — около 5 МБ, дальше он работает и без сети.', 'info'),
      U.button('Выбрать снимок', pickImage, { kind: 'primary', class: 'btn-wide' }),
      progress,
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
      U.field('Текст со снимка', area, 'Заполняется распознаванием, но можно вписать и руками'),
      summary,
      checks,
      U.sectionTitle('Что записать'),
      preview,
      U.callout('Нажмите на строку, чтобы не записывать её. Категория выбирается здесь же и запоминается: такие же записи в следующий раз получат её сами. Без плюса сумма считается тратой.', 'warn'),
    ];
  });
}

/**
 * Сверка с итогами дня, которые банк печатает над списком.
 *
 * Расхождение чаще всего значит не ошибку разбора, а обрезанный снимок:
 * человек снял экран посередине, и часть операций дня в него не попала.
 * Поэтому недобор и перебор описаны по-разному — это разные поводы.
 */
function controlLines(parsed) {
  return (parsed.totals || []).map((total) => {
    const mine = parsed.rows
      .filter((r) => r.date === total.date && r.kind === (total.income ? S.KIND_IN : S.KIND_OUT))
      .reduce((sum, r) => sum + r.amount, 0);
    const diff = Math.round((mine - total.amount) * 100) / 100;
    const day = F.date(total.date);
    const word = total.income ? 'получено' : 'потрачено';

    if (Math.abs(diff) < 0.01) {
      return { ok: true, text: `${day}: ${word} ${F.moneyExact(total.amount)} — сходится с банком` };
    }
    if (diff < 0) {
      return {
        ok: false,
        text: `${day}: банк насчитал ${F.moneyExact(total.amount)}, а в разборе ${F.moneyExact(mine)}.`
          + ' Часть операций дня не попала в снимок — снимите список целиком.',
      };
    }
    return {
      ok: false,
      text: `${day}: банк насчитал ${F.moneyExact(total.amount)}, а в разборе ${F.moneyExact(mine)}.`
        + ' Что-то прочиталось неверно — сверьте суммы со снимком.',
    };
  });
}

/**
 * Сообщение после записи. Про сведённые переводы говорим отдельно:
 * человек увидит, что доход и расход уменьшились, и должен понимать почему.
 */
function pairedText(added, paired) {
  const base = `Записей добавлено: ${added}`;
  if (!paired) return base;
  return `${base}. Переводов между своими счетами сведено: ${paired}`;
}

/**
 * Что можно выбрать в категории строки.
 *
 * Список зависит от вида: у прихода свои категории, у траты свои. Текущее
 * значение добавляется в начало, даже если оно чужое, — иначе открытие
 * списка молча меняло бы категорию на первую попавшуюся.
 */
function categoryOptions(row) {
  const settings = store.getState().settings;
  const base = row.kind === S.KIND_IN
    ? [...S.categoriesOf(settings, 'income')]
    : row.kind === S.KIND_MOVE
      ? ['Сбережения', 'Переводы', 'Проценты']
      : [...S.categoriesOf(settings, 'spend')];
  if (row.category && !base.includes(row.category)) return [row.category, ...base];
  return base;
}

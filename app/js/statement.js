// Разбор банковской выписки.
//
// Банки не договорились ни о разделителе, ни о кодировке, ни о названиях
// столбцов, и договариваться не собираются. Поэтому здесь нет парсера
// «под Т-Банк» и «под Сбер»: есть разбор любой таблицы и догадка о том,
// какой столбец что означает. Догадка показывается человеку до записи —
// если она неверна, столбцы переставляются руками, и раскладка запоминается
// под именем банка, чтобы в следующий раз не спрашивать.
//
// Файл читается здесь же, в телефоне. Никуда не отправляется — сервера
// у приложения нет вовсе.

import * as D from './dates.js';

export const KIND_OUT = 'Трата';
export const KIND_IN = 'Поступление';
export const KIND_MOVE = 'Перевод себе';

// --------------------------------------------------------------------------
// Чтение файла
// --------------------------------------------------------------------------

/**
 * Кодировка выписки — почти всегда UTF-8, но выгрузка Т-Банка приходит
 * в windows-1251. Определяем строгим декодером: он падает на неверной
 * последовательности байтов, и это надёжнее, чем гадать по расширению.
 */
export async function readFile(file) {
  const buf = await file.arrayBuffer();
  try {
    return stripBom(new TextDecoder('utf-8', { fatal: true }).decode(buf));
  } catch {
    return stripBom(new TextDecoder('windows-1251').decode(buf));
  }
}

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Разделитель ищется по первой строке. Считать по всему файлу нельзя:
 * в описаниях операций запятых и точек с запятой бывает больше, чем
 * в заголовке столбцов, и файл с точкой с запятой определился бы как файл
 * с запятой из-за одного длинного назначения платежа.
 */
export function sniffDelimiter(text) {
  const line = text.split(/\r?\n/, 1)[0] || '';
  const counts = [';', '\t', ','].map((d) => [d, line.split(d).length - 1]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ';';
}

/**
 * Разбор CSV с кавычками. Своими руками, а не split(delimiter): в назначении
 * платежа разделитель встречается постоянно, и наивное деление разъезжает
 * ровно на тех строках, которые важнее всего — на крупных переводах
 * с длинным описанием.
 */
export function parseTable(text, delimiter) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 1; } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === delimiter) { row.push(cell); cell = ''; continue; }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell);
      cell = '';
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
      continue;
    }
    cell += ch;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows.map((r) => r.map((x) => x.trim()));
}

// --------------------------------------------------------------------------
// Догадка о столбцах
// --------------------------------------------------------------------------

const PATTERNS = {
  // «Дата операции» точнее «Даты платежа»: списание по карте попадает в банк
  // через день-два, и по дате платежа траты уезжают в следующий месяц.
  date: [/дата\s*операции/i, /дата\s*тран/i, /^дата$/i, /дата/i, /date/i],
  // Сумма в валюте счёта, а не операции: по рублёвой карте они совпадают,
  // по покупке за юани — нет, и считать надо то, что ушло со счёта.
  amount: [/сумма\s*платежа/i, /сумма\s*в\s*валюте\s*счет/i, /сумма\s*операции/i, /^сумма$/i, /amount/i],
  income: [/приход/i, /поступлен/i, /кредит/i, /зачислен/i],
  outgo: [/расход/i, /списан/i, /дебет/i],
  description: [/описание/i, /назначение/i, /контрагент/i, /получател/i, /коммент/i, /описание\s*операции/i, /description/i],
  category: [/категор/i, /category/i],
  status: [/статус/i, /status/i],
};

function pick(header, list) {
  for (const re of list) {
    const idx = header.findIndex((x) => re.test(x));
    if (idx >= 0) return idx;
  }
  return -1;
}

/** Возвращает раскладку столбцов: { date, amount, income, outgo, ... } */
export function guessMapping(header) {
  const map = {};
  for (const [key, list] of Object.entries(PATTERNS)) {
    const idx = pick(header, list);
    if (idx >= 0) map[key] = idx;
  }
  // Две колонки «приход» и «расход» — это другая форма записи, а не дополнение
  // к общей сумме. Если они есть обе, общая колонка только мешает.
  if (map.income != null && map.outgo != null) delete map.amount;
  else { delete map.income; delete map.outgo; }
  return map;
}

// --------------------------------------------------------------------------
// Разбор значений
// --------------------------------------------------------------------------

/**
 * Число из выписки. Пробелы-разделители разрядов бывают обычными,
 * неразрывными и узкими; минус — обычным, длинным или математическим;
 * дробная часть — через запятую или точку.
 */
export function toNumber(raw) {
  const text = String(raw || '')
    .replace(/[\s   ]/g, '')
    .replace(/[−–—]/g, '-')
    .replace(/[^\d,.-]/g, '');
  if (!text || !/\d/.test(text)) return null;

  // «1.234,56» — точка разделяет разряды, запятая дробь. «1,234.56» наоборот.
  let normal = text;
  const lastComma = text.lastIndexOf(',');
  const lastDot = text.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    normal = lastComma > lastDot ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, '');
  } else if (lastComma >= 0) {
    normal = text.replace(',', '.');
  }
  const value = Number(normal);
  return Number.isFinite(value) ? value : null;
}

/** Дата из выписки в ISO. Понимает 31.12.2026, 2026-12-31 и 31/12/2026. */
export function toDate(raw) {
  const text = String(raw || '').trim();
  let m = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return D.iso(Number(m[1]), Number(m[2]), Number(m[3]));
  m = text.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})/);
  if (m) return D.iso(Number(m[3]), Number(m[2]), Number(m[1]));
  m = text.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2})(?!\d)/);
  if (m) return D.iso(2000 + Number(m[3]), Number(m[2]), Number(m[1]));
  return null;
}

// Неудавшиеся и отменённые операции денег не двигали. Записать их значило бы
// показать траты, которых не было, — и увести аналитику ровно в ту сторону,
// ради которой всё и затевалось.
const BAD_STATUS = /fail|отклон|отмен|cancel|reject|declin/i;

// --------------------------------------------------------------------------
// Строки
// --------------------------------------------------------------------------

/**
 * Превращает таблицу в записи. Возвращает { rows, skipped } — пропущенное
 * считается и показывается: молча выкинуть треть выписки хуже, чем сказать,
 * что треть строк без даты.
 */
export function toRows(table, mapping, options = {}) {
  const { account = null, hasHeader = true } = options;
  const body = hasHeader ? table.slice(1) : table;
  const rows = [];
  const skipped = { date: 0, amount: 0, status: 0 };

  for (const cells of body) {
    const at = (i) => (i == null ? '' : cells[i] || '');

    if (mapping.status != null && BAD_STATUS.test(at(mapping.status))) { skipped.status += 1; continue; }

    const date = toDate(at(mapping.date));
    if (!date) { skipped.date += 1; continue; }

    let amount = null;
    if (mapping.amount != null) {
      amount = toNumber(at(mapping.amount));
    } else {
      const inc = toNumber(at(mapping.income)) || 0;
      const out = toNumber(at(mapping.outgo)) || 0;
      amount = inc ? Math.abs(inc) : -Math.abs(out);
    }
    if (amount == null || amount === 0) { skipped.amount += 1; continue; }

    rows.push({
      date,
      amount: Math.abs(amount),
      kind: amount < 0 ? KIND_OUT : KIND_IN,
      description: at(mapping.description).slice(0, 120),
      bankCategory: at(mapping.category).slice(0, 60) || null,
      account,
    });
  }
  return { rows, skipped };
}

// --------------------------------------------------------------------------
// Категории
// --------------------------------------------------------------------------

export const CATEGORIES = [
  'Продукты',
  'Кафе и рестораны',
  'Транспорт',
  'Жильё и связь',
  'Здоровье',
  'Покупки',
  'Развлечения',
  'Дети',
  'Прочее',
];

export const INCOME_CATEGORIES = ['Зарплата', 'Подработка', 'Возврат', 'Подарок', 'Прочий доход'];

/**
 * Правила «что в описании — то и категория».
 *
 * Список нарочно короткий и по крупным сетям: угадывать всё подряд значит
 * ошибаться незаметно. Что не угадалось — «Прочее», и это видно в разборе
 * по категориям как повод дописать своё правило.
 */
const RULES = [
  [/пятёроч|пятероч|магнит|перекр[её]сток|лента|ашан|дикси|вкусвилл|окей|о'кей|продукт|супермаркет|азбука вкуса|верный|светофор/i, 'Продукты'],
  [/кафе|ресторан|кофе|coffee|шаурм|пицц|pizza|суши|макдон|вкусно и точка|kfc|бургер|столов|кулинар|бар\b|паб\b/i, 'Кафе и рестораны'],
  [/такси|yandex\.?go|яндекс\.?go|метрополитен|метро\b|автобус|ржд|аэрофлот|s7|победа|бензин|азс|лукойл|газпромнефт|роснефт|топлив|каршеринг|делимобиль|белка|парковк/i, 'Транспорт'],
  [/жкх|квартплат|аренд|электроэнерг|водоканал|теплосет|газпром межрегион|мтс|билайн|мегафон|теле2|tele2|ростелеком|интернет|домофон/i, 'Жильё и связь'],
  [/аптек|клиник|медиц|стоматолог|больниц|поликлин|анализ|инвитро|гемотест|оптик/i, 'Здоровье'],
  [/одежд|обув|zara|uniqlo|спортмастер|wildberries|вайлдберриз|ozon|озон|детский мир|днс\b|dns\b|м\.?видео|эльдорадо|леруа|икеа|ikea/i, 'Покупки'],
  [/кино|театр|концерт|музе|steam|подписк|netflix|кинопоиск|яндекс плюс|фитнес|спортзал|бассейн|игр[аы]\b/i, 'Развлечения'],
  [/детск|школ|садик|няня|развивающ/i, 'Дети'],
];

const INCOME_RULES = [
  [/зарплат|аванс|оклад|заработн/i, 'Зарплата'],
  [/возврат|refund|отмена операции/i, 'Возврат'],
  [/подработк|фриланс|гонорар|самозанят/i, 'Подработка'],
];

/**
 * Категория строки. Своё правило человека сильнее встроенного, встроенное
 * сильнее категории банка: банк размечает по коду точки продаж и регулярно
 * относит аптеку к «Здоровью», а ту же аптеку в супермаркете — к «Продуктам».
 */
export function categorise(row, userRules = []) {
  const text = `${row.description || ''} ${row.bankCategory || ''}`;
  for (const rule of userRules) {
    if (!rule.match) continue;
    if (text.toLowerCase().includes(String(rule.match).toLowerCase())) return rule.category;
  }
  const list = row.kind === KIND_IN ? INCOME_RULES : RULES;
  for (const [re, category] of list) {
    if (re.test(text)) return category;
  }
  if (row.bankCategory) return row.bankCategory;
  return row.kind === KIND_IN ? 'Прочий доход' : 'Прочее';
}

// --------------------------------------------------------------------------
// Переводы себе
// --------------------------------------------------------------------------

// Слово «перевод» само по себе ничего не значит: перевод другу — трата,
// перевод на свой вклад — нет. Поэтому по описанию ловим только то,
// что названо своим счётом прямо.
const SELF = /свой счёт|свой счет|между своими|между счетами|брокерск|инвесткопилк|накопительн|на вклад|пополнение вклада/i;

/**
 * Отмечает переводы в собственный капитал.
 *
 * Главный признак — не слово в описании, а совпадение с уже записанным
 * взносом: если в тот же день на ту же сумму в приложении есть взнос,
 * это он и есть, и считать его тратой значит вычесть одни деньги дважды —
 * сначала из жизни, потом из накоплений.
 *
 * Допуск в два дня: банк проводит перевод сегодня, а зачисление на вклад
 * приходит завтра, и человек записывает взнос по второй дате.
 */
export function markTransfers(rows, contributions) {
  const used = new Set();
  return rows.map((row) => {
    if (row.kind !== KIND_OUT) return row;
    if (SELF.test(row.description || '')) return { ...row, kind: KIND_MOVE, category: 'Сбережения' };

    const hit = contributions.findIndex((op, i) => !used.has(i)
      && Math.abs(op.amount - row.amount) < 0.01
      && Math.abs(D.diffDays(op.date, row.date)) <= 2);
    if (hit >= 0) {
      used.add(hit);
      return { ...row, kind: KIND_MOVE, category: 'Сбережения' };
    }
    return row;
  });
}

// --------------------------------------------------------------------------
// Слияние с уже записанным
// --------------------------------------------------------------------------

/**
 * Ключ строки. Времени в выписке может не быть, идентификатора операции —
 * тоже, поэтому опознаём по дате, сумме и описанию.
 */
export function keyOf(row) {
  const text = String(row.description || '').toLowerCase().replace(/\s+/g, ' ').trim();
  return `${row.date}|${row.kind === KIND_IN ? '+' : '-'}${row.amount.toFixed(2)}|${text}`;
}

/**
 * Что из выписки ещё не записано.
 *
 * Выписку берут внахлёст — за неделю, потом снова за неделю, — и половина
 * строк уже лежит в приложении. Но два одинаковых кофе в один день бывают
 * по-настоящему, и выкидывать второй нельзя. Поэтому сравниваем не наличие,
 * а количество одинаковых строк: сколько их в выписке сверх уже записанных,
 * столько и добавляем.
 */
export function newRows(rows, existing) {
  const have = new Map();
  for (const row of existing) {
    const key = row.key || keyOf(row);
    have.set(key, (have.get(key) || 0) + 1);
  }
  const fresh = [];
  for (const row of rows) {
    const key = keyOf(row);
    const left = have.get(key) || 0;
    if (left > 0) { have.set(key, left - 1); continue; }
    fresh.push({ ...row, key });
  }
  return fresh;
}

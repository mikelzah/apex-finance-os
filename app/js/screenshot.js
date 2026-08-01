// Операции со скриншота банковского приложения.
//
// Картинку разобрать нечем: Safari не даёт странице системное распознавание
// текста, а свой движок OCR — это полтора десятка мегабайт в офлайн-кэше
// и худшее качество на рублёвых суммах, чем у самого телефона. Зато iOS
// умеет вытащить текст из картинки в два касания («Выделить всё» на снимке
// в Фото), и распознаёт он лучше любого движка, который поместился бы сюда.
//
// Поэтому сюда приходит текст, а не изображение. Задача этого файла —
// собрать из полосы строк осмысленные операции: в списке банка дата стоит
// заголовком над группой, название магазина отдельной строкой, а сумма
// со знаком где-то рядом.

import * as D from './dates.js';
import { KIND_IN, KIND_OUT } from './statement.js';

const MONTHS = [
  [/^янв/i, 1], [/^фев/i, 2], [/^мар/i, 3], [/^апр/i, 4],
  [/^ма[йяе]/i, 5], [/^июн/i, 6], [/^июл/i, 7], [/^авг/i, 8],
  [/^сен/i, 9], [/^окт/i, 10], [/^ноя/i, 11], [/^дек/i, 12],
];

/**
 * Сумма в строке.
 *
 * Рубль обязателен — без него «8,00% годовых» и «хватит на 4 месяца»
 * становятся операциями. Исключение одно: явный знак перед числом
 * с копейками, как «−1 240,50» в списке без валюты.
 */
const WITH_SIGN = /([+\-−–—])?\s*(\d[\d\s   ]*(?:[.,]\d{1,2})?)\s*(?:₽|руб\.?|rub|р\.)/iu;
const BARE = /([+\-−–—])\s*(\d[\d\s   ]*[.,]\d{2})(?!\d)/u;

// Кэшбэк и бонусы в списке банка — подпись под операцией, а не отдельное
// движение денег. Записать их доходом значит завысить доход на пустом месте.
const NOISE = /кэшб|кешб|cashback|бонус|балл|начислим|накоплено|доступно|остаток по счёту|остаток по счету/i;

/**
 * Разбирает текст, снятый со скриншота.
 *
 * @param {string} text   текст, распознанный телефоном
 * @param {string} today  сегодняшняя дата, от неё считаются «Сегодня» и «Вчера»
 */
export function parseScreen(text, today) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((x) => x.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const rows = [];
  let date = null;
  let dated = false;
  let pending = [];

  for (const line of lines) {
    const asDate = readDate(line, today);
    if (asDate) { date = asDate; dated = true; pending = []; continue; }
    if (NOISE.test(line)) continue;

    const money = readAmount(line);
    if (!money) {
      // Строка без суммы — кандидат в название. Их копится несколько:
      // банк пишет и магазин, и категорию, и время.
      pending.push(line);
      if (pending.length > 3) pending.shift();
      continue;
    }

    // Название берётся из той же строки, если оно там есть: в списке банка
    // сумма стоит справа от магазина, и после распознавания они оказываются
    // одной строкой. Иначе — ближайшая строка сверху.
    const inline = line.replace(money.raw, '').replace(/[·•|]/g, ' ').trim();
    const before = pending.filter((x) => !isTime(x));
    // Из строк над суммой берутся две последние, и первая из них —
    // название: в списке банка магазин стоит над своей категорией
    // («Пятёрочка», ниже «Супермаркеты»), а не под ней. Выше этих двух
    // может лежать что угодно — название месяца, заголовок раздела.
    const name = before.length > 1 ? before[before.length - 2] : before[before.length - 1];
    const under = before.length > 1 ? before[before.length - 1] : null;
    const description = inline || name || '';
    const bankCategory = inline ? before[before.length - 1] || null : under;

    rows.push({
      date: date || today,
      amount: money.amount,
      kind: money.kind,
      description: description.slice(0, 120),
      bankCategory: bankCategory ? bankCategory.slice(0, 60) : null,
    });
    pending = [];
  }

  return { rows, dated };
}

// --------------------------------------------------------------------------

function isTime(line) {
  return /^\d{1,2}[:.]\d{2}$/.test(line);
}

function readAmount(line) {
  const m = line.match(WITH_SIGN) || line.match(BARE);
  if (!m) return null;

  const digits = m[2].replace(/[\s   ]/g, '').replace(',', '.');
  const amount = Number(digits);
  if (!Number.isFinite(amount) || amount === 0) return null;

  // Без знака — трата: в списке банка приход всегда помечен плюсом,
  // а расход чаще всего ничем. Это догадка, и поэтому вид каждой записи
  // виден в разборе до записи и правится одним касанием.
  const kind = m[1] === '+' ? KIND_IN : KIND_OUT;
  return { amount, kind, raw: m[0] };
}

/**
 * Заголовок даты над группой операций.
 *
 * Год в списке банка обычно не пишут. Если месяц ещё не наступил, значит
 * это прошлый год: операции из будущего в выписке не бывают, а вот
 * декабрьские в январе — сплошь и рядом.
 */
export function readDate(line, today) {
  const text = line.replace(/^[^\p{L}\d]+/u, '').trim();
  if (/^сегодня/i.test(text)) return today;
  if (/^вчера/i.test(text)) return D.addDays(today, -1);
  if (/^позавчера/i.test(text)) return D.addDays(today, -2);

  let m = text.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})/);
  if (m) return D.iso(Number(m[3]), Number(m[2]), Number(m[1]));

  m = text.match(/^(\d{1,2})\s+([\p{L}]+)\.?\s*(\d{4})?/u);
  if (!m) return null;
  const month = MONTHS.find(([re]) => re.test(m[2]));
  if (!month) return null;

  const day = Number(m[1]);
  if (day < 1 || day > 31) return null;
  const now = D.parts(today);
  const year = m[3] ? Number(m[3]) : (month[1] > now.m ? now.y - 1 : now.y);
  const iso = D.iso(year, month[1], day);
  return D.isValid(iso) ? iso : null;
}

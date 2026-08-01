// Операции со скриншота банковского приложения.
//
// Сюда приходит текст: либо распознанный движком из ocr.js, либо вставленный
// руками. Задача этого файла — собрать из полосы строк осмысленные операции.
// Список банка не таблица: дата стоит заголовком над группой, название
// магазина отдельной строкой, категория под ним, а сумма где-то рядом.
//
// Разбор рассчитан на текст после распознавания, а он не бывает чистым.
// Рубль превращается в букву, «Go» в «Со», дефис в тире. Поэтому правила
// написаны свободно там, где ошибка безобидна, и строго там, где она
// стоила бы денег: сумма без валюты не принимается вовсе, иначе «8,00%
// годовых» и «хватит на 4 месяца» стали бы операциями.

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
// Рубль после распознавания редко остаётся рублём: перечёркнутая «Р» читается
// как обычная русская «Р» или как латинская «P» — они приняты наравне
// со знаком. Без этого пропадали все суммы без копеек: «−450 ₽» не подходило
// ни под одно правило, а «−1 240,50 ₽» проходило по запятой и двум цифрам.
const WITH_SIGN = /([+\-−–—])?\s*(\d[\d\s   ]*(?:[.,]\d{1,2})?)\s*(?:₽|руб\.?|rub|[рp]\.?(?![\p{L}]))/iu;
const BARE = /([+\-−–—])\s*(\d[\d\s   ]*[.,]\d{2})(?!\d)/u;

// Кэшбэк и бонусы в списке банка — подпись под операцией, а не отдельное
// движение денег. Записать их доходом значит завысить доход на пустом месте.
const NOISE = /кэшб|кешб|cashback|бонус|балл|начислим|накоплено|доступно|остаток по счёту|остаток по счету/i;

/**
 * Итог дня — «Вы потратили 4 865,24 ₽» под заголовком с датой.
 *
 * Записывать его операцией нельзя: это сумма всех остальных строк, и день
 * удваивается. Но и выбрасывать жалко — банк тут сам даёт контрольную сумму,
 * по которой видно, всё ли прочиталось верно. Она и есть единственная защита
 * от тихо переехавшей цифры.
 */
// Граница слова здесь не \b, а явная проверка: \b в JavaScript знает только
// латиницу, и после «потратили» никакой границы не находит — правило молча
// не срабатывает ни на одной русской строке.
const TOTAL = /^(?:вы\s+потратили|вы\s+получили|потрачено|получено|израсходовано|итого|всего)(?![\p{L}])/iu;

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
  const totals = [];
  let date = null;
  let dated = false;
  let pending = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const asDate = readDate(line, today);
    if (asDate) { date = asDate; dated = true; pending = []; continue; }
    if (NOISE.test(line)) continue;

    if (TOTAL.test(line)) {
      const sum = readAmount(line);
      if (sum) totals.push({ date: date || today, amount: sum.amount, income: /получ/i.test(line) });
      pending = [];
      continue;
    }

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
    // Хвост валюты убирается отдельно: когда сумма поймана правилом без неё,
    // буква «Р» остаётся в строке и попадает в название магазина.
    const inline = line
      .replace(money.raw, '')
      .replace(/[·•|]/g, ' ')
      .replace(/\s*(?:₽|руб\.?|[рp]\.?)\s*$/iu, '')
      .trim();
    const before = pending.filter((x) => !isTime(x));
    // Из строк над суммой берутся две последние, и первая из них —
    // название: в списке банка магазин стоит над своей категорией
    // («Пятёрочка», ниже «Супермаркеты»), а не под ней. Выше этих двух
    // может лежать что угодно — название месяца, заголовок раздела.
    const name = before.length > 1 ? before[before.length - 2] : before[before.length - 1];
    const under = before.length > 1 ? before[before.length - 1] : null;
    const description = inline || name || '';

    // Когда сумма стоит в строке с названием, категория идёт следующей
    // строкой — и её надо не только взять, но и убрать с дороги. Оставленная
    // в накопителе, она становилась названием следующей операции: аптека
    // после «Супермаркетов» уезжала в продукты.
    let bankCategory = under;
    if (inline) {
      const at = nextPlain(lines, i, today, money);
      bankCategory = at < 0 ? null : lines[at];
      if (at >= 0) i = at;
    }

    rows.push({
      date: date || today,
      amount: money.amount,
      kind: money.kind,
      description: clean(description).slice(0, 120),
      bankCategory: bankCategory ? clean(stripAmount(bankCategory)).slice(0, 60) || null : null,
    });
    pending = [];
  }

  return { rows, dated, totals };
}

/**
 * Убирает следы значков из названия.
 *
 * Иконка магазина стоит слева от названия, и распознавание превращает её
 * в одинокий символ: «Ф Пётр Сергеевич К.», «@ Дикси», «|. Перекрёсток».
 * Справа так же оседают часики неподтверждённой операции — «©», «®».
 * Ни то ни другое не название, а в правиле категорий такой мусор мешает.
 */
/** Убирает сумму из строки категории — там ей делать нечего. */
function stripAmount(text) {
  const money = readAmount(text);
  return money ? text.replace(money.raw, ' ') : text;
}

function clean(text) {
  return String(text || '')
    .replace(/^[^\p{L}\d]+/u, '')
    // Одинокая буква в начале — почти всегда буква с иконки: настоящие
    // названия так не начинаются, а «М.Видео» пишется без пробела.
    .replace(/^[\p{L}]\s+(?=[\p{L}\d])/u, '')
    .replace(/[\s©®™@|]+$/u, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// --------------------------------------------------------------------------

function isTime(line) {
  return /^\d{1,2}[:.]\d{2}$/.test(line);
}

/**
 * Ближайшая ниже строка с категорией операции.
 *
 * Обычно это строка без суммы. Но в Т-Банке на ней же справа стоит кэшбэк —
 * «Фастфуд   +20 ₽», без слова «кэшбэк» и без всякого другого признака,
 * кроме положительного знака и мелкой суммы. Без разбора она становилась
 * доходом: двадцать рублей прихода под каждой тратой, и норма сбережений
 * растёт на ровном месте.
 *
 * Отличаем по смыслу, а не по слову: кэшбэк — это возврат части трата,
 * он меньше её и идёт в другую сторону. Строка при этом обязана нести
 * ещё и текст: одинокое «+20 ₽» может оказаться настоящей операцией,
 * и съедать её молча нельзя.
 */
function nextPlain(lines, from, today, main) {
  for (let i = from + 1; i < Math.min(lines.length, from + 3); i += 1) {
    const line = lines[i];
    if (NOISE.test(line)) continue;
    if (readDate(line, today) || isTime(line)) return -1;

    const money = readAmount(line);
    if (!money) return i;
    if (isCashback(money, main, line)) return i;
    return -1;
  }
  return -1;
}

// Кэшбэк больше трети траты не бывает: обычно это единицы процентов,
// у самых щедрых карт — десятки.
const CASHBACK_SHARE = 0.35;

function isCashback(money, main, line) {
  if (!main || main.kind !== KIND_OUT || money.kind !== KIND_IN) return false;
  if (money.amount > main.amount * CASHBACK_SHARE) return false;
  return /\p{L}{3}/u.test(line.replace(money.raw, ''));
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

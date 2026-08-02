// Даты живут строками «ГГГГ-ММ-ДД» и превращаются в числа только внутри.
// Через объект Date напрямую считать нельзя: new Date('2026-07-28') — это
// полночь UTC, и в положительном часовом поясе локальный день уезжает назад.
// Поэтому вся арифметика идёт через Date.UTC, а наружу возвращается строка.

const MS_DAY = 86400000;

export function today() {
  const now = new Date();
  return iso(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function iso(y, m, d) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function parts(s) {
  const [y, m, d] = s.split('-').map(Number);
  return { y, m, d };
}

export function toDays(s) {
  const { y, m, d } = parts(s);
  return Math.round(Date.UTC(y, m - 1, d) / MS_DAY);
}

export function fromDays(n) {
  const dt = new Date(n * MS_DAY);
  return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function addDays(s, n) {
  return fromDays(toDays(s) + n);
}

/** Сколько дней от b до a. Положительное — a позже. */
export function diffDays(a, b) {
  return toDays(a) - toDays(b);
}

export function isLeap(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function yearDays(y) {
  return isLeap(y) ? 366 : 365;
}

export function lastDayOfMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * Та же дата через n месяцев. 31-е в коротком месяце становится последним
 * числом: 31 января плюс месяц — это 28 февраля, а не 3 марта.
 */
export function addMonths(s, n) {
  const { y, m, d } = parts(s);
  const total = (y * 12 + (m - 1)) + Math.round(n);
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return iso(ny, nm, Math.min(d, lastDayOfMonth(ny, nm)));
}

/**
 * Та же дата через n лет.
 *
 * 29 февраля переносится на 28-е: 29 февраля 2027 года не существует, а срок
 * владения от него всё равно надо от чего-то отсчитывать.
 */
export function addYears(s, n) {
  const { y, m, d } = parts(s);
  return iso(y + n, m, Math.min(d, lastDayOfMonth(y + n, m)));
}

export function month(s) {
  return s.slice(0, 7);
}

/** Первое число месяца, к которому относится дата. */
export function monthStart(s) {
  const { y, m } = parts(s);
  return iso(y, m, 1);
}

/**
 * Настоящая ли это дата.
 *
 * Обратный ход обязателен. Date.UTC молча переносит выход за границы:
 * «2026-02-31» становится 3 марта, «2026-13-07» — июлем следующего года.
 * Обе строки проходили проверку на форму и на «не NaN», и дальше жили как
 * настоящие даты — сортировались, считались, попадали в месяц. На экране
 * при этом получалось «7 undefined 2026»: месяца с номером 13 в списке
 * названий нет.
 *
 * Такие строки приходят снаружи: из выписки в формате мм/дд, из распознанного
 * снимка, из чужой резервной копии. Внутри их не собрать — addMonths и addYears
 * поджимают день к последнему числу месяца.
 */
export function isValid(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const days = toDays(s);
  return !Number.isNaN(days) && fromDays(days) === s;
}

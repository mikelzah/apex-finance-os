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

export function month(s) {
  return s.slice(0, 7);
}

/** Первое число месяца, к которому относится дата. */
export function monthStart(s) {
  const { y, m } = parts(s);
  return iso(y, m, 1);
}

export function isValid(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(toDays(s));
}

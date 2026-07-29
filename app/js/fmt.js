// Форматирование. Рубли, даты, проценты — в одном месте, чтобы
// «1 250 ₽» выглядело одинаково на всех экранах.

import * as D from './dates.js';

const MONTHS = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

const nf0 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Рубли без копеек — для крупных сумм, где копейки только мешают. */
export function money(x) {
  if (x == null || Number.isNaN(x)) return '—';
  return `${nf0.format(Math.round(x))} ₽`;
}

/** Рубли с копейками — там, где важна сверка с банком. */
export function money2(x) {
  if (x == null || Number.isNaN(x)) return '—';
  return `${nf2.format(x)} ₽`;
}

export function signedMoney(x) {
  if (x == null || Number.isNaN(x)) return '—';
  const sign = x > 0 ? '+' : '';
  return `${sign}${nf0.format(Math.round(x))} ₽`;
}

export function num(x, digits = 2) {
  if (x == null || Number.isNaN(x)) return '—';
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(x);
}

export function percent(x, digits = 1) {
  if (x == null || Number.isNaN(x)) return '—';
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(x)}%`;
}

/** Доля 0..1 в проценты. */
export function share(x, digits = 0) {
  if (x == null || Number.isNaN(x)) return '—';
  return percent(x * 100, digits);
}

export function date(s) {
  if (!D.isValid(s)) return '—';
  const { y, m, d } = D.parts(s);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export function dateShort(s) {
  if (!D.isValid(s)) return '—';
  const { m, d } = D.parts(s);
  return `${d} ${MONTHS_SHORT[m - 1]}`;
}

export function monthName(s) {
  const [y, m] = s.split('-').map(Number);
  return `${MONTHS_SHORT[m - 1]} ${String(y).slice(2)}`;
}

/** Склонение: 1 день, 2 дня, 5 дней. */
export function plural(n, one, few, many) {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last > 1 && last < 5) return few;
  if (last === 1) return one;
  return many;
}

export function days(n) {
  if (n == null) return '—';
  return `${nf0.format(n)} ${plural(n, 'день', 'дня', 'дней')}`;
}

export function relativeDate(s, todayStr) {
  if (!D.isValid(s)) return '—';
  const diff = D.diffDays(s, todayStr);
  if (diff === 0) return 'сегодня';
  if (diff === -1) return 'вчера';
  if (diff === 1) return 'завтра';
  return date(s);
}

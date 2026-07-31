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

/**
 * Скрытие сумм.
 *
 * Заслонка ставится здесь, а не в стилях, и это принципиально. Размытие или
 * прозрачность оставляют настоящее число в разметке: его видно копированием,
 * поиском по странице и любым снимком, сделанным до того, как стиль
 * применился. Здесь суммы не существует вовсе — вместо неё точки, и подсмотреть
 * нечего.
 *
 * Скрываются только деньги. Проценты, доли и количества ничего о человеке
 * не сообщают: «33,49% портфеля» не выдаёт ни рубля.
 */
const HIDE_KEY = 'apex-finance-os:hide-money';
const MASK = '••• ₽';

export function hidden() {
  return localStorage.getItem(HIDE_KEY) === 'on';
}

export function setHidden(on) {
  if (on) localStorage.setItem(HIDE_KEY, 'on');
  else localStorage.removeItem(HIDE_KEY);
}

/** Рубли без копеек — для крупных сумм, где копейки только мешают. */
export function money(x) {
  if (x == null || Number.isNaN(x)) return '—';
  if (hidden()) return MASK;
  return `${nf0.format(Math.round(x))} ₽`;
}

/** Рубли с копейками — там, где важна сверка с банком. */
export function money2(x) {
  if (x == null || Number.isNaN(x)) return '—';
  if (hidden()) return MASK;
  return `${nf2.format(x)} ₽`;
}

export function signedMoney(x) {
  if (x == null || Number.isNaN(x)) return '—';
  if (hidden()) return MASK;
  const sign = x > 0 ? '+' : '';
  return `${sign}${nf0.format(Math.round(x))} ₽`;
}

/**
 * Рубли с копейками там, где они есть, и без них там, где их нет.
 *
 * Отдельная функция, потому что обе крайности плохи. Округление до рубля
 * съедает начисленные проценты: доход 3,97 ₽ показывается как «+4 ₽»,
 * и сверить его с выпиской банка нельзя. Постоянные же копейки засоряют
 * ровные суммы — «1 250,00 ₽» вместо «1 250 ₽» на каждом взносе.
 *
 * Применяется к отдельным операциям и остаткам счетов — там, где число
 * сверяют с банком. Сводные суммы вроде капитала остаются округлёнными:
 * копейки в них ничего не решают, а разряды делают нечитаемыми.
 */
export function moneyExact(x) {
  if (x == null || Number.isNaN(x)) return '—';
  if (hidden()) return MASK;
  return `${(hasKopecks(x) ? nf2 : nf0).format(hasKopecks(x) ? x : Math.round(x))} ₽`;
}

export function signedMoneyExact(x) {
  if (x == null || Number.isNaN(x)) return '—';
  if (hidden()) return MASK;
  const sign = x > 0 ? '+' : '';
  return `${sign}${(hasKopecks(x) ? nf2 : nf0).format(hasKopecks(x) ? x : Math.round(x))} ₽`;
}

function hasKopecks(x) {
  return Math.abs(x - Math.round(x)) > 0.005;
}

export function num(x, digits = 2) {
  if (x == null || Number.isNaN(x)) return '—';
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(x);
}

/**
 * Проценты. По умолчанию два знака — столько же, сколько принимает поле ввода.
 *
 * Была одна десятая, и введённые 14,25 показывались как 14,3. Ставка при этом
 * хранилась точной: округлял только вывод, и человек видел не то число,
 * которое сам вписал. Для величины, от которой считается налоговый лимит,
 * это недопустимо.
 *
 * Нули в конце не печатаются: 16 остаётся «16%», а не «16,00%».
 */
export function percent(x, digits = 2) {
  if (x == null || Number.isNaN(x)) return '—';
  const nf = new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
  return `${nf.format(x)}%`;
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

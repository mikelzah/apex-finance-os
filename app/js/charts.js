// Графики. Рисуются вручную в SVG — библиотека ради четырёх типов диаграмм
// весила бы больше всего остального приложения и тянула бы за собой сборку.
//
// В Notion графиков нет намеренно: на бесплатном плане доступен один график
// на воркспейс. Здесь это ограничение не действует.

import * as F from './fmt.js';
import * as D from './dates.js';

const NS = 'http://www.w3.org/2000/svg';

function el(name, attrs = {}, children = []) {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) {
    if (v != null) node.setAttribute(k, String(v));
  }
  for (const c of [].concat(children)) {
    if (c) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

function frame(width, height, className) {
  const svg = el('svg', {
    viewBox: `0 0 ${width} ${height}`,
    class: className,
    preserveAspectRatio: 'none',
    role: 'img',
  });
  return svg;
}

function empty(message) {
  const box = document.createElement('div');
  box.className = 'chart-empty';
  box.textContent = message;
  return box;
}

/**
 * Линия по датам. Одна точка — не график, поэтому при недостатке данных
 * честно говорим об этом, а не рисуем прямую в пустоте.
 */
export function line(points, options = {}) {
  const { height = 160, format = F.money, minPoints = 2, hint = 'Нужно минимум два измерения' } = options;
  if (!points || points.length < minPoints) return empty(hint);

  const sorted = [...points].sort((a, b) => (a.x < b.x ? -1 : 1));
  const width = 320;
  const padY = 18;
  const padL = 4;
  const padR = 4;

  const xs = sorted.map((p) => D.toDays(p.x));
  const ys = sorted.map((p) => p.y);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  let y0 = Math.min(...ys);
  let y1 = Math.max(...ys);
  if (y1 === y0) {
    y0 -= Math.abs(y0 * 0.01) || 1;
    y1 += Math.abs(y1 * 0.01) || 1;
  }
  const spanX = x1 - x0 || 1;

  const px = (v) => padL + ((v - x0) / spanX) * (width - padL - padR);
  const py = (v) => height - padY - ((v - y0) / (y1 - y0)) * (height - padY * 2);

  const svg = frame(width, height, 'chart chart-line');
  const coords = sorted.map((p) => [px(D.toDays(p.x)), py(p.y)]);
  const path = coords.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');

  const area = `${path} L${coords[coords.length - 1][0].toFixed(1)} ${height - padY} L${coords[0][0].toFixed(1)} ${height - padY} Z`;

  const gradId = `grad-${Math.random().toString(36).slice(2, 8)}`;
  const defs = el('defs', {}, [
    el('linearGradient', { id: gradId, x1: '0', y1: '0', x2: '0', y2: '1' }, [
      el('stop', { offset: '0%', 'stop-color': 'var(--accent)', 'stop-opacity': '0.28' }),
      el('stop', { offset: '100%', 'stop-color': 'var(--accent)', 'stop-opacity': '0' }),
    ]),
  ]);

  svg.appendChild(defs);
  svg.appendChild(el('path', { d: area, fill: `url(#${gradId})`, stroke: 'none' }));
  svg.appendChild(
    el('path', {
      d: path,
      fill: 'none',
      stroke: 'var(--accent)',
      'stroke-width': '2',
      'stroke-linejoin': 'round',
      'stroke-linecap': 'round',
      'vector-effect': 'non-scaling-stroke',
    }),
  );

  const last = coords[coords.length - 1];
  svg.appendChild(el('circle', { cx: last[0], cy: last[1], r: 3.5, fill: 'var(--accent)' }));

  const wrap = document.createElement('div');
  wrap.className = 'chart-wrap';
  wrap.appendChild(svg);

  const scale = document.createElement('div');
  scale.className = 'chart-scale';
  scale.innerHTML = `<span>${format(y0)}</span><span>${format(y1)}</span>`;
  wrap.appendChild(scale);

  const axis = document.createElement('div');
  axis.className = 'chart-axis';
  axis.innerHTML = `<span>${F.dateShort(sorted[0].x)}</span><span>${F.dateShort(sorted[sorted.length - 1].x)}</span>`;
  wrap.appendChild(axis);

  return wrap;
}

/** Горизонтальные полосы: текущая доля против целевой. */
export function allocation(rows, onEdit) {
  const wrap = document.createElement('div');
  wrap.className = 'alloc';
  if (!rows.length) return empty('Классы не заданы');

  for (const row of rows) {
    const editable = onEdit && !row.unmapped;
    const item = document.createElement(editable ? 'button' : 'div');
    item.className = 'alloc-row';
    if (editable) {
      item.type = 'button';
      item.addEventListener('click', () => onEdit(row));
    }

    const head = document.createElement('div');
    head.className = 'alloc-head';
    head.innerHTML = `<span class="alloc-name">${escape(row.class)}</span>
      <span class="alloc-value">${F.money(row.value)}</span>`;
    item.appendChild(head);

    const track = document.createElement('div');
    track.className = 'alloc-track';

    const fill = document.createElement('div');
    fill.className = 'alloc-fill';
    fill.style.width = `${Math.min(100, row.share || 0)}%`;
    track.appendChild(fill);

    if (row.targetShare != null) {
      const mark = document.createElement('div');
      mark.className = 'alloc-target';
      mark.style.left = `${Math.min(100, row.targetShare)}%`;
      mark.title = `цель ${row.targetShare}%`;
      track.appendChild(mark);
    }
    item.appendChild(track);

    const foot = document.createElement('div');
    foot.className = 'alloc-foot';
    const target = row.targetShare == null ? 'цель не задана' : `цель ${F.percent(row.targetShare, 0)}`;
    foot.innerHTML = `<span>${F.percent(row.share, 2)} · ${target}</span>
      <span class="tag tag-${actionClass(row.action)}">${escape(row.action)}</span>`;
    item.appendChild(foot);

    wrap.appendChild(item);
  }
  return wrap;
}

function actionClass(action) {
  if (action === 'в норме') return 'ok';
  if (action === 'докупить') return 'buy';
  if (action === 'продать') return 'sell';
  return 'muted';
}

/**
 * Календарь дисциплины: точка на каждый день месяца.
 * Пустая клетка — пропущенный день, это и есть весь чек-лист.
 */
export function ritual(operations, goalId, day) {
  const { y, m } = D.parts(day);
  const total = D.lastDayOfMonth(y, m);
  const filled = new Set();
  for (const op of operations) {
    if (goalId && op.goalId !== goalId) continue;
    if (op.type !== 'Взнос') continue;
    if (!D.isValid(op.date)) continue;
    const p = D.parts(op.date);
    if (p.y === y && p.m === m) filled.add(p.d);
  }

  const wrap = document.createElement('div');
  wrap.className = 'ritual';
  const todayD = D.parts(day).d;

  for (let d = 1; d <= total; d += 1) {
    const cell = document.createElement('span');
    const done = filled.has(d);
    const future = d > todayD;
    cell.className = `ritual-cell${done ? ' is-done' : ''}${future ? ' is-future' : ''}`;
    cell.textContent = String(d);
    cell.title = `${d} — ${done ? 'взнос есть' : future ? 'ещё впереди' : 'пропущен'}`;
    wrap.appendChild(cell);
  }
  return { node: wrap, filled: filled.size, elapsed: todayD, streak: streakOf(filled, todayD) };
}

function streakOf(filled, todayD) {
  let n = 0;
  for (let d = todayD; d >= 1; d -= 1) {
    if (filled.has(d)) n += 1;
    else if (d !== todayD) break;
  }
  return n;
}

/** Полоса прогресса цели. */
export function progress(value, options = {}) {
  const { over = false } = options;
  const track = document.createElement('div');
  track.className = `bar${over ? ' is-over' : ''}`;
  const fill = document.createElement('div');
  fill.className = 'bar-fill';
  fill.style.width = `${Math.max(0, Math.min(100, (value || 0) * 100))}%`;
  track.appendChild(fill);
  return track;
}

function escape(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
  );
}

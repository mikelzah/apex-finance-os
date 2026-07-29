// Графики. Рисуются вручную в SVG — библиотека ради четырёх типов диаграмм
// весила бы больше всего остального приложения и тянула бы за собой сборку.
//
// В Notion графиков нет намеренно: на бесплатном плане доступен один график
// на воркспейс. Здесь это ограничение не действует.
//
// Правила, которые здесь соблюдаются осознанно:
//   — соотношение сторон фиксировано (meet, а не none), иначе точка на конце
//     линии превращается в эллипс, а наклон врёт;
//   — значение читается касанием и продублировано таблицей: график, у которого
//     число нельзя прочитать вообще никак, — украшение, а не инструмент;
//   — цвет ряда не используется для текста, подписи носят краски текста.

import * as F from './fmt.js';
import * as D from './dates.js';

const NS = 'http://www.w3.org/2000/svg';

// Система координат графика. Реальный размер задаёт CSS, здесь только пропорция.
const W = 320;
const H = 132;
const PAD = { top: 10, right: 6, bottom: 18, left: 6 };

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

function div(className, text) {
  const node = document.createElement('div');
  node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function empty(message) {
  return div('chart-empty', message);
}

// --------------------------------------------------------------------------
// Линия
// --------------------------------------------------------------------------

/**
 * Линия по датам с сеткой, касанием и таблицей.
 * Одна точка — не график, поэтому при недостатке данных честно говорим
 * об этом, а не рисуем прямую в пустоте.
 */
export function line(points, options = {}) {
  const {
    height,
    format = F.money,
    label = 'Значение',
    hint = 'Нужно минимум два измерения',
  } = options;

  if (!points || points.length < 2) return empty(hint);

  const data = [...points].sort((a, b) => (a.x < b.x ? -1 : 1));
  const xs = data.map((p) => D.toDays(p.x));
  const ys = data.map((p) => p.y);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  let y0 = Math.min(...ys);
  let y1 = Math.max(...ys);
  if (y1 === y0) {
    const pad = Math.abs(y0 * 0.02) || 1;
    y0 -= pad;
    y1 += pad;
  }
  const spanX = x1 - x0 || 1;

  const px = (v) => PAD.left + ((v - x0) / spanX) * (W - PAD.left - PAD.right);
  const py = (v) => H - PAD.bottom - ((v - y0) / (y1 - y0)) * (H - PAD.top - PAD.bottom);

  const svg = el('svg', {
    viewBox: `0 0 ${W} ${H}`,
    class: 'chart',
    // meet, не none: иначе штрих и метки растягиваются вместе с шириной.
    preserveAspectRatio: 'xMidYMid meet',
    role: 'img',
    'aria-label': `${label}: с ${F.date(data[0].x)} по ${F.date(data[data.length - 1].x)}`,
  });

  // Сетка — сплошные волосяные линии на шаг от поверхности, без пунктира.
  const ticks = [y0, (y0 + y1) / 2, y1];
  for (const t of ticks) {
    svg.appendChild(
      el('line', {
        x1: PAD.left, x2: W - PAD.right, y1: py(t), y2: py(t),
        class: 'chart-grid',
      }),
    );
    svg.appendChild(
      el('text', { x: PAD.left, y: py(t) - 3, class: 'chart-tick' }, [format(t)]),
    );
  }

  const coords = data.map((p) => [px(D.toDays(p.x)), py(p.y)]);
  const path = coords.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const area =
    `${path} L${coords[coords.length - 1][0].toFixed(1)} ${H - PAD.bottom}` +
    ` L${coords[0][0].toFixed(1)} ${H - PAD.bottom} Z`;

  const gradId = `g${Math.random().toString(36).slice(2, 8)}`;
  svg.appendChild(
    el('defs', {}, [
      el('linearGradient', { id: gradId, x1: '0', y1: '0', x2: '0', y2: '1' }, [
        el('stop', { offset: '0%', 'stop-color': 'var(--accent-mark)', 'stop-opacity': '0.22' }),
        el('stop', { offset: '100%', 'stop-color': 'var(--accent-mark)', 'stop-opacity': '0' }),
      ]),
    ]),
  );
  svg.appendChild(el('path', { d: area, fill: `url(#${gradId})` }));
  svg.appendChild(el('path', { d: path, class: 'chart-line' }));

  // Конечная точка помечена всегда: это «где мы сейчас».
  const last = coords[coords.length - 1];
  svg.appendChild(el('circle', { cx: last[0], cy: last[1], r: 3, class: 'chart-end' }));

  const cursor = el('g', { class: 'chart-cursor', opacity: '0' }, [
    el('line', { y1: PAD.top, y2: H - PAD.bottom, class: 'chart-cursor-line' }),
    el('circle', { r: 4, class: 'chart-cursor-dot' }),
  ]);
  svg.appendChild(cursor);

  const wrap = div('chart-wrap');
  wrap.appendChild(svg);

  const readout = div('chart-readout');
  const setReadout = (point, dimmed) => {
    readout.classList.toggle('is-dim', Boolean(dimmed));
    readout.textContent = `${F.date(point.x)} · ${format(point.y)}`;
  };
  setReadout(data[data.length - 1], true);
  wrap.appendChild(readout);

  const axis = div('chart-axis');
  axis.appendChild(div('', F.dateShort(data[0].x)));
  axis.appendChild(div('', F.dateShort(data[data.length - 1].x)));
  wrap.appendChild(axis);

  attachCursor(svg, wrap, coords, data, cursor, setReadout);

  return figure(wrap, data, label, format);
}

/**
 * Чтение значения в точке.
 *
 * Основной способ — тап: он однозначен и не спорит с прокруткой. Протяжка
 * тоже работает, но полагаться на неё нельзя: пока браузер решает, не начало
 * ли это вертикальной прокрутки, он придерживает указатель и может его
 * отменить — палец лежит на графике, а показание не появляется.
 *
 * Поэтому touch-action остаётся pan-y (страница продолжает прокручиваться
 * пальцем поверх графика), а значение снимается по нажатию.
 */
function attachCursor(svg, wrap, coords, data, cursor, setReadout) {
  const cursorLine = cursor.querySelector('.chart-cursor-line');
  const cursorDot = cursor.querySelector('.chart-cursor-dot');

  const move = (event) => {
    const box = svg.getBoundingClientRect();
    if (!box.width) return;
    const x = ((event.clientX - box.left) / box.width) * W;

    let best = 0;
    let bestGap = Infinity;
    coords.forEach(([cx], i) => {
      const gap = Math.abs(cx - x);
      if (gap < bestGap) {
        bestGap = gap;
        best = i;
      }
    });

    const [cx, cy] = coords[best];
    cursorLine.setAttribute('x1', cx);
    cursorLine.setAttribute('x2', cx);
    cursorDot.setAttribute('cx', cx);
    cursorDot.setAttribute('cy', cy);
    cursor.setAttribute('opacity', '1');
    setReadout(data[best], false);
    wrap.classList.add('is-probing');
  };

  let dragging = false;
  // После касания браузер досылает синтетические события мыши — включая
  // уход указателя. Без этого флага курсор гас бы сразу после тапа.
  let touchDriven = false;

  const reset = () => {
    dragging = false;
    cursor.setAttribute('opacity', '0');
    setReadout(data[data.length - 1], true);
    wrap.classList.remove('is-probing');
  };

  // Тап — основной путь: он однозначен и переживает отмену указателя.
  svg.addEventListener('click', move);

  // Протяжка — дополнение сверх тапа, на событиях касания напрямую:
  // указательные события браузер придерживает, решая, не прокрутка ли это.
  svg.addEventListener('touchstart', (e) => {
    touchDriven = true;
    dragging = true;
    move(e.touches[0]);
  }, { passive: true });

  svg.addEventListener('touchmove', (e) => {
    if (dragging) move(e.touches[0]);
  }, { passive: true });

  svg.addEventListener('touchend', () => { dragging = false; }, { passive: true });

  // Мышь: наведение показывает значение без нажатия.
  svg.addEventListener('mousemove', (e) => { if (!touchDriven) move(e); });
  svg.addEventListener('mouseleave', () => { if (!touchDriven) reset(); });
}

/**
 * Обёртка с переключателем на таблицу.
 * Касание — усиление, а не единственный способ узнать число: тем же данным
 * всегда есть текстовый двойник.
 */
function figure(chart, data, label, format) {
  const fig = document.createElement('figure');
  fig.className = 'figure';

  const table = div('figure-table');
  table.hidden = true;
  const rows = [...data].reverse();
  table.innerHTML =
    '<table><thead><tr><th>Дата</th><th>' +
    escape(label) +
    '</th></tr></thead><tbody>' +
    rows.map((p) => `<tr><td>${escape(F.date(p.x))}</td><td>${escape(format(p.y))}</td></tr>`).join('') +
    '</tbody></table>';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'figure-toggle';
  toggle.textContent = 'Таблица';
  toggle.addEventListener('click', () => {
    const showTable = table.hidden;
    table.hidden = !showTable;
    chart.hidden = showTable;
    toggle.textContent = showTable ? 'График' : 'Таблица';
  });

  fig.appendChild(chart);
  fig.appendChild(table);
  fig.appendChild(toggle);
  return fig;
}

// --------------------------------------------------------------------------
// Доли портфеля
// --------------------------------------------------------------------------

/**
 * Горизонтальные полосы: фактическая доля против целевой.
 * Один ряд — один цвет: раскрашивать классы в разные оттенки значило бы
 * повторить цветом то, что уже сказано длиной полосы.
 */
export function allocation(rows, onEdit) {
  if (!rows.length) return empty('Классы не заданы');
  const wrap = div('alloc');

  for (const row of rows) {
    const editable = onEdit && !row.unmapped;
    const item = document.createElement(editable ? 'button' : 'div');
    item.className = 'alloc-row';
    if (editable) {
      item.type = 'button';
      item.addEventListener('click', () => onEdit(row));
    }

    const head = div('alloc-head');
    head.appendChild(div('alloc-name', row.class));
    head.appendChild(div('alloc-value', F.money(row.value)));
    item.appendChild(head);

    const track = div('alloc-track');
    const fill = div('alloc-fill');
    // Минимальная ширина: доля 0,02 % иначе исчезает совсем, и класс
    // выглядит отсутствующим, а не крошечным.
    fill.style.width = `${Math.max(row.value > 0 ? 1.5 : 0, Math.min(100, row.share || 0))}%`;
    track.appendChild(fill);

    if (row.targetShare != null) {
      const mark = div('alloc-target');
      mark.style.left = `${Math.min(100, row.targetShare)}%`;
      track.appendChild(mark);
    }
    item.appendChild(track);

    const foot = div('alloc-foot');
    // Без цели ярлык и подпись сказали бы одно и то же дважды —
    // оставляем только долю.
    foot.appendChild(
      div('', row.targetShare == null
        ? F.percent(row.share, 2)
        : `${F.percent(row.share, 2)} из ${F.percent(row.targetShare, 0)}`),
    );
    foot.appendChild(div(`tag tag-${actionClass(row.action)}`, row.action));
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

// --------------------------------------------------------------------------
// Календарь дисциплины
// --------------------------------------------------------------------------

/**
 * Точка на каждый день месяца. Пустая клетка — пропущенный день,
 * это и есть весь чек-лист, никаких галочек не нужно.
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

  const wrap = div('ritual');
  const todayD = D.parts(day).d;

  for (let d = 1; d <= total; d += 1) {
    const done = filled.has(d);
    const future = d > todayD;
    const cell = div(`ritual-cell${done ? ' is-done' : ''}${future ? ' is-future' : ''}`, String(d));
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

// --------------------------------------------------------------------------

export function progress(value, options = {}) {
  const { over = false } = options;
  const track = div(`bar${over ? ' is-over' : ''}`);
  const fill = div('bar-fill');
  fill.style.width = `${Math.max(0, Math.min(100, (value || 0) * 100))}%`;
  track.appendChild(fill);
  return track;
}

function escape(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
  );
}

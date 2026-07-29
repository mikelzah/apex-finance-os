// Таблица данных. Сортировка по колонкам, закреплённая шапка, итоги
// в подвале, прокрутка внутри карточки.
//
// Прокрутка живёт в обёртке, а не на странице: широкая таблица иначе
// утаскивает вбок весь экран, и вертикальный жест начинает промахиваться.

const NS = 'http://www.w3.org/2000/svg';

/**
 * @param {object} spec
 * @param {Array}  spec.rows     данные
 * @param {Array}  spec.columns  [{ key, title, align, value, render, total, sort }]
 * @param {string} spec.sortKey  колонка сортировки по умолчанию
 * @param {string} spec.dir      'asc' | 'desc'
 * @param {Function} spec.onRow  что делать по нажатию на строку
 * @param {string} spec.empty    текст, когда данных нет
 */
export function table(spec) {
  const { rows, columns, onRow, empty = 'Данных нет' } = spec;
  let sortKey = spec.sortKey || columns[0].key;
  let dir = spec.dir || 'desc';

  const scroll = document.createElement('div');
  scroll.className = 'dt-scroll';

  if (!rows.length) {
    const box = document.createElement('p');
    box.className = 'empty';
    box.textContent = empty;
    return box;
  }

  const el = document.createElement('table');
  el.className = 'dt';
  const thead = document.createElement('thead');
  const tbody = document.createElement('tbody');
  el.appendChild(thead);
  el.appendChild(tbody);
  scroll.appendChild(el);

  const hasTotals = columns.some((c) => c.total);
  const tfoot = hasTotals ? document.createElement('tfoot') : null;
  if (tfoot) el.appendChild(tfoot);

  const drawHead = () => {
    thead.replaceChildren();
    const tr = document.createElement('tr');
    for (const col of columns) {
      const th = document.createElement('th');
      if (col.align === 'right') th.className = 'is-num';

      if (col.sort === false) {
        th.textContent = col.title;
      } else {
        const state = col.key === sortKey ? (dir === 'asc' ? 'ascending' : 'descending') : 'none';
        th.setAttribute('aria-sort', state);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'dt-sort';
        button.setAttribute('aria-sort', state);
        button.append(col.title, arrow(dir === 'asc'));
        button.addEventListener('click', () => {
          // Повторное нажатие по той же колонке переворачивает порядок,
          // по новой — начинает с убывания: чаще всего нужно «сначала большие».
          if (col.key === sortKey) dir = dir === 'asc' ? 'desc' : 'asc';
          else { sortKey = col.key; dir = 'desc'; }
          drawHead();
          drawBody();
        });
        th.appendChild(button);
      }
      tr.appendChild(th);
    }
    thead.appendChild(tr);
  };

  const drawBody = () => {
    const col = columns.find((c) => c.key === sortKey) || columns[0];
    const sorted = [...rows].sort((a, b) => compare(col.value(a), col.value(b)) * (dir === 'asc' ? 1 : -1));

    tbody.replaceChildren();
    for (const row of sorted) {
      const tr = document.createElement('tr');
      if (onRow) {
        tr.className = 'is-clickable';
        tr.tabIndex = 0;
        tr.addEventListener('click', () => onRow(row));
        tr.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRow(row); }
        });
      }
      for (const c of columns) {
        const td = document.createElement('td');
        if (c.align === 'right') td.className = 'is-num';
        const cell = c.render ? c.render(row) : String(c.value(row) ?? '');
        if (cell instanceof Node) td.appendChild(cell);
        else td.textContent = cell;
        if (c.cellClass) td.classList.add(...[].concat(c.cellClass(row) || []));
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }

    if (tfoot) {
      tfoot.replaceChildren();
      const tr = document.createElement('tr');
      for (const c of columns) {
        const td = document.createElement('td');
        if (c.align === 'right') td.className = 'is-num';
        td.textContent = c.total ? c.total(rows) : '';
        tr.appendChild(td);
      }
      tfoot.appendChild(tr);
    }
  };

  drawHead();
  drawBody();
  markOverflow(scroll);
  return scroll;
}

/**
 * Подсказка, что таблица шире экрана.
 *
 * Обрезанная у края колонка сама по себе не читается как «здесь есть ещё» —
 * её принимают за брак вёрстки. Затухание у правого края появляется только
 * когда прокручивать действительно есть куда, и гаснет в конце.
 */
function markOverflow(scroll) {
  const update = () => {
    const overflows = scroll.scrollWidth - scroll.clientWidth > 2;
    const atEnd = scroll.scrollLeft + scroll.clientWidth >= scroll.scrollWidth - 2;
    scroll.classList.toggle('is-overflowing', overflows && !atEnd);
    scroll.classList.toggle('is-scrolled', scroll.scrollLeft > 2);
  };
  scroll.addEventListener('scroll', update, { passive: true });
  // Ширина известна только после вставки в документ.
  requestAnimationFrame(update);
  if ('ResizeObserver' in window) new ResizeObserver(update).observe(scroll);
}

/** Числа сравниваются числами, строки — по-русски, пустые уезжают вниз. */
function compare(a, b) {
  const aEmpty = a == null || a === '';
  const bEmpty = b == null || b === '';
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return -1;
  if (bEmpty) return 1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'ru');
}

function arrow(up) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 8 8');
  svg.setAttribute('class', 'dt-arrow');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', up ? 'M1 5.2 4 2.2l3 3' : 'M1 2.8 4 5.8l3-3');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.4');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(path);
  return svg;
}

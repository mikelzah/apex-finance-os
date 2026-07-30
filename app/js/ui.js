// Мелочи интерфейса: создание узлов, шторки, всплывающие сообщения.
// Никакого фреймворка — экранов девять, состояние одно, перерисовка целиком
// занимает меньше миллисекунды. Виртуальный DOM здесь решал бы
// несуществующую проблему.

export function h(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }
  append(node, children);
  return node;
}

export function append(parent, children) {
  for (const child of [].concat(children)) {
    if (child == null || child === false) continue;
    parent.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)));
  }
  return parent;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

// --------------------------------------------------------------------------
// Блоки
// --------------------------------------------------------------------------

export function card(children, attrs = {}) {
  return h('section', { ...attrs, class: `card ${attrs.class || ''}`.trim() }, children);
}

export function sectionTitle(text, action) {
  return h('div', { class: 'section-title' }, [h('h2', { text }), action]);
}

export function stat(label, value, options = {}) {
  return h('div', { class: `stat ${options.class || ''}`.trim() }, [
    h('div', { class: 'stat-label', text: label }),
    h('div', { class: `stat-value ${options.big ? 'is-big' : ''}`.trim(), text: value }),
    options.hint ? h('div', { class: 'stat-hint', text: options.hint }) : null,
  ]);
}

export function row(label, value, options = {}) {
  return h('div', { class: `row ${options.class || ''}`.trim(), onclick: options.onClick }, [
    h('div', { class: 'row-label' }, [
      h('span', { text: label }),
      options.sub ? h('small', { text: options.sub }) : null,
    ]),
    h('div', { class: 'row-value' }, [
      h('span', { text: value }),
      options.tag ? h('span', { class: `tag tag-${options.tagClass || 'muted'}`, text: options.tag }) : null,
    ]),
    options.onClick ? h('span', { class: 'row-chevron', text: '›' }) : null,
  ]);
}

export function callout(text, kind = 'info') {
  return h('p', { class: `callout callout-${kind}`, text });
}

export function button(text, onClick, options = {}) {
  return h(
    'button',
    {
      class: `btn btn-${options.kind || 'ghost'} ${options.class || ''}`.trim(),
      type: options.type || 'button',
      onclick: onClick,
      disabled: options.disabled,
    },
    [text],
  );
}

export function emptyState(text) {
  return h('p', { class: 'empty', text });
}

// --------------------------------------------------------------------------
// Поля формы
// --------------------------------------------------------------------------

/**
 * Сворачиваемая группа полей.
 *
 * Форма актива описывает и вклад, и биржевую бумагу, и квартиру — у каждого
 * своя половина полей. Показывать вкладу «Режим торгов», а акции «День
 * капитализации» значит топить нужное в ненужном. Группа раскрыта, если
 * в ней уже что-то заполнено.
 */
export function group(title, open, children) {
  return h('details', { class: 'group', open: open || null }, [
    h('summary', { class: 'group-summary' }, [
      h('span', { text: title }),
      h('span', { class: 'group-chevron', text: '⌄' }),
    ]),
    h('div', { class: 'group-body' }, children),
  ]);
}

export function field(label, input, hint) {
  return h('label', { class: 'field' }, [
    h('span', { class: 'field-label', text: label }),
    input,
    hint ? h('small', { class: 'field-hint', text: hint }) : null,
  ]);
}

export function input(attrs = {}) {
  return h('input', { class: 'control', ...attrs });
}

export function numberInput(value, attrs = {}) {
  return input({
    type: 'text',
    inputmode: 'decimal',
    // Русская раскладка на телефоне охотно ставит запятую — принимаем обе.
    value: value == null ? '' : String(value).replace('.', ','),
    ...attrs,
  });
}

export function select(options, value, attrs = {}) {
  return h(
    'select',
    { class: 'control', ...attrs },
    options.map((o) => {
      const item = typeof o === 'string' ? { value: o, label: o } : o;
      return h('option', { value: item.value, selected: item.value === value }, [item.label]);
    }),
  );
}

export function checkbox(label, checked, attrs = {}) {
  const box = h('input', { type: 'checkbox', checked: checked || false, ...attrs });
  return { node: h('label', { class: 'check' }, [box, h('span', { text: label })]), box };
}

export function textarea(value, attrs = {}) {
  return h('textarea', { class: 'control control-area', rows: 4, ...attrs }, [value || '']);
}

/** «1 250,50» и «1250.5» одинаково превращаются в число. Пусто — null. */
export function parseNumber(raw) {
  if (raw == null) return null;
  const text = String(raw).replace(/\s| /g, '').replace(',', '.');
  if (!text) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

// --------------------------------------------------------------------------
// Шторка
// --------------------------------------------------------------------------

let sheetHost = null;

export function sheet(title, build, options = {}) {
  // Прежнюю шторку убираем мгновенно: если дать ей уехать с анимацией,
  // она на четверть секунды наложится на новую.
  close(true);

  const body = h('div', { class: 'sheet-body' });
  const backdrop = h('div', { class: 'sheet-backdrop', onclick: () => close() });
  const panel = h('div', { class: 'sheet-panel', role: 'dialog', 'aria-modal': 'true' }, [
    h('div', { class: 'sheet-grip' }),
    h('header', { class: 'sheet-head' }, [
      h('h2', { text: title }),
      h('button', { class: 'sheet-close', type: 'button', 'aria-label': 'Закрыть', onclick: () => close() }, ['✕']),
    ]),
    body,
  ]);

  sheetHost = h('div', { class: 'sheet' }, [backdrop, panel]);
  document.body.appendChild(sheetHost);
  document.body.classList.add('is-locked');
  attachSwipeToClose(panel, body, backdrop);

  const api = {
    close,
    setFooter(children) {
      const existing = panel.querySelector('.sheet-foot');
      if (existing) existing.remove();
      panel.appendChild(h('div', { class: 'sheet-foot' }, children));
    },
  };
  append(body, build(api));

  if (options.focus !== false) {
    const first = body.querySelector('input, select, textarea');
    // Автофокус на iOS немедленно выкидывает клавиатуру и перекрывает форму —
    // фокусируем только текстовые поля, где ввод и правда первый шаг.
    if (first && first.dataset.autofocus === 'yes') setTimeout(() => first.focus(), 120);
  }
  return api;
}

/**
 * Закрытие шторки.
 *
 * @param {number|boolean} from  смещение в пикселях, с которого уезжать
 *                               (когда закрывают протяжкой), либо true —
 *                               убрать мгновенно, без анимации.
 */
export function close(from = 0) {
  if (!sheetHost) return;
  const host = sheetHost;
  sheetHost = null;
  document.body.classList.remove('is-locked');

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (from === true || reduced) {
    host.remove();
    return;
  }

  const panel = host.querySelector('.sheet-panel');
  const backdrop = host.querySelector('.sheet-backdrop');
  // Панель уезжает вниз, а не исчезает: мгновенное removeChild после
  // протяжки выглядит как обрыв — палец ещё движется, а окна уже нет.
  host.style.pointerEvents = 'none';
  panel.style.animation = 'none';
  panel.style.transform = `translateY(${Number(from) || 0}px)`;
  panel.style.transition = 'transform var(--dur-base) var(--ease-out)';
  backdrop.style.transition = 'opacity var(--dur-base) var(--ease-out)';

  // Смена transform в том же кадре, где включён transition, не даёт
  // анимации: браузер склеивает оба присваивания в одно состояние.
  requestAnimationFrame(() => {
    panel.style.transform = 'translateY(100%)';
    backdrop.style.opacity = '0';
  });
  setTimeout(() => host.remove(), 260);
}

/**
 * Закрытие протяжкой вниз.
 *
 * За грип и шапку тянем всегда. За тело — только когда оно прокручено
 * вверх: иначе жест отбирал бы прокрутку у длинной формы. Кнопки и поля
 * ввода перетаскивание не начинают, чтобы нажатие оставалось нажатием.
 */
function attachSwipeToClose(panel, body, backdrop) {
  const CONTROLS = 'button, input, select, textarea, a, summary';
  let dragging = false;
  let startY = 0;
  let dy = 0;
  let startedAt = 0;

  const canStart = (target) => {
    if (target.closest && target.closest(CONTROLS)) return false;
    if (body.contains(target)) return body.scrollTop <= 0;
    return true;
  };

  panel.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1 || !canStart(e.target)) return;
    dragging = true;
    startY = e.touches[0].clientY;
    dy = 0;
    startedAt = Date.now();
    panel.style.animation = 'none';
    panel.style.transition = 'none';
    backdrop.style.transition = 'none';
  }, { passive: true });

  panel.addEventListener('touchmove', (e) => {
    if (!dragging) return;
    const delta = e.touches[0].clientY - startY;
    if (delta <= 0) {
      // Тянут вверх — шторка уже наверху, двигать нечего.
      dy = 0;
      panel.style.transform = '';
      backdrop.style.opacity = '';
      return;
    }
    dy = delta;
    // Без этого iOS начинает тянуть страницу под шторкой.
    e.preventDefault();
    panel.style.transform = `translateY(${dy}px)`;
    backdrop.style.opacity = String(Math.max(0, 1 - dy / (panel.offsetHeight || 1)));
  }, { passive: false });

  const release = () => {
    if (!dragging) return;
    dragging = false;

    const height = panel.offsetHeight || 1;
    const speed = dy / Math.max(1, Date.now() - startedAt);
    // Либо утащили заметно, либо смахнули быстро — короткий резкий жест
    // читается как «закрой», даже если палец прошёл немного.
    if (dy > height * 0.28 || (dy > 56 && speed > 0.5)) {
      close(dy);
      return;
    }

    panel.style.transition = 'transform var(--dur-base) var(--ease-panel)';
    backdrop.style.transition = 'opacity var(--dur-base) var(--ease-out)';
    panel.style.transform = '';
    backdrop.style.opacity = '';
  };

  panel.addEventListener('touchend', release, { passive: true });
  panel.addEventListener('touchcancel', release, { passive: true });
}

// --------------------------------------------------------------------------
// Сообщения и подтверждения
// --------------------------------------------------------------------------

let toastTimer = null;

export function toast(text, kind = 'ok') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const node = h('div', { class: `toast toast-${kind}`, text });
  document.body.appendChild(node);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.remove(), 3200);
}

export function confirmSheet(title, message, confirmLabel, onConfirm, kind = 'danger') {
  sheet(title, (api) => {
    api.setFooter([
      button('Отмена', () => api.close()),
      button(confirmLabel, async () => {
        api.close();
        await onConfirm();
      }, { kind }),
    ]);
    return [h('p', { class: 'sheet-text', text: message })];
  }, { focus: false });
}

/** Тактильный отклик там, где он уместен. На iOS не работает — и ладно. */
export function tap() {
  if (navigator.vibrate) navigator.vibrate(8);
}

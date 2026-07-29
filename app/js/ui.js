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
  close();

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

export function close() {
  if (sheetHost) {
    sheetHost.remove();
    sheetHost = null;
    document.body.classList.remove('is-locked');
  }
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

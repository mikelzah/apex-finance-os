// Мелочи интерфейса: создание узлов, шторки, всплывающие сообщения.
// Никакого фреймворка — экранов девять, состояние одно, перерисовка целиком
// занимает меньше миллисекунды. Виртуальный DOM здесь решал бы
// несуществующую проблему.

/**
 * Оболочка приложения. Всё наложенное — шторки, сообщения, зверь — живёт
 * внутри неё, а не в body: оболочка ровно в экран, и от неё считаются
 * absolute-привязки. В body они считались бы от вьюпорта, который на этом
 * устройстве бывает меньше экрана.
 */
export function shell() {
  return document.getElementById('app') || document.body;
}

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

/**
 * Шапка экрана раздела: крупный заголовок слева, круглое действие справа.
 *
 * Заголовок здесь обязателен, и обоснование «экран назван вкладкой внизу»
 * не работает: подпись вкладки набрана десятым кеглем в самом низу, читается
 * последней и отвечает на вопрос «куда я могу пойти», а не «где я сейчас».
 * Экран без заголовка начинается с содержимого, и первая же карточка
 * прочитывается как заголовок — а это не она.
 *
 * У экранов с вложенными страницами шапка своя, настоящая (header в оболочке),
 * и эта её не заменяет: та про «вернуться назад», эта про «вы здесь».
 */
export function screenHead(title, action = null) {
  return h('div', { class: 'screen-head' }, [
    h('h1', { class: 'screen-title', text: title }),
    action,
  ]);
}

/**
 * Круглое действие в шапке экрана.
 *
 * Круг, а не пилюля с подписью. Пилюля во всю подпись — «Добавить бумагу» —
 * весит на экране столько же, сколько заголовок, и спорит с ним за первый
 * взгляд; а подпись ей нужна только потому, что она широкая. Круг с плюсом
 * узнаётся без слов и оставляет заголовку весь его вес. Слово никуда не делось:
 * оно в aria-label и в заголовке шторки, которая по нажатию и открывается.
 */
export function roundAction(label, icon, onClick) {
  return h('button', {
    class: 'head-round',
    type: 'button',
    'aria-label': label,
    title: label,
    onclick: onClick,
  }, [icon]);
}

export function stat(label, value, options = {}) {
  return h('div', { class: `stat ${options.class || ''}`.trim() }, [
    h('div', { class: 'stat-label', text: label }),
    h('div', { class: `stat-value ${options.big ? 'is-big' : ''}`.trim(), text: value }),
    options.hint ? h('div', { class: 'stat-hint', text: options.hint }) : null,
  ]);
}

export function row(label, value, options = {}) {
  // Нажимаемость помечается классом, а не выводится из наличия обработчика:
  // обработчик вешается через addEventListener, и в разметке от него
  // не остаётся следа, по которому CSS мог бы отличить одно от другого.
  const clickable = options.onClick ? 'is-clickable' : '';
  return h('div', { class: `row ${clickable} ${options.class || ''}`.trim(), onclick: options.onClick }, [
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

/**
 * Строка с переключателем.
 *
 * Отличается от обычной строки не украшением, а обещанием: строка со
 * значением и шевроном ведёт дальше, строка с переключателем меняется
 * на месте. По виду должно быть понятно, что произойдёт, до нажатия,
 * а не после.
 */
export function switchRow(label, on, options = {}) {
  const knob = h('i', {});
  const sw = h('span', { class: `switch ${on ? 'is-on' : ''}`.trim() }, [knob]);
  return h('button', {
    class: 'row row-switch',
    type: 'button',
    role: 'switch',
    'aria-checked': String(Boolean(on)),
    onclick: options.onChange,
  }, [
    h('div', { class: 'row-label' }, [
      h('span', { text: label }),
      options.sub ? h('small', { text: options.sub }) : null,
    ]),
    sw,
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

/**
 * Пустое состояние.
 *
 * Серая надпись посреди белого поля сообщает «здесь ничего нет» и на этом
 * заканчивается. Зверёк рядом с той же надписью сообщает то же самое, но
 * экран перестаёт выглядеть сломанным — а именно так пустой экран и читается,
 * пока не привыкнешь.
 *
 * Зверёк рисуется лениво: ui.js не может импортировать mascot.js напрямую,
 * потому что mascot.js импортирует shell отсюда — вышел бы круг.
 */
let drawMascot = null;

export function useMascot(fn) {
  drawMascot = fn;
}

export function emptyState(text, options = {}) {
  const quiet = options.quiet || !drawMascot;
  return h('div', { class: `empty-box ${quiet ? 'is-quiet' : ''}`.trim() }, [
    quiet ? null : drawMascot('empty-mascot'),
    h('p', { class: 'empty', text }),
  ]);
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

/**
 * Строка поиска.
 *
 * data-keep-focus обязателен: экран собирается заново на каждое нажатие
 * клавиши, и без этого признака фокус слетал бы после первой же буквы,
 * а искать пришлось бы по одному символу за раз.
 */
export function search(value, onInput, options = {}) {
  return h('div', { class: 'search' }, [
    h('input', {
      class: 'control search-input',
      type: 'search',
      // inputmode search даёт на iOS клавишу «Найти» вместо перевода строки.
      inputmode: 'search',
      enterkeyhint: 'search',
      autocomplete: 'off',
      placeholder: options.placeholder || 'Поиск',
      value: value || '',
      'data-keep-focus': options.key || 'search',
      oninput: (e) => onInput(e.target.value),
    }),
    value ? h('button', {
      class: 'search-clear',
      type: 'button',
      'aria-label': 'Очистить',
      onclick: () => onInput(''),
    }, ['✕']) : null,
  ]);
}

/**
 * Подходит ли запись под запрос.
 *
 * Слова ищутся по отдельности и в любом порядке: «лавка 738» должно находить
 * запись «Яндекс Лавка» на 738 ₽, хотя такой строки целиком нигде нет.
 */
export function matches(query, ...parts) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = parts.filter((x) => x != null).join(' ').toLowerCase();
  return words.every((w) => hay.includes(w));
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
  shell().appendChild(sheetHost);
  document.body.classList.add('is-locked');
  attachSwipeToClose(panel, body, backdrop);

  // Клавиатура поднимает всю шторку (--keyboard-inset), но панель при этом
  // становится ниже, и поле может остаться за краем её собственной прокрутки.
  // Задержка — под анимацию клавиатуры: сразу после focusin высота ещё старая.
  body.addEventListener('focusin', (e) => {
    const field = e.target;
    if (!field || !field.scrollIntoView) return;
    setTimeout(() => field.scrollIntoView({ block: 'nearest' }), 350);
  });

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
  shell().appendChild(node);
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

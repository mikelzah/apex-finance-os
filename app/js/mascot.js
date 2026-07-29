// Маленький зверь, висящий на Dynamic Island.
//
// Почему висит, а не сидит. Dynamic Island — вырез в матрице: пикселей там
// физически нет, и поверх этой области система рисует своё. Всё, что
// приложение нарисует выше safe-area-inset-top, окажется под чёрной
// пилюлей и просто не будет видно. Поэтому зверь ухватился за нижний край
// острова и свесился: руки уходят в невидимую зону — и именно это создаёт
// впечатление, что он за неё держится.
//
// На устройствах без острова safe-area-inset-top меньше или равен нулю,
// и зверь просто висит у верхней кромки экрана. Тоже читается.
//
// Персонаж придуман для этого приложения. Похожие жёлтые существа
// в комбинезонах — чужая собственность, и копировать их облик незачем.

const NS = 'http://www.w3.org/2000/svg';
const KEY = 'apex-finance-os:mascot';

let node = null;

export function enabled() {
  return localStorage.getItem(KEY) !== 'off';
}

export function setEnabled(on) {
  if (on) localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, 'off');
  apply();
}

export function apply() {
  if (enabled()) mount();
  else unmount();
}

function mount() {
  if (node) return;
  node = draw();
  document.body.appendChild(node);
  document.body.classList.add('has-mascot');
  scheduleBlink();
}

function unmount() {
  if (!node) return;
  node.remove();
  node = null;
  document.body.classList.remove('has-mascot');
}

/** Короткая радость: зверь подпрыгивает, когда записан взнос. */
export function celebrate() {
  if (!node) return;
  node.classList.remove('is-happy');
  // Перезапуск анимации без reflow не срабатывает — браузер склеивает
  // снятие и возврат класса в один кадр.
  void node.offsetWidth;
  node.classList.add('is-happy');
  setTimeout(() => node && node.classList.remove('is-happy'), 900);
}

let blinkTimer = null;

function scheduleBlink() {
  clearTimeout(blinkTimer);
  if (!node) return;
  // Неровный ритм: моргание по таймеру с одинаковым шагом выглядит
  // механическим, а не живым.
  const delay = 2600 + Math.random() * 4200;
  blinkTimer = setTimeout(() => {
    if (!node) return;
    node.classList.add('is-blinking');
    setTimeout(() => node && node.classList.remove('is-blinking'), 160);
    scheduleBlink();
  }, delay);
}

function el(name, attrs = {}, children = []) {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, String(v));
  for (const c of [].concat(children)) if (c) n.appendChild(c);
  return n;
}

function draw() {
  const wrap = document.createElement('div');
  wrap.className = 'mascot';
  wrap.setAttribute('aria-hidden', 'true');

  const svg = el('svg', { viewBox: '0 0 40 48', class: 'mascot-svg' });

  // Руки уходят вверх за границу видимой области — там, где остров.
  svg.appendChild(el('path', {
    d: 'M13.5 15 C12 10 12.5 5 13 -2',
    class: 'mascot-limb',
  }));
  svg.appendChild(el('path', {
    d: 'M26.5 15 C28 10 27.5 5 27 -2',
    class: 'mascot-limb',
  }));

  // Ноги качаются: одна группа, чтобы движение было общим.
  const legs = el('g', { class: 'mascot-legs' }, [
    el('path', { d: 'M16 33 C15.5 38 15 41 14.5 44', class: 'mascot-limb' }),
    el('path', { d: 'M24 33 C24.5 38 25 41 25.5 44', class: 'mascot-limb' }),
    el('circle', { cx: 14, cy: 45, r: 2.4, class: 'mascot-foot' }),
    el('circle', { cx: 26, cy: 45, r: 2.4, class: 'mascot-foot' }),
  ]);
  svg.appendChild(legs);

  svg.appendChild(el('ellipse', { cx: 20, cy: 24, rx: 11, ry: 11.5, class: 'mascot-body' }));

  const eyes = el('g', { class: 'mascot-eyes' }, [
    el('circle', { cx: 16, cy: 22.5, r: 3.4, class: 'mascot-eye' }),
    el('circle', { cx: 24, cy: 22.5, r: 3.4, class: 'mascot-eye' }),
    el('circle', { cx: 16.6, cy: 23, r: 1.7, class: 'mascot-pupil' }),
    el('circle', { cx: 24.6, cy: 23, r: 1.7, class: 'mascot-pupil' }),
  ]);
  svg.appendChild(eyes);

  // Улыбка появляется только в момент радости.
  svg.appendChild(el('path', { d: 'M16.5 28.5 Q20 31 23.5 28.5', class: 'mascot-smile' }));

  wrap.appendChild(svg);
  return wrap;
}

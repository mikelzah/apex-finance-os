// Насколько низ вьюпорта выше низа экрана — и поправка на эту разницу.
//
// Замерено по снимкам с iPhone 17 Pro Max (экран 440×956 CSS):
//
//   главная, страница прокручивается   — вьюпорт 956, таб-бар 864–956
//   журнал, страница влезает целиком   — вьюпорт 893, таб-бар 803–893
//
// То есть iOS отдаёт разную высоту вьюпорта одному и тому же приложению.
// Там, где она меньше экрана, панель с bottom: 0 заканчивается выше края,
// и под ней остаётся полоса, куда закреплённый слой не достаёт.
//
// Основное лечение — в CSS: страница всегда выше вьюпорта, поэтому прокрутка
// есть везде и высота вьюпорта одна. Этот модуль — вторая страховка на случай,
// если дело не в прокрутке.
//
// Главное здесь — когда считать. В прошлый раз я посчитал поправку один раз
// на старте, на коротком экране-заглушке: там вьюпорт короткий, поправка вышла
// 63, и дальше применялась к экранам, где вьюпорт был уже полным. Панель ушла
// на 63 пикселя за край. Поэтому теперь замер живёт рядом с отрисовкой:
// пересчитывается после каждой, и значение всегда относится к тому экрану,
// который показан сейчас.

// Больше любой правдоподобной разницы. Если замер однажды соврёт, панель
// уедет за край и приложением станет невозможно пользоваться — лучше
// оставить как есть.
const LIMIT = 160;

const seen = new Map();

export function standalone() {
  if (navigator.standalone === true) return true;
  return Boolean(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
}

export function measure() {
  const inner = window.innerHeight || 0;
  const vv = window.visualViewport;
  const doc = document.documentElement;
  const visual = vv ? Math.round(vv.height) : inner;
  const screenH = (window.screen && window.screen.height) || 0;
  const isStandalone = standalone();
  const portrait = window.innerWidth <= inner;

  // Настоящей высотой вьюпорта считаем высоту экрана — но только в отдельном
  // окне и только в портрете. В Safari с панелями браузера сверху и снизу это
  // неверно, и панель уехала бы под них. visualViewport для этого не годится:
  // при открытой клавиатуре iOS ужимает именно его.
  const full = isStandalone && portrait && screenH > inner ? screenH : inner;
  const raw = Math.round(full - inner);

  return {
    inner,
    visual,
    screenH,
    scrollHeight: doc.scrollHeight,
    scrollable: doc.scrollHeight > inner,
    standalone: isStandalone,
    gap: raw > 0 && raw <= LIMIT ? raw : 0,
  };
}

function put(gap) {
  document.documentElement.style.setProperty('--viewport-gap', `${gap}px`);
}

/**
 * Замерить показанный экран и поправить нижние панели.
 *
 * Вызывается после отрисовки: до неё высота документа ещё от прошлого экрана,
 * а именно от неё и зависит, какой вьюпорт отдаст iOS.
 */
export function note(key) {
  const m = measure();
  seen.set(key, m);
  put(m.gap);
}

export function records() {
  return [...seen.entries()];
}

export function watch() {
  const again = () => put(measure().gap);
  window.addEventListener('resize', again);
  // На поворот iOS отвечает не сразу: размеры на момент события ещё старые.
  window.addEventListener('orientationchange', () => setTimeout(again, 250));
}

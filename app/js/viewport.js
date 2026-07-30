// Замеры вьюпорта. Только чтение: ничего не двигает и ни на что не влияет.
//
// Нужны потому, что iOS отдаёт разную высоту вьюпорта одному и тому же
// приложению. Замерено по снимкам с iPhone 17 Pro Max (экран 440×956 CSS):
//
//   главная, страница прокручивается   — вьюпорт 956, таб-бар 864–956
//   журнал, страница влезает целиком   — вьюпорт 893, таб-бар 803–893
//
// В первом случае панель стоит вплотную к краю экрана, во втором под ней
// остаётся полоса в 63 пикселя, куда закреплённый слой не достаёт. Лечится
// это в CSS: страница всегда чуть выше вьюпорта, поэтому прокрутка есть
// везде и высота вьюпорта всегда одна.
//
// Раздел диагностики в настройках показывает эти числа по каждому экрану —
// чтобы разбираться по замерам, а не по догадкам. Здесь же лежит цена
// прошлой ошибки: поправку я посчитал один раз на старте, на коротком
// экране-заглушке, и применил ко всем экранам сразу. На прокручиваемых
// вьюпорт был уже полным, и панель ушла на 63 пикселя за край.

const seen = new Map();

export function standalone() {
  if (navigator.standalone === true) return true;
  return Boolean(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
}

export function measure() {
  const inner = window.innerHeight || 0;
  const vv = window.visualViewport;
  const doc = document.documentElement;
  return {
    inner,
    visual: vv ? Math.round(vv.height) : inner,
    screenH: (window.screen && window.screen.height) || 0,
    scrollHeight: doc.scrollHeight,
    scrollable: doc.scrollHeight > inner,
    standalone: standalone(),
  };
}

/**
 * Запомнить замер экрана. Вызывается после отрисовки: до неё высота
 * документа ещё от прошлого экрана.
 *
 * Замер именно после отрисовки важен и по второй причине: разница между
 * экранами и появляется от высоты содержимого.
 */
export function note(key) {
  seen.set(key, measure());
}

export function records() {
  return [...seen.entries()];
}

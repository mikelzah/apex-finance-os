// Насколько низ вьюпорта выше низа экрана — и поправка на эту разницу.
//
// Замеры с iPhone 17 Pro Max, установленное приложение, экран 440×956 CSS.
// Приведены как есть, из раздела диагностики:
//
//   screen.height 956 · visualViewport.height 956 · отдельное окно да
//
//   dashboard  вьюпорт 895  документ 1879  прокручивается
//   goals      вьюпорт 956  документ 1810  прокручивается
//   portfolio  вьюпорт 956  документ 1323  прокручивается
//   journal    вьюпорт 895  документ  895  влезает целиком
//   more       вьюпорт 895  документ 1177  прокручивается
//
// Из этих чисел следуют три вещи.
//
// Первая: window.innerHeight у одного и того же приложения бывает то 895,
// то 956. Панель с bottom: 0 прижимается к низу вьюпорта, поэтому при 895
// она заканчивается на 61 пиксель выше края экрана, и под ней остаётся
// полоса, куда закреплённый слой не достаёт.
//
// Вторая: прокрутка тут ни при чём. dashboard и more прокручиваются, а
// вьюпорт у них всё равно 895. Значит объяснение «страница влезает целиком,
// поэтому вьюпорт короче» было неверным, и запас высоты у .screen проблему
// не решал.
//
// Третья, главная: visualViewport.height равен 956 при innerHeight 895.
// То есть видимая область — весь экран, и разница между ней и вьюпортом
// и есть искомая щель. Это прямой признак, а не догадка о причине, и он
// не требует ни проверки на отдельное окно, ни высоты экрана.
//
// Отдельно про время замера. Первая моя попытка провалилась именно на нём:
// поправка считалась один раз на старте, на коротком экране-заглушке, и
// применялась ко всем экранам сразу — панель ушла за край. Поэтому замер
// живёт рядом с отрисовкой, повторяется после того, как раскладка успокоится,
// и слушает всё, что может сдвинуть вьюпорт.

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

  // Масштаб учитываем на случай, если страницу всё-таки увеличили: при зуме
  // visualViewport.height меряется в увеличенных пикселях, и без умножения
  // разница вышла бы отрицательной.
  const visible = vv ? Math.round(vv.height * (vv.scale || 1)) : inner;

  const raw = Math.round(visible - inner);

  return {
    inner,
    visible,
    screenH: (window.screen && window.screen.height) || 0,
    scrollHeight: doc.scrollHeight,
    scrollable: doc.scrollHeight > inner,
    standalone: standalone(),
    gap: raw > 0 && raw <= LIMIT ? raw : 0,
  };
}

function put(gap) {
  document.documentElement.style.setProperty('--viewport-gap', `${gap}px`);
}

/**
 * Пересчитать поправку.
 *
 * Пока открыта шторка — не трогаем: под ней та же поправка, и сдвиг посреди
 * ввода выглядел бы как прыжок панели под пальцем. Клавиатура ужимает
 * visualViewport, так что момент для замера самый неудачный.
 */
function again() {
  if (document.body.classList.contains('is-locked')) return;
  put(measure().gap);
}

/**
 * Замерить показанный экран и поправить нижние панели.
 *
 * Вызывается после отрисовки. Сразу — чтобы поправка не отставала на глазах,
 * и ещё раз, когда раскладка успокоится: iOS меняет высоту вьюпорта не в тот
 * же кадр, и первый замер бывает от предыдущего состояния.
 */
export function note(key) {
  const m = measure();
  seen.set(key, m);
  put(m.gap);
  requestAnimationFrame(() => setTimeout(() => {
    again();
    seen.set(key, measure());
  }, 150));
}

export function records() {
  return [...seen.entries()];
}

export function watch() {
  const vv = window.visualViewport;
  if (vv) {
    vv.addEventListener('resize', again);
    vv.addEventListener('scroll', again);
  }
  window.addEventListener('resize', again);
  // На поворот iOS отвечает не сразу: размеры на момент события ещё старые.
  window.addEventListener('orientationchange', () => setTimeout(again, 250));

  // Прокрутка сама вьюпорт не меняет, но именно на ней iOS показывает и
  // убирает свои полосы, и высота меняется вместе с этим. Раз в кадр.
  let queued = false;
  window.addEventListener('scroll', () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      again();
    });
  }, { passive: true });
}

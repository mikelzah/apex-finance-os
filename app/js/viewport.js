// Насколько низ вьюпорта выше низа экрана — и поправка на эту разницу.
//
// Замеры с iPhone 17 Pro Max, установленное приложение, экран 440×956 CSS.
// Приведены как есть, из раздела диагностики, по каждому экрану отдельно:
//
//   more/settings  вьюпорт 956  видимая 956  документ 1397
//   journal        вьюпорт 894  видимая 894  документ  894
//   more           вьюпорт 956  видимая 956  документ 1177
//
//   screen.height 956 · отдельное окно да
//
// Из этих чисел следуют три вещи.
//
// Первая: window.innerHeight у одного и того же приложения бывает то 894,
// то 956. Панель с bottom: 0 прижимается к низу вьюпорта, поэтому при 894
// она заканчивается на 62 пикселя выше края экрана, и под ней остаётся
// полоса, куда закреплённый слой не достаёт.
//
// Вторая: прокрутка тут ни при чём. В более раннем замере dashboard и more
// прокручивались, а вьюпорт у них всё равно был коротким. Значит объяснение
// «страница влезает целиком, поэтому вьюпорт короче» неверно, и запас высоты
// у .screen проблему не решал.
//
// Третья: visualViewport.height на коротком экране тоже 894. Разница между
// видимой областью и вьюпортом здесь не работает — раньше я решил обратное,
// сравнив 956 из шапки раздела (её замерили на настройках) с 894 из строки
// журнала. Это были числа с разных экранов, и вывод из них не следовал.
//
// Единственная величина, которая остаётся 956 на любом экране, — screen.height.
// В отдельном окне веб-вью занимает весь экран, поэтому она и есть настоящая
// высота вьюпорта, а разница с innerHeight — искомая щель. В обычном Safari
// это неверно: там сверху и снизу панели браузера. Отсюда набор условий,
// при которых величине можно доверять.
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
  const scr = window.screen || {};
  const screenH = scr.height || 0;
  const screenW = scr.width || 0;
  const isStandalone = standalone();

  // Масштаб учитываем на случай, если страницу всё-таки увеличили: при зуме
  // visualViewport.height меряется в увеличенных пикселях.
  const visible = vv ? Math.round(vv.height * (vv.scale || 1)) : inner;

  // Когда screen.height можно считать высотой вьюпорта:
  //
  //   отдельное окно  — в Safari сверху и снизу панели браузера, и панель
  //                     уехала бы под них;
  //   портрет         — в ландшафте iOS отдаёт размеры экрана не переставляя
  //                     их местами, и разница вышла бы бессмысленной;
  //   ширины сошлись  — прямая проверка, что экран и вьюпорт вообще меряются
  //                     в одних пикселях. Не сошлись — не сравниваем и высоты.
  const trusted = isStandalone
    && screenW === window.innerWidth
    && window.innerWidth <= inner
    && screenH > inner;

  const raw = trusted ? Math.round(screenH - inner) : 0;

  return {
    inner,
    visible,
    screenH,
    trusted,
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

// Щель между низом вьюпорта и низом экрана.
//
// Что замерено по снимку с устройства (iPhone 17 Pro Max, установленное
// приложение, экран 440×956 CSS): таб-бар с position: fixed; bottom: 0
// занимает 803–893, то есть его нижний край на 63 пикселя выше края экрана.
// Полоса 894–956 закрашена цветом фона страницы — закреплённый слой туда
// не достаёт. Отступ безопасной зоны при этом честные 34: он тут ни при чём.
//
// Заметно это только там, где страница не прокручивается. Журнал с коротким
// списком укладывается в экран, и под таб-баром остаётся пустая полоса.
// На длинных экранах прокрутка есть, и полосы не видно.
//
// Почему вьюпорт короче экрана — из окружения разработки выяснить нельзя:
// ни один настольный браузер этого не воспроизводит. Поэтому здесь не догадка
// о причине, а измерение следствия: считаем высоту щели на самом устройстве
// и отдаём её в CSS, где всё прижатое к низу сдвигается вниз ровно на неё.

// Больше любой правдоподобной щели. Страховка: если измерение однажды соврёт,
// панель уедет за край экрана и приложением станет невозможно пользоваться.
// Лучше оставить как есть.
const LIMIT = 160;

export function standalone() {
  if (navigator.standalone === true) return true;
  return Boolean(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
}

/**
 * Все числа, из которых считается щель. Отдельной функцией — их показывает
 * раздел диагностики в настройках: причина неизвестна, так что важно видеть
 * исходные замеры, а не только результат.
 */
export function measure() {
  const inner = window.innerHeight || 0;
  const vv = window.visualViewport;
  const visual = vv ? Math.round(vv.height) : inner;
  const screenH = (window.screen && window.screen.height) || 0;
  const isStandalone = standalone();
  const portrait = window.innerWidth <= inner;

  // В установленном виде веб-вью занимает весь экран, поэтому screen.height —
  // это и есть настоящая высота вьюпорта. В обычном Safari так считать нельзя:
  // там сверху и снизу панели браузера, и панель уехала бы под них.
  //
  // Одному visualViewport верить тоже нельзя: при открытой клавиатуре iOS
  // ужимает именно его, а layout-вьюпорт не трогает. Щель посчиталась бы
  // нулевой, и панель прыгнула бы вверх посреди ввода.
  let full = visual;
  if (isStandalone && portrait && screenH > full) full = screenH;

  const raw = Math.round(full - inner);
  return {
    inner,
    visual,
    screenH,
    standalone: isStandalone,
    portrait,
    raw,
    gap: raw > 0 && raw <= LIMIT ? raw : 0,
  };
}

export function apply() {
  document.documentElement.style.setProperty('--viewport-gap', `${measure().gap}px`);
}

export function watch() {
  apply();
  window.addEventListener('resize', apply);
  // На поворот iOS отвечает не сразу: размеры на момент события ещё старые.
  window.addEventListener('orientationchange', () => setTimeout(apply, 250));
}

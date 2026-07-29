// Тема. Три состояния: следовать системе, светлая, тёмная.
//
// В CSS нет ни одного медиазапроса на цветовую схему: системная тема
// разрешается здесь в конкретную и проставляется атрибутом на <html>.
// Иначе светлые значения пришлось бы держать в двух местах — в медиазапросе
// и под атрибутом, — и они неизбежно разъехались бы.
//
// Первичную установку делает встроенный скрипт в <head>, до отрисовки:
// без него приложение на долю секунды мигает тёмным на светлой теме.

const KEY = 'apex-finance-os:theme';
const MODES = ['system', 'light', 'dark'];

const query = window.matchMedia('(prefers-color-scheme: light)');

export function preference() {
  const saved = localStorage.getItem(KEY);
  return MODES.includes(saved) ? saved : 'system';
}

export function resolved() {
  const mode = preference();
  if (mode !== 'system') return mode;
  return query.matches ? 'light' : 'dark';
}

export function apply() {
  const theme = resolved();
  document.documentElement.dataset.theme = theme;

  // Строка состояния iOS красится этим тегом. Без синхронизации она
  // остаётся тёмной поверх светлого приложения.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute('content', theme === 'light' ? '#f4f8fb' : '#080a0e');
  }
  return theme;
}

export function set(mode) {
  if (!MODES.includes(mode)) return;
  if (mode === 'system') localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, mode);
  apply();
}

export function label(mode = preference()) {
  return { system: 'Как в системе', light: 'Светлая', dark: 'Тёмная' }[mode];
}

/** Следим за системой, пока пользователь не выбрал тему явно. */
export function watch(onChange) {
  const handler = () => {
    if (preference() !== 'system') return;
    apply();
    onChange?.();
  };
  if (query.addEventListener) query.addEventListener('change', handler);
  else query.addListener(handler);
}

// Оформление. Два набора: свой и «Т-стиль».
//
// Устроено так же, как тема, и по той же причине: атрибут на <html>, который
// проставляется до первой отрисовки. Разница в том, что тема меняет краски
// внутри одного оформления, а оформление меняет само устройство экрана —
// плотность, радиусы, шрифт, форму карточек.
//
// Отдельный слой, а не правка своих стилей, — это условие эксперимента.
// Выключить оформление должно быть так же дёшево, как включить: один
// переключатель, никаких следов в остальном коде.

const KEY = 'apex-finance-os:skin';
const SKINS = ['kubysh', 't'];

export function preference() {
  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch { /* приватный режим */ }
  return SKINS.includes(saved) ? saved : 'kubysh';
}

export function apply() {
  const skin = preference();
  document.documentElement.dataset.skin = skin;
  return skin;
}

export function set(value) {
  if (!SKINS.includes(value)) return;
  try {
    if (value === 'kubysh') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, value);
  } catch { /* приватный режим — оформление живёт до перезагрузки */ }
  apply();
}

export function label(value = preference()) {
  return { kubysh: 'Кубыш', t: 'Т-стиль' }[value];
}

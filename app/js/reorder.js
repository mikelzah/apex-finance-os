// Перетаскивание карточек пальцем.
//
// Задача сложнее, чем кажется, из-за одного: за ручку карточки хватаются и
// чтобы её перетащить, и чтобы прокрутить экран, и чтобы открыть её на правку.
// Три жеста на одном месте разводятся во времени и по расстоянию:
//
//   отпустил, не сдвинув          → это нажатие, карточка открывается;
//   повёл сразу                   → это прокрутка, перетаскивание отменяется;
//   подержал и только потом повёл → это перетаскивание.
//
// Задержка обязательна не ради удобства. Прокрутку в Safari можно отменить
// только до того, как она началась: preventDefault на touchmove действует,
// пока палец ещё не сдвинулся. Поэтому перехват ставится в момент удержания,
// когда движения ещё не было, — и после этого экран уже не поедет.
//
// Карточки во время жеста двигаются трансформом, а не перестановкой в DOM:
// перестановка на каждый кадр стоила бы полной раскладки списка, а трансформ
// живёт в композиторе. В хранилище порядок уходит один раз, в конце.

const HOLD_MS = 280;
// На сколько можно шевельнуть палец, не отменив удержание. Палец на стекле
// не стоит неподвижно никогда — ноль здесь означал бы «жест недоступен».
const SLOP = 10;

/**
 * Включить перетаскивание для списка карточек.
 *
 * @param {HTMLElement[]} cards  карточки в текущем порядке
 * @param {(el: HTMLElement) => HTMLElement|null} handle  за что можно тянуть
 * @param {(order: number[]) => void} onCommit  новый порядок как индексы исходного
 */
export function enable(cards, handle, onCommit) {
  for (const [index, card] of cards.entries()) {
    const grip = handle(card);
    if (!grip) continue;
    grip.classList.add('is-grip');
    grip.addEventListener('pointerdown', (e) => start(e, cards, index, onCommit));
  }
}

function start(event, cards, from, onCommit) {
  // Правая кнопка мыши и продолжение уже идущего жеста нас не касаются.
  if (event.button != null && event.button !== 0) return;

  const card = cards[from];
  const startY = event.clientY;
  let held = false;
  let moved = 0;
  let to = from;
  let layout = null;

  const timer = setTimeout(() => {
    held = true;
    layout = measure(cards, from);
    card.classList.add('is-dragging');
    document.body.classList.add('is-reordering');
    if (navigator.vibrate) navigator.vibrate(8);
  }, HOLD_MS);

  // Не passive: именно этим слушателем отменяется прокрутка, когда жест
  // опознан как перетаскивание.
  const onTouchMove = (e) => { if (held) e.preventDefault(); };
  window.addEventListener('touchmove', onTouchMove, { passive: false });

  const onMove = (e) => {
    const dy = e.clientY - startY;
    moved = Math.max(moved, Math.abs(dy));
    if (!held) {
      // Повели раньше, чем додержали, — это прокрутка, не мешаем ей.
      if (moved > SLOP) cleanup(false);
      return;
    }
    card.style.transform = `translateY(${dy}px)`;
    to = targetIndex(layout, from, dy);
    shift(cards, layout, from, to);
  };

  const onUp = () => cleanup(held);

  const cleanup = (commit) => {
    clearTimeout(timer);
    window.removeEventListener('touchmove', onTouchMove);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    if (!held) return;

    card.classList.remove('is-dragging');
    document.body.classList.remove('is-reordering');
    for (const c of cards) c.style.transform = '';

    // После отпускания браузер шлёт click — тот самый, что открывает карточку
    // на правку. Перетащил и получил форму поверх результата: гасим один раз
    // и только тот, что относится к этому жесту.
    const swallow = (e) => { e.stopPropagation(); e.preventDefault(); };
    window.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 350);

    if (commit && to !== from) {
      const order = cards.map((_, i) => i);
      order.splice(to, 0, order.splice(from, 1)[0]);
      onCommit(order);
    }
  };

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
}

/**
 * Снимок положения карточек на момент начала жеста.
 *
 * Меряется один раз: во время перетаскивания карточки уже сдвинуты
 * трансформом, и повторный замер вернул бы не исходную раскладку, а её.
 */
function measure(cards, from) {
  const boxes = cards.map((c) => {
    const r = c.getBoundingClientRect();
    return { top: r.top, height: r.height, centre: r.top + r.height / 2 };
  });
  // Промежуток между карточками одинаков — он задан одним margin. Берём его
  // из первой пары, чтобы не зашивать сюда значение из стилей.
  const gap = boxes.length > 1 ? boxes[1].top - (boxes[0].top + boxes[0].height) : 0;
  return { boxes, step: boxes[from].height + gap };
}

/** Куда встанет карточка, если отпустить палец сейчас. */
function targetIndex(layout, from, dy) {
  const centre = layout.boxes[from].centre + dy;
  let to = from;
  for (let i = 0; i < layout.boxes.length; i += 1) {
    if (i === from) continue;
    const mid = layout.boxes[i].centre;
    if (i > from && centre > mid) to = Math.max(to, i);
    if (i < from && centre < mid) to = Math.min(to, i);
  }
  return to;
}

/** Расступиться: соседи уезжают на высоту перетаскиваемой карточки. */
function shift(cards, layout, from, to) {
  for (let i = 0; i < cards.length; i += 1) {
    if (i === from) continue;
    let d = 0;
    if (from < to && i > from && i <= to) d = -layout.step;
    if (from > to && i < from && i >= to) d = layout.step;
    cards[i].style.transform = d ? `translateY(${d}px)` : '';
  }
}

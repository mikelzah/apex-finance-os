// Иконки таб-бара. Раньше здесь стояли типографские глифы (◎ ◈ ◧) — они
// зависят от того, какой шрифт подставит система, и на разных прошивках
// съезжают по базовой линии. Обычные SVG-контуры такого не делают.
//
// Все построены в сетке 24×24 штрихом 1.7, скруглёнными концами: линии
// одной толщины читаются как один набор, а не как случайные символы.

const paths = {
  // Дом — «Главная».
  home: ['M3.5 10.6 12 3.5l8.5 7.1V20a.9.9 0 0 1-.9.9h-4.4v-5.6H8.8v5.6H4.4a.9.9 0 0 1-.9-.9z'],
  // Мишень — «Цели».
  target: [
    'M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18z',
    'M12 16.2a4.2 4.2 0 1 1 0-8.4 4.2 4.2 0 0 1 0 8.4z',
  ],
  dot: 'M12 12.9a.9.9 0 1 1 0-1.8.9.9 0 0 1 0 1.8z',
  // Столбцы разной высоты — «Портфель».
  bars: ['M5.5 20V13.5', 'M12 20V5', 'M18.5 20v-9.5'],
  // Строки списка — журнал внутри портфеля.
  list: ['M4 7h16', 'M4 12h16', 'M4 17h10'],
  // Кошелёк — «Траты». Не монета и не кредитка: монета читается как доход,
  // а карточка — как способ оплаты. Кошелёк про то, сколько осталось.
  wallet: [
    'M3.8 8.6h16.4v9.9a1.6 1.6 0 0 1-1.6 1.6H5.4a1.6 1.6 0 0 1-1.6-1.6z',
    'M6.6 8.6V5.9a1.6 1.6 0 0 1 1.6-1.6h7.6a1.6 1.6 0 0 1 1.6 1.6v2.7',
    'M16.2 14.3h.01',
  ],
  // Многоточие — «Ещё».
  more: ['M6 12h.01', 'M12 12h.01', 'M18 12h.01'],
  // Плюс — кнопка записи в навигации. Штрих толще остальных: она лежит
  // на жёлтой заливке и по размеру вдвое меньше того, что вокруг.
  plus: ['M12 5.5v13', 'M5.5 12h13'],
  // Две стрелки навстречу — «любая операция». Не плюс: плюс уже занят
  // взносом, и два одинаковых знака рядом означали бы одно и то же.
  swap: ['M17 3.5v11.5', 'M17 15l-4-4', 'M17 15l4-4', 'M7 20.5V9', 'M7 9l-4 4', 'M7 9l4 4'],
  // Колокольчик — вход в «Требует внимания».
  bell: ['M18 8.6a6 6 0 1 0-12 0c0 6-2 7.5-2 7.5h16s-2-1.5-2-7.5', 'M13.7 19.4a2 2 0 0 1-3.4 0'],
  // Снимок экрана — рамка с полосой сверху, как у окна приложения.
  // Не фотоаппарат: снимают не камерой, а самим телефоном.
  shot: ['M3.6 4.5h16.8v15a1.6 1.6 0 0 1-1.6 1.6H5.2a1.6 1.6 0 0 1-1.6-1.6z', 'M3.6 9h16.8', 'M8.4 14.4h5.4'],
};

const NS = 'http://www.w3.org/2000/svg';

export function icon(name) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.7');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');

  for (const d of paths[name] || []) {
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }

  // Многоточие из штрихов нулевой длины выходит слишком тонким —
  // точки должны читаться как точки, а не как пыль.
  if (name === 'more') svg.setAttribute('stroke-width', '2.4');

  // Плюс на жёлтой кнопке: тонкий крест на заливке выглядит процарапанным.
  if (name === 'plus') svg.setAttribute('stroke-width', '2.2');

  // Застёжка кошелька — такая же точка, и по той же причине.
  if (name === 'wallet') {
    const clasp = document.createElementNS(NS, 'path');
    clasp.setAttribute('d', 'M16.2 15.2a.9.9 0 1 1 0-1.8.9.9 0 0 1 0 1.8z');
    clasp.setAttribute('fill', 'currentColor');
    clasp.setAttribute('stroke', 'none');
    svg.appendChild(clasp);
  }

  // У мишени центр залит, иначе на 24 пикселях она читается просто кольцом.
  if (name === 'target') {
    const centre = document.createElementNS(NS, 'path');
    centre.setAttribute('d', paths.dot);
    centre.setAttribute('fill', 'currentColor');
    centre.setAttribute('stroke', 'none');
    svg.appendChild(centre);
  }
  return svg;
}

/** Значки статусов. Цвет никогда не остаётся единственным различителем. */
export function statusIcon(level) {
  const glyph = { error: '!', warn: '!', info: 'i', ok: '✓' }[level] || 'i';
  const node = document.createElement('span');
  node.className = `status-icon status-${level}`;
  node.setAttribute('aria-hidden', 'true');
  node.textContent = glyph;
  return node;
}

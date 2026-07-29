// Первый запуск.
//
// Приложение не подставляет данные само. Показать человеку чужой капитал
// как его собственный — худшее, чем может встретить финансовое приложение
// при первом открытии, даже если цифры потом легко стереть.

import * as U from '../ui.js';
import * as store from '../store.js';

const { h } = U;
const NS = 'http://www.w3.org/2000/svg';

export function render(ctx) {
  const start = async (action, message) => {
    try {
      await action();
      U.toast(message);
      ctx.refresh();
    } catch (err) {
      U.toast(`Не удалось загрузить: ${err.message}`, 'error');
    }
  };

  return [
    h('section', { class: 'intro' }, [
      mark(),
      h('h1', { text: 'APEX Finance OS' }),
      h('p', { text: 'Капитал, цели и портфель в одном месте. Данные хранятся только в этом устройстве и никуда не отправляются.' }),

      h('div', { class: 'intro-actions' }, [
        U.button('Начать с нуля', () => start(store.startEmpty, 'Готово — заведите первый актив'), {
          kind: 'primary',
          class: 'btn-wide',
        }),
        U.button('Посмотреть на демо-данных', () => start(store.loadDemo, 'Загружены демо-данные'), {
          class: 'btn-wide',
        }),
        U.button('Загрузить из копии', () => restore(ctx), { class: 'btn-wide' }),
      ]),

      h('p', {
        class: 'intro-note',
        text: 'Демо-данные вымышленные. Их можно стереть в любой момент в разделе «Ещё».',
      }),
    ]),
  ];
}

function restore(ctx) {
  const picker = h('input', {
    type: 'file',
    accept: 'application/json,.json',
    style: { display: 'none' },
  });
  picker.addEventListener('change', async () => {
    const file = picker.files && picker.files[0];
    if (!file) return;
    try {
      const counts = await store.importText(await file.text());
      U.toast(`Загружено: ${counts.assets} активов, ${counts.operations} операций`);
      ctx.refresh();
    } catch (err) {
      U.toast(`Не удалось загрузить: ${err.message}`, 'error');
    } finally {
      picker.remove();
    }
  });
  document.body.appendChild(picker);
  picker.click();
}

function mark() {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 512 512');
  svg.setAttribute('class', 'intro-mark');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', 'M112 364 L256 148 L400 364');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'var(--accent)');
  path.setAttribute('stroke-width', '56');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(path);
  return svg;
}

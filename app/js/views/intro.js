// Первый запуск.
//
// Приложение не подставляет данные само. Показать человеку чужой капитал
// как его собственный — худшее, чем может встретить финансовое приложение
// при первом открытии, даже если цифры потом легко стереть.

import * as U from '../ui.js';
import * as store from '../store.js';
import * as mascot from '../mascot.js';

const { h } = U;

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
      mascot.portrait('intro-mark'),
      h('h1', { text: mascot.NAME }),
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


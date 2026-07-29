// Точка входа: загрузка состояния, маршрутизация, перерисовка.

import * as U from './ui.js';
import * as D from './dates.js';
import * as F from './fmt.js';
import * as store from './store.js';
import { icon } from './icons.js';

import * as dashboard from './views/dashboard.js';
import * as goals from './views/goals.js';
import * as portfolio from './views/portfolio.js';
import * as journal from './views/journal.js';
import * as more from './views/more.js';

const { h } = U;

const TABS = [
  { id: 'dashboard', label: 'Главная', icon: 'home' },
  { id: 'goals', label: 'Цели', icon: 'target' },
  { id: 'portfolio', label: 'Портфель', icon: 'bars' },
  { id: 'journal', label: 'Журнал', icon: 'list' },
  { id: 'more', label: 'Ещё', icon: 'more' },
];

const VIEWS = { dashboard, goals, portfolio, journal, more };

const screen = document.getElementById('screen');
const header = document.getElementById('header');
const tabbar = document.getElementById('tabbar');

let route = { tab: 'dashboard', sub: null };

// --------------------------------------------------------------------------

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [tab, sub] = raw.split('/');
  return { tab: VIEWS[tab] ? tab : 'dashboard', sub: sub || null };
}

function go(path) {
  location.hash = `#/${path}`;
}

function context() {
  return {
    state: store.getState(),
    today: D.today(),
    route,
    sub: route.sub,
    go,
    refresh: render,
  };
}

// --------------------------------------------------------------------------

function render() {
  const ctx = context();
  const view = VIEWS[route.tab];

  renderHeader();

  U.clear(screen);
  screen.classList.toggle('is-bare', header.hidden);
  const banner = backupBanner(ctx);
  if (banner) screen.appendChild(banner);
  U.append(screen, view.render(ctx));

  renderTabs();
  // Возврат в подраздел не должен оставлять экран прокрученным вниз.
  if (route.tab !== 'journal') screen.scrollTop = 0;
}

/**
 * Шапка есть только во вложенных разделах — там она несёт кнопку «назад».
 * На основных экранах заголовок дублировал бы таб-бар и забирал полосу
 * в 110 пикселей, ничего не сообщая.
 */
function renderHeader() {
  U.clear(header);
  const isSub = route.tab === 'more' && route.sub;
  header.hidden = !isSub;
  if (!isSub) return;

  U.append(header, [
    h('button', { class: 'back', type: 'button', onclick: () => go('more'), 'aria-label': 'Назад' }, [
      h('span', { class: 'back-chevron', text: '‹' }),
    ]),
    h('h1', { text: more.title(route.sub) }),
  ]);
}

function renderTabs() {
  U.clear(tabbar);
  U.append(
    tabbar,
    TABS.map((tab) =>
      h('button', {
        class: `tab${tab.id === route.tab ? ' is-on' : ''}`,
        type: 'button',
        'aria-current': tab.id === route.tab ? 'page' : null,
        onclick: () => {
          U.tap();
          go(tab.id);
        },
      }, [
        icon(tab.icon),
        h('span', { class: 'tab-label', text: tab.label }),
      ]),
    ),
  );
}

/**
 * Напоминание о копии. Данные живут только здесь, и единственное, что стоит
 * между ними и случайной очисткой Safari, — выгруженный файл.
 */
function backupBanner(ctx) {
  const { state, today } = ctx;
  const every = state.settings.backupReminderDays;
  if (!every) return null;
  if (route.tab === 'more') return null;

  if (!state.operations.length && !state.assets.length) return null;

  // Пока копии не было, отсчёт идёт от установки: напоминать в первый же день
  // бессмысленно — терять ещё нечего, а баннер уже мозолит глаза.
  const last = state.meta.lastBackupAt;
  const since = last || state.meta.createdAt;
  if (!since) return null;
  const age = D.diffDays(today, since.slice(0, 10));
  if (age < every) return null;

  return h('button', { class: 'banner', type: 'button', onclick: () => go('more/backup') }, [
    h('span', { class: 'banner-title', text: !last ? 'Копии данных ещё не было' : `Копия сделана ${F.days(age)} назад` }),
    h('span', { class: 'banner-sub', text: 'Данные хранятся только в этом телефоне' }),
  ]);
}

// --------------------------------------------------------------------------

async function boot() {
  try {
    const { seeded } = await store.init();
    route = parseHash();
    render();
    if (seeded) U.toast('Загружены стартовые данные');
  } catch (err) {
    console.error(err);
    U.clear(screen);
    screen.appendChild(
      U.card([
        h('h2', { text: 'Не удалось запустить' }),
        h('p', { class: 'sheet-text', text: String(err && err.message ? err.message : err) }),
      ]),
    );
    return;
  }

  window.addEventListener('hashchange', () => {
    route = parseHash();
    U.close();
    render();
  });

  // Приложение открыто сутками — на смене даты «сегодня» должно поехать само,
  // иначе календарь дисциплины утром покажет вчерашний день.
  let day = D.today();
  setInterval(() => {
    const now = D.today();
    if (now !== day) {
      day = now;
      render();
    }
  }, 60000);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && D.today() !== day) {
      day = D.today();
      render();
    }
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.warn('Service worker не зарегистрировался:', err);
    });
  }
}

boot();

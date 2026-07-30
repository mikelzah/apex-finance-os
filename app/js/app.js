// Точка входа: загрузка состояния, маршрутизация, перерисовка.

import * as U from './ui.js';
import * as D from './dates.js';
import * as F from './fmt.js';
import * as store from './store.js';
import * as theme from './theme.js';
import { icon } from './icons.js';
import * as mascot from './mascot.js';

import * as dashboard from './views/dashboard.js';
import * as goals from './views/goals.js';
import * as portfolio from './views/portfolio.js';
import * as journal from './views/journal.js';
import * as more from './views/more.js';
import * as intro from './views/intro.js';

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
let booted = false;
// Какой экран показан сейчас. Нужен, чтобы отличить переход на другой экран
// от перерисовки того же: первый начинается сверху, вторая обязана сохранить
// положение — иначе запись взноса из середины списка выкидывала бы наверх.
let shownScreen = null;

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
  // Пока выбор на первом запуске не сделан, вкладки нечего показывать:
  // приложение спрашивает, с чего начать, и не притворяется наполненным.
  if (store.needsOnboarding()) return renderIntro();

  const ctx = context();
  const view = VIEWS[route.tab];
  const key = `${route.tab}/${route.sub || ''}`;

  // Положение читаем до перестройки: после очистки экрана оно теряется.
  const keepScroll = key === shownScreen ? scrollTopNow() : 0;

  renderHeader(ctx);
  tabbar.hidden = false;

  U.clear(screen);
  screen.classList.toggle('is-bare', header.hidden);

  const notices = [offlineNotice(), backupBanner(ctx)].filter(Boolean);
  U.append(screen, notices);
  U.append(screen, view.render(ctx));

  renderTabs();
  shownScreen = key;
  scrollTo(keepScroll);
}

function renderIntro() {
  header.hidden = true;
  tabbar.hidden = true;
  U.clear(screen);
  screen.classList.add('is-bare');
  U.append(screen, intro.render({ refresh: render, go }));
  shownScreen = 'intro';
  scrollTo(0);
}

/**
 * Прокручивается документ, а не #screen.
 *
 * У .screen стоит overflow-y: auto, но высота не ограничена — блок растёт
 * под содержимое, внутренней прокрутки не возникает, и screen.scrollTop
 * всегда равен нулю. Раньше сброс был написан именно так и потому
 * не работал: при переходе на другой экран оставалось положение прошлого.
 */
function scrollTopNow() {
  return window.scrollY || document.documentElement.scrollTop || 0;
}

function scrollTo(y) {
  window.scrollTo(0, y);
}

/**
 * Шапка есть только во вложенных разделах — там она несёт кнопку «назад».
 * На основных экранах заголовок дублировал бы таб-бар и забирал полосу
 * в 110 пикселей, ничего не сообщая.
 */
function renderHeader(ctx) {
  U.clear(header);
  const isSub = route.tab === 'more' && route.sub;
  header.hidden = !isSub;
  if (!isSub) return;

  U.append(header, [
    h('button', { class: 'back', type: 'button', onclick: () => go('more'), 'aria-label': 'Назад' }, [
      h('span', { class: 'back-chevron', text: '‹' }),
    ]),
    h('h1', { text: more.title(route.sub) }),
    // Действие раздела живёт в шапке: заголовок экрана под ней повторял бы
    // название раздела, и на экране оказывалось бы два одинаковых заголовка.
    h('div', { class: 'header-action' }, [more.action(route.sub, ctx)]),
  ]);
}

let tabNodes = null;

/**
 * Таб-бар собирается один раз, дальше меняется только подсветка.
 *
 * Пересобирать закреплённую панель на каждой перерисовке незачем: сами
 * кнопки не меняются никогда. Чем меньше правок в composited-слое, тем
 * меньше поводов для расхождения между тем, что в DOM, и тем, что
 * на экране.
 */
function renderTabs() {
  if (!tabNodes) {
    tabNodes = TABS.map((tab) =>
      h('button', {
        class: 'tab',
        type: 'button',
        onclick: () => {
          U.tap();
          go(tab.id);
        },
      }, [
        icon(tab.icon),
        h('span', { class: 'tab-label', text: tab.label }),
      ]),
    );
    U.append(U.clear(tabbar), tabNodes);
  }

  TABS.forEach((tab, i) => {
    const active = tab.id === route.tab;
    tabNodes[i].classList.toggle('is-on', active);
    if (active) tabNodes[i].setAttribute('aria-current', 'page');
    else tabNodes[i].removeAttribute('aria-current');
  });
}

/**
 * Оффлайн — не авария: данные лежат в телефоне, работает вообще всё,
 * кроме обновления котировок. Поэтому сноска, а не тревожная плашка.
 */
function offlineNotice() {
  if (navigator.onLine !== false) return null;
  return h('div', { class: 'offline' }, [
    h('span', { text: 'Нет сети — котировки не обновятся, остальное работает' }),
  ]);
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

function skeleton() {
  U.clear(screen);
  screen.classList.add('is-bare');
  U.append(screen, [
    h('div', { class: 'hero' }, [
      h('div', { class: 'skeleton skeleton-line', style: { width: '40%', margin: '0 auto' } }),
      h('div', { class: 'skeleton skeleton-hero' }),
    ]),
    h('div', { class: 'act' }, [h('div', { class: 'skeleton', style: { height: '4.5rem', borderRadius: 'var(--radius-lg)' } })]),
    h('div', { class: 'card' }, [h('div', { class: 'skeleton skeleton-block' })]),
  ]);
}

async function boot() {
  theme.apply();
  mascot.apply();
  // Чтение из IndexedDB обычно занимает миллисекунды, но на холодном старте
  // после перезагрузки телефона бывает и заметно дольше. Пустой белый экран
  // в этот момент читается как поломка, скелетон — как загрузка.
  skeleton();

  try {
    await store.init();
    route = parseHash();
    render();
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

  booted = true;

  // Свайп по центру экрана в standalone-режиме — это жест назад/вперёд
  // по истории. Слушаем оба события: hashchange не приходит, когда хеш
  // совпадает, а запись в истории другая, и тогда экран остался бы старым.
  // Сверка с текущим маршрутом не даёт перерисовать дважды: при обычном
  // переходе Safari присылает и popstate, и hashchange.
  const onNavigate = () => {
    const next = parseHash();
    if (next.tab === route.tab && next.sub === route.sub) return;
    route = next;
    U.close();
    render();
  };
  window.addEventListener('hashchange', onNavigate);
  window.addEventListener('popstate', onNavigate);

  theme.watch(() => booted && render());

  window.addEventListener('online', () => booted && render());
  window.addEventListener('offline', () => booted && render());

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

// Точка входа: загрузка состояния, маршрутизация, перерисовка.

import * as U from './ui.js';
import * as D from './dates.js';
import * as F from './fmt.js';
import * as store from './store.js';
import * as C from './calc.js';
import * as theme from './theme.js';
import * as viewport from './viewport.js';
import { icon } from './icons.js';
import * as mascot from './mascot.js';
import * as lock from './lock.js';

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
  const raw = location.hash.replace(/^#\/?/, '').split('?')[0];
  const [tab, sub] = raw.split('/');
  return { tab: VIEWS[tab] ? tab : 'dashboard', sub: sub || null };
}

/**
 * Быстрый взнос по адресу: #/quick или #/quick?amount=500.
 *
 * Виджета у веб-приложения на iOS не будет — это ограничение системы, обойти
 * нечем. Но «Команды» умеют открыть адрес по голосу или с кнопки действия,
 * и тогда взнос записывается за одно касание вместо пяти.
 *
 * Адрес сразу заменяется на главную: иначе обновление страницы или возврат
 * по истории записали бы взнос второй раз, и человек узнал бы об этом
 * из журнала неделю спустя.
 */
async function quickFromHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  if (!/^quick(\?|$)/.test(raw)) return false;

  const params = new URLSearchParams(raw.split('?')[1] || '');
  const s = store.getState().settings;
  const amount = Number(params.get('amount')) || s.quickAmount;
  const asset = store.getState().assets.find((a) => a.id === s.quickAssetId);

  history.replaceState(null, '', '#/dashboard');

  if (!amount || !asset) {
    U.toast('Быстрый взнос не настроен — выберите сумму и актив в настройках', 'error');
    return false;
  }

  await store.mutate((draft) => {
    draft.operations.push({
      id: store.newId('op'),
      date: D.today(),
      type: C.OP_CONTRIBUTION,
      amount,
      assetId: asset.id,
      goalId: s.quickGoalId || null,
      source: C.SOURCE_MANUAL,
      comment: null,
    });
  });
  mascot.celebrate();
  U.toast(`Взнос ${F.money(amount)} записан`);
  return true;
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
  // Появление экрана — про переход на другой экран. При перерисовке того же
  // оно читается как «страница поменялась целиком», хотя изменился фильтр
  // или переключатель. Мигает при этом всё сразу, включая то, что не менялось.
  screen.classList.toggle('is-quiet', key === shownScreen);

  const notices = [offlineNotice(), backupBanner(ctx)].filter(Boolean);
  U.append(screen, notices);
  U.append(screen, view.render(ctx));

  renderTabs();
  shownScreen = key;
  scrollTo(keepScroll);
  viewport.note(key);
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
 * Прокручивается #screen, а не документ.
 *
 * Так стало после перехода на оболочку в высоту экрана: страница не
 * прокручивается вовсе, иначе навигацию было бы нечем удержать у нижнего
 * края. Раньше здесь стояло window.scrollY — и до этого, ещё раньше,
 * screen.scrollTop, который тогда всегда возвращал ноль. Проверять надо
 * тот элемент, который действительно прокручивается.
 */
function scrollTopNow() {
  return screen.scrollTop || 0;
}

function scrollTo(y) {
  screen.scrollTop = y;
}

/**
 * Шапка есть только во вложенных страницах — там она несёт кнопку «назад».
 * На основных экранах заголовок дублировал бы таб-бар и забирал полосу
 * в 110 пикселей, ничего не сообщая.
 *
 * Вложенные страницы бывают у любой вкладки: раздел в «Ещё», бумага
 * в «Портфеле». Признак один — вьюха умеет назвать страницу по её адресу.
 */
function renderHeader(ctx) {
  U.clear(header);
  const view = VIEWS[route.tab];
  const isSub = Boolean(route.sub) && typeof view.title === 'function';
  header.hidden = !isSub;
  if (!isSub) return;

  U.append(header, [
    h('button', { class: 'back', type: 'button', onclick: () => go(route.tab), 'aria-label': 'Назад' }, [
      h('span', { class: 'back-chevron', text: '‹' }),
    ]),
    h('h1', { text: view.title(route.sub, ctx) }),
    // Действие страницы живёт в шапке: заголовок экрана под ней повторял бы
    // название, и на экране оказывалось бы два одинаковых заголовка.
    h('div', { class: 'header-action' }, [view.action ? view.action(route.sub, ctx) : null]),
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
  // Зверёк для пустых экранов. Передаётся, а не импортируется: ui.js не может
  // тянуть mascot.js напрямую — тот сам берёт оболочку из ui.js, и вышел бы круг.
  U.useMascot(mascot.portrait);
  theme.apply();
  // До первой отрисовки: от полной высоты считается высота страницы.
  viewport.watch();
  mascot.apply();
  // Чтение из IndexedDB обычно занимает миллисекунды, но на холодном старте
  // после перезагрузки телефона бывает и заметно дольше. Пустой белый экран
  // в этот момент читается как поломка, скелетон — как загрузка.
  skeleton();

  try {
    await store.init();
    // Снимок капитала за текущий месяц — до первой отрисовки, чтобы история
    // набиралась сама. Кнопка «Снимок за месяц» остаётся, но полагаться
    // на неё нельзя: история, которую надо помнить записывать, не набирается
    // никогда, а без неё нечего раскладывать на вложенное и наросшее.
    if (!store.needsOnboarding()) {
      await store.snapshotWorth(D.today());
      await quickFromHash();
    }
    route = parseHash();
    render();
    if (lock.enabled()) lock.screen(() => {});
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
  const onNavigate = async () => {
    // Адрес быстрого взноса обрабатывается и здесь, а не только при запуске.
    // Приложение с домашнего экрана обычно уже открыто, и переход на #/quick
    // тогда не перезагружает страницу — это смена хеша внутри того же
    // документа. Обработчик только при запуске означал бы, что «Команда»
    // срабатывает через раз: на холодном старте да, на живом приложении нет.
    if (await quickFromHash()) {
      route = parseHash();
      U.close();
      render();
      return;
    }
    const next = parseHash();
    if (next.tab === route.tab && next.sub === route.sub) return;
    route = next;
    U.close();
    render();
  };
  window.addEventListener('hashchange', onNavigate);
  window.addEventListener('popstate', onNavigate);

  // Документ не должен прокручиваться никогда: на нём держится вся привязка
  // навигации к низу экрана. overflow: hidden отменяет жест, но не программную
  // прокрутку — а её вызывает сам браузер, подводя поле ввода под клавиатуру.
  // Уехавший на триста пикселей документ утащил бы за собой всю оболочку.
  window.addEventListener('scroll', () => {
    if (window.scrollY !== 0 || window.scrollX !== 0) window.scrollTo(0, 0);
  }, { passive: true });

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
      // Новый день — новый снимок. На переходе через месяц это и создаёт
      // строку следующего месяца, а прошлый остаётся с последним значением.
      store.snapshotWorth(now).then(() => render());
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

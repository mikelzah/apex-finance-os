// Service worker. Держит оболочку приложения в кэше, поэтому после первого
// открытия сеть не нужна вовсе — данные и так лежат в IndexedDB.
//
// Версию штампует scripts/build-pages.sh временем сборки. Руками её поднимать
// не нужно.
//
// Про стратегию. Раньше здесь было «сначала кэш, сеть в фоне», и это оказалось
// дорогой ошибкой: свежий код доезжал до устройства только к следующему
// запуску, а если в HTTP-кэше лежала копия постарше — то и позже. На деле
// несколько исправлений подряд проверялись на сборке двухдневной давности,
// и выводы делались не о том коде, который правился.
//
// Поэтому код оболочки — HTML, CSS, JS, манифест — берётся из сети с
// откатом на кэш по таймауту. Запуск при живой сети всегда показывает
// свежую версию; без сети приложение открывается из копии, как и раньше.
// Шрифт, иконки и демо-данные меняются вместе с версией кэша, им сеть
// на каждом запуске незачем — они читаются из кэша сразу.

const VERSION = 'v4';
const CACHE = `apex-finance-os-${VERSION}`;

// Распознаватель живёт в отдельном кэше, который не чистится вместе с версией.
// Он весит пять с половиной мегабайт и не меняется от сборки к сборке — качать
// его заново после каждого обновления приложения было бы издевательством
// над мобильным трафиком. Версия в имени папки: сменится движок — сменится
// и путь, а старый кэш уйдёт вместе с ним.
const VENDOR_CACHE = 'apex-finance-os-vendor-1';
const isVendor = (url) => url.pathname.includes('/vendor/');

// Сколько ждать сеть, прежде чем показать сохранённую копию. Порог заметно
// больше обычного ответа Pages и заметно меньше терпения человека.
const NETWORK_TIMEOUT = 2500;

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './css/t-style.css',
  './css/tokens.css',
  './fonts/inter-subset.woff2',
  './js/app.js',
  './js/build.js',
  './js/store.js',
  './js/calc.js',
  './js/dates.js',
  './js/fmt.js',
  './js/ui.js',
  './js/forms.js',
  './js/charts.js',
  './js/moex.js',
  './js/icons.js',
  './js/theme.js',
  './js/skin.js',
  './js/viewport.js',
  './js/table.js',
  './js/mascot.js',
  './js/reorder.js',
  './js/lock.js',
  './js/statement.js',
  './js/xlsx.js',
  './js/screenshot.js',
  './js/ocr.js',
  './js/import.js',
  './js/views/dashboard.js',
  './js/views/spending.js',
  './js/views/goals.js',
  './js/views/portfolio.js',
  './js/views/journal.js',
  './js/views/more.js',
  './js/views/intro.js',
  './data/demo.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

/** Код оболочки: его нужно обновлять, а не просто хранить. */
function isCode(url) {
  return url.pathname.endsWith('/')
    || /\.(?:html|css|js|webmanifest)$/.test(url.pathname);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Положить в кэш, минуя HTTP-кэш браузера.
 *
 * Без cache: 'reload' установка могла сложить в новый кэш файлы из старого
 * HTTP-кэша: Pages отдаёт их с max-age, и на устройстве они живут дольше,
 * чем нужно. Новая версия кэша при этом наполнялась старым содержимым —
 * и обновление не доезжало вообще никогда.
 */
async function fill(cache, url) {
  try {
    const response = await fetch(url, { cache: 'reload' });
    if (response && response.ok) await cache.put(url, response);
  } catch (err) {
    // Пропущенная иконка не должна мешать приложению установиться.
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => Promise.all(SHELL.map((url) => fill(cache, url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys
        .filter((k) => k !== CACHE && k !== VENDOR_CACHE)
        .map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);

  const network = fetch(request, { cache: 'no-cache' })
    .then((response) => {
      if (response && response.ok && response.type === 'basic') {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  // Сеть успела — показываем свежее. Не успела — показываем копию, а сеть
  // продолжает работать и обновит кэш к следующему запуску.
  const quick = await Promise.race([network, wait(NETWORK_TIMEOUT).then(() => null)]);
  if (quick) return quick;

  const cached = await cache.match(request);
  if (cached) return cached;

  const late = await network;
  if (late) return late;

  return new Response('Нет сети и нет сохранённой копии', {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

async function cacheFirst(request, name = CACHE) {
  const cache = await caches.open(name);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response && response.ok && response.type === 'basic') {
    cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Котировки идут мимо кэша: вчерашняя цена, выданная как сегодняшняя,
  // хуже честного отказа — приложение умеет попросить ввести её руками.
  if (url.origin !== self.location.origin) return;

  // Движок распознавания — всегда из кэша: он не меняется, а весит столько,
  // что даже проверка свежести по сети на каждом обращении заметна.
  if (isVendor(url)) {
    event.respondWith(cacheFirst(request, VENDOR_CACHE));
    return;
  }

  event.respondWith(isCode(url) ? networkFirst(request) : cacheFirst(request));
});

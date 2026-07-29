// Service worker. Кэширует оболочку приложения целиком, поэтому после первого
// открытия сеть не нужна вовсе — данные и так лежат в IndexedDB.
//
// Версию поднимайте при каждом изменении файлов: иначе на телефоне останется
// старая копия, а понять это по внешнему виду невозможно.

const VERSION = 'v1';
const CACHE = `apex-finance-os-${VERSION}`;

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/store.js',
  './js/calc.js',
  './js/dates.js',
  './js/fmt.js',
  './js/ui.js',
  './js/forms.js',
  './js/charts.js',
  './js/moex.js',
  './js/views/dashboard.js',
  './js/views/goals.js',
  './js/views/portfolio.js',
  './js/views/journal.js',
  './js/views/more.js',
  './data/seed.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // addAll падает целиком, если хоть один файл не найден. Кладём по одному:
      // пропущенная иконка не должна мешать приложению установиться.
      .then((cache) => Promise.all(SHELL.map((url) => cache.add(url).catch(() => null))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Котировки идут мимо кэша: вчерашняя цена, выданная как сегодняшняя,
  // хуже честного отказа — приложение умеет попросить ввести её руками.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      // Сеть всё равно опрашиваем, чтобы подтянуть обновление приложения
      // к следующему запуску. Ответ пользователю при этом мгновенный.
      const network = fetch(request)
        .then((response) => {
          if (response && response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);

      return cached || network;
    }),
  );
});

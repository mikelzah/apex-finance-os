// Проверка публичной сборки в условиях GitHub Pages: сайт лежит не в корне
// домена, а в подпапке /apex-finance-os/ — как у любого репозитория.
const { chromium } = require('playwright');
const path = require('path');
const FIX = path.join(__dirname, 'fixtures');

const BASE = 'http://127.0.0.1:8900/apex-finance-os/';
const OUT = path.join(__dirname, '.out');

let failed = 0;
const check = (label, got, want) => {
  const ok = got === want;
  if (!ok) failed += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}: ${got}`);
};

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'], executablePath: process.env.CHROMIUM_PATH || undefined });
  const context = await browser.newContext({
    viewport: { width: 440, height: 956 },
    deviceScaleFactor: 3,
    isMobile: true, hasTouch: true,
    locale: 'ru-RU', timezoneId: 'Europe/Moscow', colorScheme: 'dark',
  });

  const errors = [];
  const missing = [];
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => { if (r.status() >= 400) missing.push(`${r.status()} ${r.url()}`); });

  console.log('\nЗагрузка из подпапки');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  check('экран первого запуска показан', await page.isVisible('.intro'), true);
  check('шрифт загрузился', await page.evaluate(() => document.fonts.check('600 16px Inter')), true);

  const manifest = await page.evaluate(async () => {
    const href = document.querySelector('link[rel=manifest]').href;
    const res = await fetch(href);
    return res.ok ? { url: href, ...(await res.json()) } : null;
  });
  check('манифест доступен', Boolean(manifest), true);
  check('start_url разрешается в подпапку',
    new URL(manifest.start_url, manifest.url).pathname, '/apex-finance-os/index.html');

  const iconOk = await page.evaluate(async () => {
    const res = await fetch('./icons/icon-192.png');
    return res.ok && res.headers.get('content-type').includes('png');
  });
  check('иконки отдаются', iconOk, true);

  // Считаем ошибки до намеренного запроса ниже: он сам даст 404.
  check('запуск проходит без ошибок в консоли', errors.length, 0);

  // Личного слепка в публичной сборке нет.
  const seed = await page.evaluate(async () => (await fetch('./data/seed.json')).status);
  check('личных данных нет на сервере', seed, 404);
  errors.length = 0;

  console.log('\nРабота приложения');
  await page.click('.intro-actions .btn:nth-child(2)');
  await page.waitForTimeout(1000);
  check('демо-данные загрузились', (await page.textContent('.hero-value')).includes('₽'), true);
  await page.screenshot({ path: `${OUT}/40-pages-subpath.png` });

  await page.goto(`${BASE}#/more/settings`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const settings = await page.textContent('.screen');
  check('кнопки личного слепка нет', settings.includes('личный слепок'), false);
  // Демо-данные загружаются с первого экрана, а не из настроек: блок
  // «Заменить данные» убран по просьбе. Проверяем то, что осталось.
  check('сборка видна', settings.includes('Сборка'), true);
  check('кнопка обновления на месте', settings.includes('Обновить приложение'), true);

  console.log('\nService worker и офлайн');
  const swState = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return reg ? { scope: reg.scope, active: Boolean(reg.active) } : null;
  });
  check('service worker зарегистрирован', Boolean(swState), true);
  check('его область — подпапка', swState && new URL(swState.scope).pathname, '/apex-finance-os/');

  // Ждём, пока оболочка осядет в кэше, и обрываем сеть.
  await page.waitForTimeout(1500);
  const cached = await page.evaluate(async () => {
    const keys = await caches.keys();
    if (!keys.length) return 0;
    return (await (await caches.open(keys[0])).keys()).length;
  });
  check('файлы попали в кэш', cached > 15, true);

  await context.setOffline(true);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  const offlineWorks = await page.evaluate(() => Boolean(document.querySelector('.hero-value')));
  check('приложение открывается без сети', offlineWorks, true);
  await page.screenshot({ path: `${OUT}/41-pages-offline.png` });
  await context.setOffline(false);

  await browser.close();
  const realMissing = missing.filter((m) => !m.includes('seed.json'));
  console.log(realMissing.length ? `\nНе найдено:\n${realMissing.join('\n')}` : '\nВсе файлы отдались');
  console.log(errors.length ? `Ошибки:\n${errors.join('\n')}` : 'Ошибок в консоли нет');
  console.log(failed ? `\n${failed} проверок провалено\n` : '\nВсе проверки прошли\n');
  process.exit(failed || realMissing.length ? 1 : 0);
})();

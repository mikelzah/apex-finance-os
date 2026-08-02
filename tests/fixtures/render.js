// Перерисовка снимков банков из макетов рядом.
//
// Снимки — это вход распознавателя, и держать их картинками обязательно:
// OCR читает пиксели, а не разметку. Но картинка непрозрачна для чтения
// и правки, поэтому рядом лежит макет, из которого она получена. Правится
// макет, снимок перерисовывается этим скриптом:
//
//   node tests/fixtures/render.js
//
// Всё содержимое выдумано: имена, магазины, суммы. Настоящих денег здесь
// нет и быть не может — репозиторий открытый.
const { chromium } = require('playwright');
const path = require('path');

const SHOTS = [
  { html: 'fake-otp.html', png: 'otp.png', width: 430, scale: 3 },
  { html: 'fake-bank.html', png: 'bank-light.png', width: 430, height: 800, scale: 3, theme: 'light' },
  { html: 'fake-bank.html', png: 'bank-dark.png', width: 430, height: 800, scale: 3, theme: 'dark' },
  { html: 'fake-tbank.html', png: 'tbank.png', width: 430, scale: 3 },
];

(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'], executablePath: process.env.CHROMIUM_PATH || undefined });
  for (const shot of SHOTS) {
    const c = await b.newContext({
      viewport: { width: shot.width, height: shot.height || 900 },
      deviceScaleFactor: shot.scale,
      colorScheme: shot.theme || 'light',
      locale: 'ru-RU',
    });
    const p = await c.newPage();
    await p.goto(`file://${path.join(__dirname, shot.html)}`, { waitUntil: 'networkidle' });
    // Тёмная тема в макете включается классом, а не медиазапросом: так её
    // видно в разметке, и не приходится гадать, что применилось.
    if (shot.theme === 'dark') await p.evaluate(() => document.body.classList.add('dark'));
    await p.waitForTimeout(300);
    // Снимок ровно во вьюпорт, а не всей страницы: распознавание
    // зависит от размера картинки, и менять его между перерисовками нельзя.
    await p.screenshot({ path: path.join(__dirname, shot.png), fullPage: !shot.height });
    await c.close();
    console.log(`  ${shot.png}`);
  }
  await b.close();
})();

// Проверка зверя с эмуляцией Dynamic Island.
//
// Playwright не умеет подставлять env(safe-area-inset-*), поэтому
// подменяем токен --safe-top на реальные 59 пикселей iPhone 17 Pro Max
// и рисуем сверху чёрную пилюлю — ровно то, что закрывает система.
const { chromium } = require('playwright');
const path = require('path');
const FIX = path.join(__dirname, 'fixtures');

const OUT = path.join(__dirname, '.out');
const URL = 'http://127.0.0.1:8899/app/index.html';

// Остров на 17 Pro Max: примерно 125×37 pt, отступ сверху 11 pt.
const ISLAND = `
  :root { --safe-top: 59px !important; }
  body::before {
    content: '';
    position: fixed;
    top: 11px; left: 50%;
    transform: translateX(-50%);
    width: 125px; height: 37px;
    border-radius: 999px;
    background: #000;
    z-index: 1000;
    pointer-events: none;
  }
`;

let failed = 0;
const check = (label, got, want) => {
  const ok = got === want;
  if (!ok) failed += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}: ${got}`);
};

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'], executablePath: process.env.CHROMIUM_PATH || undefined });

  for (const mode of ['dark', 'light']) {
    const context = await browser.newContext({
      viewport: { width: 440, height: 956 },
      deviceScaleFactor: 3,
      isMobile: true, hasTouch: true,
      locale: 'ru-RU', timezoneId: 'Europe/Moscow', colorScheme: mode,
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto(`${URL}#/dashboard`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(700);
    await page.evaluate(async () => (await import('./js/store.js')).loadDemo());
    await page.reload({ waitUntil: 'networkidle' });
    await page.addStyleTag({ content: ISLAND });
    await page.waitForTimeout(1000);

    console.log(`\n${mode === 'dark' ? 'Тёмная' : 'Светлая'} тема`);
    check('зверь на месте', await page.isVisible('.mascot'), true);

    // Руки должны заходить под пилюлю, ноги — свисать ниже неё.
    const box = await page.evaluate(() => {
      const m = document.querySelector('.mascot').getBoundingClientRect();
      const s = getComputedStyle(document.documentElement).getPropertyValue('--safe-top');
      return { top: Math.round(m.top), bottom: Math.round(m.bottom), safe: s.trim() };
    });
    check('руки уходят выше границы острова', box.top < 48, true);
    check('тело ниже острова видно', box.bottom > 48, true);
    console.log(`       зверь: ${box.top}–${box.bottom} px, safe-top ${box.safe}`);

    // Не перехватывает касания.
    const passthrough = await page.evaluate(() => {
      const m = document.querySelector('.mascot').getBoundingClientRect();
      const el = document.elementFromPoint(m.left + m.width / 2, m.bottom - 4);
      return el && el.closest('.mascot') ? 'перехватывает' : 'проходит насквозь';
    });
    check('касания проходят насквозь', passthrough, 'проходит насквозь');

    // Не наезжает на содержимое.
    const overlap = await page.evaluate(() => {
      const m = document.querySelector('.mascot').getBoundingClientRect();
      const label = document.querySelector('.hero-label').getBoundingClientRect();
      return Math.round(label.top - m.bottom);
    });
    check('есть зазор до заголовка', overlap > 0, true);
    console.log(`       зазор: ${overlap} px`);

    await page.screenshot({ path: `${OUT}/${mode}-30-mascot.png`, clip: { x: 0, y: 0, width: 440, height: 420 } });

    // Радость на взносе.
    await page.click('.quick');
    await page.waitForTimeout(220);
    check('подпрыгивает на взносе', await page.evaluate(
      () => document.querySelector('.mascot').classList.contains('is-happy')), true);
    await page.screenshot({ path: `${OUT}/${mode}-31-mascot-happy.png`, clip: { x: 0, y: 0, width: 440, height: 420 } });

    // Выключение.
    await page.evaluate(async () => (await import('./js/mascot.js')).setEnabled(false));
    await page.waitForTimeout(300);
    check('выключается', await page.evaluate(() => !document.querySelector('.mascot')), true);
    await page.evaluate(async () => (await import('./js/mascot.js')).setEnabled(true));

    if (errors.length) { failed += 1; console.log(`  FAIL ошибки: ${errors.join('; ')}`); }
    await context.close();
  }

  await browser.close();
  console.log(failed ? `\n${failed} проверок провалено\n` : '\nВсе проверки прошли\n');
  process.exit(failed ? 1 : 0);
})();

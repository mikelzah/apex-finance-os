// Закрытие шторки протяжкой вниз. Жест шлём через CDP — это настоящие
// события касания, а не синтетические, которые ведут себя иначе.
const { chromium } = require('playwright');
const path = require('path');
const FIX = path.join(__dirname, 'fixtures');
const URL = 'http://127.0.0.1:8899/app/index.html';

let failed = 0;
const check = (label, ok, extra = '') => {
  if (!ok) failed += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
};

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'], executablePath: process.env.CHROMIUM_PATH || undefined });
  const context = await browser.newContext({
    viewport: { width: 440, height: 956 },
    isMobile: true, hasTouch: true, locale: 'ru-RU', timezoneId: 'Europe/Moscow',
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }],
  });

  /** Протяжка вниз из точки (x, y) на dist пикселей за steps шагов. */
  const swipeDown = async (x, y, dist, steps = 10, pause = 16) => {
    await touch('touchStart', x, y);
    for (let i = 1; i <= steps; i += 1) {
      await touch('touchMove', x, y + (dist * i) / steps);
      await new Promise((r) => setTimeout(r, pause));
    }
    await touch('touchEnd', x, y + dist);
  };

  const sheetOpen = () => page.evaluate(() => Boolean(document.querySelector('.sheet')));

  await page.goto(`${URL}#/dashboard`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  await page.evaluate(async () => (await import('./js/store.js')).loadDemo());
  await page.waitForTimeout(600);

  // Путь до шторки: Портфель → бумага → «Изменить» в шапке. Строка списка
  // теперь ведёт на страницу бумаги, а форма открывается уже оттуда.
  console.log('\nПортфель → страница бумаги → карточка актива');
  await page.goto(`${URL}#/portfolio`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3500); // ждём, пока уйдёт тост
  // Бумаги в портфеле перестали быть строками списка: у них свой узел
  // со значком, названием и построчной доходностью. Ведёт он туда же —
  // на страницу бумаги.
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.paper')];
    rows.find((r) => r.textContent.includes('Сбербанк')).click();
  });
  await page.waitForTimeout(600);
  await page.click('.header-action button');
  await page.waitForTimeout(500);
  check('шторка открылась', await sheetOpen());
  await page.screenshot({ path: path.join(__dirname, '.out', '50-sheet-open.png') });

  const grip = await page.evaluate(() => {
    const g = document.querySelector('.sheet-grip').getBoundingClientRect();
    return { x: Math.round(g.x + g.width / 2), y: Math.round(g.y + g.height / 2) };
  });

  console.log('\nПротяжка вниз');
  // Короткая протяжка — шторка должна вернуться.
  await swipeDown(grip.x, grip.y, 30);
  await page.waitForTimeout(400);
  check('короткая протяжка не закрывает', await sheetOpen(), '30 px');

  // Длинная — закрывает.
  await swipeDown(grip.x, grip.y, 320);
  await page.waitForTimeout(500);
  check('длинная протяжка закрывает', !(await sheetOpen()), '320 px');

  // Быстрый короткий смах — тоже закрывает.
  //
  // Два шага без пауз, иначе это не смах. Прошлая версия слала 4 шага
  // по 4 мс и на деле укладывалась в 155–203 мс: 90 пикселей за такое время —
  // это 0,44–0,58 px/мс при пороге 0,5, то есть жест сидел ровно на границе
  // и проходил или не проходил от посторонних причин. Синтетические касания
  // на простаивающей странице отдаются по кадрам, поэтому любое изменение
  // нагрузки сдвигало результат. Настоящий смах пальцем — от 1 px/мс.
  // Шторку закрыли прошлой проверкой — открываем заново тем же путём.
  await page.click('.header-action button');
  await page.waitForTimeout(500);
  await swipeDown(grip.x, grip.y, 90, 2, 0);
  await page.waitForTimeout(500);
  check('быстрый смах закрывает', !(await sheetOpen()), '90 px рывком');

  console.log('\nЧто не должно ломаться');
  // Протяжка из прокрученного тела не должна закрывать — она листает форму.
  await page.click('.header-action button');
  await page.waitForTimeout(500);
  await page.evaluate(() => { document.querySelector('.sheet-body').scrollTop = 200; });
  await page.waitForTimeout(200);
  const mid = await page.evaluate(() => {
    const b = document.querySelector('.sheet-body').getBoundingClientRect();
    return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) };
  });
  await swipeDown(mid.x, mid.y, 120);
  await page.waitForTimeout(400);
  check('протяжка из прокрученной формы не закрывает', await sheetOpen());

  // Кнопка-крестик по-прежнему работает.
  await page.click('.sheet-close');
  await page.waitForTimeout(500);
  check('крестик закрывает', !(await sheetOpen()));

  // Тап по затемнению.
  await page.click('.header-action button');
  await page.waitForTimeout(500);
  await page.click('.sheet-backdrop', { position: { x: 220, y: 40 } });
  await page.waitForTimeout(500);
  check('тап по затемнению закрывает', !(await sheetOpen()));

  // Сохранение из формы не сломалось.
  console.log('\nФорма продолжает работать');
  await page.goto(`${URL}#/journal`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const before = await page.evaluate(() => document.querySelectorAll('.op').length);
  await page.click('.screen-head .head-round');
  await page.waitForTimeout(500);
  await page.fill('.sheet-body .control', '750');
  await page.click('.sheet-foot .btn-primary');
  await page.waitForTimeout(700);
  const after = await page.evaluate(() => document.querySelectorAll('.op').length);
  check('операция сохраняется', after === before + 1, `${before} → ${after}`);
  check('шторка после сохранения закрыта', !(await sheetOpen()));

  await browser.close();
  if (errors.length) { failed += 1; console.log(`\nОшибки: ${errors.join('; ')}`); }
  console.log(failed ? `\n${failed} проверок провалено\n` : '\nВсе проверки прошли\n');
  process.exit(failed ? 1 : 0);
})();

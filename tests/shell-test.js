// Навигация обязана стоять на низу экрана при любом вьюпорте и не двигаться
// при прокрутке.
const { chromium } = require('playwright');
const URL = 'http://127.0.0.1:8899/app/index.html';

(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'], executablePath: process.env.CHROMIUM_PATH || undefined });
  let bad = 0;
  const check = (l, ok, d) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? ' — ' + d : ''}`); if (!ok) bad += 1; };

  // Вьюпорт нарочно много меньше экрана — как на устройстве (611 при 956).
  const c = await b.newContext({ viewport: { width: 440, height: 611 }, isMobile: true, hasTouch: true, locale: 'ru-RU', colorScheme: 'light' });
  const p = await c.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.addInitScript(`
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
    Object.defineProperty(window.screen, 'height', { get: () => 956, configurable: true });
    Object.defineProperty(window.screen, 'width', { get: () => 440, configurable: true });
  `);

  await p.goto(`${URL}#/dashboard`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  await p.evaluate(async () => (await import('./js/store.js')).loadDemo());
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(900);

  const geom = () => p.evaluate(() => {
    const app = document.getElementById('app').getBoundingClientRect();
    const bar = document.querySelector('.tabbar').getBoundingClientRect();
    const sc = document.getElementById('screen');
    return {
      appH: Math.round(app.height),
      barBottom: Math.round(bar.bottom), barTop: Math.round(bar.top),
      full: getComputedStyle(document.documentElement).getPropertyValue('--full-height').trim(),
      docScroll: document.documentElement.scrollHeight - document.documentElement.clientHeight,
      screenScroll: sc.scrollHeight - sc.clientHeight,
      screenTop: sc.scrollTop,
      fixedCount: [...document.querySelectorAll('*')].filter((n) => getComputedStyle(n).position === 'fixed').length,
    };
  });

  console.log('\n1. Оболочка в экран, а не во вьюпорт');
  let g = await geom();
  console.log(`     --full-height ${g.full}, высота оболочки ${g.appH}, панель ${g.barTop}–${g.barBottom}`);
  check('оболочка ростом с экран', g.appH === 956, String(g.appH));
  check('низ панели у нижнего края экрана', g.barBottom >= 900 && g.barBottom <= 956, String(g.barBottom));
  check('элементов с position: fixed нет', g.fixedCount === 0, String(g.fixedCount));

  console.log('\n2. Прокручивается содержимое, а не страница');
  // Переполнение у документа есть — оболочка выше вьюпорта. Важно не это,
  // а то, что прокрутить его нельзя: overflow: hidden запрещает прокрутку,
  // а не убирает переполнение.
  // overflow: hidden отменяет жест, но не программную прокрутку. Проверяем,
  // что страховка возвращает документ на место — именно это и произойдёт,
  // когда браузер сам поедет за полем ввода.
  const docMoved = await p.evaluate(() => new Promise((resolve) => {
    window.scrollTo(0, 500);
    document.documentElement.scrollTop = 500;
    setTimeout(() => resolve({
      win: window.scrollY,
      html: document.documentElement.scrollTop,
      body: document.body.scrollTop,
    }), 120);
  }));
  console.log(`     после попытки прокрутить документ: window ${docMoved.win}, html ${docMoved.html}, body ${docMoved.body}`);
  check('документ прокрутить нельзя', docMoved.win === 0 && docMoved.html === 0 && docMoved.body === 0,
    JSON.stringify(docMoved));
  check('содержимое прокручивается', g.screenScroll > 0, String(g.screenScroll));

  console.log('\n3. Панель не двигается при прокрутке');
  const before = (await geom()).barBottom;
  await p.evaluate(() => { document.getElementById('screen').scrollTop = 400; });
  await p.waitForTimeout(300);
  g = await geom();
  console.log(`     прокрутили на ${g.screenTop}, панель ${g.barTop}–${g.barBottom}`);
  check('содержимое уехало', g.screenTop === 400, String(g.screenTop));
  check('панель на месте', g.barBottom === before, `${g.barBottom} было ${before}`);

  console.log('\n4. Положение прокрутки живёт по правилам');
  await p.evaluate(() => { location.hash = '#/goals'; });
  await p.waitForTimeout(400);
  check('переход на другой экран — сверху', (await geom()).screenTop === 0, String((await geom()).screenTop));

  console.log('\n5. Стекло: панель полупрозрачна и размывает');
  const glass = await p.evaluate(() => {
    const cs = getComputedStyle(document.querySelector('.tabbar'));
    return { bg: cs.backgroundColor, blur: cs.backdropFilter || cs.webkitBackdropFilter, radius: cs.borderRadius };
  });
  console.log(`     фон ${glass.bg}, размытие ${glass.blur}, радиус ${glass.radius}`);
  check('фон полупрозрачный', /rgba\(.*0\.\d+\)/.test(glass.bg), glass.bg);
  check('размытие включено', /blur/.test(glass.blur || ''), glass.blur);
  check('капсула, а не прямоугольник', parseFloat(glass.radius) > 90, glass.radius);

  console.log('\n6. Содержимое проходит под панелью');
  const under = await p.evaluate(() => {
    const bar = document.querySelector('.tabbar').getBoundingClientRect();
    const sc = document.getElementById('screen').getBoundingClientRect();
    return { barTop: Math.round(bar.top), screenBottom: Math.round(sc.bottom) };
  });
  console.log(`     низ прокручиваемой области ${under.screenBottom}, верх панели ${under.barTop}`);
  check('область прокрутки уходит под панель', under.screenBottom > under.barTop,
    `${under.screenBottom} vs ${under.barTop}`);

  await c.close();
  await b.close();
  if (errs.length) { console.log('\nОшибки:'); errs.forEach((e) => console.log('  ' + e)); bad += errs.length; }
  console.log(bad ? `\n${bad} провалов\n` : '\nВсё сходится\n');
  process.exit(bad ? 1 : 0);
})();

// Тот же жест, но настоящими касаниями через CDP: на телефоне мышь не при чём,
// и именно у touch отменяется прокрутка.
const { chromium } = require('playwright');
const URL = 'http://127.0.0.1:8899/app/index.html';
(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'], executablePath: process.env.CHROMIUM_PATH || undefined });
  const c = await b.newContext({ viewport: { width: 440, height: 956 }, isMobile: true, hasTouch: true, locale: 'ru-RU' });
  const p = await c.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  const cdp = await c.newCDPSession(p);
  let bad = 0;
  const check = (l, ok, d) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? ' — ' + d : ''}`); if (!ok) bad += 1; };
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', {
    type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }],
  });

  await p.goto(`${URL}#/dashboard`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(500);
  await p.evaluate(async () => (await import('./js/store.js')).loadDemo());
  await p.goto(`${URL}#/goals`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(900);

  const names = () => p.evaluate(() => [...document.querySelectorAll('.goal-name')].map((n) => n.textContent.trim()));
  const before = await names();
  console.log(`\n  было: ${before.join(' · ')}`);

  // Тянуть надо не на расстояние между шапками, а пока центр карточки
  // не пройдёт центр соседней: карточки разной высоты, и первое много меньше
  // второго. Это правило самого жеста, а не особенность проверки.
  const pt = await p.evaluate(() => {
    const heads = [...document.querySelectorAll('.goal-head')];
    const cards = [...document.querySelectorAll('.screen .card')];
    const h = heads[0].getBoundingClientRect();
    const a = cards[0].getBoundingClientRect();
    const b = cards[1].getBoundingClientRect();
    const centre = (r) => r.top + r.height / 2;
    return { x: h.left + 60, y: h.top + h.height / 2, dy: centre(b) - centre(a) + 12 };
  });

  console.log('\n1. Пальцем: подержать и перетащить');
  const scrollBefore = await p.evaluate(() => document.getElementById('screen').scrollTop);
  await touch('touchStart', pt.x, pt.y);
  await p.waitForTimeout(400);
  check('карточка взята', await p.evaluate(() => Boolean(document.querySelector('.card.is-dragging'))));
  for (let i = 1; i <= 14; i += 1) {
    await touch('touchMove', pt.x, pt.y + (pt.dy * i) / 14);
    await p.waitForTimeout(16);
  }
  const scrollDuring = await p.evaluate(() => document.getElementById('screen').scrollTop);
  check('экран не поехал во время переноса', scrollDuring === scrollBefore, `${scrollBefore} → ${scrollDuring}`);
  await touch('touchEnd', 0, 0);
  await p.waitForTimeout(900);
  const after = await names();
  console.log(`  стало: ${after.join(' · ')}`);
  check('порядок поменялся', after.join() !== before.join(), after.join(' · '));
  check('форма не открылась поверх', !(await p.evaluate(() => Boolean(document.querySelector('.sheet')))));

  console.log('\n2. Пальцем без удержания — экран прокручивается');
  const order = await names();
  const top = await p.evaluate(() => document.getElementById('screen').scrollTop);
  const g = await p.evaluate(() => {
    const r = document.querySelector('.goal-head').getBoundingClientRect();
    return { x: r.left + 60, y: r.top + r.height / 2 };
  });
  await touch('touchStart', g.x, g.y);
  for (let i = 1; i <= 10; i += 1) { await touch('touchMove', g.x, g.y - i * 22); await p.waitForTimeout(14); }
  await touch('touchEnd', 0, 0);
  await p.waitForTimeout(700);
  const moved = await p.evaluate(() => document.getElementById('screen').scrollTop);
  console.log(`     прокрутка ${top} → ${moved}`);
  check('экран прокрутился', moved > top, `${top} → ${moved}`);
  check('порядок не тронут', (await names()).join() === order.join());

  console.log(`\n  ошибок в консоли: ${errs.length}${errs.length ? ' — ' + errs.join(' | ') : ''}`);
  if (errs.length) bad += 1;
  await b.close();
  console.log(bad ? `\n${bad} провалов` : '\nВсё сходится');
  process.exit(bad ? 1 : 0);
})();

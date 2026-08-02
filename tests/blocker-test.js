const { chromium } = require('playwright');
const URL = 'http://127.0.0.1:8899/app/index.html';
(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'], executablePath: process.env.CHROMIUM_PATH || undefined });
  const c = await b.newContext({ viewport: { width: 440, height: 956 }, isMobile: true, hasTouch: true, locale: 'ru-RU' });
  const p = await c.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  let bad = 0;
  const check = (l, ok, d) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? ' — ' + d : ''}`); if (!ok) bad += 1; };

  await p.goto(`${URL}#/dashboard`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(600);
  await p.evaluate(async () => {
    const store = await import('./js/store.js');
    const D = await import('./js/dates.js');
    await store.startEmpty();
    await store.mutate((d) => {
      d.assets = [
        { id: 'dep', name: 'Вклад', type: 'Деньги', status: 'Активен', liquidity: 'Низкая',
          assetClass: 'Вклады', opening: 1800000, openingDate: null, rate: 18, goalIds: [] },
        { id: 'sav', name: 'Накопительный счёт', type: 'Деньги', status: 'Активен',
          liquidity: 'Мгновенная', assetClass: 'Вклады', opening: 0,
          openingDate: D.addDays(D.today(), -10), rate: 8, goalIds: [] },
      ];
      d.operations = [{ id: 'c', date: D.addDays(D.today(), -4), type: 'Взнос', amount: 9289,
        assetId: 'sav', goalId: null, source: 'Вручную', comment: null }];
    });
  });
  await p.goto(`${URL}#/portfolio`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(900);

  console.log('\n1. Абсурдной доходности больше нет');
  const top = await p.evaluate(() => ({
    rate: document.querySelector('.hero-delta')?.textContent.trim() || null,
    note: document.querySelector('.hero-note')?.textContent.trim() || null,
  }));
  console.log(`     ${top.rate || 'числа нет'} · ${top.note}`);
  check('процент не показан', top.rate === null, top.rate);
  check('вместо него объяснение', Boolean(top.note), top.note);
  check('назван виновник', /Вклад/.test(top.note || ''), top.note);
  check('и чего не хватает', /даты начального остатка/.test(top.note || ''), top.note);

  console.log('\n2. Объяснение ведёт в проверку данных');
  await p.locator('.hero-note').click();
  await p.waitForTimeout(700);
  check('открылась проверка', (await p.evaluate(() => location.hash)) === '#/more/health');
  const found = await p.evaluate(() => [...document.querySelectorAll('.row-label small')].map((x) => x.textContent.trim()));
  check('в ней та же находка', found.some((x) => /без даты/.test(x)), found.join(' | '));

  console.log('\n3. Заполнили дату — доходность появилась');
  await p.evaluate(async () => {
    const store = await import('./js/store.js');
    const D = await import('./js/dates.js');
    await store.mutate((d) => { d.assets.find((a) => a.id === 'dep').openingDate = D.addYears(D.today(), -1); });
  });
  await p.goto(`${URL}#/portfolio`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  const after = await p.evaluate(() => ({
    rate: document.querySelector('.hero-delta')?.textContent.trim() || null,
    note: document.querySelector('.hero-note')?.textContent.trim() || null,
    classRate: [...document.querySelectorAll('.section-rate')].map((x) => x.textContent.trim()),
  }));
  console.log(`     ${after.rate} · у класса: ${after.classRate.join(', ')}`);
  check('процент появился', Boolean(after.rate), after.rate);
  check('объяснение убралось', after.note === null, after.note);
  check('и у класса «Вклады» тоже', after.classRate.length === 1, after.classRate.join(', '));
  const num = parseFloat((after.rate || '').replace(/[^\d,.-]/g, '').replace(',', '.'));
  console.log(`     число: ${num}%`);
  check('оно правдоподобное, а не 205%', num > -5 && num < 30, String(num));

  console.log(`\n  ошибок в консоли: ${errs.length}${errs.length ? ' — ' + errs.join(' | ') : ''}`);
  if (errs.length) bad += 1;
  await b.close();
  console.log(bad ? `\n${bad} провалов` : '\nВсё сходится');
  process.exit(bad ? 1 : 0);
})();

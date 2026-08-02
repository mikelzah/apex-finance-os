// Копейки: там, где сверяют с банком, они на месте; ровные суммы не засоряются.
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
  // Счёт как на снимке: ровные взносы и дробные проценты.
  await p.evaluate(async () => {
    const store = await import('./js/store.js');
    const D = await import('./js/dates.js');
    await store.startEmpty();
    await store.mutate((d) => {
      d.assets = [{ id: 'sav', name: 'Накопительный счёт', type: 'Деньги', status: 'Активен',
        liquidity: 'Мгновенная', assetClass: 'Вклады', rate: 8, opening: 0,
        openingDate: D.addDays(D.today(), -10), goalIds: [] }];
      const add = (date, type, amount, comment) => d.operations.push({
        id: store.newId('op'), date, type, amount, assetId: 'sav', goalId: null,
        source: type === 'Доход' ? 'Расчёт' : 'Вручную', comment,
      });
      add(D.addDays(D.today(), -4), 'Взнос', 1250, null);
      add(D.addDays(D.today(), -3), 'Взнос', 1250, null);
      add(D.addDays(D.today(), -1), 'Доход', 4.32, 'Разница со сверкой');
      add(D.today(), 'Взнос', 1250, null);
      add(D.today(), 'Доход', 3.97, 'Проценты, расчёт');
    });
  });
  await p.goto(`${URL}#/portfolio/sav`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(900);

  const rows = await p.evaluate(() => [...document.querySelectorAll('.row')].map((r) => ({
    l: r.querySelector('.row-label span').textContent.trim(),
    v: r.querySelector('.row-value span').textContent.trim(),
  })));
  rows.forEach((r) => console.log(`     ${r.l} — ${r.v}`));

  console.log('\n1. Проценты показаны с копейками');
  const income = rows.filter((r) => /Доход/.test(r.l));
  check('3,97 не превратилось в 4', income.some((r) => /3,97/.test(r.v)), income.map((r) => r.v).join(', '));
  check('4,32 не превратилось в 4', income.some((r) => /4,32/.test(r.v)), income.map((r) => r.v).join(', '));

  console.log('\n2. Ровные взносы копейками не засорены');
  const paid = rows.filter((r) => /Взнос/.test(r.l));
  check('взносы без «,00»', paid.every((r) => !/,00/.test(r.v)), paid.map((r) => r.v).join(', '));
  check('и это по-прежнему 1 250 ₽', paid.every((r) => /1\s?250\s?₽/.test(r.v.replace(/ /g, ' '))), paid.map((r) => r.v).join(', '));

  console.log('\n3. Остаток счёта — с копейками: его сверяют с банком');
  const stat = await p.evaluate(() => ({
    v: document.querySelector('.stat-value').textContent.trim(),
    exact: null,
  }));
  const truth = await p.evaluate(async () => {
    const store = await import('./js/store.js');
    const C = await import('./js/calc.js');
    const s = store.getState();
    return C.assetValue(s.assets[0], s.operations);
  });
  console.log(`     на экране ${stat.v}, в расчёте ${truth}`);
  check('копейки видны', /,/.test(stat.v), stat.v);
  check('и совпадают с расчётом', stat.v.replace(/\s| /g, '').startsWith(truth.toFixed(2).replace('.', ',')), `${stat.v} vs ${truth}`);

  console.log('\n4. В журнале то же самое');
  await p.goto(`${URL}#/journal`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  const amounts = await p.evaluate(() => [...document.querySelectorAll('.op-amount')].map((x) => x.textContent.trim()));
  console.log(`     ${amounts.join(' | ')}`);
  check('проценты с копейками', amounts.some((x) => /3,97/.test(x)), amounts.join(', '));
  check('взносы без копеек', amounts.filter((x) => /1\s?250/.test(x)).every((x) => !/,/.test(x)), amounts.join(', '));

  console.log('\n5. Месячные итоги — тоже суммы операций, тоже с копейками');
  const summary = await p.evaluate(() => [...document.querySelectorAll('.stat-value')].map((x) => x.textContent.trim()));
  const monthTotal = await p.evaluate(() => document.querySelector('.month-total')?.textContent.trim());
  console.log(`     ${summary.join(' | ')} · итог месяца ${monthTotal}`);
  check('начислено 8,29 ₽, а не 8 ₽', summary.some((x) => /8,29/.test(x)), summary.join(', '));
  check('внесено осталось ровным', summary.some((x) => /3\s?750\s?₽/.test(x.replace(/ /g, ' '))), summary.join(', '));
  check('итог месяца с копейками', /,\d\d/.test(monthTotal || ''), monthTotal);

  console.log('\n5а. Капитал остаётся округлённым: там копейки — шум');
  const capital = await p.evaluate(async () => {
    location.hash = '#/dashboard';
    await new Promise((r) => setTimeout(r, 700));
    return document.querySelector('.hero-value')?.textContent.trim();
  });
  console.log(`     ${capital}`);
  check('в капитале копеек нет', !/,\d\d/.test(capital || ''), capital);
  await p.goto(`${URL}#/journal`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(600);

  console.log('\n6. Скрытие сумм по-прежнему работает');
  await p.evaluate(async () => (await import('./js/fmt.js')).setHidden(true));
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  const masked = await p.evaluate(() => [...document.querySelectorAll('.op-amount')].map((x) => x.textContent.trim()));
  console.log(`     ${masked.slice(0, 3).join(' | ')}`);
  check('точные суммы тоже скрыты', masked.every((x) => /•/.test(x)), masked.join(', '));
  await p.evaluate(async () => (await import('./js/fmt.js')).setHidden(false));

  console.log(`\n  ошибок в консоли: ${errs.length}${errs.length ? ' — ' + errs.join(' | ') : ''}`);
  if (errs.length) bad += 1;
  await b.close();
  console.log(bad ? `\n${bad} провалов` : '\nВсё сходится');
  process.exit(bad ? 1 : 0);
})();

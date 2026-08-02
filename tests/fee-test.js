// Средняя цена: с комиссией и без. Воспроизводим случай с экрана брокера.
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
    const C = await import('./js/calc.js');
    await store.startEmpty();
    await store.mutate((d) => {
      d.assets = [{ id: 'lqdt', name: 'LQDT', type: 'Инвестиции', status: 'Активен', liquidity: 'T+1',
        assetClass: 'Фонды', ticker: 'LQDT', quantity: 0, lotSize: 1, price: 2.0519, goalIds: [] }];
      // 211 шт по 2,0363 ₽ плюс комиссия 1,29 ₽ — как в отчёте брокера.
      store.savePaperOp(d, {
        id: 'buy', date: '2026-07-11', type: C.OP_BUY, quantity: 211, unitPrice: 2.0363,
        fee: 1.29, amount: 211 * 2.0363 + 1.29, assetId: 'lqdt', ticker: 'LQDT',
        goalId: null, source: 'Вручную', comment: null,
      }, null);
    });
  });
  await p.goto(`${URL}#/portfolio/lqdt`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(900);

  const pos = await p.evaluate(() => [...document.querySelectorAll('.stat')].map((s) => ({
    l: s.querySelector('.stat-label').textContent.trim(),
    v: s.querySelector('.stat-value').textContent.trim(),
    h: s.querySelector('.stat-hint')?.textContent.trim() || null,
  })));
  pos.forEach((x) => console.log(`     ${x.l}: ${x.v}${x.h ? ` (${x.h})` : ''}`));

  const avg = pos.find((x) => x.l === 'Средняя цена');
  const fee = pos.find((x) => x.l === 'Комиссия');
  const profit = pos.find((x) => /Прибыль|Убыток/.test(x.l));

  console.log('\n1. Средняя считается по заплаченному');
  check('средняя с комиссией — 2,0424 ₽', /2,0424/.test(avg.v), avg.v);

  console.log('\n2. Рядом стоит цена самой бумаги — та, что у брокера');
  check('показана и чистая цена', /2,0363/.test(avg.h || ''), avg.h);
  check('и сказано, что первая с комиссией', /с комиссией/.test(avg.h || ''), avg.h);

  console.log('\n3. Комиссия названа отдельной строкой');
  check('строка комиссии есть', Boolean(fee), pos.map((x) => x.l).join(', '));
  check('и равна 1,29 ₽', /1,29/.test(fee?.v || ''), fee?.v);

  console.log('\n4. Прибыль считается от заплаченного, а не от цены бумаги');
  console.log(`     ${profit.v} (${profit.h})`);
  check('прибыль +2 ₽, а не +3', /\+2\s*₽/.test(profit.v), profit.v);

  console.log('\n5. Без комиссии подпись прежняя');
  await p.evaluate(async () => {
    const store = await import('./js/store.js');
    await store.mutate((d) => { d.operations.find((o) => o.id === 'buy').fee = null; });
  });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  const plain = await p.evaluate(() => [...document.querySelectorAll('.stat')].map((s) => ({
    l: s.querySelector('.stat-label').textContent.trim(),
    h: s.querySelector('.stat-hint')?.textContent.trim() || null,
  })));
  const avg2 = plain.find((x) => x.l === 'Средняя цена');
  console.log(`     ${avg2.h}`);
  check('строки комиссии нет', !plain.some((x) => x.l === 'Комиссия'), plain.map((x) => x.l).join(', '));
  check('подпись про количество', /куплено/.test(avg2.h || ''), avg2.h);

  console.log(`\n  ошибок в консоли: ${errs.length}${errs.length ? ' — ' + errs.join(' | ') : ''}`);
  if (errs.length) bad += 1;
  await b.close();
  console.log(bad ? `\n${bad} провалов` : '\nВсё сходится');
  process.exit(bad ? 1 : 0);
})();

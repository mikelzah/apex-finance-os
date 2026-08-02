// Прирост капитала: не выдумывается там, где вход неизвестен, и считает
// начальный остаток без даты.
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

  // Повторяем случай с экрана: бумаги заведены количеством, вклад без даты.
  await p.evaluate(async () => {
    const store = await import('./js/store.js');
    await store.startEmpty();
    await store.mutate((d) => {
      d.assets = [
        { id: 'gmkn', name: 'GMKN', type: 'Инвестиции', status: 'Активен', liquidity: 'T+1',
          assetClass: 'Акции', ticker: 'GMKN', quantity: 8010, lotSize: 1, price: 114.48, goalIds: [] },
        { id: 'dep', name: 'Вклад', type: 'Деньги', status: 'Активен', liquidity: 'Низкая',
          assetClass: 'Вклады', opening: 1800000, openingDate: null, rate: 18, goalIds: [] },
      ];
    });
  });
  await p.goto(`${URL}#/more/history`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(900);

  console.log('\n1. Пока цена входа бумаги неизвестна — прироста нет');
  const blocked = await p.evaluate(() => ({
    stats: [...document.querySelectorAll('.stat-label')].map((x) => x.textContent.trim()),
    warn: document.querySelector('.callout-warn')?.textContent.trim() || null,
    capital: document.querySelector('.stat-value')?.textContent.trim(),
  }));
  console.log(`     ${blocked.stats.join(' | ')}`);
  console.log(`     ${blocked.warn}`);
  check('капитал показан', /₽/.test(blocked.capital || ''), blocked.capital);
  check('«наросло» не показано', !blocked.stats.some((x) => /Наросло|Просело/.test(x)), blocked.stats.join(', '));
  check('«вложено» не показано', !blocked.stats.includes('Вложено своих'), blocked.stats.join(', '));
  check('объяснено почему', /Прирост не посчитать/.test(blocked.warn || ''), blocked.warn);
  check('бумага названа поимённо', /GMKN/.test(blocked.warn || ''), blocked.warn);

  console.log('\n2. Записали покупку — разложение появилось и сходится');
  await p.evaluate(async () => {
    const store = await import('./js/store.js');
    const C = await import('./js/calc.js');
    const D = await import('./js/dates.js');
    await store.mutate((d) => {
      d.assets.find((a) => a.id === 'gmkn').quantity = 0;
      store.savePaperOp(d, {
        id: store.newId('op'), date: D.addYears(D.today(), -1), type: C.OP_BUY,
        quantity: 8010, unitPrice: 100, fee: null, amount: 801000, assetId: 'gmkn',
        ticker: 'GMKN', goalId: null, source: 'Вручную', comment: null,
      }, null);
    });
  });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  const ok = await p.evaluate(async () => {
    const store = await import('./js/store.js');
    const C = await import('./js/calc.js');
    const D = await import('./js/dates.js');
    const s = store.getState();
    return {
      stats: [...document.querySelectorAll('.stat')].map((x) => ({
        l: x.querySelector('.stat-label').textContent.trim(),
        v: x.querySelector('.stat-value').textContent.trim(),
      })),
      invested: C.investedAt(s.assets, s.operations, D.today()),
      total: C.netWorth(s.assets, s.operations).total,
    };
  });
  console.log(`     ${ok.stats.map((x) => `${x.l}: ${x.v}`).join(' | ')}`);
  console.log(`     расчёт: вложено ${ok.invested}, капитал ${ok.total.toFixed(0)}`);
  check('вложено появилось', ok.stats.some((x) => x.l === 'Вложено своих'), ok.stats.map((x) => x.l).join(', '));
  // Вклад 1 800 000 без даты + покупка 801 000 = 2 601 000.
  check('вклад без даты посчитан', Math.abs(ok.invested - 2601000) < 1, String(ok.invested));
  check('прирост = капитал минус вложенное',
    Math.abs((ok.total - ok.invested) - (ok.total - 2601000)) < 1, String(ok.total - ok.invested));

  console.log('\n3. Снимок за день, а не за месяц');
  const snapNow = await p.evaluate(async () => (await import('./js/store.js')).getState().netWorth.map((r) => r.date));
  console.log(`     снимки: ${snapNow.join(', ')}`);
  check('снимок за сегодня есть', snapNow.length === 1, JSON.stringify(snapNow));

  const msg = await p.evaluate(async () => {
    const store = await import('./js/store.js');
    const D = await import('./js/dates.js');
    const written = await store.snapshotWorth(D.today());
    return { written, n: store.getState().netWorth.length };
  });
  console.log(`     повторный снимок записан: ${msg.written}, всего ${msg.n}`);
  check('повторный снимок ничего не портит', msg.n === 1, String(msg.n));
  check('и честно говорит, что не менялось', msg.written === false, String(msg.written));

  console.log('\n4. Кнопка объясняет, что произошло');
  await p.locator('.card:has-text("История капитала") .btn').click();
  await p.waitForTimeout(700);
  const toast = await p.evaluate(() => document.querySelector('.toast')?.textContent.trim() || null);
  console.log(`     ${toast}`);
  check('в сообщении сказано про снимок', /снимок/i.test(toast || ''), toast);

  console.log('\n5. Пустой график объясняет срок, а не требует действий');
  const hint = await p.evaluate(() => document.querySelector('.empty')?.textContent.trim() || null);
  console.log(`     ${hint}`);
  check('сказано, что линия начнётся со второго дня', /второго дня/.test(hint || ''), hint);
  check('и что снимок пишется сам', /сам/.test(hint || ''), hint);

  console.log('\n6. Со вторым днём линия появляется');
  await p.evaluate(async () => {
    const store = await import('./js/store.js');
    const D = await import('./js/dates.js');
    await store.mutate((d) => {
      d.netWorth.push({ month: D.month(D.addDays(D.today(), -1)), date: D.addDays(D.today(), -1),
        total: 2500000, liquid: 100000, invested: 2400000 });
    });
  });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  const chart = await p.evaluate(() => ({
    line: Boolean(document.querySelector('.chart-line')),
    second: Boolean(document.querySelector('.chart-line-second')),
  }));
  check('линия капитала нарисована', chart.line);
  check('и линия вложенного тоже', chart.second);

  console.log(`\n  ошибок в консоли: ${errs.length}${errs.length ? ' — ' + errs.join(' | ') : ''}`);
  if (errs.length) bad += 1;
  await b.close();
  console.log(bad ? `\n${bad} провалов` : '\nВсё сходится');
  process.exit(bad ? 1 : 0);
})();

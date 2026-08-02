// Доходность на экранах: у бумаги, у класса и у всего портфеля.
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
  await p.evaluate(async () => (await import('./js/store.js')).loadDemo());

  console.log('\n1. Пока цена входа неизвестна — доходности нет');
  await p.goto(`${URL}#/portfolio`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  // Вклад знает и сумму, и дату входа — его доходность законна и до сделок.
  // Неизвестна она только там, где бумага заведена начальным количеством.
  const byClass = () => p.evaluate(() => {
    const out = {};
    for (const g of document.querySelectorAll('.group')) {
      const name = g.querySelector('.section-title h2')?.textContent.trim();
      out[name] = g.querySelector('.section-rate')?.textContent.trim() || null;
    }
    return { hero: document.querySelector('.hero-delta')?.textContent.trim() || null, classes: out };
  });
  const before = await byClass();
  console.log(`     под суммой: ${before.hero || 'ничего'}, у классов: ${JSON.stringify(before.classes)}`);
  check('у портфеля доходности нет', before.hero === null, String(before.hero));
  check('у акций нет', before.classes['Акции'] === null, String(before.classes['Акции']));
  check('у фондов нет', before.classes['Фонды'] === null, String(before.classes['Фонды']));
  check('у вкладов есть — там вход известен', Boolean(before.classes['Вклады']), String(before.classes['Вклады']));

  console.log('\n2. Обнуляем начальные количества и пишем сделки — доходность появляется');
  await p.evaluate(async () => {
    const store = await import('./js/store.js');
    const C = await import('./js/calc.js');
    const today = new Date();
    const year = new Date(today.getTime() - 365 * 86400000).toISOString().slice(0, 10);
    await store.mutate((d) => {
      for (const a of d.assets) if (a.ticker) a.quantity = 0;
      for (const [id, qty, price] of [['demo-sber', 140, 280], ['demo-fund', 1800, 1.9]]) {
        const asset = d.assets.find((x) => x.id === id);
        if (!asset) continue;
        store.savePaperOp(d, {
          id: store.newId('op'), date: year, type: C.OP_BUY, quantity: qty, unitPrice: price,
          fee: null, amount: qty * price, assetId: id, ticker: asset.ticker, goalId: null,
          source: 'Вручную', comment: null,
        }, null);
      }
    });
  });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  const after = await p.evaluate(() => ({
    hero: document.querySelector('.hero-delta')?.textContent.trim() || null,
    rates: [...document.querySelectorAll('.section-rate')].map((x) => x.textContent.trim()),
  }));
  console.log(`     под суммой: ${after.hero}, у классов: ${after.rates.join(', ')}`);
  check('доходность портфеля показана', /годовых/.test(after.hero || ''), after.hero);
  check('доходность классов показана', after.rates.length >= 2, after.rates.join(', '));

  console.log('\n3. Сходится с расчётом');
  const truth = await p.evaluate(async () => {
    const store = await import('./js/store.js');
    const C = await import('./js/calc.js');
    const s = store.getState();
    const today = new Date().toISOString().slice(0, 10);
    const inP = s.assets.filter((a) => C.ASSET_CLASSES.includes(a.assetClass) && a.status !== 'Продан');
    const sber = s.assets.find((a) => a.id === 'demo-sber');
    return {
      portfolio: C.returnOf(inP, s.operations, today),
      sber: C.returnOf([sber], s.operations, today),
      sberValue: C.assetValue(sber, s.operations),
    };
  });
  console.log(`     портфель ${truth.portfolio?.toFixed(2)}%, Сбер ${truth.sber?.toFixed(2)}%`);
  const heroNum = parseFloat((after.hero || '').replace(/[^\d,.-]/g, '').replace(',', '.'));
  check('число под суммой совпадает с расчётом', Math.abs(heroNum - truth.portfolio) < 0.02, `${heroNum} vs ${truth.portfolio}`);
  // Сбер: куплен по 280 год назад, стоит 318,4. Годовых должно быть около 13,7%.
  check('доходность Сбера правдоподобна', truth.sber > 12 && truth.sber < 15, String(truth.sber));

  console.log('\n4. На странице бумаги — своя строка');
  await p.goto(`${URL}#/portfolio/demo-sber`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  const pos = await p.evaluate(() => [...document.querySelectorAll('.stat')].map((s) => ({
    l: s.querySelector('.stat-label').textContent.trim(),
    v: s.querySelector('.stat-value').textContent.trim(),
  })));
  console.log(`     ${pos.map((x) => `${x.l}: ${x.v}`).join(' | ')}`);
  const rate = pos.find((x) => x.l === 'Доходность');
  check('доходность бумаги показана', Boolean(rate), JSON.stringify(pos.map((x) => x.l)));
  check('с пометкой «годовых»', /годовых/.test(rate?.v || ''), rate?.v);
  check('рядом есть прибыль', pos.some((x) => /Прибыль|Убыток/.test(x.l)), pos.map((x) => x.l).join(', '));

  console.log(`\n  ошибок в консоли: ${errs.length}${errs.length ? ' — ' + errs.join(' | ') : ''}`);
  if (errs.length) bad += 1;
  await b.close();
  console.log(bad ? `\n${bad} провалов` : '\nВсё сходится');
  process.exit(bad ? 1 : 0);
})();

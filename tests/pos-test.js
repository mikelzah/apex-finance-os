// Позиция: прибыль показывается только там, где цена входа известна целиком.
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
  await p.waitForTimeout(500);
  await p.evaluate(async () => (await import('./js/store.js')).loadDemo());

  const trade = (assetId, qty, price) => p.evaluate(async ([assetId, qty, price]) => {
    const store = await import('./js/store.js');
    const C = await import('./js/calc.js');
    const t = { id: store.newId('op'), date: new Date().toISOString().slice(0, 10), type: C.OP_BUY,
      quantity: qty, unitPrice: price, fee: null, amount: qty * price, assetId, goalId: null, source: 'Вручную', comment: null };
    await store.mutate((d) => store.savePaperOp(d, t, null));
  }, [assetId, qty, price]);

  const posCard = () => p.evaluate(() => {
    const card = [...document.querySelectorAll('.card')].find((x) => x.querySelector('h2')?.textContent.trim() === 'Позиция');
    if (!card) return null;
    return [...card.querySelectorAll('.stat')].map((s) => ({
      label: s.querySelector('.stat-label').textContent.trim(),
      value: s.querySelector('.stat-value').textContent.trim(),
    }));
  });

  console.log('\n1. Есть начальный блок — прибыль не выдумывается');
  await trade('demo-sber', 10, 300);
  await p.goto(`${URL}#/portfolio/demo-sber`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  const mixed = await posCard();
  console.log(`     ${mixed.map((s) => `${s.label}: ${s.value}`).join(' | ')}`);
  check('средняя по сделкам показана', mixed.some((s) => s.label === 'Средняя цена'), JSON.stringify(mixed));
  check('прибыли нет', !mixed.some((s) => /Прибыль|Убыток/.test(s.label)), JSON.stringify(mixed.map((s) => s.label)));
  check('сказано, почему', mixed.some((s) => /Цена входа известна не/.test(s.label)));

  console.log('\n2. Обнуляем начальный блок — прибыль появляется и считается верно');
  await p.evaluate(async () => {
    const store = await import('./js/store.js');
    await store.mutate((d) => { d.assets.find((a) => a.id === 'demo-sber').quantity = 0; });
  });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  const clean = await posCard();
  const nums = await p.evaluate(async () => {
    const store = await import('./js/store.js');
    const C = await import('./js/calc.js');
    const s = store.getState();
    const a = s.assets.find((x) => x.id === 'demo-sber');
    return { held: C.assetQuantity(a, s.operations), price: a.price, value: C.assetValue(a, s.operations) };
  });
  console.log(`     ${clean.map((s) => `${s.label}: ${s.value}`).join(' | ')}`);
  console.log(`     ${nums.held} шт × ${nums.price} ₽ = ${nums.value} ₽, куплено по 300`);
  const profit = clean.find((s) => /Прибыль|Убыток/.test(s.label));
  check('прибыль показана', Boolean(profit), JSON.stringify(clean.map((s) => s.label)));
  const expected = nums.value - 300 * nums.held;
  check('прибыль = рынок минус вложено', profit && profit.value.replace(/\s| /g, '').startsWith(`+${Math.round(expected)}`),
    `${profit?.value}, ожидалось +${expected}`);

  console.log(`\n  ошибок в консоли: ${errs.length}${errs.length ? ' — ' + errs.join(' | ') : ''}`);
  if (errs.length) bad += 1;
  await b.close();
  console.log(bad ? `\n${bad} провалов` : '\nВсё сходится');
  process.exit(bad ? 1 : 0);
})();

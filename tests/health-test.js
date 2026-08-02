// Ребалансировка суммами и проверка данных.
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
  const near = (a, z, eps = 1) => Math.abs(a - z) <= eps;

  await p.goto(`${URL}#/dashboard`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(600);
  await p.evaluate(async () => (await import('./js/store.js')).loadDemo());

  console.log('\n1. Ярлык доли называет сумму, а не только направление');
  await p.goto(`${URL}#/portfolio`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  const tags = await p.evaluate(() => [...document.querySelectorAll('.alloc-row')].map((r) => ({
    cls: r.querySelector('.alloc-name').textContent.trim(),
    tag: r.querySelector('.tag').textContent.trim(),
  })));
  tags.forEach((t) => console.log(`     ${t.cls}: ${t.tag}`));
  check('в ярлыках есть рубли', tags.some((t) => /₽/.test(t.tag)), JSON.stringify(tags));
  check('«в норме» без суммы', tags.filter((t) => /в норме/.test(t.tag)).every((t) => !/₽/.test(t.tag)), JSON.stringify(tags));

  console.log('\n2. План довложения');
  const plan = await p.evaluate(() => {
    const n = document.querySelector('.plan');
    if (!n) return null;
    return {
      total: n.querySelector('.plan-total').textContent.trim(),
      rows: [...n.querySelectorAll('.plan-row')].map((r) => r.textContent.replace(/\s+/g, ' ').trim()),
    };
  });
  console.log(`     всего ${plan?.total}: ${plan?.rows.join(' | ')}`);
  check('план показан', Boolean(plan));
  check('в нём есть классы с суммами', plan.rows.length >= 1, JSON.stringify(plan?.rows));

  console.log('\n3. План проверяется расчётом: после довложения доли сходятся');
  const math = await p.evaluate(async () => {
    const store = await import('./js/store.js');
    const C = await import('./js/calc.js');
    const s = store.getState();
    const { rows, total } = C.portfolioRows(s.assets, s.operations, s.portfolio);
    const plan = C.rebalanceByAdding(rows);
    const add = new Map(plan.items.map((x) => [x.class, x.add]));
    const after = rows
      .filter((r) => r.targetShare != null && r.targetShare > 0)
      .map((r) => ({
        cls: r.class,
        target: r.targetShare,
        share: ((r.value + (add.get(r.class) || 0)) / (total + plan.total)) * 100,
      }));
    return { plan, after, total };
  });
  math.after.forEach((a) => console.log(`     ${a.cls}: стало ${a.share.toFixed(2)}% при цели ${a.target}%`));
  check('ни одна доля не ниже цели', math.after.every((a) => a.share >= a.target - 0.05), JSON.stringify(math.after));
  check('и не выше', math.after.every((a) => a.share <= a.target + 0.05), JSON.stringify(math.after));
  check('ничего не продаётся', math.plan.items.every((x) => x.add > 0), JSON.stringify(math.plan.items));

  console.log('\n4. Проверка данных находит двойной счёт');
  await p.evaluate(async () => {
    const store = await import('./js/store.js');
    await store.mutate((d) => {
      const a = d.assets.find((x) => x.id === 'demo-savings');
      a.goalIds = d.goals.slice(0, 2).map((g) => g.id);
    });
  });
  await p.goto(`${URL}#/more/health`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  const found = await p.evaluate(() => [...document.querySelectorAll('.row')].map((r) => ({
    t: r.querySelector('.row-label span').textContent.trim(),
    s: r.querySelector('.row-label small')?.textContent.trim(),
  })));
  found.forEach((x) => console.log(`     ${x.t} — ${x.s}`));
  check('двойная привязка найдена', found.some((x) => /целям/.test(x.s || '')), JSON.stringify(found));
  check('начальное количество отмечено', found.some((x) => /без сделки/.test(x.s || '')), JSON.stringify(found));

  console.log('\n5. Находка ведёт туда, где чинить');
  const before = await p.evaluate(() => location.hash);
  await p.locator('.row').first().click();
  await p.waitForTimeout(700);
  const after = await p.evaluate(() => location.hash);
  console.log(`     ${before} → ${after}`);
  check('адрес сменился', after !== before, `${before} → ${after}`);

  console.log('\n6. Строка в «Ещё» считает находки');
  await p.goto(`${URL}#/more`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  const hub = await p.evaluate(() => {
    const r = [...document.querySelectorAll('.row')].find((x) => /Проверка данных/.test(x.textContent));
    return r ? r.textContent.replace(/\s+/g, ' ').trim() : null;
  });
  console.log(`     ${hub}`);
  check('строка есть и с ярлыком ошибок', /Проверка данных/.test(hub || '') && /ошибки/.test(hub || ''), hub);

  console.log('\n7. Чистые данные — пустое состояние с Кубышем');
  await p.evaluate(async () => {
    const store = await import('./js/store.js');
    const D = await import('./js/dates.js');
    await store.mutate((d) => {
      d.goals = [];
      d.operations = [];
      d.assets = [{
        id: 'ok', name: 'Счёт', type: 'Деньги', status: 'Активен', liquidity: 'Мгновенная',
        assetClass: 'Вклады', rate: 12, opening: 1000, openingDate: D.today(), goalIds: [],
      }];
    });
  });
  await p.goto(`${URL}#/more/health`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  const clean = await p.evaluate(() => ({
    text: document.querySelector('.health-ok')?.textContent.trim() || null,
    mascot: Boolean(document.querySelector('.health-mascot .mascot-body')),
    rows: document.querySelectorAll('.row').length,
  }));
  console.log(`     ${clean.text} · зверёк: ${clean.mascot}`);
  check('находок нет', clean.rows === 0, String(clean.rows));
  check('сказано, что всё сходится', /сходится/.test(clean.text || ''), clean.text);
  check('и нарисован Кубыш', clean.mascot);

  console.log(`\n  ошибок в консоли: ${errs.length}${errs.length ? ' — ' + errs.join(' | ') : ''}`);
  if (errs.length) bad += 1;
  await b.close();
  console.log(bad ? `\n${bad} провалов` : '\nВсё сходится');
  process.exit(bad ? 1 : 0);
})();

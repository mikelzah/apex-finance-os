// Скрытие сумм, быстрый взнос по адресу и Кубыш-проводник.
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
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(900);

  console.log('\n1. Скрытие сумм');
  const openMoney = await p.evaluate(() => document.querySelector('.hero-value').textContent.trim());
  await p.goto(`${URL}#/more/settings`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(600);
  await p.locator('.row:has-text("Скрывать суммы")').click();
  await p.waitForTimeout(600);
  await p.goto(`${URL}#/dashboard`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  const hiddenState = await p.evaluate(() => ({
    hero: document.querySelector('.hero-value').textContent.trim(),
    // Настоящего числа не должно быть нигде в разметке — ни в тексте,
    // ни в атрибутах: иначе его видно копированием и поиском.
    anyDigits: /\d{3}[\s ]\d{3}/.test(document.getElementById('screen').textContent),
    percents: [...document.querySelectorAll('.hero-delta, .alloc-foot')].map((x) => x.textContent.trim()),
  }));
  console.log(`     было ${openMoney}, стало ${hiddenState.hero}`);
  check('сумма скрыта точками', /•/.test(hiddenState.hero), hiddenState.hero);
  check('крупных чисел на экране не осталось', !hiddenState.anyDigits);

  await p.goto(`${URL}#/portfolio`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  const pf = await p.evaluate(() => ({
    hero: document.querySelector('.hero-value').textContent.trim(),
    shares: [...document.querySelectorAll('.alloc-foot div')].map((x) => x.textContent.trim()).filter(Boolean),
    // Бумаги в портфеле стали строками со значком и построчной доходностью:
    // количество и цена переехали из .row-label small в .paper-sub.
    // Проверяется то же — что при скрытых суммах количества остаются видны.
    subs: [...document.querySelectorAll('.paper-sub')].map((x) => x.textContent.trim()),
  }));
  console.log(`     доли: ${pf.shares.slice(0, 2).join(' | ')}`);
  check('проценты остались видны', pf.shares.some((x) => /%/.test(x)), pf.shares.join(', '));
  check('количества остались видны', pf.subs.some((x) => /\d+ ×/.test(x)), pf.subs.join(' | '));

  await p.goto(`${URL}#/more/settings`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(600);
  await p.locator('.row:has-text("Скрывать суммы")').click();
  await p.waitForTimeout(600);
  await p.goto(`${URL}#/dashboard`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  const back = await p.evaluate(() => document.querySelector('.hero-value').textContent.trim());
  check('обратно включается', back === openMoney, `${back} vs ${openMoney}`);

  console.log('\n2. Быстрый взнос по адресу');
  const beforeOps = await p.evaluate(async () => (await import('./js/store.js')).getState().operations.length);
  await p.goto(`${URL}#/quick?amount=777`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  const quick = await p.evaluate(async () => {
    const store = await import('./js/store.js');
    const s = store.getState();
    const last = [...s.operations].sort((a, b) => (a.id < b.id ? 1 : -1))[0];
    return { n: s.operations.length, last, hash: location.hash, toast: document.querySelector('.toast')?.textContent.trim() };
  });
  console.log(`     операций ${beforeOps} → ${quick.n}, адрес ${quick.hash}, ${quick.toast}`);
  check('взнос записан', quick.n === beforeOps + 1, `${beforeOps} → ${quick.n}`);
  check('на указанную сумму', quick.last.amount === 777, String(quick.last.amount));
  check('это именно взнос', quick.last.type === 'Взнос', quick.last.type);
  check('адрес заменён на главную', quick.hash === '#/dashboard', quick.hash);

  console.log('\n3. Обновление страницы не пишет взнос второй раз');
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(1000);
  const again = await p.evaluate(async () => (await import('./js/store.js')).getState().operations.length);
  check('операций столько же', again === quick.n, `${quick.n} → ${again}`);

  console.log('\n4. Без суммы берётся быстрый взнос из настроек');
  await p.goto(`${URL}#/quick`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  const dflt = await p.evaluate(async () => {
    const store = await import('./js/store.js');
    const s = store.getState();
    const last = [...s.operations].sort((a, b) => (a.id < b.id ? 1 : -1))[0];
    return { amount: last.amount, quick: s.settings.quickAmount };
  });
  console.log(`     записано ${dflt.amount} при настройке ${dflt.quick}`);
  check('сумма из настроек', dflt.amount === dflt.quick, `${dflt.amount} vs ${dflt.quick}`);

  console.log('\n5. Кубыш в пустых экранах');
  await p.evaluate(async () => {
    const store = await import('./js/store.js');
    await store.mutate((d) => { d.goals = []; });
  });
  await p.goto(`${URL}#/goals`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  const empty = await p.evaluate(() => ({
    box: Boolean(document.querySelector('.empty-box')),
    body: Boolean(document.querySelector('.empty-box .mascot-body')),
    text: document.querySelector('.empty')?.textContent.trim(),
  }));
  console.log(`     ${empty.text} · зверёк ${empty.body}`);
  check('пустое состояние с рамкой', empty.box);
  check('в нём нарисован Кубыш', empty.body);
  check('текст на месте', /Целей пока нет/.test(empty.text || ''), empty.text);

  console.log('\n6. Фраза по делу');
  await p.evaluate(async () => {
    const store = await import('./js/store.js');
    await store.mutate((d) => {
      // Актив в двух целях — ошибка уровня «искажает цифры».
      d.goals = [{ id: 'g1', name: 'Первая', target: 100000, status: 'Активна', planPerDay: 500 },
                 { id: 'g2', name: 'Вторая', target: 100000, status: 'Активна' }];
      d.assets.find((a) => a.id === 'demo-savings').goalIds = ['g1', 'g2'];
    });
  });
  await p.goto(`${URL}#/dashboard`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  // Фраза Кубыша переехала с главной под колокольчик — вместе с сигналами
  // и днём капитализации. Прежде каждое из этого занимало свой блок,
  // и в обычный день главная разъезжалась втрое. Проверяется то же:
  // что фраза есть, что она про двойную привязку и что ведёт туда,
  // где это чинится.
  await p.locator('.bell').click();
  await p.waitForTimeout(600);
  const adv = await p.evaluate(() => {
    const n = [...document.querySelectorAll('.notice')].find((x) => /Кубыш/.test(x.textContent));
    return n ? { text: n.querySelector('.notice-body').textContent.trim() } : null;
  });
  console.log(`     ${adv?.text}`);
  check('фраза показана', Boolean(adv));
  check('говорит про двойную привязку', /целям/.test(adv?.text || ''), adv?.text);

  await p.locator('.notice-acts .btn-primary').last().click();
  await p.waitForTimeout(700);
  const went = await p.evaluate(() => location.hash);
  console.log(`     ведёт на ${went}`);
  check('ведёт туда, где чинить', went === '#/more/health', went);

  console.log('\n7. Когда всё ровно — фразы нет');
  await p.evaluate(async () => {
    const store = await import('./js/store.js');
    const D = await import('./js/dates.js');
    await store.mutate((d) => {
      d.goals = [];
      d.operations = [];
      d.assets = [{ id: 'ok', name: 'Счёт', type: 'Деньги', status: 'Активен', liquidity: 'Мгновенная',
        assetClass: 'Вклады', rate: 12, opening: 1000, openingDate: D.today(), goalIds: [] }];
    });
  });
  await p.goto(`${URL}#/dashboard`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  // Молчит — значит фразы от Кубыша под колокольчиком нет. Сам колокольчик
  // может показывать другое: сигналы и день капитализации живут там же
  // и к совету отношения не имеют.
  await p.locator('.bell').click();
  await p.waitForTimeout(600);
  const quiet = await p.evaluate(() =>
    [...document.querySelectorAll('.notice-title')].some((n) => n.textContent.trim() === 'Кубыш'));
  check('приложение молчит', !quiet);

  console.log(`\n  ошибок в консоли: ${errs.length}${errs.length ? ' — ' + errs.join(' | ') : ''}`);
  if (errs.length) bad += 1;
  await b.close();
  console.log(bad ? `\n${bad} провалов` : '\nВсё сходится');
  process.exit(bad ? 1 : 0);
})();

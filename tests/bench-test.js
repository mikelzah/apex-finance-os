// Доходность рядом с безриском.
//
// «+12,84% годовых» само по себе не значит ни хорошо, ни плохо. Смысл
// появляется рядом со ставкой, которую можно было получить, ничего не делая.
const { chromium } = require('playwright');
const URL = 'http://127.0.0.1:8899/app/index.html';

(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'], executablePath: process.env.CHROMIUM_PATH || undefined });
  const p = await (await b.newContext({ viewport: { width: 440, height: 956 }, isMobile: true, hasTouch: true, locale: 'ru-RU' })).newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  let bad = 0;
  const check = (l, ok, d) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? ' — ' + d : ''}`); if (!ok) bad += 1; };

  await p.goto(`${URL}#/dashboard`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(600);

  console.log('\n1. Средняя ставка взвешена по дням');
  const avg = await p.evaluate(async () => {
    const C = await import('./js/calc.js');
    const series = [
      { date: '2026-01-01', rate: 21 },
      { date: '2026-04-01', rate: 18 },
      { date: '2026-07-01', rate: 16 },
    ];
    return {
      // Полгода: 90 дней по 21 и 91 по 18 → около 19,5.
      half: C.averageRate(series, '2026-01-01', '2026-07-01'),
      // Только последний отрезок — ровно 16.
      tail: C.averageRate(series, '2026-07-01', '2026-08-02'),
      // Период начинается раньше ряда: считаем по известным дням, а не
      // тянем первую ставку в прошлое.
      early: C.averageRate(series, '2025-06-01', '2026-04-01'),
      empty: C.averageRate([], '2026-01-01', '2026-08-01'),
      backwards: C.averageRate(series, '2026-08-01', '2026-01-01'),
    };
  });
  console.log(`     полгода ${avg.half} · хвост ${avg.tail} · раньше ряда ${avg.early}`);
  check('среднее между 21 и 18', avg.half > 19 && avg.half < 20, String(avg.half));
  check('на одном отрезке — ровно ставка', avg.tail === 16, String(avg.tail));
  check('до начала ряда не выдумывает', avg.early === 21, String(avg.early));
  check('пустой ряд — ничего', avg.empty === null, String(avg.empty));
  check('обратный период — ничего', avg.backwards === null, String(avg.backwards));

  console.log('\n2. Период считается от первого вложения');
  const bench = await p.evaluate(async () => {
    const C = await import('./js/calc.js');
    const D = await import('./js/dates.js');
    const today = D.today();
    const series = [{ date: D.addDays(today, -400), rate: 16 }];
    const asset = { id: 'a', name: 'Вклад', type: 'Деньги', status: 'Активен', liquidity: 'Мгновенная',
      assetClass: 'Вклады', opening: 0, goalIds: [], lotSize: 1 };
    const long = [{ id: 'o1', date: D.addDays(today, -200), type: 'Взнос', assetId: 'a', amount: 100000 }];
    const short = [{ id: 'o1', date: D.addDays(today, -10), type: 'Взнос', assetId: 'a', amount: 100000 }];
    return {
      long: C.benchmark([asset], long, series, today),
      short: C.benchmark([asset], short, series, today),
      noRate: C.benchmark([asset], long, [], today),
      noFlows: C.benchmark([asset], [], series, today),
    };
  });
  console.log(`     длинный: ${JSON.stringify(bench.long)} · короткий: ${bench.short}`);
  check('срок от первого вложения', bench.long && bench.long.days === 200, String(bench.long && bench.long.days));
  check('ставка подхвачена', bench.long && bench.long.rate === 16, String(bench.long && bench.long.rate));
  check('на сроке меньше месяца не считаем', bench.short === null, String(bench.short));
  check('без ряда ставок не считаем', bench.noRate === null, String(bench.noRate));
  check('без вложений не считаем', bench.noFlows === null, String(bench.noFlows));

  console.log('\n3. На экране портфеля');
  await p.evaluate(async () => {
    const store = await import('./js/store.js');
    const D = await import('./js/dates.js');
    const today = D.today();
    await store.startEmpty();
    await store.mutate((d) => {
      d.keyRate = [{ date: D.addDays(today, -400), rate: 16 }];
      d.assets = [{ id: 'a', name: 'Накопительный счёт', type: 'Деньги', status: 'Активен',
        liquidity: 'Мгновенная', assetClass: 'Вклады', opening: 0, goalIds: [], lotSize: 1 }];
      // Год назад вложено 100 000, сейчас на счёте 110 000 — это 10% годовых,
      // и это меньше ключевой.
      d.operations = [{ id: 'o1', date: D.addDays(today, -365), type: 'Взнос', assetId: 'a', amount: 100000 }];
      d.assets[0].opening = 0;
      d.operations.push({ id: 'o2', date: today, type: 'Доход', assetId: 'a', amount: 10000 });
    });
  });
  await p.goto(`${URL}#/portfolio`, { waitUntil: 'networkidle' });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(900);

  const hero = await p.evaluate(() => ({
    delta: document.querySelector('.hero-delta')?.innerText.replace(/\s+/g, ' ').trim() || null,
    bench: document.querySelector('.hero-bench')?.innerText.replace(/\s+/g, ' ').trim() || null,
    bad: Boolean(document.querySelector('.hero-bench .is-bad')),
  }));
  console.log(`     ${hero.delta} · ${hero.bench}`);
  check('доходность на месте', /годовых/.test(hero.delta || ''), String(hero.delta));
  check('строка сравнения есть', /Ключевая за период/.test(hero.bench || ''), String(hero.bench));
  check('сказано «отстаёте»', /отстаёте/.test(hero.bench || ''), String(hero.bench));
  check('разница в пунктах, а не в процентах', /п\.п\./.test(hero.bench || ''), String(hero.bench));
  check('помечено как отставание', hero.bad, String(hero.bad));

  console.log('\n4. Портфель впереди ставки');
  await p.evaluate(async () => {
    const store = await import('./js/store.js');
    const D = await import('./js/dates.js');
    await store.mutate((d) => {
      // Тот же взнос, но выросло вдвое сильнее — уже больше ключевой.
      d.operations = d.operations.filter((o) => o.id !== 'o2');
      d.operations.push({ id: 'o3', date: D.today(), type: 'Доход', assetId: 'a', amount: 25000 });
    });
  });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  const ahead = await p.evaluate(() => ({
    bench: document.querySelector('.hero-bench')?.innerText.replace(/\s+/g, ' ').trim() || null,
    good: Boolean(document.querySelector('.hero-bench .is-good')),
  }));
  console.log(`     ${ahead.bench}`);
  check('сказано «опережаете»', /опережаете/.test(ahead.bench || ''), String(ahead.bench));
  check('помечено как опережение', ahead.good, String(ahead.good));

  console.log('\n5. Без ряда ставок строки нет вовсе');
  await p.evaluate(async () => {
    const store = await import('./js/store.js');
    await store.mutate((d) => { d.keyRate = []; });
  });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  const none = await p.evaluate(() => ({
    bench: document.querySelector('.hero-bench') ? 'есть' : 'нет',
    delta: document.querySelector('.hero-delta') ? 'есть' : 'нет',
  }));
  console.log(`     сравнение: ${none.bench} · доходность: ${none.delta}`);
  check('сравнения нет', none.bench === 'нет', none.bench);
  check('доходность на месте', none.delta === 'есть', none.delta);

  console.log(`\n  ошибок в консоли: ${errs.length}${errs.length ? ' — ' + errs.join(' | ') : ''}`);
  if (errs.length) bad += 1;
  await b.close();
  console.log(bad ? `\n${bad} провалов` : '\nВсё сходится');
  process.exit(bad ? 1 : 0);
})();

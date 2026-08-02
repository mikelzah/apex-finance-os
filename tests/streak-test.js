// Серия взносов не обрывается на границе месяца.
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

  const streak = (dates, day) => p.evaluate(async ({ dates, day }) => {
    const charts = await import('./js/charts.js');
    const ops = dates.map((date, i) => ({
      id: `o${i}`, date, type: 'Взнос', amount: 500, assetId: 'a', goalId: null,
      source: 'Вручную', comment: null,
    }));
    return charts.ritual(ops, null, day).streak;
  }, { dates, day });

  console.log('\n1. Серия через границу месяца');
  // Двадцать девятое, тридцатое, тридцать первое июля и первое августа.
  const across = await streak(['2026-07-29', '2026-07-30', '2026-07-31', '2026-08-01'], '2026-08-01');
  console.log(`     первого августа: ${across}`);
  check('считается четыре дня, а не один', across === 4, String(across));

  console.log('\n2. Пропуск серию обрывает');
  const broken = await streak(['2026-07-25', '2026-07-26', '2026-08-01'], '2026-08-01');
  console.log(`     после разрыва: ${broken}`);
  check('после пропуска серия начинается заново', broken === 1, String(broken));

  console.log('\n3. Сегодняшний день прощается');
  // Взноса сегодня ещё нет, но вчера и позавчера были: день не кончился,
  // и обнулять счётчик с утра значило бы наказывать за то, что не успел.
  const yesterday = await streak(['2026-07-30', '2026-07-31'], '2026-08-01');
  console.log(`     взноса сегодня нет: ${yesterday}`);
  check('серия держится до вчера', yesterday === 2, String(yesterday));

  console.log('\n4. Разрыв длиннее суток серию не прощает');
  const gap = await streak(['2026-07-29', '2026-07-30'], '2026-08-01');
  console.log(`     позавчера и раньше: ${gap}`);
  check('вчерашний пропуск обрывает', gap === 0, String(gap));

  console.log('\n5. Через границу года');
  const newYear = await streak(['2025-12-30', '2025-12-31', '2026-01-01'], '2026-01-01');
  console.log(`     первого января: ${newYear}`);
  check('год тоже не обрывает', newYear === 3, String(newYear));

  console.log('\n6. Длинная серия целиком');
  const long = [];
  for (let i = 0; i < 40; i += 1) {
    const d = new Date(Date.UTC(2026, 7, 1) - i * 86400000);
    long.push(d.toISOString().slice(0, 10));
  }
  const all = await streak(long, '2026-08-01');
  console.log(`     сорок дней подряд: ${all}`);
  check('считаются все сорок', all === 40, String(all));

  console.log('\n7. Карточка на главной показывает то же');
  await p.evaluate(async () => {
    const store = await import('./js/store.js');
    await store.startEmpty();
    await store.mutate((d) => {
      d.assets = [{ id: 'a', name: 'Счёт', type: 'Деньги', status: 'Активен', liquidity: 'Мгновенная',
        assetClass: 'Вклады', opening: 1000, goalIds: [], lotSize: 1 }];
      const D = { dates: ['2026-07-29', '2026-07-30', '2026-07-31', '2026-08-01'] };
      D.dates.forEach((date, i) => d.operations.push({
        id: `o${i}`, date, type: 'Взнос', amount: 500, assetId: 'a', goalId: null,
        source: 'Вручную', comment: null,
      }));
    });
  });
  // Переход по тому же адресу перерисовкой не считается — нужен reload,
  // иначе экран остаётся таким, каким был до записи операций.
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  const shown = await p.evaluate(() => document.querySelector('.ritual-streak')?.textContent);
  console.log(`     на экране: «${shown}»`);
  check('на главной четыре дня подряд', /^4 дня подряд/.test(shown || ''), String(shown));

  console.log(`\n  ошибок в консоли: ${errs.length}${errs.length ? ' — ' + errs.join(' | ') : ''}`);
  if (errs.length) bad += 1;
  await b.close();
  console.log(bad ? `\n${bad} провалов` : '\nВсё сходится');
  process.exit(bad ? 1 : 0);
})();

// Хватит ли денег до конца месяца.
//
// Прогноз, который врёт, хуже отсутствующего: по нему принимают решения.
// Поэтому проверяется и то, что он молчит, когда считать не из чего.
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

  // Считаем на выдуманном «сегодня» в середине месяца: до конца 16 дней.
  const r = await p.evaluate(async () => {
    const C = await import('./js/calc.js');
    const D = await import('./js/dates.js');
    const today = '2026-08-15';

    const money = (opening) => [{ id: 'a', name: 'Карта', type: 'Деньги', status: 'Активен',
      liquidity: 'Мгновенная', assetClass: 'Вклады', opening, openingDate: '2026-01-01',
      goalIds: [], lotSize: 1 }];

    // Ровный темп: 20 трат по 1 000 за последние 30 дней.
    const steady = [];
    for (let i = 0; i < 20; i += 1) {
      steady.push({ id: `s${i}`, date: D.addDays(today, -i), amount: 1000, kind: 'Трата',
        category: 'Прочее', description: `Магазин ${i}`, key: `k${i}` });
    }

    // Зарплата двух прошлых месяцев — значит, будет и в этом.
    const salary = [
      { id: 'i1', date: '2026-06-20', amount: 90000, kind: 'Поступление', category: 'Зарплата',
        description: 'ЗАРПЛАТА ООО РОМАШКА', key: 'i1' },
      { id: 'i2', date: '2026-07-20', amount: 90000, kind: 'Поступление', category: 'Зарплата',
        description: 'ЗАРПЛАТА ООО РОМАШКА', key: 'i2' },
    ];

    return {
      pace: C.dailyPace(steady, today),
      end: C.monthEnd(today),
      // Денег много — хватает с запасом.
      rich: C.monthOutlook(steady, money(200000), [], today),
      // Денег впритык.
      thin: C.monthOutlook(steady, money(12000), [], today),
      // Денег не хватает вовсе.
      poor: C.monthOutlook(steady, money(3000), [], today),
      // Не хватало бы, но придёт зарплата.
      saved: C.monthOutlook([...steady, ...salary], money(3000), [], today),
      // Записей слишком мало — темпа нет, прогноза нет.
      few: C.monthOutlook(steady.slice(0, 5), money(100000), [], today),
      empty: C.monthOutlook([], money(100000), [], today),
      // В последний день месяца считать нечего.
      last: C.monthOutlook(steady, money(100000), [], '2026-08-31'),
    };
  });

  console.log('\n1. Темп и срок');
  console.log(`     ${r.pace} ₽/день · конец месяца ${r.end} · осталось ${r.rich.daysLeft} дней`);
  check('темп — сумма за 30 дней', Math.abs(r.pace - 20000 / 30) < 0.01, String(r.pace));
  check('конец месяца — 31 августа', r.end === '2026-08-31', r.end);
  check('осталось 16 дней', r.rich.daysLeft === 16, String(r.rich.daysLeft));
  check('уйдёт темп × дни', Math.abs(r.rich.expectedSpend - r.pace * 16) < 0.02, String(r.rich.expectedSpend));

  console.log('\n2. Три исхода');
  console.log(`     много: останется ${r.rich.left} (${r.rich.level})`);
  console.log(`     впритык: останется ${r.thin.left} (${r.thin.level})`);
  console.log(`     мало: останется ${r.poor.left} (${r.poor.level})`);
  check('с запасом — спокойно', r.rich.level === 'ok', r.rich.level);
  check('впритык — предупреждение', r.thin.level === 'warn', `${r.thin.left} / ${r.thin.level}`);
  check('не хватает — тревога', r.poor.level === 'bad' && r.poor.left < 0, `${r.poor.left} / ${r.poor.level}`);

  console.log('\n3. Ожидаемая зарплата спасает месяц');
  console.log(`     без неё ${r.poor.left}, с ней ${r.saved.left}; ждём ${r.saved.income.map((x) => `${x.name} ${x.amount} ${x.nextDate}`).join(', ')}`);
  check('зарплата найдена', r.saved.income.length === 1, JSON.stringify(r.saved.income));
  check('она в этом месяце', r.saved.income[0].nextDate === '2026-08-20', String(r.saved.income[0].nextDate));
  check('и учтена в остатке', r.saved.left === r.poor.left + 90000, `${r.saved.left} vs ${r.poor.left + 90000}`);
  check('исход стал спокойным', r.saved.level === 'ok', r.saved.level);

  console.log('\n4. Когда считать не из чего — молчим');
  check('пять записей — не темп', r.few === null, JSON.stringify(r.few));
  check('пустая выписка — не темп', r.empty === null, JSON.stringify(r.empty));
  check('в последний день дней не осталось', r.last.daysLeft === 0, String(r.last.daysLeft));

  console.log('\n5. На экране');
  await p.evaluate(async () => {
    const store = await import('./js/store.js');
    const D = await import('./js/dates.js');
    const today = D.today();
    await store.startEmpty();
    await store.mutate((d) => {
      d.assets = [{ id: 'a', name: 'Карта', type: 'Деньги', status: 'Активен', liquidity: 'Мгновенная',
        assetClass: 'Вклады', opening: 9000, openingDate: D.addDays(today, -200), goalIds: [], lotSize: 1 }];
      d.spending = [];
      for (let i = 0; i < 20; i += 1) {
        d.spending.push({ id: `s${i}`, date: D.addDays(today, -i), amount: 1000, kind: 'Трата',
          category: 'Прочее', description: `Магазин ${i}`, key: `k${i}` });
      }
      // Зарплата приходит в тот же день месяца, что и «завтра»: так
      // следующая выплата попадает внутрь этого месяца при любом дне запуска,
      // кроме последнего — его проверяет отдельная ветка ниже.
      const payday = D.addDays(today, 1);
      d.spending.push({ id: 'i1', date: D.addMonths(payday, -2), amount: 90000, kind: 'Поступление',
        category: 'Зарплата', description: 'ЗАРПЛАТА ООО РОМАШКА', key: 'i1' });
      d.spending.push({ id: 'i2', date: D.addMonths(payday, -1), amount: 90000, kind: 'Поступление',
        category: 'Зарплата', description: 'ЗАРПЛАТА ООО РОМАШКА', key: 'i2' });
    });
  });
  await p.goto(`${URL}#/spending`, { waitUntil: 'networkidle' });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(900);

  const card = await p.evaluate(() => {
    const el = [...document.querySelectorAll('.card')].find((c) => /До конца месяца/.test(c.textContent));
    return el ? el.innerText.replace(/\s+/g, ' ') : null;
  });
  console.log(`     ${card}`);
  check('блок на экране', Boolean(card), String(card));
  check('назван темп', /в день/.test(card || ''), String(card));
  check('видно, сколько доступно', /Сейчас доступно/.test(card || ''), String(card));
  // Сегодняшний день может оказаться последним в месяце — тогда ждать
  // внутри месяца уже нечего. Сверяем экран с расчётом, а не с ожиданием.
  const expects = await p.evaluate(async () => {
    const C = await import('./js/calc.js');
    const store = await import('./js/store.js');
    const D = await import('./js/dates.js');
    const s = store.getState();
    const out = C.monthOutlook(s.spending, s.assets, s.operations, D.today());
    return out ? out.income.length : 0;
  });
  console.log(`     ожидаемых поступлений: ${expects}`);
  check('зарплата названа поимённо, если её ждут',
    (expects > 0) === /Ждём: ЗАРПЛАТА/.test(card || ''), `${expects} / ${/Ждём/.test(card || '')}`);

  console.log(`\n  ошибок в консоли: ${errs.length}${errs.length ? ' — ' + errs.join(' | ') : ''}`);
  if (errs.length) bad += 1;
  await b.close();
  console.log(bad ? `\n${bad} провалов` : '\nВсё сходится');
  process.exit(bad ? 1 : 0);
})();

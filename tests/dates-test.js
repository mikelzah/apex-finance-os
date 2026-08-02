// Несуществующие даты не должны считаться настоящими.
const { chromium } = require('playwright');
const URL = 'http://127.0.0.1:8899/app/index.html';
(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'], executablePath: process.env.CHROMIUM_PATH || undefined });
  const p = await (await b.newContext({ viewport: { width: 440, height: 956 }, locale: 'ru-RU' })).newPage();
  let bad = 0;
  const check = (l, ok, d) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? ' — ' + d : ''}`); if (!ok) bad += 1; };
  await p.goto(`${URL}#/dashboard`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(600);

  const r = await p.evaluate(async () => {
    const D = await import('./js/dates.js');
    const S = await import('./js/statement.js');
    const F = await import('./js/fmt.js');
    const SC = await import('./js/screenshot.js');
    return {
      good: ['2026-08-02', '2028-02-29', '2026-12-31', '2026-01-01'].map((s) => [s, D.isValid(s)]),
      bad: ['2026-02-30', '2026-13-07', '2027-02-29', '2026-04-31', '2026-00-10', '2026-01-00']
        .map((s) => [s, D.isValid(s)]),
      // Порядок «день.месяц» — основной, но 29 месяцем быть не может.
      parse: [['31.02.2026'], ['07/29/2026'], ['29.07.2026'], ['03/04/2026'], ['31.12.26'], ['2026-02-30']]
        .map(([s]) => [s, S.toDate(s)]),
      shot: ['31.11.2026', '29.07.2026'].map((s) => [s, SC.readDate(s, '2026-08-02')]),
      shown: ['2026-13-45', '2026-02-30'].map((s) => [s, F.date(s)]),
      // Внутренняя арифметика несуществующих дат не производит.
      months: [D.addMonths('2026-01-31', 1), D.addYears('2028-02-29', 1), D.addDays('2026-12-31', 1)],
    };
  });

  console.log('\n1. Настоящие даты остаются настоящими');
  console.log(`     ${r.good.map(([s, v]) => `${s}:${v}`).join(' · ')}`);
  check('все приняты', r.good.every(([, v]) => v), JSON.stringify(r.good));

  console.log('\n2. Несуществующие отвергнуты');
  console.log(`     ${r.bad.map(([s, v]) => `${s}:${v}`).join(' · ')}`);
  check('все отвергнуты', r.bad.every(([, v]) => !v), JSON.stringify(r.bad));

  console.log('\n3. Разбор выписки');
  for (const [s, v] of r.parse) console.log(`     ${s} → ${v}`);
  const map = Object.fromEntries(r.parse);
  check('31 февраля — пусто', map['31.02.2026'] === null, String(map['31.02.2026']));
  check('07/29/2026 прочтён как 29 июля', map['07/29/2026'] === '2026-07-29', String(map['07/29/2026']));
  check('29.07.2026 не сломался', map['29.07.2026'] === '2026-07-29', String(map['29.07.2026']));
  check('неоднозначное — день первым', map['03/04/2026'] === '2026-04-03', String(map['03/04/2026']));
  check('двузначный год цел', map['31.12.26'] === '2026-12-31', String(map['31.12.26']));
  check('несуществующая ISO — пусто', map['2026-02-30'] === null, String(map['2026-02-30']));

  console.log('\n4. Снимок');
  console.log(`     ${r.shot.map(([s, v]) => `${s} → ${v}`).join(' · ')}`);
  check('31 ноября — пусто', r.shot[0][1] === null, String(r.shot[0][1]));
  check('нормальная дата цела', r.shot[1][1] === '2026-07-29', String(r.shot[1][1]));

  console.log('\n5. На экране «undefined» не появляется');
  console.log(`     ${r.shown.map(([s, v]) => `${s} → ${v}`).join(' · ')}`);
  check('обе показаны прочерком', r.shown.every(([, v]) => v === '—'), JSON.stringify(r.shown));

  console.log('\n6. Внутренняя арифметика цела');
  console.log(`     ${r.months.join(' · ')}`);
  check('31 янв + месяц = 28 фев', r.months[0] === '2026-02-28', r.months[0]);
  check('29 фев + год = 28 фев', r.months[1] === '2029-02-28', r.months[1]);
  check('31 дек + день = 1 янв', r.months[2] === '2027-01-01', r.months[2]);

  await b.close();
  console.log(bad ? `\n${bad} провалов` : '\nВсё сходится');
  process.exit(bad ? 1 : 0);
})();

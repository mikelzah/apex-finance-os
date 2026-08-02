// Снимок капитала можно убрать: актив ушёл задним числом, история врёт.
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
  // В суммах узкий неразрывный пробел, обычный /1 920 000/ по ним не ищется.
  const flat = (x) => String(x || '').replace(/\s/g, '');
  const check = (l, ok, d) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? ' — ' + d : ''}`); if (!ok) bad += 1; };

  await p.goto(`${URL}#/dashboard`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(600);
  // Вчерашний снимок помнит вклад, которого в активах уже нет.
  await p.evaluate(async () => {
    const store = await import('./js/store.js');
    const D = await import('./js/dates.js');
    await store.startEmpty();
    const yesterday = D.addDays(D.today(), -1);
    const before = D.addDays(D.today(), -2);
    await store.mutate((d) => {
      d.assets = [{ id: 'a', name: 'Счёт', type: 'Деньги', status: 'Активен', liquidity: 'Мгновенная',
        assetClass: 'Вклады', opening: 120000, openingDate: before, goalIds: [], lotSize: 1 }];
      d.netWorth = [
        { month: before.slice(0, 7), date: before, total: 120000, liquid: 120000, invested: 0 },
        { month: yesterday.slice(0, 7), date: yesterday, total: 1920000, liquid: 1920000, invested: 0 },
      ];
    });
  });
  await p.goto(`${URL}#/more/history`, { waitUntil: 'networkidle' });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(900);

  const list = () => p.evaluate(() => [...document.querySelectorAll('.row')].map((r) => ({
    day: r.querySelector('.row-label span')?.textContent.trim(),
    sum: r.querySelector('.row-value span')?.textContent.trim(),
    tappable: Boolean(r.querySelector('.row-chevron')),
  })));

  console.log('\n1. Снимки видны и нажимаются');
  let rows = await list();
  console.log(`     ${rows.map((r) => `${r.day}: ${r.sum}`).join(' · ')}`);
  check('снимков три (сегодняшний записался сам)', rows.length === 3, String(rows.length));
  check('все нажимаются', rows.every((r) => r.tappable), JSON.stringify(rows.map((r) => r.tappable)));
  const fat = rows.find((r) => flat(r.sum).includes('1920000'));
  check('лишний снимок на месте', Boolean(fat), JSON.stringify(rows));

  console.log('\n2. Предупреждение о безвозвратности');
  await p.locator(`.row:has-text("${fat.day}")`).first().click();
  await p.waitForTimeout(500);
  let text = await p.evaluate(() => document.querySelector('.sheet-text')?.textContent || '');
  console.log(`     ${text}`);
  check('в тексте день и сумма', text.includes(fat.day) && flat(text).includes('1920000'), text);
  check('сказано, что не вернуть', /Вернуть её нельзя/.test(text), text);

  console.log('\n3. Удаление');
  await p.locator('.sheet-foot .btn-danger').click();
  await p.waitForTimeout(900);
  rows = await list();
  console.log(`     ${rows.map((r) => `${r.day}: ${r.sum}`).join(' · ')}`);
  check('снимка не осталось', !rows.some((r) => flat(r.sum).includes('1920000')), JSON.stringify(rows));
  check('остальные целы', rows.length === 2, String(rows.length));
  const kept = await p.evaluate(async () => {
    const store = await import('./js/store.js');
    return store.getState().netWorth.map((r) => r.total);
  });
  console.log(`     в хранилище: ${kept.join(', ')}`);
  check('в хранилище тоже нет', !kept.includes(1920000), kept.join(', '));

  console.log('\n4. У сегодняшнего снимка предупреждение другое');
  const todayRow = (await list())[0];
  await p.locator(`.row:has-text("${todayRow.day}")`).first().click();
  await p.waitForTimeout(500);
  text = await p.evaluate(() => document.querySelector('.sheet-text')?.textContent || '');
  console.log(`     ${text}`);
  check('сказано, что вернётся сам', /запишется заново/.test(text), text);
  await p.locator('.sheet-foot .btn-ghost, .sheet-foot .btn').first().click();
  await p.waitForTimeout(400);

  console.log('\n5. После перезагрузки удалённое не возвращается');
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  rows = await list();
  console.log(`     ${rows.map((r) => `${r.day}: ${r.sum}`).join(' · ')}`);
  check('лишнего снимка нет', !rows.some((r) => flat(r.sum).includes('1920000')), JSON.stringify(rows));

  console.log(`\n  ошибок в консоли: ${errs.length}${errs.length ? ' — ' + errs.join(' | ') : ''}`);
  if (errs.length) bad += 1;
  await b.close();
  console.log(bad ? `\n${bad} провалов` : '\nВсё сходится');
  process.exit(bad ? 1 : 0);
})();

// Распознавание снимка экрана банка: светлая и тёмная тема.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const FIX = path.join(__dirname, 'fixtures');
const URL = 'http://127.0.0.1:8899/app/index.html';
const DIR = FIX;

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
  await p.evaluate(async () => {
    const store = await import('./js/store.js');
    await store.startEmpty();
    await store.mutate((d) => {
      d.assets = [{ id: 'a', name: 'Карта', type: 'Деньги', status: 'Активен', liquidity: 'Мгновенная',
        assetClass: 'Вклады', opening: 200000, goalIds: [], lotSize: 1 }];
    });
  });

  const run = async (name) => {
    const b64 = fs.readFileSync(`${DIR}/${name}`).toString('base64');
    const started = Date.now();
    const out = await p.evaluate(async (data) => {
      const ocr = await import('./js/ocr.js');
      const S = await import('./js/screenshot.js');
      const D = await import('./js/dates.js');
      const bin = Uint8Array.from(atob(data), (ch) => ch.charCodeAt(0));
      const file = new File([bin], 'shot.png', { type: 'image/png' });
      const stages = [];
      const text = await ocr.recognise(file, (label) => {
        if (!stages.includes(label)) stages.push(label);
      });
      return { text, stages, parsed: S.parseScreen(text, D.today()) };
    }, b64);
    return { ...out, seconds: Math.round((Date.now() - started) / 100) / 10 };
  };

  console.log('\n1. Светлая тема');
  const light = await run('bank-light.png');
  console.log(`     ${light.seconds} с · этапы: ${light.stages.join(' → ')}`);
  console.log('     — распознано —');
  console.log(light.text.split('\n').filter(Boolean).map((x) => `     ${x}`).join('\n'));
  console.log('     — понято —');
  for (const r of light.parsed.rows) console.log(`     ${r.date} · ${r.kind} · ${r.amount} · ${r.description}`);

  const rows = light.parsed.rows;
  const amounts = rows.map((r) => r.amount);
  check('нашлись все шесть операций', rows.length === 6, String(rows.length));
  check('2 317,40 прочитано верно', amounts.includes(2317.4), amounts.join(', '));
  check('610 прочитано верно', amounts.includes(610), amounts.join(', '));
  check('265 прочитано верно', amounts.includes(265), amounts.join(', '));
  check('1 962,30 прочитано верно', amounts.includes(1962.3), amounts.join(', '));
  check('132 500 прочитано верно', amounts.includes(132500), amounts.join(', '));
  check('35 000 прочитано верно', amounts.includes(35000), amounts.join(', '));
  check('кэшбэк не стал операцией', !amounts.includes(73), amounts.join(', '));
  check('зарплата — приход', (rows.find((r) => r.amount === 132500) || {}).kind === 'Поступление',
    JSON.stringify(rows.find((r) => r.amount === 132500)));
  check('даты разложились по трём дням', new Set(rows.map((r) => r.date)).size === 3,
    [...new Set(rows.map((r) => r.date))].join(', '));

  console.log('\n2. Тёмная тема — картинка переворачивается');
  const dark = await run('bank-dark.png');
  console.log(`     ${dark.seconds} с`);
  console.log('     — распознано —');
  console.log(dark.text.split('\n').filter(Boolean).map((x) => `     ${x}`).join('\n'));
  console.log('     — понято —');
  for (const r of dark.parsed.rows) console.log(`     ${r.date} · ${r.kind} · ${r.amount} · ${r.description}`);
  const darkAmounts = dark.parsed.rows.map((r) => r.amount);
  check('в тёмной теме тоже шесть', dark.parsed.rows.length === 6, String(dark.parsed.rows.length));
  check('суммы те же', [2317.4, 610, 265, 1962.3, 132500, 35000].every((x) => darkAmounts.includes(x)),
    darkAmounts.join(', '));

  console.log('\n3. Категории и переводы по распознанному');
  const marked = await p.evaluate(async (rowsIn) => {
    const St = await import('./js/statement.js');
    const withCat = rowsIn.map((r) => ({ ...r, category: St.categorise(r, []) }));
    return St.markTransfers(withCat, []);
  }, light.parsed.rows);
  console.log(`     ${marked.map((r) => `${r.category}`).join(' | ')}`);
  check('перевод между счетами опознан',
    marked.some((r) => r.kind === 'Перевод себе'), marked.map((r) => r.kind).join(', '));
  check('аптека — здоровье', marked.some((r) => r.category === 'Здоровье'), marked.map((r) => r.category).join(', '));

  console.log('\n4. Путь через шторку');
  await p.goto(`${URL}#/more/spending`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  await p.locator('.btn:has-text("Со скриншота")').first().click();
  await p.waitForTimeout(300);
  const chooser = p.waitForEvent('filechooser');
  await p.locator('.sheet-body .btn:has-text("Выбрать снимок")').click();
  await (await chooser).setFiles(`${DIR}/bank-light.png`);
  await p.waitForFunction(() => {
    const el = document.querySelector('.sheet-body textarea');
    return el && el.value.length > 20;
  }, null, { timeout: 90000 });
  await p.waitForTimeout(500);
  const sheet = await p.evaluate(() => ({
    summary: [...document.querySelectorAll('.sheet-body .sheet-note')].map((x) => x.textContent).join(' '),
    preview: [...document.querySelectorAll('.preview-row')].length,
  }));
  console.log(`     ${sheet.summary}`);
  check('снимок разобран в шторке', /Нашлось операций: 6/.test(sheet.summary), sheet.summary);
  check('разбор показан построчно', sheet.preview === 6, String(sheet.preview));

  await p.locator('.sheet-foot .btn-primary').click();
  await p.waitForTimeout(900);
  const saved = await p.evaluate(async () => (await import('./js/store.js')).getState().spending.length);
  check('записи сохранены', saved === 6, String(saved));

  console.log(`\n  ошибок в консоли: ${errs.length}${errs.length ? ' — ' + errs.join(' | ') : ''}`);
  if (errs.length) bad += 1;
  await b.close();
  console.log(bad ? `\n${bad} провалов` : '\nВсё сходится');
  process.exit(bad ? 1 : 0);
})();

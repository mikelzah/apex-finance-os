// Загрузка копии обязана спросить, прежде чем стереть всё нынешнее.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const FIX = path.join(__dirname, 'fixtures');
const URL = 'http://127.0.0.1:8899/app/index.html';
const DIR = FIX;

(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'], executablePath: process.env.CHROMIUM_PATH || undefined });
  const p = await (await b.newContext({ viewport: { width: 440, height: 956 }, locale: 'ru-RU' })).newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  let bad = 0;
  const check = (l, ok, d) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? ' — ' + d : ''}`); if (!ok) bad += 1; };

  await p.goto(`${URL}#/dashboard`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(700);

  // Копия из одного актива — чтобы отличить её от демо по количеству.
  const copy = await p.evaluate(async () => {
    const store = await import('./js/store.js');
    await store.startEmpty();
    await store.mutate((d) => {
      d.assets = [{ id: 'only', name: 'Единственный', type: 'Деньги', status: 'Активен',
        liquidity: 'Мгновенная', assetClass: 'Вклады', opening: 777, goalIds: [], lotSize: 1 }];
    });
    return store.exportText();
  });
  fs.writeFileSync(`${DIR}/copy.json`, copy);
  fs.writeFileSync(`${DIR}/broken.json`, '{"assets": [ это не json');

  await p.evaluate(async () => {
    const store = await import('./js/store.js');
    await store.loadDemo();
  });
  await p.goto(`${URL}#/more/backup`, { waitUntil: 'networkidle' });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(800);

  const assets = () => p.evaluate(async () => (await import('./js/store.js')).getState().assets.length);
  const before = await assets();
  console.log(`\nСейчас в приложении активов: ${before}`);

  console.log('\n1. Перед заменой спрашивают');
  let chooser = p.waitForEvent('filechooser');
  await p.locator('.btn:has-text("Загрузить из копии")').click();
  (await chooser).setFiles(`${DIR}/copy.json`);
  await p.waitForTimeout(700);
  const ask = await p.evaluate(() => ({
    title: document.querySelector('.sheet-head h2')?.textContent.trim() || null,
    text: document.querySelector('.sheet-text')?.textContent || '',
  }));
  console.log(`     ${ask.title}: ${ask.text}`);
  check('шторка появилась', ask.title === 'Заменить всё на копию?', String(ask.title));
  check('сказано, что в копии', /1 актив,/.test(ask.text), ask.text);
  check('сказано, что сейчас', new RegExp(`${before} актива`).test(ask.text), ask.text);
  check('сказано, что не вернуть', /вернуть его будет нечем/.test(ask.text), ask.text);
  check('данные пока целы', (await assets()) === before, String(await assets()));

  console.log('\n2. Отмена ничего не меняет');
  await p.locator('.sheet-foot .btn').first().click();
  await p.waitForTimeout(600);
  check('активы на месте', (await assets()) === before, String(await assets()));

  console.log('\n3. Согласие заменяет');
  chooser = p.waitForEvent('filechooser');
  await p.locator('.btn:has-text("Загрузить из копии")').click();
  (await chooser).setFiles(`${DIR}/copy.json`);
  await p.waitForTimeout(700);
  await p.locator('.sheet-foot .btn-danger').click();
  await p.waitForTimeout(900);
  const after = await assets();
  console.log(`     стало активов: ${after}`);
  check('копия применилась', after === 1, String(after));

  console.log('\n4. Битый файл не трогает данные');
  chooser = p.waitForEvent('filechooser');
  await p.locator('.btn:has-text("Загрузить из копии")').click();
  (await chooser).setFiles(`${DIR}/broken.json`);
  await p.waitForTimeout(700);
  const toast = await p.evaluate(() => document.querySelector('.toast')?.textContent || '');
  console.log(`     сообщение: ${toast}`);
  check('сказано по-человечески', /повреждён|не копия|не та копия/.test(toast), toast);
  check('«Unexpected token» не показан', !/Unexpected|token/.test(toast), toast);
  check('данные целы', (await assets()) === 1, String(await assets()));

  console.log(`\n  ошибок в консоли: ${errs.length}${errs.length ? ' — ' + errs.slice(0, 2).join(' | ') : ''}`);
  if (errs.length) bad += 1;
  await b.close();
  console.log(bad ? `\n${bad} провалов` : '\nВсё сходится');
  process.exit(bad ? 1 : 0);
})();

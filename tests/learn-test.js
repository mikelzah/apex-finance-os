// Категория правится до записи и подтягивается к таким же записям потом.
const { chromium } = require('playwright');
const URL = 'http://127.0.0.1:8899/app/index.html';

// Так вышло с Райффайзеном: тесная обрезка, «Дикси» прочиталось как «КОИ»,
// а кэшбэк «+ 8,1 ₽» стоит отдельной строкой без единого слова.
const RAIF = `КОИ —269,97 ₽
© с +81 ₽
7 Райффайзен Подписка —410 ₽`;

const AGAIN = `КОИ —312,40 ₽
7 Райффайзен Подписка —465 ₽`;

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
        assetClass: 'Вклады', opening: 50000, goalIds: [], lotSize: 1 }];
    });
  });

  console.log('\n1. Кэшбэк строкой без слов больше не доход');
  const parsed = await p.evaluate(async (text) => {
    const S = await import('./js/screenshot.js');
    const D = await import('./js/dates.js');
    return S.parseScreen(text, D.today()).rows;
  }, RAIF);
  for (const r of parsed) console.log(`     ${r.kind} · ${r.amount} · ${r.description}`);
  check('операций две, а не три', parsed.length === 2, String(parsed.length));
  check('81 ₽ дохода нет', !parsed.some((r) => r.amount === 81), parsed.map((r) => r.amount).join(', '));

  const open = async (text) => {
    const direct = p.locator('.btn:has-text("Со скриншота")').first();
    if (await direct.count() && await direct.isVisible()) await direct.click();
    else {
      await p.locator('.btn:has-text("Загрузить")').first().click();
      await p.waitForTimeout(300);
      await p.locator('.row:has-text("Со скриншота")').click();
    }
    await p.waitForTimeout(300);
    await p.locator('.sheet-body textarea').fill(text);
    await p.waitForTimeout(400);
  };
  const rows = () => p.evaluate(() => [...document.querySelectorAll('.preview-row')].map((r) => ({
    name: r.querySelector('.preview-text')?.textContent,
    category: r.querySelector('.preview-cat')?.value,
  })));

  console.log('\n2. Категорию видно и можно поменять прямо в списке');
  await p.goto(`${URL}#/spending`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  await open(RAIF);
  let list = await rows();
  console.log(`     ${list.map((r) => `${r.name}: ${r.category}`).join(' | ')}`);
  check('у каждой строки свой выбор категории', list.length === 2 && list.every((r) => r.category), JSON.stringify(list));
  check('«КОИ» разбор не узнал', list[0].category === 'Прочее', list[0].category);

  await p.locator('.preview-cat').first().selectOption('Продукты');
  await p.waitForTimeout(400);
  list = await rows();
  console.log(`     после правки: ${list.map((r) => `${r.name}: ${r.category}`).join(' | ')}`);
  check('категория поменялась', list[0].category === 'Продукты', list[0].category);
  check('вторая строка не тронута', list[1].category !== 'Продукты', list[1].category);

  console.log('\n3. Записывается исправленная категория');
  await p.locator('.sheet-foot .btn-primary').click();
  await p.waitForTimeout(800);
  const saved = await p.evaluate(async () => {
    const store = await import('./js/store.js');
    return store.getState().spending.map((r) => `${r.description}: ${r.category}`);
  });
  console.log(`     ${saved.join(' | ')}`);
  check('в базе именно она', saved.some((x) => x.startsWith('КОИ: Продукты')), saved.join(' | '));

  console.log('\n4. Следующая такая же запись берёт категорию сама');
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  await open(AGAIN);
  list = await rows();
  console.log(`     ${list.map((r) => `${r.name}: ${r.category}`).join(' | ')}`);
  check('новая «КОИ» уже продукты', list[0].category === 'Продукты', JSON.stringify(list));

  console.log('\n5. Правка после записи учится так же');
  // Меняем категорию у уже записанной строки — и новая запись с тем же
  // названием должна получить её же.
  await p.evaluate(async () => {
    const store = await import('./js/store.js');
    const row = store.getState().spending.find((r) => /Райффайзен/.test(r.description));
    await store.saveSpend({ ...row, category: 'Жильё и связь' });
  });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  await open(AGAIN);
  list = await rows();
  console.log(`     ${list.map((r) => `${r.name}: ${r.category}`).join(' | ')}`);
  const raif = list.find((r) => /Райффайзен/.test(r.name || ''));
  check('подписка стала жильём и связью', raif && raif.category === 'Жильё и связь', JSON.stringify(list));

  console.log('\n6. Узнаёт по слову, а не только по точному совпадению');
  const byWord = await p.evaluate(async () => {
    const S = await import('./js/statement.js');
    const store = await import('./js/store.js');
    const learned = S.learnCategories(store.getState().spending);
    return S.categorise({ description: 'РАЙФФАЙЗЕН ПОДПИСКА 4512 MOSCOW', bankCategory: null }, [], learned);
  });
  console.log(`     «РАЙФФАЙЗЕН ПОДПИСКА 4512 MOSCOW» → ${byWord}`);
  check('номер точки в названии не мешает', byWord === 'Жильё и связь', byWord);

  console.log(`\n  ошибок в консоли: ${errs.length}${errs.length ? ' — ' + errs.join(' | ') : ''}`);
  if (errs.length) bad += 1;
  await b.close();
  console.log(bad ? `\n${bad} провалов` : '\nВсё сходится');
  process.exit(bad ? 1 : 0);
})();

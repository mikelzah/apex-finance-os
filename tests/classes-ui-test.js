// Экран портфеля и выбор класса в карточке актива.
const { chromium } = require('playwright');
const URL = 'http://127.0.0.1:8899/app/index.html';

(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'], executablePath: process.env.CHROMIUM_PATH || undefined });
  const c = await b.newContext({ viewport: { width: 440, height: 956 }, isMobile: true, hasTouch: true, locale: 'ru-RU', colorScheme: 'light' });
  const p = await c.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

  let bad = 0;
  const check = (l, ok, d) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? ' — ' + d : ''}`); if (!ok) bad += 1; };

  await p.goto(`${URL}#/dashboard`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(600);
  await p.evaluate(async () => (await import('./js/store.js')).loadDemo());
  // Добавляем машину: она обязана попасть в капитал, но не в портфель.
  await p.evaluate(async () => {
    const store = await import('./js/store.js');
    await store.mutate((d) => {
      d.assets.push({
        id: 'car', name: 'Машина', type: 'Транспорт', status: 'Активен',
        liquidity: 'Низкая', opening: 1800000, goalIds: [], assetClass: null,
      });
    });
  });
  await p.goto(`${URL}#/portfolio`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(800);

  const shown = await p.evaluate(() => ({
    classes: [...document.querySelectorAll('.alloc-name')].map((n) => n.textContent.trim()),
    total: document.querySelector('.stat-value')?.textContent.trim(),
    hint: document.querySelector('.stat-hint')?.textContent.trim(),
    outside: [...document.querySelectorAll('.card')]
      .filter((card) => /Вне расчёта долей/.test(card.textContent))
      .map((card) => [...card.querySelectorAll('.row-label span:first-child')].map((s) => s.textContent.trim()))[0] || [],
    addButton: [...document.querySelectorAll('button')].some((x) => /Добавить класс/.test(x.textContent)),
  }));
  console.log(`\nКлассы: ${shown.classes.join(', ')}`);
  console.log(`База: ${shown.total} (${shown.hint})`);
  console.log(`Вне расчёта: ${shown.outside.join(', ') || '—'}`);

  check('четыре класса в закреплённом порядке',
    shown.classes.join(',') === 'Акции,Фонды,Облигации,Вклады', shown.classes.join(','));
  check('машина в списке вне расчёта', shown.outside.includes('Машина'), shown.outside.join(','));
  check('«Прочего» среди классов нет', !shown.classes.includes('Прочее'));
  check('кнопки «Добавить класс» больше нет', shown.addButton === false);

  console.log('\nКапитал машину по-прежнему учитывает');
  const worth = await p.evaluate(async () => {
    const store = await import('./js/store.js'); const C = await import('./js/calc.js');
    const st = store.getState();
    return C.netWorth(st.assets, st.operations).total;
  });
  console.log(`     чистый капитал ${worth} ₽`);
  check('машина внутри капитала', worth > 1800000, String(worth));

  console.log('\nВыбор класса в карточке актива');
  await p.locator('.card:has-text("Вне расчёта долей") .row').first().click();
  await p.waitForTimeout(600);
  // Строка ведёт на страницу актива; форма — по «Изменить» в шапке.
  await p.click('.header-action button');
  await p.waitForTimeout(600);
  const opts = await p.evaluate(() => {
    const labels = [...document.querySelectorAll('.sheet .field-label')];
    const f = labels.find((l) => /Класс в портфеле/.test(l.textContent));
    const sel = f && f.parentElement.querySelector('select');
    return sel ? { options: [...sel.options].map((o) => o.textContent), value: sel.value } : null;
  });
  console.log(`     варианты: ${opts && opts.options.join(' | ')}`);
  check('поле есть', Boolean(opts));
  check('пять вариантов вместе с пустым', opts.options.length === 5, String(opts && opts.options.length));
  check('у машины класс не задан', opts.value === '', opts.value);

  console.log('\nЗадаём машине класс — она входит в расчёт');
  await p.evaluate(() => {
    const f = [...document.querySelectorAll('.sheet .field-label')].find((l) => /Класс в портфеле/.test(l.textContent));
    const sel = f.parentElement.querySelector('select');
    sel.value = 'Акции';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await p.locator('.sheet-foot .btn-primary').click();
  await p.waitForTimeout(800);
  const after = await p.evaluate(async () => {
    const store = await import('./js/store.js'); const C = await import('./js/calc.js');
    const st = store.getState();
    const car = st.assets.find((a) => a.id === 'car');
    return { cls: car.assetClass, total: C.portfolioRows(st.assets, st.operations, st.portfolio).total };
  });
  console.log(`     класс машины: ${after.cls}, база расчёта ${after.total} ₽`);
  check('класс сохранился', after.cls === 'Акции', String(after.cls));
  check('база выросла на стоимость машины', after.total > 1800000, String(after.total));

  console.log('\nЦелевая доля правится, название класса — нет');
  await p.goto(`${URL}#/portfolio`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  await p.locator('.alloc-row').first().click();
  await p.waitForTimeout(600);
  const sheet = await p.evaluate(() => ({
    title: document.querySelector('.sheet-head h2')?.textContent.trim(),
    fields: [...document.querySelectorAll('.sheet .field-label')].map((l) => l.textContent.trim()),
  }));
  console.log(`     шторка «${sheet.title}», поля: ${sheet.fields.join(', ')}`);
  check('заголовок — имя класса', sheet.title === 'Акции', sheet.title);
  check('только целевая доля', sheet.fields.length === 1 && /Целевая доля/.test(sheet.fields[0]), sheet.fields.join(','));

  console.log('\nСтарого экрана «Классы по тикерам» нет');
  await p.goto(`${URL}#/more`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(500);
  const hub = await p.evaluate(() => document.getElementById('screen').textContent);
  check('строки в «Ещё» не осталось', !/Классы по тикерам/.test(hub));

  await c.close();
  await b.close();
  if (errs.length) { console.log('\nОшибки:'); errs.forEach((e) => console.log('  ' + e)); bad += errs.length; }
  console.log(bad ? `\n${bad} провалов\n` : '\nВсё сходится\n');
  process.exit(bad ? 1 : 0);
})();

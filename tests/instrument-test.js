// Портфель: сначала бумаги по классам, потом доли. У каждой бумаги — своя
// страница с операциями и графиком цены.
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
  await p.goto(`${URL}#/portfolio`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(900);

  console.log('\n1. Порядок: сумма, потом бумаги, потом доли');
  // Сравниваем не порядок в разметке, а положение на экране: спрашивается
  // именно «что человек видит выше».
  const order = await p.evaluate(() => {
    const s = document.getElementById('screen');
    const nodes = [...s.querySelectorAll('.hero-label, .section-title h2')];
    return nodes.map((n) => ({ text: n.textContent.trim(), top: Math.round(n.getBoundingClientRect().top + s.scrollTop) }));
  });
  console.log(`     сверху вниз: ${order.map((o) => `${o.text} (${o.top})`).join(' | ')}`);
  const at = (t) => order.find((o) => o.text === t)?.top;
  const yTotal = at('Портфель');
  const yShares = at('Доли');
  const yClass = order.filter((o) => ['Акции', 'Фонды', 'Облигации', 'Вклады'].includes(o.text))
    .map((o) => o.top).sort((a, b) => a - b)[0];
  check('сумма портфеля — самое верхнее', yTotal != null && yTotal < yClass, `сумма на ${yTotal}, класс на ${yClass}`);
  check('бумаги выше долей', yClass != null && yShares != null && yClass < yShares, `класс на ${yClass}, доли на ${yShares}`);

  const totalShown = await p.evaluate(() => document.querySelector('.hero-value')?.textContent.trim());
  console.log(`     сумма на экране: ${totalShown}`);
  check('сумма — не пустая и не ноль', Boolean(totalShown) && totalShown !== '0 ₽', totalShown);

  console.log('\n2. Классы с суммами, пустых нет');
  const groups = await p.evaluate(() =>
    [...document.querySelectorAll('.section-title')]
      .filter((t) => ['Акции','Фонды','Облигации','Вклады'].includes(t.querySelector('h2')?.textContent.trim()))
      .map((t) => ({ cls: t.querySelector('h2').textContent.trim(), sum: t.querySelector('.section-sum')?.textContent.trim() })));
  groups.forEach((g) => console.log(`     ${g.cls}: ${g.sum}`));
  check('показаны только непустые классы', groups.length > 0 && groups.every((g) => g.sum && g.sum !== '0 ₽'),
    JSON.stringify(groups));

  console.log('\n2а. Действия не налезают друг на друга');
  // Кнопки встали в столбец, а не в строку: обновление котировок — действие
  // служебное, и рядом с «Добавить бумагу» равным по весу оно читалось
  // как выбор из равного. Исходная жалоба — «кнопки налезают» — проверяется
  // ровно так же: ни один пиксель одной не попадает в прямоугольник другой.
  const acts = await p.evaluate(() => {
    const row = document.querySelector('.act');
    if (!row) return null;
    const btns = [...row.querySelectorAll('.btn')].map((b) => {
      const r = b.getBoundingClientRect();
      return { text: b.textContent.trim(), x: Math.round(r.left), r: Math.round(r.right), y: Math.round(r.top), b: Math.round(r.bottom) };
    });
    return { btns, gap: btns.length === 2 ? Math.round(btns[1].y - btns[0].b) : null };
  });
  console.log(`     ${acts.btns.map((x) => `«${x.text}» ${x.x}–${x.r} / ${x.y}–${x.b}`).join('  ')}`);
  check('оба действия на месте', acts.btns.length === 2, acts.btns.map((x) => x.text).join(', '));
  check('стоят в столбец', acts.btns[0].x === acts.btns[1].x, `${acts.btns[0].x} vs ${acts.btns[1].x}`);
  check('не пересекаются, между ними просвет', acts.gap > 0, `${acts.gap} px`);
  // Прямая проверка исходной жалобы: ни один пиксель одной кнопки не попадает
  // в прямоугольник другой.
  const overlap = Math.max(0, Math.min(acts.btns[0].r, acts.btns[1].r) - Math.max(acts.btns[0].x, acts.btns[1].x))
    * Math.max(0, Math.min(acts.btns[0].b, acts.btns[1].b) - Math.max(acts.btns[0].y, acts.btns[1].y));
  check('площадь наложения нулевая', overlap === 0, `${overlap} px²`);

  console.log('\n3. Бумага открывается своей страницей');
  const firstRow = p.locator('.card:has(.section-sum) .paper').first();
  const name = (await firstRow.textContent()).trim();
  await firstRow.click();
  await p.waitForTimeout(700);
  const page1 = await p.evaluate(() => ({
    hash: location.hash,
    header: document.getElementById('header').hidden ? null : document.querySelector('#header h1')?.textContent.trim(),
    action: document.querySelector('.header-action button')?.textContent.trim(),
    stat: document.querySelector('.stat-value')?.textContent.trim(),
    hint: document.querySelector('.stat-hint')?.textContent.trim(),
    sections: [...document.querySelectorAll('.section-title h2')].map((n) => n.textContent.trim()),
  }));
  console.log(`     ${page1.hash} · заголовок «${page1.header}» · действие «${page1.action}»`);
  console.log(`     стоимость ${page1.stat} (${page1.hint}) · разделы: ${page1.sections.join(', ')}`);
  check('адрес вида portfolio/<id>', /#\/portfolio\/.+/.test(page1.hash), page1.hash);
  check('в шапке имя бумаги', Boolean(page1.header) && name.includes(page1.header.slice(0, 6)), page1.header);
  check('кнопка «Изменить» в шапке', page1.action === 'Изменить', page1.action);
  // У бумаги раздел называется «Сделки»: движение денег её стоимость
  // не меняет, там записывают покупки и продажи.
  check('есть раздел сделок', page1.sections.includes('Сделки и выплаты'), page1.sections.join(','));

  console.log('\n4. График цены у бумаги с тикером');
  const chart = await p.evaluate(() => ({
    hasChart: Boolean(document.querySelector('.figure .chart')),
    priceSection: [...document.querySelectorAll('.section-title h2')].some((n) => n.textContent.trim() === 'Цена'),
    ticker: null,
  }));
  console.log(`     раздел «Цена»: ${chart.priceSection}, график: ${chart.hasChart}`);

  console.log('\n5. Сделка записывается прямо со страницы бумаги');
  const opsBefore = await p.evaluate(async () => (await import('./js/store.js')).getState().operations.length);
  await p.locator('.card:has-text("Сделки и выплаты") .section-title button').click();
  await p.waitForTimeout(700);
  const preset = await p.evaluate(() => {
    const f = [...document.querySelectorAll('.sheet .field-label')].find((l) => l.textContent.startsWith('Бумага'));
    const sel = f && f.parentElement.querySelector('select');
    return sel ? sel.options[sel.selectedIndex].textContent.trim() : null;
  });
  console.log(`     в форме подставлена бумага: ${preset}`);
  check('бумага подставлена сама', Boolean(preset), String(preset));
  await p.locator('.field:has-text("Количество, лотов") input').fill('3');
  await p.locator('.field:has-text("Цена за штуку") input').fill('310');
  await p.locator('.sheet-foot .btn-primary').click();
  await p.waitForTimeout(800);
  const opsAfter = await p.evaluate(async () => (await import('./js/store.js')).getState().operations.length);
  check('сделка создалась', opsAfter === opsBefore + 1, `${opsBefore} → ${opsAfter}`);
  // :has-text — селектор Playwright, в document.querySelector он недопустим.
  const listed = await p.evaluate(() => {
    const card = [...document.querySelectorAll('.card')].find((n) => /Сделки и выплаты/.test(n.textContent));
    return card ? card.querySelectorAll('.row').length : 0;
  });
  check('видна в списке сделок бумаги', listed > 0, String(listed));

  console.log('\n6. Назад — на список портфеля');
  await p.click('.back');
  await p.waitForTimeout(600);
  check('вернулись в портфель', (await p.evaluate(() => location.hash)) === '#/portfolio');
  check('шапки на списке нет', await p.evaluate(() => document.getElementById('header').hidden));

  console.log('\n7. Актив без класса тоже открывается страницей');
  await p.evaluate(async () => {
    const store = await import('./js/store.js');
    await store.mutate((d) => {
      d.assets.push({ id: 'car', name: 'Машина', type: 'Транспорт', status: 'Активен',
        liquidity: 'Низкая', opening: 1800000, goalIds: [], assetClass: null });
    });
  });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  await p.locator('.card:has-text("Вне расчёта долей") .row').first().click();
  await p.waitForTimeout(700);
  const carPage = await p.evaluate(() => ({
    header: document.querySelector('#header h1')?.textContent.trim(),
    price: [...document.querySelectorAll('.section-title h2')].some((n) => n.textContent.trim() === 'Цена'),
  }));
  console.log(`     «${carPage.header}», раздел «Цена»: ${carPage.price}`);
  check('открылась страница машины', carPage.header === 'Машина', carPage.header);
  check('графика цены у неё нет', carPage.price === false, String(carPage.price));

  await c.close();
  await b.close();
  if (errs.length) { console.log('\nОшибки:'); errs.forEach((e) => console.log('  ' + e)); bad += errs.length; }
  console.log(bad ? `\n${bad} провалов\n` : '\nВсё сходится\n');
  process.exit(bad ? 1 : 0);
})();

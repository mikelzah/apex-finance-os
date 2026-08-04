// На главной — все активные цели карточками и ни одной неактивной.
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
  await p.evaluate(async () => {
    const store = await import('./js/store.js');
    const D = await import('./js/dates.js');
    await store.startEmpty();
    await store.mutate((d) => {
      d.assets = [{ id: 'a', name: 'Счёт', type: 'Деньги', status: 'Активен', liquidity: 'Мгновенная',
        assetClass: 'Вклады', opening: 50000, openingDate: D.addDays(D.today(), -30), goalIds: ['g1'], lotSize: 1 }];
      d.goals = [
        { id: 'g1', name: '🚗 Автомобиль', target: 210000, deadline: null, planPerDay: 900, status: 'Активна', sort: 0 },
        { id: 'g2', name: '🏝 Отпуск', target: 150000, deadline: null, planPerDay: null, status: 'Активна', sort: 1 },
        { id: 'g3', name: '💰 Первый миллион', target: 1000000, deadline: null, planPerDay: null, status: 'На паузе', sort: 2 },
        { id: 'g4', name: '🛡 Подушка', target: 400000, deadline: null, planPerDay: null, status: 'Достигнута', sort: 3 },
      ];
    });
  });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(900);

  const home = () => p.evaluate(() => ({
    // Цели на главной лежат лентой внутри одной плитки, а не карточками
    // во всю ширину: при четырёх целях карточки выдавливали за нижний край
    // всё остальное. Проверяется ровно то же — какие цели показаны
    // и в каком порядке, — только слайды вместо карточек.
    cards: [...document.querySelectorAll('.goal-slide-name')].map((x) => x.textContent.trim()),
    // Что бы ни попало в строки главной, целей среди них быть не должно.
    rows: [...document.querySelectorAll('.row-label span')].map((x) => x.textContent.trim()),
    titles: [...document.querySelectorAll('.section-title')].map((x) => x.textContent.trim()),
  }));

  console.log('\n1. Все активные цели — карточками');
  let g = await home();
  console.log(`     карточки: ${g.cards.join(' · ')}`);
  check('обе активные на месте', g.cards.join('|') === '🚗 Автомобиль|🏝 Отпуск', g.cards.join(', '));
  check('порядок — как расставлено', g.cards[0] === '🚗 Автомобиль', g.cards.join(', '));

  console.log('\n2. Неактивных на главной нет');
  console.log(`     строки: ${g.rows.join(' · ') || '—'}`);
  check('цели на паузе нет', !g.rows.includes('💰 Первый миллион') && !g.cards.includes('💰 Первый миллион'),
    g.rows.join(', '));
  check('достигнутой нет', !g.rows.includes('🛡 Подушка') && !g.cards.includes('🛡 Подушка'), g.rows.join(', '));
  check('блока «Остальные цели» нет', !g.titles.some((t) => /Остальные цели/.test(t)), g.titles.join(' | '));

  console.log('\n3. Перестановка меняет порядок карточек');
  await p.evaluate(async () => {
    const store = await import('./js/store.js');
    await store.mutate((d) => {
      d.goals.find((x) => x.id === 'g1').sort = 5;
      d.goals.find((x) => x.id === 'g2').sort = 0;
    });
  });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  g = await home();
  console.log(`     карточки: ${g.cards.join(' · ')}`);
  check('первой стала переставленная', g.cards.join('|') === '🏝 Отпуск|🚗 Автомобиль', g.cards.join(', '));

  // Так же, как это делает человек: форма на экране «Цели», потом главная.
  console.log('\n4. Новая цель появляется после добавления через форму');
  await p.evaluate(() => { location.hash = '#/goals'; });
  await p.waitForTimeout(700);
  await p.locator('.screen-head .head-round[aria-label="Добавить цель"]').click();
  await p.waitForTimeout(500);
  // Числовые поля тоже type=text — название берём по data-autofocus.
  await p.locator('.sheet-body input[data-autofocus=yes]').fill('💻 Ноутбук');
  await p.locator('.sheet-body .control[inputmode=decimal]').first().fill('90000');
  await p.locator('.sheet-foot .btn-primary').click();
  await p.waitForTimeout(700);
  await p.evaluate(() => { location.hash = '#/dashboard'; });
  await p.waitForTimeout(800);
  g = await home();
  console.log(`     карточки: ${g.cards.join(' · ')}`);
  check('новая цель карточкой', g.cards.includes('💻 Ноутбук'), g.cards.join(', '));

  console.log('\n5. Цель, поставленная на паузу, уходит с главной');
  await p.evaluate(() => { location.hash = '#/goals'; });
  await p.waitForTimeout(700);
  await p.locator('.goal-head:has-text("Ноутбук")').first().click();
  await p.waitForTimeout(500);
  await p.locator('.sheet-body select').last().selectOption('На паузе');
  await p.locator('.sheet-foot .btn-primary').click();
  await p.waitForTimeout(700);
  await p.evaluate(() => { location.hash = '#/dashboard'; });
  await p.waitForTimeout(800);
  g = await home();
  console.log(`     карточки: ${g.cards.join(' · ')} · строки: ${g.rows.join(' · ') || '—'}`);
  check('карточки нет', !g.cards.includes('💻 Ноутбук'), g.cards.join(', '));
  check('и строкой не всплыла', !g.rows.includes('💻 Ноутбук'), g.rows.join(', '));

  console.log('\n6. Активных целей нет — блока нет, а экран цел');
  await p.evaluate(async () => {
    const store = await import('./js/store.js');
    await store.mutate((d) => { for (const x of d.goals) x.status = 'На паузе'; });
  });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  g = await home();
  const capital = await p.evaluate(() => document.querySelector('.hero-value, .stat-value')?.textContent.trim() || '');
  console.log(`     карточек: ${g.cards.length} · капитал: ${capital}`);
  check('ни одной карточки цели', g.cards.length === 0, g.cards.join(', '));
  check('главная не сломалась', capital.length > 0, capital);

  console.log(`\n  ошибок в консоли: ${errs.length}${errs.length ? ' — ' + errs.join(' | ') : ''}`);
  if (errs.length) bad += 1;
  await b.close();
  console.log(bad ? `\n${bad} провалов` : '\nВсё сходится');
  process.exit(bad ? 1 : 0);
})();

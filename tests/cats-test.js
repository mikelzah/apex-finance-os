// Записи скрыты, раскрываются по категории, и есть кнопка на всё сразу.
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
      d.assets = [{ id: 'a', name: 'Карта', type: 'Деньги', status: 'Активен', liquidity: 'Мгновенная',
        assetClass: 'Вклады', opening: 100000, goalIds: [], lotSize: 1 }];
      let n = 0;
      const put = (amount, kind, category, description) => d.spending.push({
        id: `s${n += 1}`, date: D.addDays(D.today(), -(n % 5)), amount, kind, category, description,
        account: 'Банк', key: `k${n}`, source: 'Вручную',
      });
      put(1200, 'Трата', 'Продукты', 'Пятёрочка');
      put(900, 'Трата', 'Продукты', 'ВкусВилл');
      put(512, 'Трата', 'Продукты', 'Дикси');
      put(1465, 'Трата', 'Кафе и рестораны', 'Яндекс.Еда');
      put(920, 'Трата', 'Транспорт', 'Подорожник');
      put(50000, 'Поступление', 'Зарплата', 'Зарплата');
      put(3000, 'Перевод себе', 'Переводы', 'Перевод на вклад');
    });
  });
  await p.goto(`${URL}#/more/spending`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(800);

  const state = () => p.evaluate(() => ({
    cats: [...document.querySelectorAll('.cat-name')].map((x) => x.textContent),
    ops: [...document.querySelectorAll('.cat-op')].map((x) => x.textContent),
    tables: document.querySelectorAll('.spend-total').length,
    button: [...document.querySelectorAll('.btn')].map((x) => x.textContent).find((t) => /все траты|Скрыть список/.test(t)),
  }));

  console.log('\n1. Сначала записей не видно');
  let s = await state();
  console.log(`     категории: ${s.cats.join(', ')} · кнопка: «${s.button}»`);
  check('категории показаны', s.cats.length === 3, s.cats.join(', '));
  check('таблицы записей нет', s.tables === 0, String(s.tables));
  check('раскрытых записей нет', s.ops.length === 0, String(s.ops.length));
  check('есть кнопка на все траты', s.button === 'Показать все траты', String(s.button));

  console.log('\n2. Нажатие по категории раскрывает её записи');
  await p.locator('.cat:has-text("Продукты")').click();
  await p.waitForTimeout(400);
  s = await state();
  console.log(`     ${s.ops.join(' | ')}`);
  check('раскрылись три записи продуктов', s.ops.length === 3, String(s.ops.length));
  check('это именно продукты', s.ops.every((x) => /Пятёрочка|ВкусВилл|Дикси/.test(x)), s.ops.join(' | '));
  check('чужих записей нет', !s.ops.some((x) => /Подорожник|Яндекс/.test(x)), s.ops.join(' | '));
  check('общий список так и не появился', s.tables === 0, String(s.tables));

  console.log('\n3. Другая категория — раскрыта только она');
  await p.locator('.cat:has-text("Транспорт")').click();
  await p.waitForTimeout(400);
  s = await state();
  console.log(`     ${s.ops.join(' | ')}`);
  check('раскрыта одна запись', s.ops.length === 1, String(s.ops.length));
  check('это Подорожник', /Подорожник/.test(s.ops[0] || ''), s.ops[0]);

  console.log('\n4. Повторное нажатие закрывает');
  await p.locator('.cat:has-text("Транспорт")').click();
  await p.waitForTimeout(400);
  s = await state();
  check('записи снова скрыты', s.ops.length === 0, String(s.ops.length));

  console.log('\n5. Кнопка показывает всё');
  await p.locator('.btn:has-text("Показать все траты")').click();
  await p.waitForTimeout(500);
  s = await state();
  const rows = await p.evaluate(() => document.querySelectorAll('.spend-op').length);
  console.log(`     строк в списке: ${rows} · кнопка: «${s.button}»`);
  check('общий список появился', s.tables === 1, String(s.tables));
  // Семь записей: пять трат, доход и перевод. В общий список входят все —
  // иначе доход и перевод нельзя было бы открыть и поправить.
  check('в нём все семь записей', rows === 7, String(rows));
  check('кнопка сменилась на «Скрыть»', s.button === 'Скрыть список', String(s.button));

  console.log('\n6. Запись открывается на правку');
  await p.locator('.spend-op').first().click();
  await p.waitForTimeout(500);
  const sheet = await p.evaluate(() => document.querySelector('.sheet-head h2')?.textContent);
  check('шторка записи открылась', sheet === 'Запись', String(sheet));
  await p.locator('.sheet-close').click();
  await p.waitForTimeout(300);

  console.log('\n7. И из раскрытой категории тоже');
  await p.locator('.btn:has-text("Скрыть список")').click();
  await p.waitForTimeout(400);
  await p.locator('.cat:has-text("Кафе")').click();
  await p.waitForTimeout(400);
  await p.locator('.cat-op').first().click();
  await p.waitForTimeout(500);
  const sheet2 = await p.evaluate(() => document.querySelector('.sheet-head h2')?.textContent);
  check('шторка открылась и отсюда', sheet2 === 'Запись', String(sheet2));

  console.log(`\n  ошибок в консоли: ${errs.length}${errs.length ? ' — ' + errs.join(' | ') : ''}`);
  if (errs.length) bad += 1;
  await b.close();
  console.log(bad ? `\n${bad} провалов` : '\nВсё сходится');
  process.exit(bad ? 1 : 0);
})();

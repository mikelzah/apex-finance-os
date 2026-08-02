// Поиск по журналу и по тратам.
//
// Главное здесь — не сам отбор, а фокус: экран собирается заново на каждое
// нажатие клавиши, и без сохранения фокуса набрать больше одной буквы
// невозможно. Проверяется именно это.
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

  console.log('\n1. Отбор по словам');
  const words = await p.evaluate(async () => {
    const U = await import('./js/ui.js');
    return {
      // Слова ищутся по отдельности и в любом порядке.
      both: U.matches('лавка 738', 'Яндекс Лавка', 'Продукты', '738'),
      order: U.matches('738 лавка', 'Яндекс Лавка', 'Продукты', '738'),
      partial: U.matches('лав', 'Яндекс Лавка'),
      caseless: U.matches('ЛАВКА', 'яндекс лавка'),
      miss: U.matches('лавка 999', 'Яндекс Лавка', '738'),
      empty: U.matches('', 'что угодно'),
      nulls: U.matches('лавка', null, undefined, 'Яндекс Лавка'),
    };
  });
  check('оба слова', words.both, String(words.both));
  check('порядок не важен', words.order, String(words.order));
  check('часть слова', words.partial, String(words.partial));
  check('регистр не важен', words.caseless, String(words.caseless));
  check('лишнее слово не находит', !words.miss, String(words.miss));
  check('пустой запрос находит всё', words.empty, String(words.empty));
  check('пустые поля не мешают', words.nulls, String(words.nulls));

  await p.evaluate(async () => {
    const store = await import('./js/store.js');
    const D = await import('./js/dates.js');
    const today = D.today();
    await store.startEmpty();
    await store.mutate((d) => {
      d.assets = [
        { id: 'a1', name: 'Накопительный счёт', type: 'Деньги', status: 'Активен', liquidity: 'Мгновенная',
          assetClass: 'Вклады', opening: 50000, openingDate: D.addDays(today, -100), goalIds: [], lotSize: 1 },
        { id: 'a2', name: 'Брокерский счёт', type: 'Деньги', status: 'Активен', liquidity: 'Мгновенная',
          assetClass: 'Вклады', opening: 20000, openingDate: D.addDays(today, -100), goalIds: [], lotSize: 1 },
      ];
      d.operations = [
        { id: 'o1', date: D.addDays(today, -20), type: 'Взнос', assetId: 'a1', amount: 4500, goalId: null },
        { id: 'o2', date: D.addDays(today, -10), type: 'Взнос', assetId: 'a2', amount: 7300, goalId: null },
        { id: 'o3', date: D.addDays(today, -5), type: 'Доход', assetId: 'a1', amount: 812, goalId: null },
      ];
      d.spending = [
        { id: 's1', date: D.addDays(today, -3), amount: 640, kind: 'Трата', category: 'Продукты',
          description: 'Яндекс Лавка', account: 'Банк', key: 'k1' },
        { id: 's2', date: D.addDays(today, -2), amount: 4500, kind: 'Трата', category: 'Покупки',
          description: 'OZON', account: 'Банк', key: 'k2' },
        { id: 's3', date: D.addDays(today, -1), amount: 890, kind: 'Трата', category: 'Кафе и рестораны',
          description: 'Яндекс.Еда', account: 'Банк', key: 'k3' },
      ];
    });
  });

  console.log('\n2. Журнал: фокус переживает набор');
  await p.goto(`${URL}#/portfolio`, { waitUntil: 'networkidle' });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  await p.locator('.segment:has-text("Журнал")').click();
  await p.waitForTimeout(500);

  const box = '[data-keep-focus="journal-search"]';
  await p.locator(box).click();
  // Именно посимвольный ввод: вставка целиком не воспроизводит проблему.
  await p.keyboard.type('брокер', { delay: 60 });
  await p.waitForTimeout(400);
  const typed = await p.evaluate((sel) => {
    const el = document.querySelector(sel);
    return { value: el ? el.value : null, focused: document.activeElement === el, caret: el && el.selectionStart };
  }, box);
  console.log(`     в поле «${typed.value}», фокус ${typed.focused}, курсор ${typed.caret}`);
  check('набралось целиком', typed.value === 'брокер', String(typed.value));
  check('фокус остался в поле', typed.focused, String(typed.focused));
  check('курсор в конце', typed.caret === 6, String(typed.caret));

  console.log('\n3. Журнал: что нашлось');
  let rows = await p.evaluate(() =>
    [...document.querySelectorAll('.op-row, .op')].map((x) => x.innerText.replace(/\s+/g, ' ')));
  console.log(`     ${rows.join(' | ') || '—'}`);
  check('осталась одна операция', rows.length === 1, String(rows.length));
  check('и это брокерская', /7 300|7300/.test(rows[0] || ''), rows[0]);

  // Поиск по сумме — то, ради чего в журнал и лезут.
  await p.locator(box).fill('');
  await p.locator(box).click();
  await p.keyboard.type('812', { delay: 40 });
  await p.waitForTimeout(400);
  rows = await p.evaluate(() =>
    [...document.querySelectorAll('.op-row, .op')].map((x) => x.innerText.replace(/\s+/g, ' ')));
  console.log(`     по сумме: ${rows.join(' | ') || '—'}`);
  check('по сумме находит', rows.length === 1 && /812/.test(rows[0]), rows.join(' | '));

  console.log('\n4. Журнал: пусто — сказано, по какому запросу');
  await p.locator(box).fill('');
  await p.locator(box).click();
  await p.keyboard.type('чебурашка', { delay: 30 });
  await p.waitForTimeout(400);
  const emptyText = await p.evaluate(() => document.querySelector('.empty-box')?.innerText || '');
  console.log(`     ${emptyText.replace(/\s+/g, ' ')}`);
  check('назван запрос', /чебурашка/.test(emptyText), emptyText.replace(/\s+/g, ' '));

  console.log('\n5. Крестик очищает');
  await p.locator('.search-clear').click();
  await p.waitForTimeout(400);
  const cleared = await p.evaluate((sel) => document.querySelector(sel)?.value, box);
  rows = await p.evaluate(() => document.querySelectorAll('.op-row, .op').length);
  console.log(`     в поле «${cleared}», операций ${rows}`);
  check('поле пустое', cleared === '', String(cleared));
  check('вернулись все операции', rows === 3, String(rows));

  console.log('\n6. Траты: поиск вместо разбора по категориям');
  await p.goto(`${URL}#/spending`, { waitUntil: 'networkidle' });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  const sbox = '[data-keep-focus="spend-search"]';
  await p.locator(sbox).click();
  await p.keyboard.type('яндекс', { delay: 50 });
  await p.waitForTimeout(400);

  const spend = await p.evaluate((sel) => ({
    value: document.querySelector(sel)?.value,
    focused: document.activeElement === document.querySelector(sel),
    ops: [...document.querySelectorAll('.spend-op')].map((x) => x.innerText.replace(/\s+/g, ' ')),
    title: [...document.querySelectorAll('.section-title')].map((x) => x.textContent.trim()),
    bars: document.querySelectorAll('.cat-bar, .bar').length,
  }), sbox);
  console.log(`     «${spend.value}» → ${spend.ops.length} записи: ${spend.ops.join(' | ')}`);
  check('набралось целиком', spend.value === 'яндекс', String(spend.value));
  check('фокус остался', spend.focused, String(spend.focused));
  check('нашлись обе записи', spend.ops.length === 2, String(spend.ops.length));
  check('OZON не попал', !spend.ops.join(' ').includes('OZON'), spend.ops.join(' | '));
  check('заголовок сменился на «Найдено»', spend.title.includes('Найдено'), spend.title.join(', '));

  console.log('\n7. Траты: поиск по сумме и по категории');
  await p.locator(sbox).fill('');
  await p.locator(sbox).click();
  await p.keyboard.type('4500', { delay: 40 });
  await p.waitForTimeout(400);
  let ops = await p.evaluate(() => [...document.querySelectorAll('.spend-op')].map((x) => x.innerText.replace(/\s+/g, ' ')));
  check('по сумме', ops.length === 1 && /OZON/.test(ops[0]), ops.join(' | '));

  await p.locator(sbox).fill('');
  await p.locator(sbox).click();
  await p.keyboard.type('кафе', { delay: 40 });
  await p.waitForTimeout(400);
  ops = await p.evaluate(() => [...document.querySelectorAll('.spend-op')].map((x) => x.innerText.replace(/\s+/g, ' ')));
  check('по категории', ops.length === 1 && /Еда/.test(ops[0]), ops.join(' | '));

  console.log(`\n  ошибок в консоли: ${errs.length}${errs.length ? ' — ' + errs.join(' | ') : ''}`);
  if (errs.length) bad += 1;
  await b.close();
  console.log(bad ? `\n${bad} провалов` : '\nВсё сходится');
  process.exit(bad ? 1 : 0);
})();

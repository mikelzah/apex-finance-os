// Операции со скриншота: текст, распознанный телефоном, становится записями.
const { chromium } = require('playwright');
const URL = 'http://127.0.0.1:8899/app/index.html';

// Так выглядит список операций в приложении банка после «Выделить всё»:
// дата заголовком над группой, магазин и категория отдельными строками,
// сумма ниже. Плюс шум — время, кэшбэк, остаток.
const ALFA = `Июль
Сегодня
Пятёрочка
Супермаркеты
−1 240,50 ₽
Кэшбэк 62 ₽
Вчера
Яндекс Go
Такси
−320 ₽
29 июля
Зарплата за июль
+77 777,77 ₽
Остаток по счёту 66 666,66 ₽`;

// Другой банк: сумма в той же строке, что и магазин, между ними время.
const TBANK = `2 июля
14:22
ВкусВилл −1 500,25 ₽
09:05
Перевод между счетами −20 000 ₽
15 декабря
Аптека Ригла −450 ₽`;

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
        assetClass: 'Вклады', opening: 30000, goalIds: [], lotSize: 1 }];
    });
  });

  console.log('\n1. Список с датами-заголовками');
  const a = await p.evaluate(async (text) => {
    const S = await import('./js/screenshot.js');
    const D = await import('./js/dates.js');
    return { today: D.today(), yesterday: D.addDays(D.today(), -1), ...S.parseScreen(text, D.today()) };
  }, ALFA);
  for (const r of a.rows) console.log(`     ${r.date} · ${r.kind} · ${r.amount} · ${r.description}`);
  check('нашлись три операции', a.rows.length === 3, String(a.rows.length));
  check('«Сегодня» — сегодня', a.rows[0].date === a.today, a.rows[0].date);
  check('«Вчера» — вчера', a.rows[1].date === a.yesterday, a.rows[1].date);
  check('«29 июля» без года', a.rows[2].date === '2026-07-29', a.rows[2].date);
  check('минус — трата', a.rows[0].kind === 'Трата' && a.rows[0].amount === 1240.5, JSON.stringify(a.rows[0]));
  check('плюс — поступление', a.rows[2].kind === 'Поступление' && a.rows[2].amount === 77777.77, JSON.stringify(a.rows[2]));
  check('магазин взят строкой выше суммы', a.rows[0].description === 'Пятёрочка', a.rows[0].description);
  check('категория банка подхвачена', a.rows[0].bankCategory === 'Супермаркеты', String(a.rows[0].bankCategory));
  check('кэшбэк не стал доходом', !a.rows.some((r) => /62/.test(String(r.amount))), JSON.stringify(a.rows.map((r) => r.amount)));
  check('остаток по счёту не стал операцией',
    !a.rows.some((r) => r.amount === 66666.66), JSON.stringify(a.rows.map((r) => r.amount)));

  console.log('\n2. Сумма в одной строке с магазином');
  const t = await p.evaluate(async (text) => {
    const S = await import('./js/screenshot.js');
    const D = await import('./js/dates.js');
    return S.parseScreen(text, D.today());
  }, TBANK);
  for (const r of t.rows) console.log(`     ${r.date} · ${r.kind} · ${r.amount} · ${r.description}`);
  check('три операции', t.rows.length === 3, String(t.rows.length));
  check('название из той же строки', t.rows[0].description === 'ВкусВилл', t.rows[0].description);
  check('время не стало названием', !t.rows.some((r) => /^\d{1,2}:\d{2}$/.test(r.description)), '');
  // Декабря ещё не было в этом году — значит, прошлый декабрь.
  check('месяц из будущего отнесён к прошлому году', t.rows[2].date === '2025-12-15', t.rows[2].date);

  console.log('\n3. Правила категорий и переводов действуют и здесь');
  const marked = await p.evaluate(async (text) => {
    const S = await import('./js/screenshot.js');
    const St = await import('./js/statement.js');
    const D = await import('./js/dates.js');
    const { rows } = S.parseScreen(text, D.today());
    const withCat = rows.map((r) => ({ ...r, category: St.categorise(r, []) }));
    return St.markTransfers(withCat, []);
  }, TBANK);
  console.log(`     ${marked.map((r) => `${r.category}/${r.kind}`).join(' | ')}`);
  check('ВкусВилл — продукты', marked[0].category === 'Продукты', marked[0].category);
  check('перевод между счетами — не трата', marked[1].kind === 'Перевод себе', marked[1].kind);
  check('аптека — здоровье', marked[2].category === 'Здоровье', marked[2].category);

  console.log('\n4. Шторка: разбор виден до записи');
  await p.goto(`${URL}#/more/spending`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  await p.locator('.btn:has-text("Со скриншота")').first().click();
  await p.waitForTimeout(400);
  const opened = await p.evaluate(() => Boolean(document.querySelector('.sheet')));
  check('шторка открылась', opened, String(opened));

  await p.locator('.sheet-body textarea').fill(ALFA);
  await p.waitForTimeout(400);
  const sheet = await p.evaluate(() => ({
    summary: [...document.querySelectorAll('.sheet-body .sheet-note')].map((x) => x.textContent).join(' '),
    preview: [...document.querySelectorAll('.preview-row')].map((r) => r.textContent),
  }));
  console.log(`     ${sheet.summary}`);
  console.log(`     ${sheet.preview.join('\n     ')}`);
  check('сводка про три операции', /Нашлось операций: 3/.test(sheet.summary), sheet.summary);
  check('разбор показан построчно', sheet.preview.length === 3, String(sheet.preview.length));
  check('зарплата со знаком плюс', /\+/.test(sheet.preview[2]), sheet.preview[2]);

  await p.locator('.sheet-foot .btn-primary').click();
  await p.waitForTimeout(800);
  const saved = await p.evaluate(async () => {
    const store = await import('./js/store.js');
    return store.getState().spending.map((r) => `${r.date} ${r.kind} ${r.amount} ${r.description}`);
  });
  console.log(`     записано: ${saved.length}`);
  check('записи сохранены', saved.length === 3, String(saved.length));

  console.log('\n5. Повторная вставка того же текста');
  // Список записей закрыт, и кнопка из его заголовка ушла вместе с ним:
  // на заполненном экране путь идёт через «Загрузить» в шапке.
  await p.locator('.head-round[aria-label="Загрузить выписку"]').first().click();
  await p.waitForTimeout(300);
  await p.locator('.row:has-text("Со скриншота")').click();
  await p.waitForTimeout(400);
  await p.locator('.sheet-body textarea').fill(ALFA);
  await p.waitForTimeout(400);
  const again = await p.evaluate(() =>
    [...document.querySelectorAll('.sheet-body .sheet-note')].map((x) => x.textContent).join(' '));
  console.log(`     ${again}`);
  // Раньше сводка писала «Новых: 0», теперь уже записанные не показываются
  // вовсе и сводка говорит, сколько их пропущено.
  check('повторные пропущены', /Уже записано раньше: 3/.test(again), again);

  console.log('\n6. Текст без дат');
  const noDate = await p.evaluate(async () => {
    const S = await import('./js/screenshot.js');
    const D = await import('./js/dates.js');
    const r = S.parseScreen('Пятёрочка\n−100 ₽', D.today());
    return { dated: r.dated, date: r.rows[0].date, today: D.today() };
  });
  check('отсутствие даты замечено', noDate.dated === false, String(noDate.dated));
  check('без даты ставится сегодня', noDate.date === noDate.today, noDate.date);

  console.log(`\n  ошибок в консоли: ${errs.length}${errs.length ? ' — ' + errs.join(' | ') : ''}`);
  if (errs.length) bad += 1;
  await b.close();
  console.log(bad ? `\n${bad} провалов` : '\nВсё сходится');
  process.exit(bad ? 1 : 0);
})();

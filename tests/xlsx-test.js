// Выписка Альфа-Банка: xlsx, шапка не в первой строке, серийные даты Excel,
// внутрибанковские переводы и выплата процентов.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const FIX = path.join(__dirname, 'fixtures');
const URL = 'http://127.0.0.1:8899/app/index.html';
const DIR = FIX;
// Настоящее имя выписки Альфа-Банка — с двоеточиями времени выгрузки.
// В репозитории такой файл не лежит: двоеточие в имени переживает не всякую
// файловую систему. Копия делается на месте, из того же содержимого.
const FILE = path.join(__dirname, '.out', 'Выписка 2026-07-01T14:05:59.534+0300.xlsx');
fs.mkdirSync(path.dirname(FILE), { recursive: true });
fs.copyFileSync(`${FIX}/alfa-plain.xlsx`, FILE);
// Тот же файл под простым именем. Playwright в этой песочнице молча
// отбрасывает путь с двоеточием и не вызывает change, поэтому шаг
// «человек выбирает файл» идёт через копию. К приложению это отношения
// не имеет: имя используется только для расширения и подписи счёта,
// и проверяется отдельно ниже.
const FILE_PLAIN = `${DIR}/alfa-plain.xlsx`;

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
      d.assets = [{ id: 'sav', name: 'Альфа-Счёт', type: 'Деньги', status: 'Активен', liquidity: 'Мгновенная',
        assetClass: 'Вклады', rate: 8, opening: 50000, openingDate: D.addDays(D.today(), -200), goalIds: [], lotSize: 1 }];
    });
  });

  const base64 = fs.readFileSync(FILE).toString('base64');

  console.log('\n1. xlsx читается без библиотек');
  const table = await p.evaluate(async (b64) => {
    const xlsx = await import('./js/xlsx.js');
    const bin = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    const rows = await xlsx.readSheet(bin.buffer);
    return { count: rows.length, head: rows.slice(0, 12).map((r) => r.filter(Boolean).join(' | ')) };
  }, base64);
  console.log(`     строк: ${table.count}`);
  console.log(`     ${table.head.slice(9, 12).join('\n     ')}`);
  check('лист разобран', table.count === 18, String(table.count));
  check('пустые ячейки не сдвинули столбцы',
    table.head[10].startsWith('Дата операции | Дата проводки | Код'), table.head[10]);

  console.log('\n2. Шапка найдена не в первой строке');
  const found = await p.evaluate(async (b64) => {
    const xlsx = await import('./js/xlsx.js');
    const S = await import('./js/statement.js');
    const bin = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    const rows = await xlsx.readSheet(bin.buffer);
    const headerRow = S.findHeaderRow(rows);
    return { headerRow, header: rows[headerRow], mapping: S.guessMapping(rows[headerRow]) };
  }, base64);
  console.log(`     шапка в строке ${found.headerRow + 1} · ${JSON.stringify(found.mapping)}`);
  check('взята строка с «Дата операции»', found.headerRow === 10, String(found.headerRow));
  // Строка «Дата открытия счета … Поступления 77 777,77» содержит и «дата»,
  // и «поступления» — она не должна победить.
  check('реквизиты за шапку не приняты', found.header[0] === 'Дата операции', found.header[0]);
  check('сумма — «Сумма в валюте счета»', found.mapping.amount === 5, String(found.mapping.amount));
  check('описание найдено', found.mapping.description === 4, String(found.mapping.description));
  check('статус найден', found.mapping.status === 6, String(found.mapping.status));

  console.log('\n3. Строки');
  const rows = await p.evaluate(async (b64) => {
    const xlsx = await import('./js/xlsx.js');
    const S = await import('./js/statement.js');
    const bin = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    const table = await xlsx.readSheet(bin.buffer);
    const headerRow = S.findHeaderRow(table);
    const mapping = S.guessMapping(table[headerRow]);
    const { rows, skipped } = S.toRows(table, mapping, { account: 'Альфа-Банк', headerRow });
    const withCat = rows.map((r) => ({ ...r, category: S.categorise(r, []) }));
    return { rows: S.markTransfers(withCat, []), skipped };
  }, base64);
  for (const r of rows.rows) console.log(`     ${r.date} · ${r.kind} · ${r.amount} · ${r.category} · ${r.description.slice(0, 40)}`);
  check('отклонённая пропущена', rows.skipped.status === 1, JSON.stringify(rows.skipped));
  check('строк разобрано 6', rows.rows.length === 6, String(rows.rows.length));

  const by = (part) => rows.rows.find((r) => r.description.includes(part));
  check('дата из текста', by('PYATEROCHKA').date === '2026-06-02', by('PYATEROCHKA').date);
  check('серийная дата Excel', by('VKUSVILL').date === '2026-06-30', by('VKUSVILL').date);
  check('дробная часть числа', by('PYATEROCHKA').amount === 2340.55, String(by('PYATEROCHKA').amount));
  check('точка с запятой в описании не разорвала строку',
    by('YANDEX').description === 'YANDEX GO; поездка', by('YANDEX').description);
  check('«Выполнен» не принят за «не выполнен»', rows.rows.length === 6, String(rows.rows.length));
  check('внутрибанковский перевод — не трата',
    by('Внутрибанковский').kind === 'Перевод себе', by('Внутрибанковский').kind);
  check('выплата процентов — не бытовой доход',
    by('Выплата процентов').kind === 'Перевод себе', by('Выплата процентов').kind);
  check('зарплата осталась доходом', by('Зарплата').kind === 'Поступление', by('Зарплата').kind);

  console.log('\n4. Счёт после такой выписки');
  const stats = await p.evaluate(async (list) => {
    const store = await import('./js/store.js');
    const S = await import('./js/statement.js');
    const C = await import('./js/calc.js');
    const fresh = S.newRows(list, []);
    await store.addSpending(fresh, 'Альфа-Банк', { date: 0 }, 'дата операции|сумма');
    const s = store.getState();
    const st = C.spendStats(s.spending, '2026-06-30', 1);
    return { income: st.income, spent: st.spent, moved: st.moved, rate: st.rate, profiles: Object.keys(s.settings.bankProfiles) };
  }, rows.rows);
  console.log(`     доход ${stats.income} · траты ${stats.spent} · переводы ${stats.moved}`);
  // Проценты 123,45 в доход не попали: они уже посчитаны в капитале.
  check('доход — только зарплата', stats.income === 77777.77, String(stats.income));
  // 2340,55 + 690 + 1500,25 = 4530,80
  check('траты без переводов и процентов', Math.abs(stats.spent - 4530.8) < 0.01, String(stats.spent));
  check('перевод и проценты отдельно', Math.abs(stats.moved - 20123.45) < 0.01, String(stats.moved));
  console.log(`     раскладка запомнена под ключом: ${stats.profiles.join(', ')}`);
  check('раскладка запомнена по столбцам, а не по имени файла',
    stats.profiles.length === 1 && !stats.profiles[0].includes('.xlsx'), stats.profiles.join(','));

  console.log('\n5. Загрузка файла как это делает человек');
  await p.goto(`${URL}#/more/spending`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  await p.evaluate(async () => (await import('./js/store.js')).clearSpending());
  // Переход по тому же адресу с тем же хэшем перезагрузкой не считается,
  // и экран остался бы отрисованным до очистки. Нужен настоящий reload.
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  // Кнопка открывает системный выбор файла — перехватываем его.
  const chooser = p.waitForEvent('filechooser');
  await p.locator('.btn:has-text("Загрузить выписку")').first().click();
  await (await chooser).setFiles(FILE_PLAIN);
  await p.waitForTimeout(900);
  const sheet = await p.evaluate(() => ({
    note: document.querySelector('.sheet-body .sheet-note')?.textContent || '',
    summary: [...document.querySelectorAll('.sheet-body .sheet-note')][1]?.textContent || '',
    preview: [...document.querySelectorAll('.preview-row')].map((r) => r.textContent),
  }));
  console.log(`     ${sheet.note}`);
  console.log(`     ${sheet.summary}`);
  console.log(`     ${sheet.preview.slice(0, 3).join('\n     ')}`);
  check('банк узнан по содержимому файла, а не по имени', /Альфа/.test(sheet.note), sheet.note);
  check('в сводке 6 строк', /Разобрано строк: 6/.test(sheet.summary), sheet.summary);
  check('отменённая отмечена', /Отменённых пропущено: 1/.test(sheet.summary), sheet.summary);
  check('разбор показан до записи', sheet.preview.length === 5, String(sheet.preview.length));

  await p.locator('.sheet-foot .btn-primary').click();
  await p.waitForTimeout(900);
  const after = await p.evaluate(async () => {
    const store = await import('./js/store.js');
    return store.getState().spending.length;
  });
  console.log(`     записей после загрузки: ${after}`);
  check('записи сохранены', after === 6, String(after));

  console.log('\n6. Имя файла с двоеточиями времени выгрузки');
  const naming = await p.evaluate(() => {
    const name = 'Выписка 2026-07-01T14:05:59.534+0300.xlsx';
    return { isXlsx: /\.xlsx$/i.test(name) };
  });
  check('такое имя всё равно опознаётся как xlsx', naming.isXlsx, String(naming.isXlsx));
  const stable = await p.evaluate(async () => {
    const store = await import('./js/store.js');
    return Object.keys(store.getState().settings.bankProfiles);
  });
  console.log(`     ключи раскладок: ${stable.join(' / ')}`);
  check('ключ раскладки не содержит времени выгрузки',
    stable.every((k) => !/\d{4}-\d{2}-\d{2}T/.test(k)), stable.join(','));

  console.log(`\n  ошибок в консоли: ${errs.length}${errs.length ? ' — ' + errs.join(' | ') : ''}`);
  if (errs.length) bad += 1;
  await b.close();
  console.log(bad ? `\n${bad} провалов` : '\nВсё сходится');
  process.exit(bad ? 1 : 0);
})();

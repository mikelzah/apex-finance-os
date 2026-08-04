// Быт: разбор выписки, слияние внахлёст, категории, вердикт.
const { chromium } = require('playwright');
const URL = 'http://127.0.0.1:8899/app/index.html';

// Выписка в форме Т-Банка: точка с запятой, кавычки, запятая в дробной части,
// «Статус» с отменённой операцией, разделитель разрядов — обычный пробел.
const TBANK = [
  '"Дата операции";"Дата платежа";"Статус";"Сумма операции";"Валюта операции";"Сумма платежа";"Категория";"Описание"',
  '"01.07.2026 09:14:00";"01.07.2026";"OK";"-1 240,50";"RUB";"-1 240,50";"Супермаркеты";"PYATEROCHKA 4512"',
  '"01.07.2026 10:02:00";"01.07.2026";"FAILED";"-99 000,00";"RUB";"-99 000,00";"Переводы";"Перевод по номеру"',
  '"02.07.2026 12:30:00";"02.07.2026";"OK";"-320,00";"RUB";"-320,00";"Рестораны";"COFFEE HOUSE; центр"',
  '"02.07.2026 12:31:00";"02.07.2026";"OK";"-320,00";"RUB";"-320,00";"Рестораны";"COFFEE HOUSE; центр"',
  '"05.07.2026 11:00:00";"05.07.2026";"OK";"-2 500,00";"RUB";"-2 500,00";"Транспорт";"YANDEX GO"',
  '"05.07.2026 18:00:00";"05.07.2026";"OK";"120 000,00";"RUB";"120 000,00";"Пополнения";"Зарплата за июль"',
  '"06.07.2026 09:00:00";"06.07.2026";"OK";"-30 000,00";"RUB";"-30 000,00";"Переводы";"Перевод между счетами"',
].join('\r\n');

// Форма Сбера: приход и расход разными колонками, точка в разрядах,
// дата без времени.
const SBER = [
  'Дата;Описание;Расход;Приход',
  '10.07.2026;Аптека Ригла;450,00;',
  '11.07.2026;Возврат покупки;;1.200,00',
].join('\n');

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

  // Активы и один взнос: взнос должен опознать перевод себе из выписки.
  await p.evaluate(async () => {
    const store = await import('./js/store.js');
    const D = await import('./js/dates.js');
    await store.startEmpty();
    await store.mutate((d) => {
      d.assets = [{ id: 'sav', name: 'Накопительный', type: 'Деньги', status: 'Активен',
        liquidity: 'Мгновенная', assetClass: 'Вклады', rate: 8, opening: 90000,
        openingDate: D.addDays(D.today(), -300), goalIds: [], lotSize: 1 }];
      d.operations.push({ id: 'op1', date: '2026-07-06', type: 'Взнос', amount: 30000,
        assetId: 'sav', goalId: null, source: 'Вручную', comment: null });
    });
  });

  console.log('\n1. Разбор выписки Т-Банка');
  const parsed = await p.evaluate(async (text) => {
    const S = await import('./js/statement.js');
    const delim = S.sniffDelimiter(text);
    const table = S.parseTable(text, delim);
    const mapping = S.guessMapping(table[0]);
    const { rows, skipped } = S.toRows(table, mapping, { account: 'Т-Банк' });
    return { delim, header: table[0], mapping, rows, skipped };
  }, TBANK);
  console.log(`     разделитель «${parsed.delim}» · столбцы ${JSON.stringify(parsed.mapping)}`);
  check('разделитель — точка с запятой', parsed.delim === ';', parsed.delim);
  check('дата взята из «Даты операции»', parsed.mapping.date === 0, String(parsed.mapping.date));
  check('сумма — из «Суммы платежа»', parsed.mapping.amount === 5, String(parsed.mapping.amount));
  check('отменённая пропущена', parsed.skipped.status === 1, JSON.stringify(parsed.skipped));
  check('строк разобрано 6', parsed.rows.length === 6, String(parsed.rows.length));
  const first = parsed.rows[0];
  console.log(`     первая: ${first.date} · ${first.amount} · ${first.kind} · ${first.description}`);
  check('пробел в разрядах и запятая в дробях', first.amount === 1240.5, String(first.amount));
  check('дата в ISO', first.date === '2026-07-01', first.date);
  check('точка с запятой внутри кавычек не разорвала строку',
    parsed.rows[1].description === 'COFFEE HOUSE; центр', parsed.rows[1].description);
  check('зарплата опознана приходом', parsed.rows.find((r) => r.amount === 120000).kind === 'Поступление');

  console.log('\n2. Категории и переводы себе');
  const marked = await p.evaluate(async (text) => {
    const S = await import('./js/statement.js');
    const store = await import('./js/store.js');
    const table = S.parseTable(text, S.sniffDelimiter(text));
    const mapping = S.guessMapping(table[0]);
    const { rows } = S.toRows(table, mapping, { account: 'Т-Банк' });
    const withCat = rows.map((r) => ({ ...r, category: S.categorise(r, []) }));
    const ops = store.getState().operations.filter((o) => o.type === 'Взнос');
    return S.markTransfers(withCat, ops);
  }, TBANK);
  const cat = (part) => marked.find((r) => r.description.includes(part));
  console.log(`     ${marked.map((r) => `${r.category}`).join(' | ')}`);
  check('пятёрочка — продукты', cat('PYATEROCHKA').category === 'Продукты', cat('PYATEROCHKA').category);
  check('кофейня — кафе', cat('COFFEE').category === 'Кафе и рестораны', cat('COFFEE').category);
  check('яндекс go — транспорт', cat('YANDEX').category === 'Транспорт', cat('YANDEX').category);
  check('зарплата — зарплата', cat('Зарплата').category === 'Зарплата', cat('Зарплата').category);
  const move = cat('между счетами');
  check('перевод себе не трата', move.kind === 'Перевод себе', move.kind);

  console.log('\n3. Запись и повторная загрузка внахлёст');
  const added = await p.evaluate(async (rows) => {
    const S = await import('./js/statement.js');
    const store = await import('./js/store.js');
    const fresh = S.newRows(rows, store.getState().spending);
    await store.addSpending(fresh, 'Т-Банк', { date: 0 });
    return { added: fresh.length, total: store.getState().spending.length };
  }, marked);
  console.log(`     добавлено ${added.added}, всего ${added.total}`);
  check('записаны все шесть', added.total === 6, String(added.total));

  const again = await p.evaluate(async (rows) => {
    const S = await import('./js/statement.js');
    const store = await import('./js/store.js');
    const fresh = S.newRows(rows, store.getState().spending);
    return { fresh: fresh.length, total: store.getState().spending.length };
  }, marked);
  console.log(`     повтор того же файла: новых ${again.fresh}`);
  check('дубликатов не добавилось', again.fresh === 0, String(again.fresh));
  // Два одинаковых кофе в один день — это две настоящие траты, и вторая
  // не должна пропасть как дубль первой. Проверяем, что обе на месте.
  const coffees = await p.evaluate(async () => {
    const store = await import('./js/store.js');
    return store.getState().spending.filter((r) => r.description.includes('COFFEE')).length;
  });
  check('два одинаковых кофе остались двумя', coffees === 2, String(coffees));

  console.log('\n4. Вторая форма выписки: приход и расход разными колонками');
  const sber = await p.evaluate(async (text) => {
    const S = await import('./js/statement.js');
    const table = S.parseTable(text, S.sniffDelimiter(text));
    const mapping = S.guessMapping(table[0]);
    const { rows } = S.toRows(table, mapping, { account: 'Сбер' });
    return { mapping, rows };
  }, SBER);
  console.log(`     столбцы ${JSON.stringify(sber.mapping)} · ${sber.rows.map((r) => `${r.kind} ${r.amount}`).join(' | ')}`);
  check('общая колонка суммы не выбрана', sber.mapping.amount == null, JSON.stringify(sber.mapping));
  check('расход стал тратой', sber.rows[0].kind === 'Трата' && sber.rows[0].amount === 450, JSON.stringify(sber.rows[0]));
  check('точка как разделитель разрядов', sber.rows[1].amount === 1200, String(sber.rows[1].amount));
  check('приход стал поступлением', sber.rows[1].kind === 'Поступление', sber.rows[1].kind);

  console.log('\n5. Счёт быта');
  const stats = await p.evaluate(async () => {
    const store = await import('./js/store.js');
    const C = await import('./js/calc.js');
    const s = store.getState();
    const st = C.spendStats(s.spending, '2026-07-31', 1);
    const cushion = C.cushionMonths(s.assets, s.operations, st);
    const contributed = C.contributedBetween(s.operations, st.from, '2026-07-31');
    return { st, cushion, contributed, verdict: C.balanceVerdict(st, cushion, contributed) };
  });
  console.log(`     доход ${stats.st.income} · траты ${stats.st.spent} · переводы ${stats.st.moved}`);
  check('доход — только зарплата', stats.st.income === 120000, String(stats.st.income));
  // 1240,50 + 320 + 320 + 2500 = 4380,50. Перевод себе сюда не входит.
  check('траты без перевода себе', Math.abs(stats.st.spent - 4380.5) < 0.01, String(stats.st.spent));
  check('перевод учтён отдельно', stats.st.moved === 30000, String(stats.st.moved));
  check('норма сбережений считается', Math.round(stats.st.rate * 100) === 96, String(stats.st.rate));
  console.log(`     подушка ${stats.cushion} мес · в капитал ${stats.contributed}`);
  check('взнос за период найден', stats.contributed === 30000, String(stats.contributed));
  check('подушка считается по реальным тратам', Math.abs(stats.cushion - 120000 / 4380.5) < 0.1, String(stats.cushion));
  console.log(`     вердикт: ${stats.verdict.level} — ${stats.verdict.title}`);
  // Подушки на 20 месяцев нет — 90 000 при расходе 4380 в месяц это много,
  // так что ожидаем «подушка больше, чем нужна».
  check('вердикт про избыточную подушку', stats.verdict.level === 'idle', stats.verdict.level);
  check('в вердикте есть сумма', /\d/.test(stats.verdict.text), stats.verdict.text.slice(0, 60));

  console.log('\n6. Капитал от быта не поехал');
  const worth = await p.evaluate(async () => {
    const store = await import('./js/store.js');
    const C = await import('./js/calc.js');
    const s = store.getState();
    return C.netWorth(s.assets, s.operations).total;
  });
  console.log(`     капитал ${worth}`);
  // 90 000 начальных + 30 000 взнос. Траты по карте в капитал не входят.
  check('траты не вычлись из капитала', worth === 120000, String(worth));

  console.log('\n7. Экран «Траты и жизнь»');
  await p.goto(`${URL}#/more/spending`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  // Список записей закрыт, пока его не спросили: открываем кнопкой.
  await p.locator('.btn:has-text("Показать все траты")').click();
  await p.waitForTimeout(400);
  const screen = await p.evaluate(() => ({
    // Траты стали своим разделом в панели, а не разрезом «Денег»:
    // переключателя над ними больше нет, и называет экран подсвеченная
    // вкладка внизу.
    title: document.querySelector('.tabbar .tab.is-on .tab-label')?.textContent || '',
    stats: [...document.querySelectorAll('.stat')].map((s) => s.textContent.trim()).slice(0, 3),
    cats: [...document.querySelectorAll('.cat-name')].map((s) => s.textContent),
    callout: document.querySelector('.callout')?.textContent || '',
    rows: document.querySelectorAll('.spend-op').length,
  }));
  console.log(`     ${screen.title} · ${screen.stats.join(' | ')}`);
  console.log(`     категории: ${screen.cats.join(', ')}`);
  check('раздел назван переключателем', screen.title === 'Траты', screen.title);
  check('категории показаны полосами', screen.cats.length >= 3, screen.cats.join(','));
  check('вердикт на экране', screen.callout.length > 40, screen.callout.slice(0, 50));
  // Таблицы больше нет: четыре колонки не влезали в ширину телефона,
  // и за край уезжала сумма. Теперь список в две строчки.
  check('записи списком', screen.rows >= 4, String(screen.rows));

  console.log('\n8. Цена жизни на главной');
  // Прежде это была одна карточка «Жизнь и накопления» с четырьмя числами
  // внутри. Она разошлась на две плитки: подушка получила свою — это ответ
  // на «сколько я протяну», и он стоит рядом с целями, — а прожито
  // и отложено встали в ряд с дисциплиной. Проверяется то же самое:
  // что оба числа доехали до главного экрана и посчитаны по выписке.
  await p.goto(`${URL}#/dashboard`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  const trio = () => p.evaluate(() => {
    const cells = [...document.querySelectorAll('.trio-cell')].map((n) => ({
      label: n.querySelector('.trio-label').textContent,
      value: n.querySelector('.trio-value').textContent,
      hint: n.querySelector('.trio-hint').textContent,
      // Верх подписи, а не самой ячейки: колонки растянуты по высоте,
      // и разъезжается в них именно содержимое.
      top: Math.round(n.querySelector('.trio-label').getBoundingClientRect().top),
    }));
    const tiles = [...document.querySelectorAll('.card')]
      .map((c) => c.textContent.replace(/\s+/g, ' ').trim());
    return { cells, cushion: tiles.find((t) => t.startsWith('Подушка')) || null };
  });
  const home = await trio();
  console.log(`     подушка: ${home.cushion}`);
  home.cells.forEach((c) => console.log(`     ${c.label}: ${c.value} · ${c.hint} (верх ${c.top})`));
  check('подушка на главной', Boolean(home.cushion) && /мес\./.test(home.cushion), String(home.cushion));
  check('прожито и отложено на главной',
    home.cells.some((c) => c.label === 'Прожито') && home.cells.some((c) => c.label === 'Отложено'),
    home.cells.map((c) => c.label).join(', '));
  check('отложено посчитано от дохода', /% дохода/.test(home.cells[1].hint), home.cells[1].hint);

  // Три числа стоят в ряд, и подписи у них должны начинаться на одной
  // высоте. Отступ между детьми карточки задан для стопки: в ряду он
  // опускал второй и третий столбцы на двенадцать пикселей.
  const tops = home.cells.map((c) => c.top);
  check('подписи тройки на одной высоте', new Set(tops).size === 1, tops.join(' / '));

  console.log('\n9. Выписка без доходов: отложено не выдумывается');
  // Зарплату платят на другую карту, а выгружена эта: доходов в выписке
  // нет вовсе. Разность «доход минус жизнь» тогда равна минус прожито —
  // числу из соседней колонки со знаком, — и показывать её как ответ
  // нельзя: экран сообщал бы об убытке, которого никто не считал.
  await p.evaluate(async () => {
    const store = await import('./js/store.js');
    await store.mutate((d) => { d.spending = d.spending.filter((r) => r.kind !== 'Поступление'); });
  });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  const dry = await trio();
  dry.cells.forEach((c) => console.log(`     ${c.label}: ${c.value} · ${c.hint}`));
  check('прожито по-прежнему посчитано', /₽/.test(dry.cells[0].value), dry.cells[0].value);
  check('отложено — прочерк', dry.cells[1].value === '—', dry.cells[1].value);
  check('подпись называет нехватку', dry.cells[1].hint === 'в выписке нет доходов', dry.cells[1].hint);

  console.log(`\n  ошибок в консоли: ${errs.length}${errs.length ? ' — ' + errs.join(' | ') : ''}`);
  if (errs.length) bad += 1;
  await b.close();
  console.log(bad ? `\n${bad} провалов` : '\nВсё сходится');
  process.exit(bad ? 1 : 0);
})();

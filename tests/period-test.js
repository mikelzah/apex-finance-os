// Сводка журнала: за всё время по умолчанию, период переключается.
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
  // Как на снимке: длинная история, а текущий месяц только начался.
  await p.evaluate(async () => {
    const store = await import('./js/store.js');
    const D = await import('./js/dates.js');
    await store.startEmpty();
    await store.mutate((d) => {
      d.assets = [{ id: 'sav', name: 'Накопительный счёт', type: 'Деньги', status: 'Активен',
        liquidity: 'Мгновенная', assetClass: 'Вклады', rate: 8, opening: 0,
        openingDate: D.addDays(D.today(), -400), goalIds: [] }];
      const add = (date, type, amount) => d.operations.push({
        id: store.newId('op'), date, type, amount, assetId: 'sav', goalId: null,
        source: type === 'Доход' ? 'Расчёт' : 'Вручную', comment: null,
      });
      // Прошлый год: 10 взносов по 1000 и проценты.
      for (let i = 0; i < 10; i += 1) add(D.addDays(D.iso(D.parts(D.today()).y - 1, 6, 1), i), 'Взнос', 1000);
      add(D.iso(D.parts(D.today()).y - 1, 12, 31), 'Доход', 500.55);
      // Этот год, но прошлые месяцы: 20 взносов по 1250.
      for (let i = 0; i < 20; i += 1) add(D.addDays(D.iso(D.parts(D.today()).y, 3, 1), i), 'Взнос', 1250);
      add(D.iso(D.parts(D.today()).y, 3, 31), 'Доход', 120.4);
      add(D.iso(D.parts(D.today()).y, 4, 10), 'Расход', 3000);
      // Текущий месяц: один взнос.
      add(D.monthStart(D.today()), 'Взнос', 1250);
      add(D.today(), 'Доход', 1.76);
    });
  });
  await p.goto(`${URL}#/journal`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(900);

  const read = () => p.evaluate(() => ({
    // Первый переключатель на экране — «Портфель | Журнал» в шапке,
    // период идёт следующим, уже внутри карточки.
    period: [...document.querySelectorAll('.card .segmented')][0]
      ? [...document.querySelectorAll('.card .segmented')][0].querySelector('.segment.is-on')?.textContent.trim()
      : null,
    stats: [...document.querySelectorAll('.stat')].map((s) => ({
      l: s.querySelector('.stat-label').textContent.trim(),
      v: s.querySelector('.stat-value').textContent.trim(),
      h: s.querySelector('.stat-hint')?.textContent.trim(),
    })),
  }));

  console.log('\n1. По умолчанию — за всё время');
  const all = await read();
  console.log(`     период «${all.period}»: ${all.stats.map((x) => `${x.l} ${x.v}`).join(' | ')}`);
  check('выбран «Всё время»', all.period === 'Всё время', all.period);
  check('подпись говорит то же', all.stats[0].h === 'за всё время', all.stats[0].h);
  // 10×1000 + 20×1250 + 1250 = 36 250
  check('внесено за всю историю', /36\s?250/.test(all.stats[0].v.replace(/ /g, ' ')), all.stats[0].v);
  // 500,55 + 120,40 + 1,76 = 622,71
  check('начислено со всеми копейками', /622,71/.test(all.stats[1].v), all.stats[1].v);
  check('расход учтён', /3\s?000/.test(all.stats[2].v.replace(/ /g, ' ')), all.stats[2].v);

  console.log('\n2. Год считает только этот год');
  await p.locator('.segment:has-text("Год")').click();
  await p.waitForTimeout(600);
  const year = await read();
  console.log(`     период «${year.period}»: ${year.stats.map((x) => `${x.l} ${x.v}`).join(' | ')}`);
  check('выбран «Год»', year.period === 'Год', year.period);
  // 20×1250 + 1250 = 26 250
  check('внесено за год', /26\s?250/.test(year.stats[0].v.replace(/ /g, ' ')), year.stats[0].v);
  check('прошлогодние проценты не попали', /122,16/.test(year.stats[1].v), year.stats[1].v);

  console.log('\n3. Месяц считает только текущий');
  await p.locator('.segment:has-text("Месяц")').click();
  await p.waitForTimeout(600);
  const month = await read();
  console.log(`     период «${month.period}»: ${month.stats.map((x) => `${x.l} ${x.v}`).join(' | ')}`);
  check('внесено за месяц', /1\s?250/.test(month.stats[0].v.replace(/ /g, ' ')), month.stats[0].v);
  check('начислено за месяц', /1,76/.test(month.stats[1].v), month.stats[1].v);
  check('расходов в этом месяце нет', /^0\s?₽/.test(month.stats[2].v.replace(/ /g, ' ')), month.stats[2].v);

  // Раньше здесь проверялось обратное: период менял только сводку, а список
  // оставался за всё время. Так на экране оказывались два ответа на разные
  // вопросы, и было не понять, какое число к каким записям относится.
  console.log('\n4. Список подчиняется периоду');
  const rows = await p.evaluate(() => document.querySelectorAll('.op').length);
  console.log(`     операций в списке: ${rows}`);
  // Текущий месяц: взнос 1250 и начисление 1,76 — ровно две записи.
  check('видны только операции периода', rows === 2, String(rows));
  await p.locator('.segment:has-text("Всё время")').click();
  await p.waitForTimeout(600);
  const rowsAll = await p.evaluate(() => document.querySelectorAll('.op').length);
  console.log(`     после возврата к «Всё время»: ${rowsAll}`);
  check('и снова все, когда период снят', rowsAll > 30, String(rowsAll));

  console.log('\n5. Выплаты появляются отдельной плиткой');
  await p.evaluate(async () => {
    const store = await import('./js/store.js');
    const C = await import('./js/calc.js');
    const D = await import('./js/dates.js');
    await store.mutate((d) => {
      d.assets.push({ id: 'sber', name: 'Сбербанк', type: 'Инвестиции', status: 'Активен',
        liquidity: 'T+1', assetClass: 'Акции', ticker: 'SBER', quantity: 0, lotSize: 1,
        price: 300, goalIds: [] });
      store.savePaperOp(d, { id: store.newId('op'), date: D.today(), type: C.OP_DIVIDEND,
        quantity: null, unitPrice: null, fee: null, tax: 546, amount: 3654, assetId: 'sber',
        ticker: 'SBER', goalId: null, source: 'Вручную', comment: null }, null);
    });
  });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  const withPayouts = await read();
  console.log(`     ${withPayouts.stats.map((x) => `${x.l} ${x.v}`).join(' | ')}`);
  check('плитка выплат есть', withPayouts.stats.some((x) => x.l === 'Выплаты'), withPayouts.stats.map((x) => x.l).join(', '));
  check('и в ней 3 654 ₽', /3\s?654/.test((withPayouts.stats.find((x) => x.l === 'Выплаты') || {}).v?.replace(/ /g, ' ') || ''),
    withPayouts.stats.find((x) => x.l === 'Выплаты')?.v);
  check('проценты банка от неё отделены', withPayouts.stats.find((x) => x.l === 'Начислено')?.h === 'проценты банка');

  console.log(`\n  ошибок в консоли: ${errs.length}${errs.length ? ' — ' + errs.join(' | ') : ''}`);
  if (errs.length) bad += 1;
  await b.close();
  console.log(bad ? `\n${bad} провалов` : '\nВсё сходится');
  process.exit(bad ? 1 : 0);
})();

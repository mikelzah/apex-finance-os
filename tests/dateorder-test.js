// Порядок дня и месяца — свойство файла, а не отдельной ячейки.
//
// Выписка в формате мм/дд читалась двумя способами разом: «07/29» разбиралось
// верно, потому что месяца 29 не бывает, а «03/04» из того же файла — наугад.
// Половина операций уезжала на несколько месяцев, и по списку это не видно.
const { chromium } = require('playwright');
const URL = 'http://127.0.0.1:8899/app/index.html';

(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'], executablePath: process.env.CHROMIUM_PATH || undefined });
  const p = await (await b.newContext({ viewport: { width: 440, height: 956 }, locale: 'ru-RU' })).newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  let bad = 0;
  const check = (l, ok, d) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? ' — ' + d : ''}`); if (!ok) bad += 1; };

  await p.goto(`${URL}#/dashboard`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(600);

  const r = await p.evaluate(async () => {
    const S = await import('./js/statement.js');

    // Один и тот же месяц в двух порядках. В каждом наборе есть строка,
    // читаемая однозначно, и строки, которые сами по себе неразличимы.
    const dmy = ['29.07.2026', '03.04.2026', '11.07.2026', '30.07.2026'];
    const mdy = ['07/29/2026', '03/04/2026', '07/11/2026', '07/30/2026'];
    const plain = ['03.04.2026', '05.06.2026'];

    const parse = (list) => {
      const order = S.dateOrder(list);
      return { order, dates: list.map((x) => S.toDate(x, order)) };
    };

    const table = (rows) => [['Дата', 'Сумма', 'Описание'], ...rows];
    const mapping = { date: 0, amount: 1, description: 2 };
    const asRows = (dates) => S.toRows(
      table(dates.map((d) => [d, '-100', 'Магазин'])), mapping, { headerRow: 0 });

    return {
      dmy: parse(dmy),
      mdy: parse(mdy),
      plain: parse(plain),
      // Через весь разбор, а не только через функцию порядка.
      rowsMdy: asRows(mdy),
      rowsDmy: asRows(dmy),
      // Строка, которой не существует ни в одном порядке.
      nonsense: S.toDate('31.02.2026', S.ORDER_DMY),
      // Смешанный файл: почти всё мм/дд, одна строка дд.мм.
      mixed: parse(['07/29/2026', '07/30/2026', '07/31/2026', '13.07.2026']),
    };
  });

  console.log('\n1. Русский порядок');
  console.log(`     ${r.dmy.order}: ${r.dmy.dates.join(', ')}`);
  check('порядок «день первым»', r.dmy.order === 'dmy', r.dmy.order);
  check('однозначная разобрана', r.dmy.dates[0] === '2026-07-29', String(r.dmy.dates[0]));
  check('неоднозначная — 3 апреля', r.dmy.dates[1] === '2026-04-03', String(r.dmy.dates[1]));

  console.log('\n2. Американский порядок');
  console.log(`     ${r.mdy.order}: ${r.mdy.dates.join(', ')}`);
  check('порядок «месяц первым»', r.mdy.order === 'mdy', r.mdy.order);
  check('однозначная разобрана', r.mdy.dates[0] === '2026-07-29', String(r.mdy.dates[0]));
  // Вот ради этого всё и делалось: раньше здесь выходило 3 апреля.
  check('неоднозначная — 4 марта', r.mdy.dates[1] === '2026-03-04', String(r.mdy.dates[1]));
  check('весь столбец в одном июле', r.mdy.dates.slice(2).every((d) => d.startsWith('2026-07')),
    r.mdy.dates.join(', '));

  console.log('\n3. Одни неоднозначные — остаётся русский порядок');
  console.log(`     ${r.plain.order}: ${r.plain.dates.join(', ')}`);
  check('день первым', r.plain.order === 'dmy', r.plain.order);
  check('3 апреля и 5 июня', r.plain.dates.join(',') === '2026-04-03,2026-06-05', r.plain.dates.join(', '));

  console.log('\n4. Через весь разбор');
  console.log(`     мм/дд: ${r.rowsMdy.rows.map((x) => x.date).join(', ')}`);
  console.log(`     дд.мм: ${r.rowsDmy.rows.map((x) => x.date).join(', ')}`);
  check('порядок доехал до записей', r.rowsMdy.order === 'mdy', r.rowsMdy.order);
  check('ничего не потеряно', r.rowsMdy.rows.length === 4 && r.rowsDmy.rows.length === 4,
    `${r.rowsMdy.rows.length} / ${r.rowsDmy.rows.length}`);
  check('в мм/дд всё в июле и марте',
    r.rowsMdy.rows.map((x) => x.date.slice(0, 7)).join(',') === '2026-07,2026-03,2026-07,2026-07',
    r.rowsMdy.rows.map((x) => x.date).join(', '));

  console.log('\n5. Строка, не читаемая ни так, ни этак');
  console.log(`     31.02.2026 → ${r.nonsense}`);
  check('пусто, а не соседний месяц', r.nonsense === null, String(r.nonsense));

  console.log('\n6. Смешанный файл: чужая строка читается по-своему');
  console.log(`     ${r.mixed.order}: ${r.mixed.dates.join(', ')}`);
  check('порядок по большинству', r.mixed.order === 'mdy', r.mixed.order);
  check('13.07 прочитана как 13 июля', r.mixed.dates[3] === '2026-07-13', String(r.mixed.dates[3]));

  console.log(`\n  ошибок в консоли: ${errs.length}${errs.length ? ' — ' + errs.join(' | ') : ''}`);
  if (errs.length) bad += 1;
  await b.close();
  console.log(bad ? `\n${bad} провалов` : '\nВсё сходится');
  process.exit(bad ? 1 : 0);
})();

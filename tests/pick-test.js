// Выбор записываемых операций и отсев уже записанных.
const { chromium } = require('playwright');
const URL = 'http://127.0.0.1:8899/app/index.html';

// Текст со снимка вместе с полосами самого телефона: сверху часы и заряд,
// снизу панель вкладок. И то и другое разбор превращал в траты.
const WITH_CHROME = `15:12 © 50 ₽
х — История & +
СЕГОДНЯ, 1 АВГУСТА
Яндекс.Еда —890 ₽
Фастфуд +20 ₽
Перекрёсток —715,06 ₽
Продукты
ВЧЕРА, 31 ИЮЛЯ
Вкусно — и точка —805 ₽
Фастфуд
Главный Платежи ® История Чаты · 7 \\ Пеперап`;

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
        assetClass: 'Вклады', opening: 100000, goalIds: [], lotSize: 1 }];
    });
  });

  console.log('\n1. Полосы телефона не становятся операциями');
  const parsed = await p.evaluate(async (text) => {
    const S = await import('./js/screenshot.js');
    const D = await import('./js/dates.js');
    return S.parseScreen(text, D.today()).rows;
  }, WITH_CHROME);
  for (const r of parsed) console.log(`     ${r.date} · ${r.kind} · ${r.amount} · ${r.description}`);
  const amounts = parsed.map((r) => r.amount);
  check('заряд телефона не стал тратой 50 ₽', !amounts.includes(50), amounts.join(', '));
  check('панель вкладок не стала тратой 125 ₽', !amounts.includes(125), amounts.join(', '));
  check('кэшбэк по-прежнему не записан', !amounts.includes(20), amounts.join(', '));
  check('остались три настоящие операции', parsed.length === 3, String(parsed.length));

  // На пустом экране кнопка «Со скриншота» стоит прямо в подсказке,
  // а на заполненном — за кнопкой «Загрузить» в шапке: список записей
  // закрыт, и вместе с ним ушла кнопка из его заголовка.
  const open = async () => {
    const direct = p.locator('.btn:has-text("Со скриншота")').first();
    if (await direct.count() && await direct.isVisible()) {
      await direct.click();
    } else {
      await p.locator('.btn:has-text("Загрузить")').first().click();
      await p.waitForTimeout(300);
      await p.locator('.row:has-text("Со скриншота")').click();
    }
    await p.waitForTimeout(300);
    await p.locator('.sheet-body textarea').fill(WITH_CHROME);
    await p.waitForTimeout(400);
  };
  const sheet = () => p.evaluate(() => ({
    summary: [...document.querySelectorAll('.sheet-body .sheet-note')].map((x) => x.textContent).join(' '),
    rows: [...document.querySelectorAll('.preview-row')].map((r) => ({
      text: r.textContent, off: r.className.includes('is-off'),
    })),
    button: document.querySelector('.sheet-foot .btn-primary')?.textContent,
    disabled: document.querySelector('.sheet-foot .btn-primary')?.disabled,
    hint: document.querySelector('.preview .field-hint')?.textContent || '',
  }));

  console.log('\n2. Каждая строка с галочкой');
  await p.goto(`${URL}#/more/spending`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  await open();
  let s = await sheet();
  console.log(`     ${s.summary}`);
  console.log(`     кнопка: «${s.button}»`);
  check('в списке три строки', s.rows.length === 3, String(s.rows.length));
  check('все отмечены', s.rows.every((r) => !r.off), JSON.stringify(s.rows.map((r) => r.off)));
  check('на кнопке счёт', /Записать \(3\)/.test(s.button), s.button);

  console.log('\n3. Снятая галочка убирает запись из счёта');
  // Нажимается внутренняя кнопка строки: рядом с ней теперь стоит выбор
  // категории, и нажатие по всей строке снимало бы галочку при попытке
  // открыть список.
  await p.locator('.preview-pick').nth(1).click();
  await p.waitForTimeout(300);
  s = await sheet();
  console.log(`     кнопка: «${s.button}»`);
  check('строка помечена как исключённая', s.rows[1].off, JSON.stringify(s.rows.map((r) => r.off)));
  check('счёт уменьшился', /Записать \(2\)/.test(s.button), s.button);

  await p.locator('.sheet-foot .btn-primary').click();
  await p.waitForTimeout(800);
  const saved = await p.evaluate(async () => {
    const store = await import('./js/store.js');
    return store.getState().spending.map((r) => r.amount);
  });
  console.log(`     записано: ${saved.join(', ')}`);
  check('записаны только отмеченные', saved.length === 2, saved.join(', '));
  check('снятая не записалась', !saved.includes(715.06), saved.join(', '));

  console.log('\n4. Повторная загрузка того же снимка');
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  await open();
  s = await sheet();
  console.log(`     ${s.summary}`);
  console.log(`     строк в списке: ${s.rows.length} · подсказка: «${s.hint}»`);
  // Записаны были две из трёх — значит третья, снятая руками, снова
  // предлагается: человек мог передумать.
  check('уже записанные не предлагаются', s.rows.length === 1, String(s.rows.length));
  check('сказано, сколько пропущено', /Уже записано раньше: 2/.test(s.summary), s.summary);
  check('на кнопке единица', /Записать \(1\)/.test(s.button), s.button);

  console.log('\n5. Когда всё уже записано');
  await p.locator('.sheet-foot .btn-primary').click();
  await p.waitForTimeout(800);
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  await open();
  s = await sheet();
  console.log(`     ${s.summary}`);
  console.log(`     подсказка: «${s.hint}»`);
  check('список пуст', s.rows.length === 0, String(s.rows.length));
  check('сказано, что всё уже есть', /уже записаны/i.test(s.hint), s.hint);
  check('кнопка записи выключена', s.disabled === true, String(s.disabled));

  const total = await p.evaluate(async () => (await import('./js/store.js')).getState().spending.length);
  check('дубликатов в базе не появилось', total === 3, String(total));

  console.log(`\n  ошибок в консоли: ${errs.length}${errs.length ? ' — ' + errs.join(' | ') : ''}`);
  if (errs.length) bad += 1;
  await b.close();
  console.log(bad ? `\n${bad} провалов` : '\nВсё сходится');
  process.exit(bad ? 1 : 0);
})();

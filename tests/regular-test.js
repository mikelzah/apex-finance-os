// Что списывается само: повторяющиеся платежи в выписке.
//
// Проверяется не только «нашлось», но и «не нашлось лишнего». Ложная подписка
// хуже пропущенной: человек идёт отменять то, чего нет, а найти не может.
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

  const found = await p.evaluate(async () => {
    const C = await import('./js/calc.js');
    const D = await import('./js/dates.js');
    const today = '2026-08-02';
    const rows = [];
    let n = 0;
    const put = (date, amount, description, category = 'Прочее', kind = 'Трата') => rows.push({
      id: `s${n += 1}`, date, amount, kind, category, description, key: `k${n}`,
    });

    // Подписка: та же сумма, шаг месяц, день слегка гуляет.
    put('2026-05-12', 299, 'ЯНДЕКС ПЛЮС', 'Развлечения');
    put('2026-06-12', 299, 'ЯНДЕКС ПЛЮС', 'Развлечения');
    put('2026-07-13', 299, 'ЯНДЕКС ПЛЮС', 'Развлечения');
    put('2026-08-01', 299, 'ЯНДЕКС ПЛЮС', 'Развлечения');

    // Связь: сумма гуляет по тарифу, но в пределах разумного.
    put('2026-06-05', 650, 'MTS SVYAZ', 'Жильё и связь');
    put('2026-07-05', 690, 'MTS SVYAZ', 'Жильё и связь');
    put('2026-08-04', 670, 'MTS SVYAZ', 'Жильё и связь');

    // Пропущенный месяц подписку не отменяет.
    put('2026-04-20', 1090, 'IVI RU', 'Развлечения');
    put('2026-05-20', 1090, 'IVI RU', 'Развлечения');
    put('2026-07-20', 1090, 'IVI RU', 'Развлечения');

    // Продукты в одном магазине — не подписка: суммы и шаг случайные.
    put('2026-07-02', 1240, 'PYATEROCHKA 4512', 'Продукты');
    put('2026-07-09', 830, 'PYATEROCHKA 4512', 'Продукты');
    put('2026-07-11', 2100, 'PYATEROCHKA 4512', 'Продукты');
    put('2026-07-28', 640, 'PYATEROCHKA 4512', 'Продукты');

    // Раз в неделю — тоже не месячный платёж.
    for (const d of ['2026-07-01', '2026-07-08', '2026-07-15', '2026-07-22', '2026-07-29']) {
      put(d, 500, 'FITNESS CLUB', 'Здоровье');
    }

    // Один платёж — ещё ничего не значит.
    put('2026-07-14', 4500, 'AVIASALES', 'Прочее');

    // Тот же магазин, но две разные жизни: подписка на такси и сами поездки.
    put('2026-05-06', 199, 'YANDEX TAXI', 'Транспорт');
    put('2026-06-06', 199, 'YANDEX TAXI', 'Транспорт');
    put('2026-07-06', 199, 'YANDEX TAXI', 'Транспорт');
    put('2026-06-14', 740, 'YANDEX TAXI', 'Транспорт');
    put('2026-07-21', 1310, 'YANDEX TAXI', 'Транспорт');

    // Отменённая подписка: три месяца была, потом кончилась.
    put('2026-03-08', 890, 'NETFLIX COM', 'Развлечения');
    put('2026-04-08', 890, 'NETFLIX COM', 'Развлечения');
    put('2026-05-08', 890, 'NETFLIX COM', 'Развлечения');

    // Поступление той же формы подпиской быть не может.
    put('2026-06-10', 90000, 'ЗАРПЛАТА', 'Зарплата', 'Поступление');
    put('2026-07-10', 90000, 'ЗАРПЛАТА', 'Зарплата', 'Поступление');

    const list = C.recurring(rows, today);
    return { list, total: C.recurringTotal(list), today };
  });

  const names = found.list.map((r) => r.name);
  console.log('\n1. Что нашлось');
  for (const r of found.list) console.log(`     ${r.name} · ${r.amount} ₽ · ${r.count} шт · следующий ${r.nextDate}`);
  check('подписка с ровной суммой', names.includes('ЯНДЕКС ПЛЮС'), names.join(', '));
  check('связь с плавающей суммой', names.includes('MTS SVYAZ'), names.join(', '));
  check('пропущенный месяц не мешает', names.includes('IVI RU'), names.join(', '));

  console.log('\n2. Чего не должно быть');
  check('продукты не подписка', !names.includes('PYATEROCHKA 4512'), names.join(', '));
  check('еженедельное не подписка', !names.includes('FITNESS CLUB'), names.join(', '));
  check('единственный платёж не подписка', !names.includes('AVIASALES'), names.join(', '));
  check('доход не подписка', !names.includes('ЗАРПЛАТА'), names.join(', '));
  check('отменённая не показывается', !names.includes('NETFLIX COM'), names.join(', '));

  console.log('\n3. Подписка внутри шумного магазина');
  const taxi = found.list.find((r) => r.name === 'YANDEX TAXI');
  console.log(`     ${taxi ? `${taxi.amount} ₽ · ${taxi.count} шт` : 'не найдена'}`);
  check('найдена', Boolean(taxi), String(taxi));
  check('сумма — подписки, а не поездок', taxi && taxi.amount === 199, String(taxi && taxi.amount));

  console.log('\n4. Итог и следующее списание');
  console.log(`     всего ${found.total} ₽ в месяц`);
  const plus = found.list.find((r) => r.name === 'ЯНДЕКС ПЛЮС');
  check('сумма сходится', Math.abs(found.total - found.list.reduce((s, r) => s + r.amount, 0)) < 0.01, String(found.total));
  check('следующее — через месяц от последнего', plus.nextDate === '2026-09-01', plus.nextDate);
  check('средняя по связи между крайними', (() => {
    const mts = found.list.find((r) => r.name === 'MTS SVYAZ');
    return mts.amount > 650 && mts.amount < 690;
  })(), String(found.list.find((r) => r.name === 'MTS SVYAZ').amount));

  console.log('\n5. На экране');
  await p.evaluate(async () => {
    const store = await import('./js/store.js');
    const D = await import('./js/dates.js');
    await store.startEmpty();
    const shift = D.diffDays(D.today(), '2026-08-02');
    const put = (date, amount, description, category, kind = 'Трата') => ({
      id: `${date}-${amount}`, date: D.addDays(date, shift), amount, kind, category, description,
      key: `${date}-${amount}`,
    });
    await store.mutate((d) => {
      d.assets = [{ id: 'a', name: 'Карта', type: 'Деньги', status: 'Активен', liquidity: 'Мгновенная',
        assetClass: 'Вклады', opening: 100000, goalIds: [], lotSize: 1 }];
      d.spending = [
        put('2026-06-12', 299, 'ЯНДЕКС ПЛЮС', 'Развлечения'),
        put('2026-07-13', 299, 'ЯНДЕКС ПЛЮС', 'Развлечения'),
        put('2026-08-01', 299, 'ЯНДЕКС ПЛЮС', 'Развлечения'),
        put('2026-06-05', 650, 'MTS SVYAZ', 'Жильё и связь'),
        put('2026-07-05', 690, 'MTS SVYAZ', 'Жильё и связь'),
        put('2026-08-04', 670, 'MTS SVYAZ', 'Жильё и связь'),
        put('2026-07-02', 1240, 'PYATEROCHKA 4512', 'Продукты'),
        put('2026-07-20', 90000, 'ЗАРПЛАТА', 'Зарплата', 'Поступление'),
      ];
    });
  });
  await p.goto(`${URL}#/spending`, { waitUntil: 'networkidle' });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(900);

  const screen = await p.evaluate(() => {
    const card = [...document.querySelectorAll('.card')]
      .find((c) => /Списывается само/.test(c.textContent));
    return card ? card.innerText.replace(/\s+/g, ' ') : null;
  });
  console.log(`     ${screen}`);
  check('блок на экране', Boolean(screen), String(screen));
  check('в нём обе подписки', /ЯНДЕКС ПЛЮС/.test(screen) && /MTS SVYAZ/.test(screen), String(screen));
  check('продуктов в нём нет', !/PYATEROCHKA/.test(screen), String(screen));
  check('доля от трат названа', /месячных трат/.test(screen), String(screen));

  console.log(`\n  ошибок в консоли: ${errs.length}${errs.length ? ' — ' + errs.join(' | ') : ''}`);
  if (errs.length) bad += 1;
  await b.close();
  console.log(bad ? `\n${bad} провалов` : '\nВсё сходится');
  process.exit(bad ? 1 : 0);
})();

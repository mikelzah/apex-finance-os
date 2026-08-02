// Свой список категорий: добавить, переименовать, удалить, принять из выписки.
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
        assetClass: 'Вклады', opening: 50000, goalIds: [], lotSize: 1 }];
      let n = 0;
      const put = (amount, category, description) => d.spending.push({
        id: `s${n += 1}`, date: D.addDays(D.today(), -(n % 4)), amount, kind: 'Трата',
        category, description, account: 'Банк', key: `k${n}`, source: 'Вручную',
      });
      put(640, 'Продукты', 'Яндекс Лавка');
      put(1120, 'Продукты', 'Дикси');
      put(890, 'Кафе и рестораны', 'Яндекс.Еда');
      // Категория пришла из выписки банка и в списке её нет.
      put(730, 'Маркетплейсы', 'OZON');
      put(410, 'Маркетплейсы', 'Wildberries');
    });
  });
  await p.goto(`${URL}#/more/categories`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(800);

  const screen = () => p.evaluate(() => ({
    titles: [...document.querySelectorAll('.section-title, .card h3')].map((x) => x.textContent.trim()),
    // В строке подпись лежит внутри .row-label вторым элементом, отдельного
    // класса у неё нет: берём span для названия и small для подписи.
    rows: [...document.querySelectorAll('.row')].map((r) => ({
      name: r.querySelector('.row-label span')?.textContent.trim(),
      value: r.querySelector('.row-value span')?.textContent.trim(),
      sub: r.querySelector('.row-label small')?.textContent.trim(),
    })),
  }));

  console.log('\n1. Список показан целиком');
  let s = await screen();
  const names = s.rows.map((r) => r.name);
  console.log(`     ${names.join(', ')}`);
  check('траты на месте', names.includes('Продукты') && names.includes('Транспорт'), names.join(', '));
  check('доходы тоже', names.includes('Зарплата'), names.join(', '));
  check('видно, сколько записей', s.rows.find((r) => r.name === 'Продукты')?.value === '2 записи',
    s.rows.find((r) => r.name === 'Продукты')?.value);
  check('запасная помечена', /запасная/.test(s.rows.find((r) => r.name === 'Прочее')?.sub || ''),
    s.rows.find((r) => r.name === 'Прочее')?.sub);

  console.log('\n2. Категория из выписки видна отдельно');
  const stray = s.rows.find((r) => r.name === 'Маркетплейсы');
  console.log(`     ${stray?.name}: ${stray?.value} · ${stray?.sub}`);
  check('«Маркетплейсы» найдены', Boolean(stray), JSON.stringify(stray));
  check('с числом записей', stray?.value === '2 записи', stray?.value);

  await p.locator('.row:has-text("Маркетплейсы")').click();
  await p.waitForTimeout(600);
  s = await screen();
  const added = s.rows.filter((r) => r.name === 'Маркетплейсы');
  console.log(`     после нажатия строк с таким именем: ${added.length}`);
  check('переехала в список трат', added.length === 1 && !/добавить/.test(added[0].sub || ''), JSON.stringify(added));

  console.log('\n3. Своя категория');
  await p.locator('#header .btn:has-text("Добавить")').click();
  await p.waitForTimeout(400);
  await p.locator('.sheet-body input[type=text]').fill('Машина');
  await p.locator('.sheet-foot .btn-primary').click();
  await p.waitForTimeout(700);
  s = await screen();
  check('добавилась', s.rows.some((r) => r.name === 'Машина'), s.rows.map((r) => r.name).join(', '));

  console.log('\n4. Переименование меняет и записи');
  await p.locator('.row:has-text("Продукты")').first().click();
  await p.waitForTimeout(400);
  await p.locator('.sheet-body input[type=text]').fill('Еда домой');
  await p.locator('.sheet-foot .btn-primary').click();
  await p.waitForTimeout(700);
  const after = await p.evaluate(async () => {
    const store = await import('./js/store.js');
    return store.getState().spending.map((r) => r.category);
  });
  console.log(`     категории записей: ${[...new Set(after)].join(', ')}`);
  check('в записях новое имя', after.filter((x) => x === 'Еда домой').length === 2, [...new Set(after)].join(', '));
  check('старого имени не осталось', !after.includes('Продукты'), [...new Set(after)].join(', '));
  s = await screen();
  check('в списке тоже', s.rows.some((r) => r.name === 'Еда домой'), s.rows.map((r) => r.name).join(', '));
  check('и оно не задвоилось', s.rows.filter((r) => r.name === 'Еда домой').length === 1,
    s.rows.map((r) => r.name).join(', '));

  console.log('\n5. Удаление переводит записи в запасную');
  await p.locator('.row:has-text("Еда домой")').first().click();
  await p.waitForTimeout(400);
  await p.locator('.sheet-foot .btn-danger').click();
  await p.waitForTimeout(400);
  const warning = await p.evaluate(() => document.querySelector('.sheet-body')?.textContent || '');
  console.log(`     предупреждение: ${warning.slice(0, 90)}`);
  check('сказано, сколько переедет', /2 записи перейдут/.test(warning), warning.slice(0, 90));
  await p.locator('.sheet-foot .btn-danger, .sheet-foot .btn-primary').last().click();
  await p.waitForTimeout(800);

  const moved = await p.evaluate(async () => {
    const store = await import('./js/store.js');
    const rows = store.getState().spending;
    return {
      other: rows.filter((r) => r.category === 'Прочее').length,
      gone: rows.some((r) => r.category === 'Еда домой'),
      total: rows.reduce((sum, r) => sum + r.amount, 0),
    };
  });
  console.log(`     в «Прочем»: ${moved.other} · сумма всех записей: ${moved.total}`);
  check('записи переехали', moved.other === 2, String(moved.other));
  check('удалённой категории не осталось', !moved.gone, String(moved.gone));
  // Сумма не должна измениться ни на копейку: переезд категории — это
  // переименование, а не удаление денег.
  check('сумма трат не изменилась', Math.abs(moved.total - (640 + 1120 + 890 + 730 + 410)) < 0.01, String(moved.total));

  console.log('\n6. Новый список виден при добавлении записи');
  await p.goto(`${URL}#/spending`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  await p.locator('.btn:has-text("Показать все траты")').click();
  await p.waitForTimeout(400);
  await p.locator('.spend-op').first().click();
  await p.waitForTimeout(600);
  const options = await p.evaluate(() =>
    [...document.querySelectorAll('.sheet-body select')].map((sel) => [...sel.options].map((o) => o.value)));
  const cats = options.find((list) => list.includes('Прочее')) || [];
  console.log(`     в списке записи: ${cats.join(', ')}`);
  check('своя категория предлагается', cats.includes('Машина'), cats.join(', '));
  check('удалённой в списке нет', !cats.includes('Еда домой'), cats.join(', '));
  check('принятая из выписки есть', cats.includes('Маркетплейсы'), cats.join(', '));

  console.log(`\n  ошибок в консоли: ${errs.length}${errs.length ? ' — ' + errs.join(' | ') : ''}`);
  if (errs.length) bad += 1;
  await b.close();
  console.log(bad ? `\n${bad} провалов` : '\nВсё сходится');
  process.exit(bad ? 1 : 0);
})();

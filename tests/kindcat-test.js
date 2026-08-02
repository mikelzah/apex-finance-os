// Категории в записи зависят от вида: трате не предлагаются доходные.
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
      const put = (amount, kind, category, description) => d.spending.push({
        id: `s${n += 1}`, date: D.addDays(D.today(), -(n % 4)), amount, kind,
        category, description, account: 'Банк', key: `k${n}`, source: 'Вручную',
      });
      put(410, 'Трата', 'Подписки', 'Райффайзен подписка');
      // Категория пришла из выписки, в списке приложения её нет.
      put(730, 'Трата', 'Маркетплейсы', 'OZON');
      put(90000, 'Поступление', 'Зарплата', 'Аванс');
    });
  });

  await p.goto(`${URL}#/spending`, { waitUntil: 'networkidle' });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(800);

  // Значения списка «Категория» — это второй select в шторке: первый вид.
  const opts = () => p.evaluate(() => {
    const sels = [...document.querySelectorAll('.sheet-body select')];
    return { kind: sels[0]?.value, value: sels[1]?.value, list: [...(sels[1]?.options || [])].map((o) => o.value) };
  });
  const setKind = async (value) => {
    await p.evaluate((v) => {
      const sel = document.querySelectorAll('.sheet-body select')[0];
      sel.value = v;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
    await p.waitForTimeout(300);
  };

  console.log('\n1. У траты только расходные категории');
  await p.locator('.btn:has-text("Показать все траты")').click();
  await p.waitForTimeout(400);
  await p.locator('.spend-op:has-text("Райффайзен")').first().click();
  await p.waitForTimeout(600);
  let s = await opts();
  console.log(`     вид ${s.kind} · ${s.list.join(', ')}`);
  check('вид — трата', s.kind === 'Трата', s.kind);
  check('своя категория выбрана', s.value === 'Подписки', s.value);
  check('доходных нет', !s.list.some((x) => ['Зарплата', 'Подработка', 'Возврат', 'Подарок', 'Прочий доход'].includes(x)),
    s.list.join(', '));
  check('переводных нет', !s.list.some((x) => ['Сбережения', 'Переводы', 'Проценты'].includes(x)), s.list.join(', '));
  check('расходные на месте', s.list.includes('Продукты') && s.list.includes('Прочее'), s.list.join(', '));

  console.log('\n2. Сменили вид на поступление');
  await setKind('Поступление');
  s = await opts();
  console.log(`     ${s.value} из ${s.list.join(', ')}`);
  check('список доходный', s.list.includes('Зарплата') && s.list.includes('Прочий доход'), s.list.join(', '));
  check('расходных нет', !s.list.includes('Продукты') && !s.list.includes('Подписки'), s.list.join(', '));
  check('категория ушла в запасную', s.value === 'Прочий доход', s.value);

  console.log('\n3. Перевод себе');
  await setKind('Перевод себе');
  s = await opts();
  console.log(`     ${s.value} из ${s.list.join(', ')}`);
  check('только переводные', s.list.join(',') === 'Сбережения,Переводы,Проценты', s.list.join(', '));
  check('выбраны «Переводы»', s.value === 'Переводы', s.value);

  console.log('\n4. Вернулись к трате');
  await setKind('Трата');
  s = await opts();
  console.log(`     ${s.value} из ${s.list.join(', ')}`);
  check('снова расходные', s.list.includes('Продукты'), s.list.join(', '));
  check('в запасной, а не в чужой', s.value === 'Прочее', s.value);
  await p.locator('.sheet-close').click();
  await p.waitForTimeout(400);

  console.log('\n5. Категория из выписки не теряется при открытии');
  await p.locator('.spend-op:has-text("OZON")').first().click();
  await p.waitForTimeout(600);
  s = await opts();
  console.log(`     ${s.value} из ${s.list.join(', ')}`);
  check('своя категория выбрана', s.value === 'Маркетплейсы', s.value);
  check('и стоит первой', s.list[0] === 'Маркетплейсы', s.list.slice(0, 3).join(', '));
  check('доходных всё равно нет', !s.list.includes('Зарплата'), s.list.join(', '));
  // Уход и возврат к тому же виду не должен стирать её.
  await setKind('Поступление');
  await setKind('Трата');
  s = await opts();
  check('после возврата вида уцелела в списке', s.list.includes('Маркетплейсы'), s.list.join(', '));
  await p.locator('.sheet-close').click();
  await p.waitForTimeout(400);

  console.log('\n6. У поступления сразу доходный список');
  await p.locator('.spend-op:has-text("Аванс")').first().click();
  await p.waitForTimeout(600);
  s = await opts();
  console.log(`     вид ${s.kind} · ${s.value} из ${s.list.join(', ')}`);
  check('вид — поступление', s.kind === 'Поступление', s.kind);
  check('зарплата выбрана', s.value === 'Зарплата', s.value);
  check('расходных нет', !s.list.includes('Продукты'), s.list.join(', '));

  console.log('\n7. Сохранение пишет то, что выбрано');
  await setKind('Трата');
  await p.locator('.sheet-foot .btn-primary').click();
  await p.waitForTimeout(800);
  const saved = await p.evaluate(async () => {
    const store = await import('./js/store.js');
    const row = store.getState().spending.find((r) => r.description === 'Аванс');
    return { kind: row.kind, category: row.category };
  });
  console.log(`     записано: ${saved.kind} · ${saved.category}`);
  check('вид сменился', saved.kind === 'Трата', saved.kind);
  check('категория подходит виду', saved.category === 'Прочее', saved.category);

  console.log(`\n  ошибок в консоли: ${errs.length}${errs.length ? ' — ' + errs.join(' | ') : ''}`);
  if (errs.length) bad += 1;
  await b.close();
  console.log(bad ? `\n${bad} провалов` : '\nВсё сходится');
  process.exit(bad ? 1 : 0);
})();

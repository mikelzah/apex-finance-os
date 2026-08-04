// Добавление бумаги прямо с экрана портфеля.
const { chromium } = require('playwright');
const URL = 'http://127.0.0.1:8899/app/index.html';

(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'], executablePath: process.env.CHROMIUM_PATH || undefined });
  const c = await b.newContext({ viewport: { width: 440, height: 956 }, isMobile: true, hasTouch: true, locale: 'ru-RU', colorScheme: 'light' });
  const p = await c.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  // Значок бумаги ищется файлом по тикеру, и файла чаще всего нет: облигаций
  // и фондов тысячи, логотипов у них не бывает. Отсутствие файла — штатное
  // состояние, приложение рисует монограмму. Считать этот ответ сервера
  // ошибкой значит требовать список «у кого значок есть», от которого
  // в приложении сознательно отказались.
  p.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (/404/.test(m.text()) && /icons\/tickers\//.test(m.location()?.url || '')) return;
    errs.push(m.text());
  });

  let bad = 0;
  const check = (l, ok, d) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? ' — ' + d : ''}`); if (!ok) bad += 1; };

  await p.goto(`${URL}#/dashboard`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(600);
  await p.evaluate(async () => (await import('./js/store.js')).loadDemo());
  await p.goto(`${URL}#/portfolio`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(800);

  // Действие раздела живёт в шапке раздела и подписано не текстом, а именем
  // для скринридера: круг с плюсом узнаётся без слова, а слово никуда
  // не делось — оно в aria-label и в заголовке шторки, которая открывается.
  console.log('\n1. Кнопка на экране портфеля');
  const btn = p.locator('.screen-head .head-round[aria-label="Добавить бумагу"]');
  check('кнопка есть', (await btn.count()) === 1, String(await btn.count()));

  console.log('\n2. Форма открывается готовой под бумагу');
  await btn.first().click();
  await p.waitForTimeout(700);
  const form = await p.evaluate(() => {
    const val = (label) => {
      const f = [...document.querySelectorAll('.sheet .field-label')].find((l) => l.textContent.startsWith(label));
      const el = f && f.parentElement.querySelector('select, input');
      return el ? el.value : null;
    };
    const groupOpen = (name) => {
      const g = [...document.querySelectorAll('.sheet details')].find((d) => d.querySelector('summary')?.textContent.includes(name));
      return g ? g.open : null;
    };
    return {
      type: val('Тип'), cls: val('Класс в портфеле'), liquidity: val('Ликвидность'),
      quotes: groupOpen('Котировки'), balance: groupOpen('Остаток'),
    };
  });
  console.log(`     тип ${form.type}, класс ${form.cls}, ликвидность ${form.liquidity}`);
  console.log(`     группа «Котировки» раскрыта: ${form.quotes}, «Остаток»: ${form.balance}`);
  check('тип — инвестиции', form.type === 'Инвестиции', form.type);
  check('класс подставлен', form.cls === 'Акции', form.cls);
  check('котировки раскрыты сразу', form.quotes === true, String(form.quotes));
  check('остаток свёрнут', form.balance === false, String(form.balance));

  console.log('\n3. Заводим облигацию и смотрим портфель');
  await p.evaluate(() => {
    const set = (label, v) => {
      const f = [...document.querySelectorAll('.sheet .field-label')].find((l) => l.textContent.startsWith(label));
      const el = f.parentElement.querySelector('select, input');
      el.value = v;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set('Название', 'ОФЗ 26238');
    set('Класс в портфеле', 'Облигации');
    set('Тикер', 'SU26238');
    set('Количество', '100');
    set('Цена, ₽', '520');
  });
  await p.locator('.sheet-foot .btn-primary').click();
  await p.waitForTimeout(900);

  const after = await p.evaluate(async () => {
    const store = await import('./js/store.js'); const C = await import('./js/calc.js');
    const st = store.getState();
    const a = st.assets.find((x) => x.ticker === 'SU26238');
    const { rows } = C.portfolioRows(st.assets, st.operations, st.portfolio);
    return { asset: a && { cls: a.assetClass, type: a.type, value: C.assetValue(a, st.operations) },
             bonds: rows.find((r) => r.class === 'Облигации').value };
  });
  console.log(`     актив: класс ${after.asset?.cls}, тип ${after.asset?.type}, стоимость ${after.asset?.value} ₽`);
  console.log(`     в строке «Облигации»: ${after.bonds} ₽`);
  check('актив создан с нужным классом', after.asset?.cls === 'Облигации', String(after.asset?.cls));
  check('стоимость посчиталась', after.asset?.value === 52000, String(after.asset?.value));
  check('попал в свою строку портфеля', after.bonds === 52000, String(after.bonds));

  console.log('\n4. Актив без класса виден в списке «Вне расчёта долей»');
  await p.evaluate(async () => {
    const store = await import('./js/store.js');
    await store.mutate((d) => {
      const a = d.assets.find((x) => x.ticker === 'LQDT');
      if (a) a.assetClass = null;
    });
  });
  // Правка состояния из консоли перерисовку не вызывает: экраны обновляются
  // по refresh из самих вьюх. Поэтому перезагружаем.
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  const outside = await p.evaluate(() =>
    [...document.querySelectorAll('.card')].filter((c) => /Вне расчёта долей/.test(c.textContent))
      .map((c) => [...c.querySelectorAll('.row-label span:first-child')].map((s) => s.textContent.trim()))[0] || []);
  console.log(`     вне расчёта: ${outside.join(', ')}`);
  check('фонд без класса виден', outside.some((n) => /Фонд денежного рынка/.test(n)), outside.join(','));

  console.log('\n5. Задаём ему класс — уходит из списка в расчёт');
  await p.locator('.card:has-text("Вне расчёта долей") .row').first().click();
  await p.waitForTimeout(600);
  await p.click('.header-action button');
  await p.waitForTimeout(600);
  await p.evaluate(() => {
    const f = [...document.querySelectorAll('.sheet .field-label')].find((l) => l.textContent.startsWith('Класс в портфеле'));
    const sel = f.parentElement.querySelector('select');
    sel.value = 'Фонды';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await p.locator('.sheet-foot .btn-primary').click();
  await p.waitForTimeout(900);
  const done = await p.evaluate(() => ({
    outside: [...document.querySelectorAll('.card')].some((c) => /Вне расчёта долей/.test(c.textContent)),
    funds: [...document.querySelectorAll('.alloc-row')].find((r) => /Фонды/.test(r.textContent))?.textContent.replace(/\s+/g, ' ').trim(),
  }));
  console.log(`     карточка «вне расчёта» осталась: ${done.outside}`);
  console.log(`     строка фондов: ${done.funds}`);
  check('список вне расчёта исчез', done.outside === false);
  check('фонды больше не нулевые', !/^Фонды 0 ₽/.test(done.funds || ''), done.funds);

  await c.close();
  await b.close();
  if (errs.length) { console.log('\nОшибки:'); errs.forEach((e) => console.log('  ' + e)); bad += errs.length; }
  console.log(bad ? `\n${bad} провалов\n` : '\nВсё сходится\n');
  process.exit(bad ? 1 : 0);
})();

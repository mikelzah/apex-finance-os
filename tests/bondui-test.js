// Облигация на экранах: карточка, календарь, форма сделки в процентах,
// сигнал о погашении.
const { chromium } = require('playwright');
const URL = 'http://127.0.0.1:8899/app/index.html';
(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'], executablePath: process.env.CHROMIUM_PATH || undefined });
  const c = await b.newContext({ viewport: { width: 440, height: 956 }, isMobile: true, hasTouch: true, locale: 'ru-RU' });
  const p = await c.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  // Значок бумаги ищется файлом по тикеру, и у облигаций его нет по существу:
  // облигаций тысячи, логотипов у них не бывает. Отсутствие файла — штатное
  // состояние, приложение рисует вместо значка монограмму. Считать этот
  // ответ сервера ошибкой значит требовать список «у кого значок есть»,
  // от которого в приложении сознательно отказались.
  p.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (/404/.test(m.text()) && /icons\/tickers\//.test(m.location()?.url || '')) return;
    errs.push(m.text());
  });
  let bad = 0;
  const check = (l, ok, d) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? ' — ' + d : ''}`); if (!ok) bad += 1; };
  const near = (a, z, eps = 0.5) => Math.abs(a - z) <= eps;

  await p.goto(`${URL}#/dashboard`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(600);
  await p.evaluate(async () => (await import('./js/store.js')).loadDemo());

  // Заводим ОФЗ: номинал 1000, купон 12% дважды в год, ближайший через 2 месяца.
  await p.evaluate(async () => {
    const store = await import('./js/store.js');
    const D = await import('./js/dates.js');
    const today = D.today();
    await store.mutate((d) => {
      d.assets.push({
        id: 'ofz', name: 'ОФЗ 26238', type: 'Инвестиции', status: 'Активен', liquidity: 'T+1',
        assetClass: 'Облигации', ticker: 'SU26238', board: 'TQOB', quantity: 0, lotSize: 1,
        price: 98.4, faceValue: 1000, couponRate: 12, couponsPerYear: 2,
        nextCoupon: D.addMonths(today, 2), maturityDate: D.addYears(today, 3),
        opening: 0, openingDate: null, goalIds: [], notes: null,
      });
    });
  });
  await p.goto(`${URL}#/portfolio/ofz`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(800);

  console.log('\n1. Форма сделки переключается на проценты');
  await p.locator('.card:has-text("Сделки и выплаты") .section-title button').click();
  await p.waitForTimeout(600);
  const labels = await p.evaluate(() => [...document.querySelectorAll('.sheet .field')]
    .filter((f) => f.getClientRects().length)
    .map((f) => f.querySelector('.field-label').textContent.trim()));
  console.log(`     поля: ${labels.join(' · ')}`);
  check('цена — в процентах от номинала', labels.includes('Цена, % от номинала'), labels.join(', '));
  check('спрашивается НКД', labels.includes('НКД на бумагу, ₽'), labels.join(', '));
  check('рублёвой цены нет', !labels.includes('Цена за штуку, ₽'), labels.join(', '));

  console.log('\n2. Сумма считается от номинала, а не от процентов');
  await p.locator('.field:has-text("Количество, лотов") input').fill('10');
  await p.locator('.field:has-text("Цена, % от номинала") input').fill('98,4');
  await p.locator('.field:has-text("НКД") input').fill('29,83');
  await p.waitForTimeout(300);
  const total = await p.evaluate(() => ({
    v: document.querySelector('.total-value').textContent.trim(),
    n: document.querySelector('.total-note').textContent.trim(),
  }));
  console.log(`     ${total.v} · ${total.n}`);
  // 10 × (984 + 29,83) = 10 138,30
  check('итог 10 138,30 ₽', total.v.replace(/\s| /g, '').startsWith('10138,30'), total.v);
  check('в пояснении проценты и номинал', /98,4%/.test(total.n) && /1\s000\s?₽/.test(total.n), total.n);

  await p.locator('.field:has-text("Счёт") select').selectOption({ index: 1 });
  await p.locator('.sheet-foot .btn-primary').click();
  await p.waitForTimeout(900);

  console.log('\n3. Стоимость на странице бумаги');
  const page = await p.evaluate(async () => {
    const store = await import('./js/store.js');
    const C = await import('./js/calc.js');
    const D = await import('./js/dates.js');
    const s = store.getState();
    const a = s.assets.find((x) => x.id === 'ofz');
    return {
      value: C.assetValue(a, s.operations, D.today()),
      qty: C.assetQuantity(a, s.operations),
      nkd: C.accruedCoupon(a, D.today()),
      clean: C.bondClean(a),
      stats: [...document.querySelectorAll('.stat')].map((x) => ({
        l: x.querySelector('.stat-label').textContent.trim(),
        v: x.querySelector('.stat-value').textContent.trim(),
      })),
    };
  });
  console.log(`     ${page.qty} шт, чистая ${page.clean} ₽, НКД ${page.nkd.toFixed(2)} ₽, всего ${page.value.toFixed(2)} ₽`);
  console.log(`     ${page.stats.map((x) => `${x.l}: ${x.v}`).join(' | ')}`);
  check('стоимость = количество × (цена + НКД)', near(page.value, page.qty * (page.clean + page.nkd)), page.value.toFixed(2));
  check('есть блок облигации', page.stats.some((x) => x.l === 'Номинал'), page.stats.map((x) => x.l).join(', '));
  check('показан накопленный купон', page.stats.some((x) => x.l === 'Накоплен купон'));
  check('показан размер купона', page.stats.some((x) => x.l === 'Купон'));
  // «Сейчас» у облигации обязано быть в рублях: рядом стоит средняя цена
  // в рублях, и проценты с рублями под одним знаком — прямая ложь.
  const now = page.stats.find((x) => x.l === 'Сейчас');
  console.log(`     сейчас: ${now.v}`);
  check('«Сейчас» в рублях, а не в процентах', parseFloat(now.v.replace(/\s| /g, '').replace(',', '.')) > 900, now.v);

  console.log('\n4. Календарь выплат на экране портфеля');
  await p.goto(`${URL}#/portfolio`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  const cal = await p.evaluate(() => {
    const card = [...document.querySelectorAll('.card')].find((x) => x.querySelector('h2')?.textContent.trim() === 'Ближайшие выплаты');
    if (!card) return null;
    return {
      total: card.querySelector('.section-sum').textContent.trim(),
      rows: [...card.querySelectorAll('.row')].map((r) => r.textContent.replace(/\s+/g, ' ').trim()),
    };
  });
  console.log(`     всего ${cal?.total}: ${cal?.rows.join(' | ')}`);
  check('карточка выплат есть', Boolean(cal));
  check('в ней купон на 600 ₽', /600 ₽/.test(cal.rows.join(' ')), cal.rows.join(' '));

  console.log('\n5. Погашенная облигация даёт сигнал');
  await p.evaluate(async () => {
    const store = await import('./js/store.js');
    const D = await import('./js/dates.js');
    await store.mutate((d) => {
      d.assets.find((a) => a.id === 'ofz').maturityDate = D.addDays(D.today(), -10);
    });
  });
  const sig = await p.evaluate(async () => {
    const store = await import('./js/store.js');
    const C = await import('./js/calc.js');
    const D = await import('./js/dates.js');
    const s = store.getState();
    return C.signals(s.assets, s.operations, D.today())
      .filter((x) => x.asset.id === 'ofz')
      .map((x) => ({ kind: x.kind, text: x.text, level: x.level }));
  });
  console.log(`     ${JSON.stringify(sig)}`);
  check('сигнал о погашении есть', sig.some((x) => x.kind === 'matured'), JSON.stringify(sig));
  check('и он про завышенный капитал', /капитал завышен/.test(sig.find((x) => x.kind === 'matured')?.text || ''));

  console.log(`\n  ошибок в консоли: ${errs.length}${errs.length ? ' — ' + errs.join(' | ') : ''}`);
  if (errs.length) bad += 1;
  await b.close();
  console.log(bad ? `\n${bad} провалов` : '\nВсё сходится');
  process.exit(bad ? 1 : 0);
})();

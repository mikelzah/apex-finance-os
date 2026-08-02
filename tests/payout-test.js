// Дивиденды и купоны: деньги приходят на счёт, количество бумаг не меняется,
// налоговый лимит по вкладам и начисление процентов не задеты.
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
  const near = (a, z, eps = 0.01) => Math.abs(a - z) <= eps;

  await p.goto(`${URL}#/dashboard`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(600);
  await p.evaluate(async () => (await import('./js/store.js')).loadDemo());
  await p.goto(`${URL}#/portfolio/demo-sber`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(800);

  const snap = () => p.evaluate(async () => {
    const store = await import('./js/store.js');
    const C = await import('./js/calc.js');
    const s = store.getState();
    const sber = s.assets.find((a) => a.id === 'demo-sber');
    const cash = s.assets.find((a) => !a.ticker && a.type === 'Деньги');
    const year = new Date().getFullYear();
    return {
      qty: C.assetQuantity(sber, s.operations),
      value: C.assetValue(sber, s.operations),
      cashValue: C.assetValue(cash, s.operations),
      worth: C.netWorth(s.assets, s.operations).total,
      interest: C.interestReceived(s.operations, year),
      accrue: Math.round(C.accrue(cash, s.operations, new Date().toISOString().slice(0, 10)) * 100) / 100,
      payouts: s.operations.filter((o) => C.isPayout(o)).map((o) => ({ t: o.type, a: o.amount, tax: o.tax })),
      legs: s.operations.filter((o) => o.linkedTo).map((o) => ({ t: o.type, a: o.amount })),
    };
  });

  console.log('\n1. Форма умеет выплату, и поля меняются под тип');
  const before = await snap();
  console.log(`     ${before.qty} шт, счёт ${before.cashValue} ₽, проценты за год ${before.interest} ₽`);
  await p.locator('.card:has-text("Сделки и выплаты") button.btn-primary').click();
  await p.waitForTimeout(600);
  const types = await p.evaluate(() => {
    const sel = [...document.querySelectorAll('.sheet select')][0];
    return [...sel.options].map((o) => o.textContent.trim());
  });
  console.log(`     типы: ${types.join(' · ')}`);
  check('четыре типа операции', types.length === 4 && types.includes('Дивиденд') && types.includes('Купон'), types.join(', '));

  const shown = () => p.evaluate(() => [...document.querySelectorAll('.sheet .field')]
    .filter((f) => f.getClientRects().length)
    .map((f) => f.querySelector('.field-label').textContent.trim()));
  const asTrade = await shown();
  await p.locator('.field:has-text("Тип операции") select').selectOption('Дивиденд');
  await p.waitForTimeout(250);
  const asPayout = await shown();
  console.log(`     при сделке:  ${asTrade.join(' · ')}`);
  console.log(`     при выплате: ${asPayout.join(' · ')}`);
  check('у сделки спрашивают лоты и цену', asTrade.includes('Количество, лотов') && asTrade.includes('Цена за штуку, ₽'));
  check('у выплаты их не спрашивают', !asPayout.includes('Количество, лотов') && !asPayout.includes('Цена за штуку, ₽'), asPayout.join(', '));
  check('у выплаты спрашивают начислено и налог', asPayout.includes('Начислено, ₽') && asPayout.includes('Удержан налог, ₽'));

  console.log('\n2. Итог считается за вычетом налога');
  await p.locator('.field:has-text("Начислено") input').fill('4200');
  await p.locator('.field:has-text("Удержан налог") input').fill('546');
  await p.waitForTimeout(250);
  const total = await p.evaluate(() => ({
    v: document.querySelector('.total-value').textContent.trim(),
    n: document.querySelector('.total-note').textContent.trim(),
  }));
  console.log(`     итого ${total.v} · ${total.n}`);
  check('к зачислению начислено минус налог', total.v.replace(/\s| /g, '').startsWith('3654'), total.v);

  console.log('\n3. Сохраняем — деньги на счёте, бумаг столько же');
  await p.locator('.field:has-text("Счёт") select').selectOption({ index: 1 });
  await p.locator('.sheet-foot .btn-primary').click();
  await p.waitForTimeout(900);
  const after = await snap();
  console.log(`     ${after.qty} шт, счёт ${after.cashValue} ₽`);
  console.log(`     выплаты: ${JSON.stringify(after.payouts)}`);
  check('количество бумаг не изменилось', after.qty === before.qty, `${before.qty} → ${after.qty}`);
  check('стоимость бумаги не изменилась', near(after.value, before.value), `${before.value} → ${after.value}`);
  check('дивиденд записан', after.payouts.length === 1 && after.payouts[0].t === 'Дивиденд', JSON.stringify(after.payouts));
  check('налог сохранён отдельно', after.payouts[0]?.tax === 546, String(after.payouts[0]?.tax));
  check('на счёт зачислено за вычетом налога', near(after.cashValue - before.cashValue, 3654), `${before.cashValue} → ${after.cashValue}`);
  check('капитал вырос ровно на зачисленное', near(after.worth - before.worth, 3654), `${before.worth} → ${after.worth}`);

  console.log('\n4. Налоговый лимит по вкладам не задет');
  console.log(`     проценты за год: ${before.interest} → ${after.interest}`);
  check('дивиденд не попал в проценты по вкладам', near(after.interest, before.interest), `${after.interest}`);
  console.log(`     начисление по счёту: ${before.accrue} → ${after.accrue}`);
  check('начисление процентов не сломалось', Number.isFinite(after.accrue) && after.accrue >= 0, String(after.accrue));
  check('зачисление — не «доход»', after.legs.every((l) => l.t !== 'Доход'), after.legs.map((l) => l.t).join(', '));

  console.log('\n5. В журнале выплата видна и в итог месяца не входит');
  await p.goto(`${URL}#/journal`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  const j = await p.evaluate(() => {
    const ops = [...document.querySelectorAll('.op')];
    const div = ops.find((o) => /Дивиденд/.test(o.textContent));
    return {
      found: Boolean(div),
      text: div ? div.textContent.replace(/\s+/g, ' ').trim() : null,
      dot: div ? div.querySelector('.op-dot').className : null,
      neutral: div ? div.querySelector('.op-amount').classList.contains('is-neutral') : null,
      chips: [...document.querySelectorAll('.chip')].map((x) => x.textContent.trim()),
    };
  });
  console.log(`     ${j.text}`);
  check('выплата в журнале', j.found);
  check('сумма без знака', j.neutral === true);
  check('своя точка', /op-payout/.test(j.dot || ''), j.dot);
  check('есть фильтр «Выплаты»', j.chips.includes('Выплаты'), j.chips.join(', '));

  await p.locator('.chip:has-text("Выплаты")').click();
  await p.waitForTimeout(600);
  const onlyPayouts = await p.evaluate(() => [...document.querySelectorAll('.op-title')].map((x) => x.textContent.trim()));
  console.log(`     под фильтром: ${onlyPayouts.join(' · ')}`);
  check('фильтр показывает только выплаты', onlyPayouts.length === 1 && /Дивиденд/.test(onlyPayouts[0]), onlyPayouts.join(', '));

  console.log('\n6. Правка и удаление откатывают деньги');
  await p.locator('.op').first().click();
  await p.waitForTimeout(600);
  const reopened = await p.evaluate(() => ({
    title: document.querySelector('.sheet-head h2')?.textContent.trim(),
    gross: document.querySelector('.field:has(.field-label) input')?.value,
    cash: [...document.querySelectorAll('.sheet select')].pop()?.value,
  }));
  console.log(`     открылось: ${reopened.title}`);
  check('открылась форма выплаты, а не денег', reopened.title === 'Дивиденд', reopened.title);
  await p.locator('.sheet-foot .btn-danger').click();
  await p.waitForTimeout(400);
  await p.locator('.sheet-foot .btn-danger').click();
  await p.waitForTimeout(900);
  const back = await snap();
  console.log(`     счёт ${back.cashValue} ₽, выплат ${back.payouts.length}`);
  check('деньги вернулись', near(back.cashValue, before.cashValue), `${after.cashValue} → ${back.cashValue}`);
  check('зачисление ушло вместе с выплатой', back.legs.length === 0, JSON.stringify(back.legs));

  console.log(`\n  ошибок в консоли: ${errs.length}${errs.length ? ' — ' + errs.join(' | ') : ''}`);
  if (errs.length) bad += 1;
  await b.close();
  console.log(bad ? `\n${bad} провалов` : '\nВсё сходится');
  process.exit(bad ? 1 : 0);
})();

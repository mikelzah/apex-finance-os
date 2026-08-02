// Сделка по бумаге: количество, сумма, списание со счёта, откат при удалении.
const { chromium } = require('playwright');
const URL = 'http://127.0.0.1:8899/app/index.html';

(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'], executablePath: process.env.CHROMIUM_PATH || undefined });
  const c = await b.newContext({ viewport: { width: 440, height: 956 }, isMobile: true, hasTouch: true, locale: 'ru-RU', colorScheme: 'light' });
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
    return {
      qty: C.assetQuantity(sber, s.operations),
      value: C.assetValue(sber, s.operations),
      opening: sber.quantity,
      lotSize: sber.lotSize,
      price: sber.price,
      cashId: cash.id,
      cashName: cash.name,
      cashValue: C.assetValue(cash, s.operations),
      worth: C.netWorth(s.assets, s.operations).total,
      ops: s.operations.length,
      trades: s.operations.filter((o) => C.isTrade(o)).map((o) => ({ type: o.type, q: o.quantity, u: o.unitPrice, fee: o.fee, amount: o.amount })),
      legs: s.operations.filter((o) => o.linkedTo).map((o) => ({ type: o.type, amount: o.amount, assetId: o.assetId })),
    };
  });

  console.log('\n1. Форма бумаги — это сделка, а не взнос');
  const before = await snap();
  console.log(`     ${before.qty} шт × ${before.price} ₽ = ${before.value} ₽ · лот ${before.lotSize} · счёт «${before.cashName}» ${before.cashValue} ₽`);
  await p.locator('.card:has-text("Сделки и выплаты") button.btn-primary').click();
  await p.waitForTimeout(600);
  const form = await p.evaluate(() => ({
    title: document.querySelector('.sheet-head h2')?.textContent.trim(),
    fields: [...document.querySelectorAll('.field-label')].map((n) => n.textContent.trim()),
    hasTotal: Boolean(document.querySelector('.total-value')),
  }));
  console.log(`     «${form.title}»: ${form.fields.join(' · ')}`);
  check('открылась форма операции по бумаге', form.title === 'Операция по бумаге', form.title);
  check('спрашивает количество лотов', form.fields.includes('Количество, лотов'));
  check('спрашивает цену за штуку', form.fields.includes('Цена за штуку, ₽'));
  check('спрашивает комиссию', form.fields.includes('Комиссия, ₽'));
  check('спрашивает счёт', form.fields.includes('Счёт'));
  check('суммы среди полей ввода нет', !form.fields.some((f) => /^Сумма/.test(f)), form.fields.join(', '));
  check('итог считается сам', form.hasTotal);

  console.log('\n2. Итог пересчитывается на лету');
  const lots = p.locator('.field:has-text("Количество, лотов") input');
  const price = p.locator('.field:has-text("Цена за штуку") input');
  const fee = p.locator('.field:has-text("Комиссия") input');
  await lots.fill('10');
  await price.fill('300');
  await fee.fill('45');
  await p.waitForTimeout(200);
  const total = await p.evaluate(() => ({
    value: document.querySelector('.total-value').textContent.trim(),
    note: document.querySelector('.total-note').textContent.trim(),
  }));
  console.log(`     итого ${total.value} · ${total.note}`);
  check('итог = количество × цена + комиссия', total.value.replace(/\s| /g, '').startsWith('3045'), total.value);
  check('рядом видно штуки и цену', /10 шт/.test(total.note), total.note);

  console.log('\n3. Сохраняем — меняется количество, а не «сумма операций»');
  await p.locator('.field:has-text("Счёт") select').selectOption({ index: 1 });
  await p.locator('.sheet-foot .btn-primary').click();
  await p.waitForTimeout(900);
  const after = await snap();
  console.log(`     ${after.qty} шт (было ${before.qty}) · стоимость ${after.value} ₽ · счёт ${after.cashValue} ₽`);
  console.log(`     сделки: ${JSON.stringify(after.trades)}`);
  console.log(`     списания: ${JSON.stringify(after.legs)}`);
  check('количество выросло на 10 штук', after.qty === before.qty + 10, `${before.qty} → ${after.qty}`);
  check('начальное количество не тронуто', after.opening === before.opening, `${after.opening}`);
  check('стоимость = новое количество × цена', near(after.value, after.qty * after.price), `${after.value}`);
  check('сделка записана одна', after.trades.length === 1, JSON.stringify(after.trades));
  check('в сделке количество в штуках', after.trades[0]?.q === 10, String(after.trades[0]?.q));
  check('в сделке цена за штуку', after.trades[0]?.u === 300, String(after.trades[0]?.u));
  check('в сделке комиссия', after.trades[0]?.fee === 45, String(after.trades[0]?.fee));

  console.log('\n4. Деньги списаны со счёта, а не появились из воздуха');
  check('списание создано', after.legs.length === 1, JSON.stringify(after.legs));
  check('это расход', after.legs[0]?.type === 'Расход', after.legs[0]?.type);
  check('на сумму сделки', near(after.legs[0]?.amount, 3045), String(after.legs[0]?.amount));
  check('счёт уменьшился на 3045', near(before.cashValue - after.cashValue, 3045), `${before.cashValue} → ${after.cashValue}`);
  // Капитал: бумаги считаются по рыночной цене, а платили по своей. Разница
  // между ними минус комиссия — вот и всё изменение. Совпадать с нулём оно
  // не обязано: купить дешевле рынка и значит сразу стать богаче на разницу.
  const expected = 10 * after.price - 3045;
  check('капитал сошёлся с разницей цены и комиссией', near(after.worth - before.worth, expected),
    `${before.worth} → ${after.worth}, ожидалось ${expected > 0 ? '+' : ''}${expected.toFixed(2)}`);

  console.log('\n5. Сделка не считается движением денег дважды');
  const flow = await p.evaluate(async () => {
    const store = await import('./js/store.js');
    const C = await import('./js/calc.js');
    const s = store.getState();
    const today = s.operations.filter((o) => o.date === new Date().toISOString().slice(0, 10));
    return { day: today.reduce((x, o) => x + C.signed(o), 0), n: today.length };
  });
  console.log(`     операций за сегодня ${flow.n}, движение ${flow.day} ₽`);
  check('за день списано ровно 3045', near(flow.day, -3045), String(flow.day));

  console.log('\n6. Продать больше, чем есть, нельзя');
  await p.locator('.card:has-text("Сделки и выплаты") button.btn-primary').click();
  await p.waitForTimeout(500);
  await p.locator('.field:has-text("Тип операции") select').selectOption('Продажа');
  await p.locator('.field:has-text("Количество, лотов") input').fill('99999');
  await p.locator('.field:has-text("Цена за штуку") input').fill('300');
  await p.locator('.sheet-foot .btn-primary').click();
  await p.waitForTimeout(500);
  const blocked = await p.evaluate(() => ({
    toast: document.querySelector('.toast')?.textContent.trim() || null,
    open: Boolean(document.querySelector('.sheet')),
  }));
  console.log(`     ${blocked.toast}`);
  check('сделка отклонена', blocked.open && /продать больше нельзя/i.test(blocked.toast || ''), blocked.toast);
  await p.locator('.sheet-close').click();
  await p.waitForTimeout(400);

  console.log('\n7. Продажа уменьшает количество и пополняет счёт');
  await p.locator('.card:has-text("Сделки и выплаты") button.btn-primary').click();
  await p.waitForTimeout(500);
  await p.locator('.field:has-text("Тип операции") select').selectOption('Продажа');
  await p.locator('.field:has-text("Количество, лотов") input').fill('5');
  await p.locator('.field:has-text("Цена за штуку") input').fill('320');
  await p.locator('.field:has-text("Счёт") select').selectOption({ index: 1 });
  await p.locator('.sheet-foot .btn-primary').click();
  await p.waitForTimeout(900);
  const sold = await snap();
  console.log(`     ${sold.qty} шт · счёт ${sold.cashValue} ₽ · списаний ${sold.legs.length}`);
  check('количество уменьшилось на 5', sold.qty === after.qty - 5, `${after.qty} → ${sold.qty}`);
  check('на счёт зачислено 1600', near(sold.cashValue - after.cashValue, 1600), `${after.cashValue} → ${sold.cashValue}`);
  check('зачисление — не «доход»', sold.legs.every((l) => l.type !== 'Доход'), sold.legs.map((l) => l.type).join(', '));

  console.log('\n8. Удаление сделки откатывает и количество, и деньги');
  await p.locator('.card:has-text("Сделки и выплаты") .row').first().click();
  await p.waitForTimeout(600);
  await p.locator('.sheet-foot .btn-danger').click();
  await p.waitForTimeout(400);
  await p.locator('.sheet-foot .btn-danger').click();
  await p.waitForTimeout(900);
  const back = await snap();
  console.log(`     ${back.qty} шт · счёт ${back.cashValue} ₽ · операций ${back.ops}`);
  check('количество вернулось', back.qty === after.qty, `${sold.qty} → ${back.qty}`);
  check('деньги вернулись', near(back.cashValue, after.cashValue), `${sold.cashValue} → ${back.cashValue}`);
  check('списание ушло вместе со сделкой', back.legs.length === 1, JSON.stringify(back.legs));

  console.log('\n9. Проценты по вкладу от сделок не поехали');
  const accr = await p.evaluate(async () => {
    const store = await import('./js/store.js');
    const C = await import('./js/calc.js');
    const s = store.getState();
    const out = {};
    for (const a of s.assets.filter((x) => x.rate)) {
      out[a.name] = Math.round(C.accrue(a, s.operations, new Date().toISOString().slice(0, 10)) * 100) / 100;
    }
    return out;
  });
  console.log(`     ${JSON.stringify(accr)}`);
  check('начисление посчиталось без ошибок', Object.values(accr).every((v) => Number.isFinite(v) && v >= 0), JSON.stringify(accr));

  console.log('\n10. У вклада форма прежняя — деньги, а не лоты');
  await p.goto(`${URL}#/journal`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(600);
  const money = await p.evaluate(async () => {
    const forms = await import('./js/forms.js');
    const store = await import('./js/store.js');
    const cash = store.getState().assets.find((a) => !a.ticker && a.type === 'Деньги');
    forms.operationSheet(null, { assetId: cash.id });
    await new Promise((r) => setTimeout(r, 300));
    return {
      title: document.querySelector('.sheet-head h2')?.textContent.trim(),
      fields: [...document.querySelectorAll('.field-label')].map((n) => n.textContent.trim()),
      assetOptions: [...document.querySelectorAll('.field select')].map((s) => s.options.length),
    };
  });
  console.log(`     «${money.title}»: ${money.fields.join(' · ')}`);
  check('у счёта — обычная операция', money.title === 'Новая операция', money.title);
  check('спрашивает сумму', money.fields.includes('Сумма, ₽'));
  check('лотов не спрашивает', !money.fields.includes('Количество, лотов'));

  console.log(`\n  ошибок в консоли: ${errs.length}${errs.length ? ' — ' + errs.join(' | ') : ''}`);
  if (errs.length) bad += 1;
  await b.close();
  console.log(bad ? `\n${bad} провалов` : '\nВсё сходится');
  process.exit(bad ? 1 : 0);
})();

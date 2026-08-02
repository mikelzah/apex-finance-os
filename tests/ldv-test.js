// Лоты и льгота на экране: карточка лотов и предупреждение в форме продажи.
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
  await p.evaluate(async () => (await import('./js/store.js')).loadDemo());

  // Три покупки: давняя (льгота есть), почти дозревшая и свежая.
  await p.evaluate(async () => {
    const store = await import('./js/store.js');
    const C = await import('./js/calc.js');
    const D = await import('./js/dates.js');
    const today = D.today();
    await store.mutate((d) => {
      d.assets.find((a) => a.id === 'demo-sber').quantity = 0;
      const add = (date, qty, price) => store.savePaperOp(d, {
        id: store.newId('op'), date, type: C.OP_BUY, quantity: qty, unitPrice: price, fee: null,
        amount: qty * price, assetId: 'demo-sber', ticker: 'SBER', goalId: null, source: 'Вручную', comment: null,
      }, null);
      add(D.addYears(today, -4), 100, 150);            // льгота уже есть
      add(D.addDays(D.addYears(today, -3), 60), 50, 220); // до льготы ~2 месяца
      add(D.addDays(today, -30), 40, 300);             // свежая
    });
  });
  await p.goto(`${URL}#/portfolio/demo-sber`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(900);

  console.log('\n1. Карточка лотов');
  const card = await p.evaluate(() => {
    const c = [...document.querySelectorAll('.card')].find((x) => x.querySelector('h2')?.textContent.trim() === 'Лоты');
    if (!c) return null;
    return {
      head: c.querySelector('.section-sum')?.textContent.trim(),
      rows: [...c.querySelectorAll('.row')].map((r) => ({
        l: r.querySelector('.row-label span').textContent.trim(),
        sub: r.querySelector('.row-label small')?.textContent.trim(),
        v: r.querySelector('.row-value span').textContent.trim(),
        tag: r.querySelector('.tag')?.textContent.trim() || null,
      })),
      warn: c.querySelector('.callout-warn')?.textContent.trim() || null,
    };
  });
  console.log(`     всего ${card.head}`);
  card.rows.forEach((r) => console.log(`     ${r.l} — ${r.v} · ${r.sub} [${r.tag || '—'}]`));
  console.log(`     ${card.warn}`);
  check('карточка есть', Boolean(card));
  check('три лота', card.rows.length === 3, String(card.rows.length));
  check('в шапке общее количество', /190 шт/.test(card.head || ''), card.head);
  check('у давнего лота ярлык льготы', card.rows[0].tag === 'льгота', card.rows[0].tag);
  check('у свежих — сколько ждать', /через/.test(card.rows[1].tag || '') && /через/.test(card.rows[2].tag || ''),
    `${card.rows[1].tag} / ${card.rows[2].tag}`);
  check('предупреждение о ближайшем сроке', /льготу/.test(card.warn || ''), card.warn);

  console.log('\n2. Продажа: последствия видны до сохранения');
  await p.locator('.card:has-text("Сделки и выплаты") .section-title button').click();
  await p.waitForTimeout(600);
  await p.locator('.field:has-text("Тип операции") select').selectOption('Продажа');
  await p.locator('.field:has-text("Количество, лотов") input').fill('100');
  await p.locator('.field:has-text("Цена за штуку") input').fill('320');
  await p.waitForTimeout(300);
  const warnA = await p.evaluate(() => {
    const n = document.querySelector('.sheet .callout-warn');
    return n && n.getClientRects().length ? n.textContent.trim() : null;
  });
  console.log(`     100 шт: ${warnA}`);
  check('сказано про прибыль', /Прибыль/.test(warnA || ''), warnA);
  check('и что налога нет по льготе', /льгота/i.test(warnA || ''), warnA);

  await p.locator('.field:has-text("Количество, лотов") input').fill('130');
  await p.waitForTimeout(300);
  const warnB = await p.evaluate(() => document.querySelector('.sheet .callout-warn')?.textContent.trim() || null);
  console.log(`     130 шт: ${warnB}`);
  check('появился налог', /налог \d/.test(warnB || ''), warnB);
  check('назван лот, которому недолго ждать', /до льготы/.test(warnB || ''), warnB);

  console.log('\n3. У покупки предупреждения нет');
  await p.locator('.field:has-text("Тип операции") select').selectOption('Покупка');
  await p.waitForTimeout(300);
  const hidden = await p.evaluate(() => {
    const n = document.querySelector('.sheet .callout-warn');
    return !n || n.getClientRects().length === 0;
  });
  check('при покупке блок скрыт', hidden);

  console.log('\n4. Продажа гасит старый лот');
  await p.locator('.field:has-text("Тип операции") select').selectOption('Продажа');
  await p.locator('.field:has-text("Количество, лотов") input').fill('100');
  await p.locator('.sheet-foot .btn-primary').click();
  await p.waitForTimeout(900);
  const afterSale = await p.evaluate(async () => {
    const store = await import('./js/store.js');
    const C = await import('./js/calc.js');
    const s = store.getState();
    const a = s.assets.find((x) => x.id === 'demo-sber');
    return C.lotsOf(a, s.operations).map((l) => ({ d: l.date, q: l.quantity }));
  });
  console.log(`     осталось: ${JSON.stringify(afterSale)}`);
  check('старый лот закрыт целиком', afterSale.length === 2, JSON.stringify(afterSale));
  check('остались два свежих', afterSale[0].q === 50 && afterSale[1].q === 40, JSON.stringify(afterSale));

  console.log(`\n  ошибок в консоли: ${errs.length}${errs.length ? ' — ' + errs.join(' | ') : ''}`);
  if (errs.length) bad += 1;
  await b.close();
  console.log(bad ? `\n${bad} провалов` : '\nВсё сходится');
  process.exit(bad ? 1 : 0);
})();

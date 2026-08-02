// Кнопка «Записать разницу»: создаёт операцию «Доход» ровно на расхождение,
// после чего сигнал уходит сам. Отрицательное расхождение кнопки не получает.
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

  // Ставим расхождение ровно как у пользователя: банк на 3,96 больше расчёта.
  const setup = (delta) => p.evaluate(async (d) => {
    const store = await import('./js/store.js');
    const C = await import('./js/calc.js');
    await store.mutate((draft) => {
      draft.assets.forEach((a) => { a.bankBalance = null; a.goalIds = (a.goalIds || []).slice(0, 1); });
      draft.settings.mutedSignals = [];
      draft.settings.signalsOpen = true;
      const a = draft.assets.find((x) => x.type === 'Деньги') || draft.assets[0];
      a.reconciledAt = '2026-07-20';
      a.bankBalance = C.round2(C.assetValue(a, draft.operations) + d);
      draft.__target = a.id;
    });
    const st = store.getState();
    const a = st.assets.find((x) => x.id === st.__target);
    return { id: a.id, name: a.name, value: C.assetValue(a, st.operations), bank: a.bankBalance };
  }, delta);

  await p.goto(`${URL}#/dashboard`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(600);
  await p.evaluate(async () => (await import('./js/store.js')).loadDemo());
  let t = await setup(3.96);
  console.log(`\nАктив «${t.name}»: расчёт ${t.value}, банк ${t.bank}`);
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(900);

  const opsCount = () => p.evaluate(async () => (await import('./js/store.js')).getState().operations.length);
  const gapSignal = () => p.evaluate(() =>
    [...document.querySelectorAll('.signal')].find((n) => /расхождение/.test(n.textContent)) ? true : false);

  console.log('\n1. Кнопка есть и подписана суммой');
  const signalText = await p.evaluate(() => {
    const n = [...document.querySelectorAll('.signal')].find((x) => /расхождение/.test(x.textContent));
    return n ? n.querySelector('.signal-note').textContent.trim() : null;
  });
  console.log(`     текст сигнала: «${signalText}»`);
  check('в сигнале и на кнопке одно и то же число', /\+3,96 ₽/.test(signalText || ''), signalText);
  const btn = p.locator('.signal-actions .btn');
  check('кнопка на месте', (await btn.count()) === 1, String(await btn.count()));
  const label = await btn.first().textContent();
  console.log(`     подпись: «${label}»`);
  check('в подписи сумма расхождения', /3,96/.test(label), label);
  check('сигнал показан', await gapSignal());

  console.log('\n2. Нажимаем');
  const contributions = () => p.evaluate(async () => {
    const st = (await import('./js/store.js')).getState();
    const list = st.operations.filter((o) => o.type === 'Взнос');
    return { count: list.length, sum: Math.round(list.reduce((s, o) => s + o.amount, 0) * 100) / 100 };
  });
  const contribBefore = await contributions();
  const before = await opsCount();
  await btn.first().tap();
  await p.waitForTimeout(900);
  const after = await opsCount();
  check('операция создана', after === before + 1, `${before} → ${after}`);

  const op = await p.evaluate(async () => {
    const st = (await import('./js/store.js')).getState();
    return st.operations[st.operations.length - 1];
  });
  console.log(`     ${op.type} ${op.amount} ₽, актив ${op.assetId}, источник ${op.source}, «${op.comment}»`);
  check('тип «Доход», а не «Взнос»', op.type === 'Доход', op.type);
  check('сумма равна расхождению', op.amount === 3.96, String(op.amount));
  check('тот же актив', op.assetId === t.id, op.assetId);
  check('дата — сегодня', op.date === new Date().toISOString().slice(0, 10), op.date);

  console.log('\n3. Сигнал уходит сам');
  check('расхождения больше нет', (await gapSignal()) === false);
  const recomputed = await p.evaluate(async (id) => {
    const store = await import('./js/store.js');
    const C = await import('./js/calc.js');
    const st = store.getState();
    const a = st.assets.find((x) => x.id === id);
    return { value: C.round2(C.assetValue(a, st.operations)), bank: a.bankBalance };
  }, t.id);
  console.log(`     расчёт ${recomputed.value}, банк ${recomputed.bank}`);
  check('расчёт сравнялся с банком', recomputed.value === recomputed.bank, `${recomputed.value} vs ${recomputed.bank}`);

  console.log('\n4. Дисциплина не тронута: доход не считается взносом');
  const disc = await p.evaluate(() => {
    const el = [...document.querySelectorAll('.ritual-count')][0];
    return el ? el.textContent.trim() : null;
  });
  console.log(`     календарь дисциплины: ${disc} (было ${contribBefore.count} взносов на ${contribBefore.sum} ₽)`);
  const contribAfter = await contributions();
  check('взносов столько же', contribAfter.count === contribBefore.count, `${contribBefore.count} → ${contribAfter.count}`);
  check('сумма взносов та же', contribAfter.sum === contribBefore.sum, `${contribBefore.sum} → ${contribAfter.sum}`);

  console.log('\n5. Дата сверки не переписана');
  const rec = await p.evaluate(async (id) => {
    const st = (await import('./js/store.js')).getState();
    return st.assets.find((x) => x.id === id).reconciledAt;
  }, t.id);
  console.log(`     дата сверки осталась ${rec}`);
  check('приложение не выдало сверку за сегодняшнюю', rec !== new Date().toISOString().slice(0, 10), rec);

  console.log('\n6. Банк меньше расчёта — кнопки быть не должно');
  await setup(-500);
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  check('сигнал есть', await gapSignal());
  check('кнопки нет', (await p.locator('.signal-actions .btn').count()) === 0);

  await c.close();
  await b.close();
  if (errs.length) { console.log('\nОшибки:'); errs.forEach((e) => console.log('  ' + e)); bad += errs.length; }
  console.log(bad ? `\n${bad} провалов\n` : '\nВсё сходится\n');
  process.exit(bad ? 1 : 0);
})();

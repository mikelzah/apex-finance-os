// Резервная копия: круг «выгрузил — стёр — вернул» не должен терять ничего.
// Это единственная защита от потери телефона, и молчаливая потеря здесь
// обнаружится только тогда, когда восстанавливать будет уже поздно.
const { chromium } = require('playwright');
const URL = 'http://127.0.0.1:8899/app/index.html';

(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'], executablePath: process.env.CHROMIUM_PATH || undefined });
  const p = await (await b.newContext({ viewport: { width: 440, height: 956 }, locale: 'ru-RU' })).newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  let bad = 0;
  const check = (l, ok, d) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? ' — ' + d : ''}`); if (!ok) bad += 1; };

  await p.goto(`${URL}#/dashboard`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(700);

  const r = await p.evaluate(async () => {
    const store = await import('./js/store.js');
    const C = await import('./js/calc.js');
    const D = await import('./js/dates.js');
    await store.loadDemo();
    // Добавляем то, что появилось позже демо: траты, свои категории, правила.
    await store.mutate((d) => {
      d.spending.push({ id: 'sx', date: D.today(), amount: 1234.56, kind: 'Трата',
        category: 'Своя', description: 'Тест', account: 'Банк', key: 'kx', source: 'Вручную' });
      d.settings.categories = { spend: ['Своя', 'Прочее'], income: ['Зарплата', 'Прочий доход'] };
      d.settings.spendRules = [{ word: 'ТЕСТ', category: 'Своя' }];
      d.settings.bankProfiles = { 'Дата;Сумма': { date: 0, amount: 1 } };
      d.settings.mutedSignals = ['x'];
    });

    const before = store.getState();
    const snapshot = {
      assets: before.assets.length,
      operations: before.operations.length,
      goals: before.goals.length,
      spending: before.spending.length,
      netWorth: before.netWorth.length,
      keyRate: before.keyRate.length,
      priceHistory: before.priceHistory.length,
      portfolio: before.portfolio.length,
      worth: C.round2(C.netWorth(before.assets, before.operations).total),
      spendSum: C.round2(before.spending.reduce((s, x) => s + (x.amount || 0), 0)),
      categories: JSON.stringify(before.settings.categories),
      rules: JSON.stringify(before.settings.spendRules),
      profiles: JSON.stringify(before.settings.bankProfiles),
      muted: JSON.stringify(before.settings.mutedSignals),
      quickGoalId: before.settings.quickGoalId || null,
    };

    const text = store.exportText();
    await store.startEmpty();
    const emptied = store.getState().assets.length;

    // Восстановление тем же путём, каким это делает экран копии.
    const restored = await store.importText(text);

    const after = store.getState();
    const now = {
      assets: after.assets.length,
      operations: after.operations.length,
      goals: after.goals.length,
      spending: after.spending.length,
      netWorth: after.netWorth.length,
      keyRate: after.keyRate.length,
      priceHistory: after.priceHistory.length,
      portfolio: after.portfolio.length,
      worth: C.round2(C.netWorth(after.assets, after.operations).total),
      spendSum: C.round2(after.spending.reduce((s, x) => s + (x.amount || 0), 0)),
      categories: JSON.stringify(after.settings.categories),
      rules: JSON.stringify(after.settings.spendRules),
      profiles: JSON.stringify(after.settings.bankProfiles),
      muted: JSON.stringify(after.settings.mutedSignals),
      quickGoalId: after.settings.quickGoalId || null,
    };

    // Мусор вместо копии не должен ни падать, ни стирать то, что есть.
    let junk = null;
    try { junk = await store.importText('{"это": не json'); } catch (e) { junk = e.message; }
    const survived = store.getState().assets.length;

    let empty = null;
    try { empty = await store.importText('{}'); } catch (e) { empty = `исключение: ${e.message}`; }

    return { snapshot, now, emptied, restored, junk, survived, size: text.length, after: store.getState().assets.length };
  });

  console.log('\n1. Стирание действительно стирает');
  check('после startEmpty активов нет', r.emptied === 0, String(r.emptied));

  console.log('\n2. Круг без потерь');
  console.log(`     копия ${(r.size / 1024).toFixed(1)} КБ`);
  for (const key of Object.keys(r.snapshot)) {
    const same = String(r.snapshot[key]) === String(r.now[key]);
    check(key, same, same ? '' : `${r.snapshot[key]} → ${r.now[key]}`);
  }

  console.log('\n3. Мусор вместо копии');
  console.log(`     ответ: ${JSON.stringify(r.junk)} · активов осталось: ${r.survived}`);
  // Бросок здесь правильный: экран копии его ловит и показывает тостом.
  // Проверяем, что сообщение человеческое, а не «Unexpected token».
  check('сообщение по-русски', /повреждён|не копия|не та копия/.test(String(r.junk)), String(r.junk));
  check('данные на месте', r.survived > 0, String(r.survived));

  console.log(`\n  ошибок в консоли: ${errs.length}${errs.length ? ' — ' + errs.slice(0, 3).join(' | ') : ''}`);
  if (errs.length) bad += 1;
  await b.close();
  console.log(bad ? `\n${bad} провалов` : '\nВсё сходится');
  process.exit(bad ? 1 : 0);
})();

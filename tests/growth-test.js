// Взносы против переоценки: вложенное считается точно, снимок пишется сам.
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
  const near = (a, z, eps = 0.02) => Math.abs(a - z) <= eps;

  await p.goto(`${URL}#/dashboard`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(600);
  await p.evaluate(async () => (await import('./js/store.js')).loadDemo());

  console.log('\n1. Снимок за текущий месяц пишется сам при запуске');
  const wiped = await p.evaluate(async () => {
    const store = await import('./js/store.js');
    await store.mutate((d) => { d.netWorth = []; });
    return store.getState().netWorth.length;
  });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  const auto = await p.evaluate(async () => {
    const store = await import('./js/store.js');
    const C = await import('./js/calc.js');
    const s = store.getState();
    return { n: s.netWorth.length, row: s.netWorth[0], live: C.round2(C.netWorth(s.assets, s.operations).total) };
  });
  console.log(`     было ${wiped}, стало ${auto.n}: ${JSON.stringify(auto.row)}`);
  check('снимок появился без нажатий', auto.n === 1, String(auto.n));
  check('в нём сегодняшний капитал', near(auto.row.total, auto.live), `${auto.row.total} vs ${auto.live}`);
  check('за текущий месяц', auto.row.month === new Date().toISOString().slice(0, 7), auto.row.month);

  console.log('\n2. Повторный запуск не плодит строк');
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  const again = await p.evaluate(async () => (await import('./js/store.js')).getState().netWorth.length);
  check('строка по-прежнему одна', again === 1, String(again));

  console.log('\n3. Вложенное — только пришедшее извне');
  const calc = await p.evaluate(async () => {
    const store = await import('./js/store.js');
    const C = await import('./js/calc.js');
    const D = await import('./js/dates.js');
    const s = store.getState();
    const today = D.today();
    const before = C.investedAt(s.assets, s.operations, today);

    // Покупка со своего же счёта: вложенного не прибавляет — деньги переложены.
    await store.mutate((d) => {
      const sber = d.assets.find((a) => a.id === 'demo-sber');
      const cash = d.assets.find((a) => !a.ticker && a.type === 'Деньги');
      store.savePaperOp(d, {
        id: store.newId('op'), date: today, type: C.OP_BUY, quantity: 10, unitPrice: 300,
        fee: null, amount: 3000, assetId: sber.id, ticker: sber.ticker, goalId: null,
        source: 'Вручную', comment: null,
      }, cash.id);
    });
    const s2 = store.getState();
    const afterInternal = C.investedAt(s2.assets, s2.operations, today);

    // Взнос на счёт извне: вложенного прибавляется ровно на сумму.
    await store.mutate((d) => {
      const cash = d.assets.find((a) => !a.ticker && a.type === 'Деньги');
      d.operations.push({
        id: store.newId('op'), date: today, type: 'Взнос', amount: 5000,
        assetId: cash.id, goalId: null, source: 'Вручную', comment: null,
      });
    });
    const s3 = store.getState();
    const afterExternal = C.investedAt(s3.assets, s3.operations, today);

    // Проценты банка вложением не считаются.
    await store.mutate((d) => {
      const cash = d.assets.find((a) => !a.ticker && a.type === 'Деньги');
      d.operations.push({
        id: store.newId('op'), date: today, type: 'Доход', amount: 900,
        assetId: cash.id, goalId: null, source: 'Расчёт', comment: null,
      });
    });
    const s4 = store.getState();
    return {
      before, afterInternal, afterExternal,
      afterIncome: C.investedAt(s4.assets, s4.operations, today),
      total: C.round2(C.netWorth(s4.assets, s4.operations).total),
    };
  });
  console.log(`     было ${calc.before} → покупка со счёта ${calc.afterInternal} → взнос ${calc.afterExternal} → проценты ${calc.afterIncome}`);
  check('внутренняя покупка вложенного не меняет', near(calc.afterInternal, calc.before), `${calc.before} → ${calc.afterInternal}`);
  check('взнос извне прибавляет ровно 5000', near(calc.afterExternal - calc.afterInternal, 5000), String(calc.afterExternal - calc.afterInternal));
  check('проценты вложением не считаются', near(calc.afterIncome, calc.afterExternal), `${calc.afterExternal} → ${calc.afterIncome}`);

  console.log('\n4. Экран показывает разложение');
  // В демо у бумаг начальное количество, и прирост по ним честно не считается.
  // Заменяем его сделками — тогда вход известен и разложение появляется.
  await p.evaluate(async () => {
    const store = await import('./js/store.js');
    const C = await import('./js/calc.js');
    const D = await import('./js/dates.js');
    await store.mutate((d) => {
      for (const a of d.assets) {
        if (!a.ticker || !a.quantity) continue;
        const qty = a.quantity;
        a.quantity = 0;
        store.savePaperOp(d, {
          id: store.newId('op'), date: D.addYears(D.today(), -1), type: C.OP_BUY,
          quantity: qty, unitPrice: a.price, fee: null, amount: qty * a.price,
          assetId: a.id, ticker: a.ticker, goalId: null, source: 'Вручную', comment: null,
        }, null);
      }
    });
  });
  await p.goto(`${URL}#/more/history`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  const screen = await p.evaluate(() => ({
    stats: [...document.querySelectorAll('.stat')].map((s) => ({
      l: s.querySelector('.stat-label').textContent.trim(),
      v: s.querySelector('.stat-value').textContent.trim(),
      hint: s.querySelector('.stat-hint')?.textContent.trim(),
    })),
    keys: [...document.querySelectorAll('.chart-key')].map((x) => x.textContent.trim()),
    band: Boolean(document.querySelector('.chart-band')),
    second: Boolean(document.querySelector('.chart-line-second')),
    rows: [...document.querySelectorAll('.row')].slice(0, 2).map((r) => r.textContent.replace(/\s+/g, ' ').trim()),
  }));
  console.log(`     ${screen.stats.map((x) => `${x.l}: ${x.v}`).join(' | ')}`);
  console.log(`     легенда: ${screen.keys.join(', ')} · полоса: ${screen.band} · вторая линия: ${screen.second}`);
  console.log(`     ${screen.rows.join('  //  ')}`);
  check('капитал показан', screen.stats.some((x) => x.l === 'Капитал'));
  check('вложено своих показано', screen.stats.some((x) => x.l === 'Вложено своих'));
  check('наросло показано', screen.stats.some((x) => /Наросло|Просело/.test(x.l)), screen.stats.map((x) => x.l).join(', '));
  check('процент к вложенному в подписи', screen.stats.some((x) => /к вложенному/.test(x.hint || '')));

  console.log('\n5. График с двумя линиями');
  // Дорисуем снимков за прошлые дни, иначе линия из одной точки.
  await p.evaluate(async () => {
    const store = await import('./js/store.js');
    const D = await import('./js/dates.js');
    await store.mutate((d) => {
      for (const back of [3, 2, 1]) {
        const date = D.addDays(D.today(), -back);
        d.netWorth.push({ month: D.month(date), date, total: 400000 + back * 1000, liquid: 50000, invested: 350000 });
      }
    });
  });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  const chart = await p.evaluate(() => ({
    band: Boolean(document.querySelector('.chart-band')),
    second: Boolean(document.querySelector('.chart-line-second')),
    keys: [...document.querySelectorAll('.chart-key')].map((x) => x.textContent.trim()),
    ticks: [...document.querySelectorAll('.chart-tick')].map((x) => x.textContent.trim()),
  }));
  console.log(`     полоса ${chart.band}, вторая линия ${chart.second}, легенда ${chart.keys.join(' / ')}`);
  check('вторая линия нарисована', chart.second);
  check('полоса между линиями есть', chart.band);
  check('легенда объясняет обе', chart.keys.includes('Капитал') && chart.keys.includes('Вложено'), chart.keys.join(', '));

  // Правило модуля: число, которое нельзя прочитать никак, делает график
  // украшением. Двум линиям таблица нужна даже больше — расстояние между
  // ними на глаз не измеришь.
  const tbl = await p.evaluate(() => {
    const fig = document.querySelector('.figure');
    if (!fig) return null;
    fig.querySelector('.figure-toggle').click();
    const head = [...fig.querySelectorAll('.figure-table th')].map((x) => x.textContent.trim());
    const first = [...fig.querySelectorAll('.figure-table tbody tr')][0];
    return { head, cells: first ? [...first.querySelectorAll('td')].map((x) => x.textContent.trim()) : [] };
  });
  console.log(`     таблица: ${tbl?.head.join(' | ')} → ${tbl?.cells.join(' | ')}`);
  check('таблица есть', Boolean(tbl));
  check('в ней три колонки', tbl.head.length === 3, tbl.head.join(', '));
  check('и обе линии подписаны', tbl.head.includes('Капитал') && tbl.head.includes('Вложено'), tbl.head.join(', '));
  check('строка заполнена целиком', tbl.cells.length === 3 && tbl.cells.every(Boolean), tbl.cells.join(', '));

  console.log(`\n  ошибок в консоли: ${errs.length}${errs.length ? ' — ' + errs.join(' | ') : ''}`);
  if (errs.length) bad += 1;
  await b.close();
  console.log(bad ? `\n${bad} провалов` : '\nВсё сходится');
  process.exit(bad ? 1 : 0);
})();

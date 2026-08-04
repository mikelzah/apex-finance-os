// Скрытие сигналов: скрыть, найти скрытое, вернуть — по одному и все сразу.
//
// Блока сигналов на главной больше нет: сигналы живут в шторке под
// колокольчиком. Складка и память о ней проверялись здесь, пока блок был
// на экране; в шторке сворачивать нечего. Осталось то, ради чего складка
// и была: видно, что сигнал есть, его можно убрать — и убранное можно
// найти. Последнее держится на единственной строке в подвале шторки:
// счётчик скрытое не считает, на экране его нет, и без этой строки
// скрытое становится потерянным.
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

  await p.goto(`${URL}#/dashboard`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(600);
  // Данные с гарантированными сигналами: два актива с несколькими целями
  // (уровень «ошибка») и один с расхождением.
  await p.evaluate(async () => {
    const store = await import('./js/store.js');
    await store.loadDemo();
    await store.mutate((d) => {
      const g = d.goals.map((x) => x.id);
      d.assets[0].goalIds = [g[0], g[1]];
      d.assets[1].goalIds = [g[0], g[1]];
      d.assets[0].bankBalance = 999999;
      d.settings.mutedSignals = [];
    });
  });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(900);

  const muted = () => p.evaluate(async () => (await import('./js/store.js')).getState().settings.mutedSignals);
  const bell = () => p.evaluate(() => Number(document.querySelector('.bell-count')?.textContent || 0));
  const openBell = async () => { await p.tap('.bell'); await p.waitForTimeout(500); };
  // Сигнал — это уведомление с кнопкой «Скрыть сигнал»: в шторке рядом
  // с ними лежат ещё день капитализации и фраза Кубыша.
  const signalRows = () => p.locator('.notice', { has: p.locator('.btn', { hasText: 'Скрыть сигнал' }) });

  console.log('\n1. Сигналы есть — счётчик на колокольчике, сами они в шторке');
  const count = await bell();
  console.log(`     на колокольчике ${count}`);
  check('счётчик показан', count >= 3, String(count));
  await openBell();
  const total = await signalRows().count();
  console.log(`     сигналов в шторке ${total}`);
  check('сигналы в шторке', total >= 3, String(total));
  check('подвала со скрытыми пока нет', (await p.locator('.notice-foot').count()) === 0);

  console.log('\n2. Скрываем один');
  await p.locator('.btn', { hasText: 'Скрыть сигнал' }).first().tap();
  await p.waitForTimeout(800);
  check('скрытие сохранено', (await muted()).length === 1, JSON.stringify(await muted()));
  console.log(`     на колокольчике было ${count}, стало ${await bell()}`);
  check('счётчик убавился', (await bell()) === count - 1, String(await bell()));

  console.log('\n3. Скрытие держится после перезагрузки, и скрытое видно в подвале');
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  await openBell();
  check('сигналов на один меньше', (await signalRows().count()) === total - 1, String(await signalRows().count()));
  const foot = (await p.locator('.notice-foot').textContent() || '').trim();
  console.log(`     подвал: «${foot}»`);
  check('подвал со скрытыми', /Скрытые сигналы: 1/.test(foot), foot);

  console.log('\n4. Возвращаем через список скрытых');
  await p.tap('.notice-foot');
  await p.waitForTimeout(600);
  const sheetRows = await p.locator('.sheet .row').count();
  check('в списке один скрытый', sheetRows === 1, String(sheetRows));
  await p.locator('.sheet .row').first().tap();
  await p.waitForTimeout(800);
  check('скрытых не осталось', (await muted()).length === 0);
  check('счётчик вернулся', (await bell()) === count, String(await bell()));
  await openBell();
  check('сигнал вернулся в шторку', (await signalRows().count()) === total, String(await signalRows().count()));

  console.log('\n5. Изменившийся сигнал возвращается сам');
  await p.locator('.btn', { hasText: 'Скрыть сигнал' }).first().tap();
  await p.waitForTimeout(800);
  const before = (await muted())[0];
  console.log(`     скрыт: ${before.key} — «${before.text}»`);
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  await openBell();
  const wasHiddenRows = await signalRows().count();
  // Меняем расхождение: формулировка станет другой.
  await p.evaluate(async () => {
    const store = await import('./js/store.js');
    await store.mutate((d) => {
      const a = d.assets.find((x) => x.bankBalance != null);
      if (a) a.bankBalance = a.bankBalance + 12345;
    });
  });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  await openBell();
  const after = await signalRows().count();
  console.log(`     сигналов было ${wasHiddenRows}, стало ${after}`);
  if (/расхождение/.test(before.text)) {
    check('расхождение вернулось после изменения', after === wasHiddenRows + 1, String(after));
  } else {
    check('скрыто не расхождение — проверка неприменима', true, `скрыт «${before.text}»`);
  }

  console.log('\n6. Скрыть все — колокольчик гаснет, но скрытое находится');
  await p.evaluate(async () => {
    const store = await import('./js/store.js');
    await store.mutate((d) => { d.settings.mutedSignals = []; });
  });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  await openBell();
  let n = await p.locator('.btn', { hasText: 'Скрыть сигнал' }).count();
  while (n > 0) {
    await p.locator('.btn', { hasText: 'Скрыть сигнал' }).first().tap();
    await p.waitForTimeout(700);
    await openBell();
    n = await p.locator('.btn', { hasText: 'Скрыть сигнал' }).count();
  }
  const hiddenCount = (await muted()).length;
  console.log(`     скрыто ${hiddenCount}, на колокольчике ${await bell()}`);
  check('скрыты все сигналы', hiddenCount >= 3, String(hiddenCount));
  check('подвал со скрытыми на месте', /Скрытые сигналы/.test((await p.locator('.notice-foot').textContent() || '')));
  await p.tap('.notice-foot');
  await p.waitForTimeout(600);
  check('список скрытых открывается', (await p.locator('.sheet .row').count()) === hiddenCount, String(await p.locator('.sheet .row').count()));
  await p.locator('.sheet-foot .btn-primary').tap();
  await p.waitForTimeout(800);
  check('«показать все» вернуло сигналы', (await muted()).length === 0);
  check('счётчик вернулся полностью', (await bell()) >= hiddenCount, String(await bell()));

  await c.close();
  await b.close();
  if (errs.length) { console.log('\nОшибки:'); errs.forEach((e) => console.log('  ' + e)); bad += errs.length; }
  console.log(bad ? `\n${bad} провалов\n` : '\nВсё сходится\n');
  process.exit(bad ? 1 : 0);
})();

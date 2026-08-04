// Скрытие сигналов: скрыть, вернуть и чтобы выбор сохранялся.
//
// Сигналы больше не лежат отдельным блоком на главной — они, вместе с днём
// капитализации и фразой Кубыша, собраны под колокольчиком в шапке. Проверка
// ходит тем же путём, что и человек: жмёт колокольчик и работает в шторке.
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
  await p.waitForTimeout(800);

  const openBell = async () => {
    await p.click('.bell');
    await p.waitForTimeout(500);
  };
  const closeSheet = async () => {
    const foot = p.locator('.sheet-foot .btn');
    if (await foot.count()) { await foot.first().click(); await p.waitForTimeout(400); }
  };
  // Что показано в шторке: сколько уведомлений и что написано на колокольчике.
  const state = async () => {
    const bell = await p.evaluate(() => {
      const el = document.querySelector('.bell-count');
      return { count: el ? Number(el.textContent) : 0, error: Boolean(el && el.classList.contains('is-error')) };
    });
    await openBell();
    const sheet = await p.evaluate(() => ({
      notices: document.querySelectorAll('.sheet .notice').length,
      mutes: [...document.querySelectorAll('.sheet .btn')].filter((x) => /Скрыть сигнал/.test(x.textContent)).length,
      hiddenRow: (() => {
        const r = [...document.querySelectorAll('.sheet .row')].find((x) => /Скрытые сигналы/.test(x.textContent));
        return r ? r.textContent.replace(/\s+/g, ' ').trim() : null;
      })(),
    }));
    return { ...bell, ...sheet };
  };
  const muted = () => p.evaluate(async () => (await import('./js/store.js')).getState().settings.mutedSignals);

  console.log('\n1. Колокольчик со счётчиком, под ним — уведомления');
  let s = await state();
  console.log(`     на колокольчике ${s.count}${s.error ? ' (красный)' : ''}, в шторке ${s.notices}`);
  check('счётчик на колокольчике есть', s.count > 0, String(s.count));
  check('и он красный — среди находок ошибка', s.error);
  check('в шторке столько же, сколько на счётчике', s.notices === s.count, `${s.notices} vs ${s.count}`);
  const total = s.notices;
  check('сигналов несколько', total >= 3, String(total));
  check('у каждого сигнала есть «скрыть»', s.mutes > 0, String(s.mutes));
  check('скрытых пока нет', s.hiddenRow === null, s.hiddenRow);

  console.log('\n2. Скрываем один');
  await p.locator('.sheet .btn:has-text("Скрыть сигнал")').first().click();
  await p.waitForTimeout(700);
  check('скрытие сохранено', (await muted()).length === 1, JSON.stringify(await muted()));
  s = await state();
  console.log(`     на колокольчике ${s.count}, в шторке ${s.notices}, строка «${s.hiddenRow}»`);
  check('уведомлений стало меньше', s.notices === total - 1, `${s.notices} было ${total}`);
  check('появилась строка скрытых', /Скрытые сигналы/.test(s.hiddenRow || ''), s.hiddenRow);
  await closeSheet();

  console.log('\n3. Скрытие держится после перезагрузки');
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  s = await state();
  check('уведомлений столько же', s.notices === total - 1, String(s.notices));

  console.log('\n4. Возвращаем через список скрытых');
  await p.locator('.sheet .row:has-text("Скрытые сигналы")').click();
  await p.waitForTimeout(700);
  const sheetRows = await p.locator('.sheet .row').count();
  check('в списке один скрытый', sheetRows === 1, String(sheetRows));
  await p.locator('.sheet .row').first().click();
  await p.waitForTimeout(700);
  check('скрытых не осталось', (await muted()).length === 0);
  s = await state();
  check('сигнал вернулся', s.notices === total, `${s.notices} vs ${total}`);

  console.log('\n5. Изменившийся сигнал возвращается сам');
  await p.locator('.sheet .btn:has-text("Скрыть сигнал")').first().click();
  await p.waitForTimeout(700);
  const before = (await muted())[0];
  console.log(`     скрыт: ${before.key} — «${before.text}»`);
  const wasHidden = (await state()).notices;
  await closeSheet();
  // Меняем расхождение: формулировка станет другой.
  await p.evaluate(async () => {
    const store = await import('./js/store.js');
    await store.mutate((d) => {
      const a = d.assets.find((x) => x.bankBalance != null);
      if (a) a.bankBalance = a.bankBalance + 12345;
    });
  });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  const after = await state();
  console.log(`     уведомлений было ${wasHidden}, стало ${after.notices}`);
  if (/расхождение/.test(before.text)) {
    check('расхождение вернулось после изменения', after.notices === wasHidden + 1, String(after.notices));
  } else {
    check('скрыто не расхождение — проверка неприменима', true, `скрыт «${before.text}»`);
  }
  await closeSheet();

  console.log('\n6. Скрыть все — колокольчик гаснет');
  await p.evaluate(async () => {
    const store = await import('./js/store.js');
    await store.mutate((d) => { d.settings.mutedSignals = []; });
  });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  await openBell();
  let n = await p.locator('.sheet .btn:has-text("Скрыть сигнал")').count();
  let guard = 0;
  while (n > 0 && guard < 12) {
    await p.locator('.sheet .btn:has-text("Скрыть сигнал")').first().click();
    await p.waitForTimeout(600);
    await openBell();
    n = await p.locator('.sheet .btn:has-text("Скрыть сигнал")').count();
    guard += 1;
  }
  const left = await p.evaluate(() => document.querySelectorAll('.sheet .notice').length);
  const hiddenRow = await p.evaluate(() => {
    const r = [...document.querySelectorAll('.sheet .row')].find((x) => /Скрытые сигналы/.test(x.textContent));
    return r ? r.textContent.replace(/\s+/g, ' ').trim() : null;
  });
  console.log(`     осталось уведомлений ${left}, строка «${hiddenRow}»`);
  check('сигналов в шторке не осталось', left === 0 || !(await p.locator('.sheet .btn:has-text("Скрыть сигнал")').count()),
    String(left));
  // Даже когда показывать нечего, приложение помнит, что молчит по приказу.
  check('строка скрытых на месте', /Скрытые сигналы/.test(hiddenRow || ''), hiddenRow);
  check('и считает их все', (await muted()).length >= 3, JSON.stringify(await muted()).slice(0, 80));

  console.log(`\n  ошибок в консоли: ${errs.length}${errs.length ? ' — ' + errs.join(' | ') : ''}`);
  if (errs.length) bad += 1;
  await b.close();
  console.log(bad ? `\n${bad} провалов` : '\nВсё сходится');
  process.exit(bad ? 1 : 0);
})();

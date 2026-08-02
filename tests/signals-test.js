// Скрытие сигналов: скрыть, вернуть, свернуть блок и чтобы выбор сохранялся.
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
      d.settings.signalsOpen = null;
    });
  });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(800);

  const state = () => p.evaluate(() => {
    const dis = document.querySelector('.disclosure');
    const items = document.querySelector('.signals');
    return {
      label: dis ? dis.querySelector('.disclosure-label').textContent : null,
      hiddenTag: dis && dis.querySelector('.disclosure-hidden') ? dis.querySelector('.disclosure-hidden').textContent : null,
      expanded: dis ? dis.getAttribute('aria-expanded') : null,
      rows: document.querySelectorAll('.signal').length,
      visible: items ? !items.hidden : false,
      foot: document.querySelector('.signals-foot') ? document.querySelector('.signals-foot').textContent.trim() : null,
      // Спокойных строк на экране несколько (проценты, ритуал) — нужна та,
      // что про сигналы.
      quiet: (() => {
        const el = [...document.querySelectorAll('.quiet-line')].find((q) => /сигнал/.test(q.textContent));
        return el ? el.textContent.trim() : null;
      })(),
      muted: null,
    };
  });
  const muted = () => p.evaluate(async () => (await import('./js/store.js')).getState().settings.mutedSignals);

  console.log('\n1. Есть ошибки — блок раскрыт сам');
  let s = await state();
  console.log(`     «${s.label}», раскрыт ${s.expanded}, строк ${s.rows}`);
  check('блок раскрыт', s.expanded === 'true' && s.visible);
  const total = s.rows;
  check('сигналы есть', total >= 3, String(total));
  check('кнопки скрытия у каждого', (await p.locator('.signal-mute').count()) === total);

  console.log('\n2. Скрываем один');
  await p.locator('.signal-mute').first().click();
  await p.waitForTimeout(600);
  s = await state();
  console.log(`     «${s.label}», строк ${s.rows}, ярлык «${s.hiddenTag}», подвал «${s.foot}»`);
  check('сигналов стало меньше', s.rows === total - 1, `${s.rows} было ${total}`);
  check('счётчик в заголовке', /скрыто 1/.test(s.hiddenTag || ''), s.hiddenTag);
  check('подвал со скрытыми', /Скрытые сигналы: 1/.test(s.foot || ''), s.foot);
  check('скрытие сохранено', (await muted()).length === 1, JSON.stringify(await muted()));

  console.log('\n3. Скрытие держится после перезагрузки');
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  s = await state();
  check('строк столько же', s.rows === total - 1, String(s.rows));

  console.log('\n4. Возвращаем через список скрытых');
  await p.click('.signals-foot');
  await p.waitForTimeout(600);
  const sheetRows = await p.locator('.sheet .row').count();
  check('в списке один скрытый', sheetRows === 1, String(sheetRows));
  await p.locator('.sheet .row').first().click();
  await p.waitForTimeout(700);
  s = await state();
  check('сигнал вернулся', s.rows === total, `${s.rows} vs ${total}`);
  check('скрытых не осталось', (await muted()).length === 0);

  console.log('\n5. Изменившийся сигнал возвращается сам');
  await p.locator('.signal-mute').first().click();
  await p.waitForTimeout(600);
  const before = (await muted())[0];
  console.log(`     скрыт: ${before.key} — «${before.text}»`);
  const wasHiddenRows = (await state()).rows;
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
  console.log(`     строк было ${wasHiddenRows}, стало ${after.rows}`);
  if (/расхождение/.test(before.text)) {
    check('расхождение вернулось после изменения', after.rows === wasHiddenRows + 1, `${after.rows}`);
  } else {
    check('скрыто не расхождение — проверка неприменима', true, `скрыт «${before.text}»`);
  }

  console.log('\n6. Свёрнутое состояние держится, несмотря на ошибки');
  await p.evaluate(async () => {
    const store = await import('./js/store.js');
    await store.mutate((d) => { d.settings.mutedSignals = []; d.settings.signalsOpen = null; });
  });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  check('раскрыт по умолчанию (есть ошибки)', (await state()).expanded === 'true');
  await p.click('.disclosure');
  await p.waitForTimeout(500);
  check('свернулся', (await state()).visible === false);
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  s = await state();
  check('остался свёрнутым после перезагрузки', s.visible === false && s.expanded === 'false', `раскрыт ${s.expanded}`);

  console.log('\n7. Скрыть все — блок уходит в спокойную строку');
  await p.click('.disclosure');
  await p.waitForTimeout(400);
  let n = await p.locator('.signal-mute').count();
  while (n > 0) {
    await p.locator('.signal-mute').first().click();
    await p.waitForTimeout(500);
    n = await p.locator('.signal-mute').count();
  }
  s = await state();
  console.log(`     спокойная строка: «${s.quiet}»`);
  check('карточка сигналов ушла', s.label === null);
  check('строка сообщает про скрытые', /скрыто/.test(s.quiet || ''), s.quiet);
  await p.click('.quiet-line .link');
  await p.waitForTimeout(500);
  check('список скрытых открывается', (await p.locator('.sheet .row').count()) > 0);
  await p.locator('.sheet-foot .btn-primary').click();
  await p.waitForTimeout(700);
  check('«показать все» вернуло сигналы', (await state()).rows > 0);

  await c.close();
  await b.close();
  if (errs.length) { console.log('\nОшибки:'); errs.forEach((e) => console.log('  ' + e)); bad += errs.length; }
  console.log(bad ? `\n${bad} провалов\n` : '\nВсё сходится\n');
  process.exit(bad ? 1 : 0);
})();

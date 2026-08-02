// Проверка, что hidden действительно скрывает — по отрисованному, а не по
// атрибуту. Прошлый тест смотрел items.hidden и потому не заметил, что
// на экране ничего не менялось.
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
  // Ровно как у пользователя: один сигнал уровня «предупреждение».
  await p.evaluate(async () => {
    const store = await import('./js/store.js');
    await store.loadDemo();
    await store.mutate((d) => {
      d.assets.forEach((a) => { a.goalIds = (a.goalIds || []).slice(0, 1); a.bankBalance = null; a.reconciledAt = '2026-07-25'; });
      const a = d.assets[0];
      a.bankBalance = 100;
      d.settings.mutedSignals = [];
      d.settings.signalsOpen = null;
    });
  });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(900);

  const shown = (sel) => p.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return { display: cs.display, height: Math.round(r.height), painted: cs.display !== 'none' && r.height > 0 };
  }, sel);

  console.log('\n1. Один сигнал-предупреждение: блок обязан быть свёрнут');
  let s = await shown('.signals');
  console.log(`     .signals display=${s && s.display}, высота ${s && s.height}`);
  check('содержимое не отрисовано', s && s.painted === false, s ? `${s.display}, ${s.height}px` : 'нет узла');
  check('заголовок блока на месте', (await shown('.disclosure')).painted);

  console.log('\n2. Разворачиваем нажатием');
  await p.tap('.disclosure');
  await p.waitForTimeout(400);
  s = await shown('.signals');
  check('содержимое появилось', s.painted, `${s.display}, ${s.height}px`);
  check('плашка сигнала видна', (await shown('.signal')).painted);

  console.log('\n3. Сворачиваем обратно');
  await p.tap('.disclosure');
  await p.waitForTimeout(400);
  s = await shown('.signals');
  check('содержимое снова скрыто', s.painted === false, `${s.display}, ${s.height}px`);

  console.log('\n4. Выбор сохраняется после перезагрузки');
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  s = await shown('.signals');
  check('осталось свёрнутым', s.painted === false, `${s.display}, ${s.height}px`);

  console.log('\n5. Крестик реально скрывает сигнал');
  await p.tap('.disclosure');
  await p.waitForTimeout(400);
  const before = await p.locator('.signal').count();
  await p.tap('.signal-mute');
  await p.waitForTimeout(800);
  const after = await p.locator('.signal').count();
  console.log(`     плашек было ${before}, стало ${after}`);
  check('сигнал скрыт', after === before - 1, `${after} vs ${before - 1}`);
  const muted = await p.evaluate(async () => (await import('./js/store.js')).getState().settings.mutedSignals);
  check('запись о скрытии сохранена', muted.length === 1, JSON.stringify(muted));

  console.log('\n6. Переключатель «График / Таблица»: одно вместо двух');
  // Проверяем отрисованность, а не собственный display: скрывается обёртка
  // .chart-wrap, и у вложенного .chart свой display остаётся block.
  await p.evaluate(async () => {
    const store = await import('./js/store.js');
    await store.mutate((d) => { d.settings.mutedSignals = []; });
  });
  await p.goto(`${URL}#/more/history`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  const fig = () => p.evaluate(() => {
    const f = document.querySelector('.figure');
    const one = (sel) => {
      const el = f.querySelector(sel);
      if (!el) return null;
      return { drawn: el.getClientRects().length > 0, display: getComputedStyle(el).display };
    };
    return {
      chart: one('.chart'),
      wrap: one('.chart-wrap'),
      table: one('.figure-table'),
      label: f.querySelector('.figure-toggle').textContent,
    };
  });
  let f = await fig();
  console.log(`     график отрисован ${f.chart.drawn}, таблица ${f.table.drawn}, кнопка «${f.label}»`);
  check('виден график', f.chart.drawn && !f.table.drawn);
  await p.tap('.figure-toggle');
  await p.waitForTimeout(500);
  f = await fig();
  console.log(`     после нажатия: график ${f.chart.drawn}, обёртка display ${f.wrap.display}, таблица ${f.table.drawn}, кнопка «${f.label}»`);
  check('график не отрисован', !f.chart.drawn);
  check('обёртка скрыта через display: none', f.wrap.display === 'none', f.wrap.display);
  check('таблица отрисована', f.table.drawn);
  check('подпись кнопки сменилась', f.label === 'График', f.label);
  await p.tap('.figure-toggle');
  await p.waitForTimeout(500);
  f = await fig();
  check('возврат к графику', f.chart.drawn && !f.table.drawn, `график ${f.chart.drawn}, таблица ${f.table.drawn}`);

  console.log('\n7. Экран первого запуска: таб-бара быть не должно');
  await p.evaluate(async () => (await import('./js/store.js')).wipe());
  await p.evaluate(async () => {
    const store = await import('./js/store.js');
    await store.mutate((d) => { d.meta.onboarded = false; });
  });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  const bar = await shown('.tabbar');
  console.log(`     таб-бар ${bar && bar.display}`);
  check('таб-бар не отрисован', bar && bar.painted === false, bar ? bar.display : 'нет узла');

  await c.close();
  await b.close();
  if (errs.length) { console.log('\nОшибки:'); errs.forEach((e) => console.log('  ' + e)); bad += errs.length; }
  console.log(bad ? `\n${bad} провалов\n` : '\nВсё сходится\n');
  process.exit(bad ? 1 : 0);
})();

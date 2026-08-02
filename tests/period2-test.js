// Период отсекает и список, заголовки месяцев целиком, перерисовка тихая.
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
  await p.evaluate(async () => {
    const store = await import('./js/store.js');
    const D = await import('./js/dates.js');
    await store.startEmpty();
    await store.mutate((d) => {
      d.assets = [{ id: 'sav', name: 'Счёт', type: 'Деньги', status: 'Активен', liquidity: 'Мгновенная',
        assetClass: 'Вклады', rate: 8, opening: 0, openingDate: D.addDays(D.today(), -500), goalIds: [] }];
      const y = D.parts(D.today()).y;
      const add = (date, amount) => d.operations.push({ id: store.newId('op'), date, type: 'Взнос',
        amount, assetId: 'sav', goalId: null, source: 'Вручную', comment: null });
      add(D.iso(y - 1, 5, 10), 1000);      // прошлый год
      add(D.iso(y, 3, 10), 2000);          // этот год, прошлый месяц
      add(D.monthStart(D.today()), 3000);  // текущий месяц
    });
  });
  await p.goto(`${URL}#/journal`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(900);

  const months = () => p.evaluate(() => [...document.querySelectorAll('.month-head h2')].map((x) => x.textContent.trim()));

  console.log('\n1. Заголовки месяцев целиком');
  const all = await months();
  console.log(`     ${all.join(' | ')}`);
  check('месяц словом и год четырьмя цифрами', all.every((x) => /^[А-Я][а-я]+ \d{4}$/.test(x)), all.join(', '));
  check('не «авг 26»', all.every((x) => !/\b\d{2}$/.test(x)), all.join(', '));

  console.log('\n2. «Всё время» показывает все три месяца');
  check('три группы', all.length === 3, String(all.length));

  console.log('\n3. «Год» отсекает прошлогоднее');
  await p.locator('.segment:has-text("Год")').click();
  await p.waitForTimeout(600);
  const year = await months();
  console.log(`     ${year.join(' | ')}`);
  check('две группы', year.length === 2, year.join(', '));
  const lastYear = String(new Date().getFullYear() - 1);
  check('прошлого года нет', year.every((x) => !x.includes(lastYear)), year.join(', '));

  console.log('\n4. «Месяц» оставляет только текущий');
  await p.locator('.segment:has-text("Месяц")').click();
  await p.waitForTimeout(600);
  const month = await months();
  const ops = await p.evaluate(() => [...document.querySelectorAll('.op-amount')].map((x) => x.textContent.trim()));
  console.log(`     ${month.join(' | ')} · записи: ${ops.join(', ')}`);
  check('одна группа', month.length === 1, month.join(', '));
  check('и одна запись', ops.length === 1, ops.join(', '));
  check('именно текущего месяца', /3\s?000/.test(ops[0].replace(/ /g, ' ')), ops[0]);

  console.log('\n5. То же в таблице');
  await p.locator('.segment:has-text("Таблица")').click();
  await p.waitForTimeout(600);
  const tableRows = await p.evaluate(() => document.querySelectorAll('.dt tbody tr').length);
  console.log(`     строк в таблице: ${tableRows}`);
  check('таблица тоже отсечена', tableRows === 1, String(tableRows));
  await p.locator('.segment:has-text("Список")').click();
  await p.waitForTimeout(500);

  console.log('\n6. Перерисовка того же экрана — без анимации появления');
  const quiet = await p.evaluate(() => {
    const s = document.getElementById('screen');
    return { cls: s.className, anim: getComputedStyle(s.firstElementChild).animationName };
  });
  console.log(`     класс экрана: ${quiet.cls} · анимация: ${quiet.anim}`);
  check('экран помечен как перерисованный', /is-quiet/.test(quiet.cls), quiet.cls);
  check('анимации появления нет', quiet.anim === 'none', quiet.anim);

  console.log('\n7. Переход на другой экран анимацию возвращает');
  // Не портфель: журнал теперь его часть, и это один и тот же экран.
  await p.goto(`${URL}#/goals`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  const moved = await p.evaluate(() => {
    const s = document.getElementById('screen');
    return { cls: s.className, anim: getComputedStyle(s.firstElementChild).animationName };
  });
  console.log(`     класс экрана: ${moved.cls} · анимация: ${moved.anim}`);
  check('метка снята', !/is-quiet/.test(moved.cls), moved.cls);
  check('анимация вернулась', moved.anim === 'enter', moved.anim);

  console.log('\n8. Положение прокрутки при смене периода не теряется');
  // Нужен длинный список в обоих периодах, иначе прокрутки просто нет
  // и проверка мерила бы пустоту: короткий экран всегда стоит на нуле.
  await p.evaluate(async () => {
    const store = await import('./js/store.js');
    const D = await import('./js/dates.js');
    await store.mutate((d) => {
      for (let i = 0; i < 40; i += 1) {
        d.operations.push({ id: store.newId('op'), date: D.addDays(D.monthStart(D.today()), i % 28),
          type: 'Взнос', amount: 100 + i, assetId: 'sav', goalId: null, source: 'Вручную', comment: null });
      }
    });
  });
  await p.goto(`${URL}#/journal`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  await p.locator('.segment:has-text("Всё время")').click();
  await p.waitForTimeout(500);
  await p.evaluate(() => { document.getElementById('screen').scrollTop = 200; });
  await p.waitForTimeout(200);
  const scrolled = await p.evaluate(() => document.getElementById('screen').scrollTop);
  check('прокрутка вообще случилась', scrolled >= 200, String(scrolled));
  // Клик через locator тут не годится: playwright сам подкручивает элемент
  // в видимую область перед нажатием, а переключатель стоит у самого верха —
  // прокрутка обнулялась бы ещё до того, как отработает код приложения.
  // Это свойство стенда, а не приложения, поэтому нажимаем напрямую.
  await p.evaluate(() => [...document.querySelectorAll('.segment')].find((x) => x.textContent === 'Год').click());
  await p.waitForTimeout(600);
  const kept = await p.evaluate(() => document.getElementById('screen').scrollTop);
  console.log(`     прокрутка после переключения: ${kept}`);
  check('экран не прыгнул наверх', kept > 0, String(kept));

  console.log(`\n  ошибок в консоли: ${errs.length}${errs.length ? ' — ' + errs.join(' | ') : ''}`);
  if (errs.length) bad += 1;
  await b.close();
  console.log(bad ? `\n${bad} провалов` : '\nВсё сходится');
  process.exit(bad ? 1 : 0);
})();

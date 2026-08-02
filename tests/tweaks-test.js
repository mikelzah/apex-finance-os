// Правки по семи пунктам: перетаскивание целей, убранные подписи и разделы,
// занавес обновления, «Мой капитал».
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
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(800);

  console.log('\n1. «Мой капитал» вместо «Чистый капитал»');
  const label = await p.evaluate(() => document.querySelector('.hero-label')?.textContent.trim());
  console.log(`     ${label}`);
  check('заголовок переименован', label === 'Мой капитал', label);

  console.log('\n2. Подписи убраны');
  await p.goto(`${URL}#/goals`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  const goalsText = await p.evaluate(() => document.getElementById('screen').textContent);
  check('нет «Активы не привязаны»', !/Активы не привязаны/.test(goalsText));
  check('нет «Привязка задаётся в карточке»', !/Привязка задаётся в карточке актива/.test(goalsText));

  await p.goto(`${URL}#/portfolio`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  const pfText = await p.evaluate(() => document.getElementById('screen').textContent);
  check('нет «с заданным классом»', !/с заданным классом/.test(pfText));
  check('сумма портфеля осталась', /Портфель/.test(pfText) && Boolean(await p.evaluate(() => document.querySelector('.hero-value')?.textContent)));

  console.log('\n3. Настройки: убрано лишнее, оставлено нужное');
  await p.goto(`${URL}#/more/settings`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  const set = await p.evaluate(() => {
    const s = document.getElementById('screen');
    return {
      text: s.textContent,
      buttons: [...s.querySelectorAll('.btn')].map((x) => x.textContent.trim()),
      rows: [...s.querySelectorAll('.row-label span')].map((x) => x.textContent.trim()),
    };
  });
  console.log(`     строки: ${set.rows.join(' · ')}`);
  console.log(`     кнопки: ${set.buttons.join(' · ')}`);
  check('нет блока «Заменить данные»', !/Заменить данные/.test(set.text));
  check('нет «Загрузить демо-данные»', !set.buttons.includes('Загрузить демо-данные'), set.buttons.join(', '));
  check('нет «Стереть всё»', !set.buttons.includes('Стереть всё'), set.buttons.join(', '));
  check('нет «Диагностика экрана»', !/Диагностика экрана/.test(set.text));
  check('нет «Вьюпорт по экранам»', !/Вьюпорт по экранам/.test(set.text));
  check('строка «Сборка» осталась', set.rows.includes('Сборка'), set.rows.join(', '));
  check('кнопка «Обновить приложение» осталась', set.buttons.includes('Обновить приложение'), set.buttons.join(', '));

  console.log('\n4. Занавес обновления');
  // location.reload в Chromium не подменяется — присваивание молча
  // не действует. Поэтому ловим саму перезагрузку по событию загрузки кадра,
  // а не по флагу, который она же и сотрёт.
  let reloadedAt = null;
  const clickedAt = Date.now();
  p.once('load', () => { reloadedAt = Date.now() - clickedAt; });
  await p.locator('.btn:has-text("Обновить приложение")').click();
  await p.waitForTimeout(350);
  const curtain = await p.evaluate(() => {
    const n = document.querySelector('.curtain');
    if (!n) return null;
    const r = n.getBoundingClientRect();
    const app = document.getElementById('app').getBoundingClientRect();
    const one = n.querySelector('.curtain-one');
    return {
      w: Math.round(r.width), h: Math.round(r.height),
      appW: Math.round(app.width), appH: Math.round(app.height),
      z: Number(getComputedStyle(n).zIndex),
      tabZ: Number(getComputedStyle(document.getElementById('tabbar')).zIndex),
      crowd: n.querySelectorAll('.curtain-one').length,
      text: n.querySelector('.curtain-text')?.textContent.trim(),
      anim: one ? getComputedStyle(one).animationName : null,
      delays: [...n.querySelectorAll('.curtain-one')].map((x) => getComputedStyle(x).animationDelay),
    };
  });
  console.log(`     ${curtain.w}×${curtain.h} при экране ${curtain.appW}×${curtain.appH}, z ${curtain.z} против ${curtain.tabZ} у навигации`);
  console.log(`     зверей ${curtain.crowd}, «${curtain.text}», анимация ${curtain.anim}, задержки ${curtain.delays.join(', ')}`);
  check('занавес на весь экран', curtain.w === curtain.appW && curtain.h === curtain.appH, `${curtain.w}×${curtain.h}`);
  check('поверх навигации', curtain.z > curtain.tabZ, `${curtain.z} vs ${curtain.tabZ}`);
  check('зверей несколько', curtain.crowd >= 3, String(curtain.crowd));
  check('они прыгают', curtain.anim === 'curtain-hop', curtain.anim);
  check('вразнобой', new Set(curtain.delays).size > 1, curtain.delays.join(', '));
  check('перезагрузка ещё не случилась', reloadedAt === null, `через ${reloadedAt} мс`);
  await p.waitForTimeout(1600);
  console.log(`     перезагрузка через ${reloadedAt} мс после нажатия`);
  check('перезагрузка случилась', reloadedAt !== null, String(reloadedAt));
  // Занавес живёт 1400 мс. Раньше — покажется огрызок анимации.
  check('не раньше, чем анимация доиграла', reloadedAt >= 1300, `${reloadedAt} мс`);

  console.log('\n5. Порядок целей: перетаскивание');
  await p.goto(`${URL}#/goals`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  const names = () => p.evaluate(() => [...document.querySelectorAll('.goal-name')].map((n) => n.textContent.trim()));
  const before = await names();
  console.log(`     было: ${before.join(' · ')}`);
  check('целей больше одной', before.length > 1, String(before.length));

  const box = await p.evaluate(() => {
    const heads = [...document.querySelectorAll('.goal-head')];
    const a = heads[0].getBoundingClientRect();
    const b = heads[2] ? heads[2].getBoundingClientRect() : heads[1].getBoundingClientRect();
    return { fromX: a.left + a.width / 2, fromY: a.top + a.height / 2, toY: b.top + b.height / 2 };
  });

  // Жест целиком: нажали, подержали, повели, отпустили.
  await p.mouse.move(box.fromX, box.fromY);
  await p.mouse.down();
  await p.waitForTimeout(420);
  const gripped = await p.evaluate(() => Boolean(document.querySelector('.card.is-dragging')));
  check('после удержания карточка «в руке»', gripped);
  for (let i = 1; i <= 12; i += 1) {
    await p.mouse.move(box.fromX, box.fromY + ((box.toY - box.fromY) * i) / 12);
    await p.waitForTimeout(16);
  }
  const shifted = await p.evaluate(() => {
    const cards = [...document.querySelectorAll('.card')];
    return cards.map((x) => x.style.transform).filter(Boolean).length;
  });
  check('соседи расступились', shifted >= 2, String(shifted));
  await p.mouse.up();
  await p.waitForTimeout(900);

  const after = await names();
  console.log(`     стало: ${after.join(' · ')}`);
  check('порядок изменился', after.join() !== before.join(), after.join(' · '));
  check('первая уехала вниз', after.indexOf(before[0]) > 0, `${before[0]} теперь ${after.indexOf(before[0])}`);
  check('ни одна цель не потерялась', after.length === before.length && before.every((n) => after.includes(n)));

  console.log('\n6. Порядок переживает перезагрузку');
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  const reloaded = await names();
  console.log(`     после перезагрузки: ${reloaded.join(' · ')}`);
  check('порядок сохранился', reloaded.join() === after.join(), reloaded.join(' · '));

  console.log('\n7. Нажатие по шапке по-прежнему открывает цель');
  await p.locator('.goal-head').first().click();
  await p.waitForTimeout(600);
  const sheet = await p.evaluate(() => document.querySelector('.sheet-head h2')?.textContent.trim() || null);
  console.log(`     открылось: ${sheet}`);
  check('форма цели открылась', Boolean(sheet) && sheet === reloaded[0], `${sheet} vs ${reloaded[0]}`);
  await p.locator('.sheet-close').click();
  await p.waitForTimeout(400);

  console.log('\n8. Протяжка по шапке без удержания — это прокрутка, а не перенос');
  const wasOrder = await names();
  const start = await p.evaluate(() => {
    const r = document.querySelector('.goal-head').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await p.mouse.move(start.x, start.y);
  await p.mouse.down();
  for (let i = 1; i <= 8; i += 1) { await p.mouse.move(start.x, start.y - i * 25); await p.waitForTimeout(12); }
  await p.mouse.up();
  await p.waitForTimeout(600);
  const stillOrder = await names();
  check('порядок не тронут', stillOrder.join() === wasOrder.join(), stillOrder.join(' · '));

  console.log(`\n  ошибок в консоли: ${errs.length}${errs.length ? ' — ' + errs.join(' | ') : ''}`);
  if (errs.length) bad += 1;
  await b.close();
  console.log(bad ? `\n${bad} провалов` : '\nВсё сходится');
  process.exit(bad ? 1 : 0);
})();

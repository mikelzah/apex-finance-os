// Замок: экран во весь экран, повторная попытка, выключение, и предупреждение
// о том, чего он не делает.
const { chromium } = require('playwright');
const URL = 'http://127.0.0.1:8899/app/index.html';
(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'], executablePath: process.env.CHROMIUM_PATH || undefined });
  const c = await b.newContext({ viewport: { width: 440, height: 956 }, isMobile: true, hasTouch: true, locale: 'ru-RU' });
  const p = await c.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  let bad = 0;
  const check = (l, ok, d) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? ' — ' + d : ''}`); if (!ok) bad += 1; };

  await p.goto(`${URL}#/dashboard`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(600);
  await p.evaluate(async () => (await import('./js/store.js')).loadDemo());

  console.log('\n1. Предупреждение при включении говорит правду');
  await p.goto(`${URL}#/more/settings`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  const hasRow = await p.locator('.row:has-text("Вход по Face ID")').count();
  console.log(`     строка настройки: ${hasRow ? 'есть' : 'нет'}`);
  if (hasRow) {
    await p.locator('.row:has-text("Вход по Face ID")').click();
    await p.waitForTimeout(600);
    const warn = await p.evaluate(() => document.querySelector('.sheet-text')?.textContent.trim() || null);
    console.log(`     ${warn}`);
    check('сказано, что обойти нельзя', /обойти это нельзя/i.test(warn || ''), warn);
    check('сказано про потерянный ключ', /войти будет нечем/i.test(warn || ''));
    check('сказано, что данные не шифруются', /не шифруются/i.test(warn || ''));
    check('сказано сделать копию', /копию/i.test(warn || ''));
    await p.locator('.sheet-foot .btn').first().click();
    await p.waitForTimeout(400);
  }

  console.log('\n2. Замок закрывает экран целиком');
  await p.evaluate(() => localStorage.setItem('apex-finance-os:lock', 'ZmFrZQ=='));
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  const lock = await p.evaluate(() => {
    const n = document.querySelector('.lock');
    if (!n) return null;
    const r = n.getBoundingClientRect();
    const app = document.getElementById('app').getBoundingClientRect();
    return {
      w: Math.round(r.width), h: Math.round(r.height),
      appW: Math.round(app.width), appH: Math.round(app.height),
      z: Number(getComputedStyle(n).zIndex),
      title: n.querySelector('.lock-title')?.textContent.trim(),
      mascot: Boolean(n.querySelector('.mascot-body')),
      note: n.querySelector('.lock-note')?.textContent.trim(),
      button: n.querySelector('.btn')?.textContent.trim(),
    };
  });
  console.log(`     ${lock.w}×${lock.h} при экране ${lock.appW}×${lock.appH}, z ${lock.z}`);
  console.log(`     «${lock.title}» · кнопка «${lock.button}» · ${lock.note}`);
  check('во весь экран', lock.w === lock.appW && lock.h === lock.appH, `${lock.w}×${lock.h}`);
  check('поверх всего', lock.z >= 300, String(lock.z));
  check('назван по имени', lock.title === 'Кубыш', lock.title);
  check('с Кубышем', lock.mascot);
  check('есть кнопка повтора', lock.button === 'Войти', lock.button);
  check('объяснено, почему не пустили', Boolean(lock.note), lock.note);

  console.log('\n3. Выключение снимает замок');
  await p.evaluate(() => localStorage.removeItem('apex-finance-os:lock'));
  // Именно перезагрузка: переход по хешу документ не перезагружает,
  // и уже нарисованный замок остался бы на экране — что, кстати, и правильно,
  // выхода из него нет по устройству.
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  await p.evaluate(() => { location.hash = '#/dashboard'; });
  await p.waitForTimeout(700);
  const gone = await p.evaluate(() => ({
    lock: Boolean(document.querySelector('.lock')),
    hero: document.querySelector('.hero-value')?.textContent.trim(),
  }));
  console.log(`     замок ${gone.lock}, капитал ${gone.hero}`);
  check('замка нет', !gone.lock);
  check('приложение работает', Boolean(gone.hero), gone.hero);

  console.log(`\n  ошибок в консоли: ${errs.length}${errs.length ? ' — ' + errs.join(' | ') : ''}`);
  if (errs.length) bad += 1;
  await b.close();
  console.log(bad ? `\n${bad} провалов` : '\nВсё сходится');
  process.exit(bad ? 1 : 0);
})();

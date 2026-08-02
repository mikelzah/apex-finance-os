// Шторка с полем ввода не должна прятаться под клавиатуру.
//
// Настоящую клавиатуру в Chromium не вызвать, поэтому подменяется
// visualViewport — ровно тот источник, по которому приложение её и меряет.
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
    await store.startEmpty();
  });
  await p.goto(`${URL}#/more/categories`, { waitUntil: 'networkidle' });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(800);

  // Клавиатура: видимая область укорачивается снизу, разметка не меняется.
  // Настоящий visualViewport запоминается один раз: удалить и вернуть его
  // нельзя — в Chromium это собственное свойство окна, и delete стирает его
  // насовсем. Поэтому подмена всегда считается от сохранённого.
  const keyboard = (height) => p.evaluate(async (h) => {
    const V = await import('./js/viewport.js');
    if (!window.__vv) window.__vv = window.visualViewport;
    const real = window.__vv;
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: h
        ? { width: real.width, height: real.height - h, offsetTop: 0, scale: 1,
            addEventListener() {}, removeEventListener() {} }
        : real,
    });
    V.applyKeyboard();
    return getComputedStyle(document.documentElement).getPropertyValue('--keyboard-inset').trim();
  }, height);

  const box = () => p.evaluate(() => {
    const panel = document.querySelector('.sheet-panel').getBoundingClientRect();
    const app = document.getElementById('app').getBoundingClientRect();
    const input = document.querySelector('.sheet-body input[type=text]')?.getBoundingClientRect();
    const save = document.querySelector('.sheet-foot .btn-primary')?.getBoundingClientRect();
    return {
      appBottom: Math.round(app.bottom),
      top: Math.round(panel.top), bottom: Math.round(panel.bottom),
      input: input ? Math.round(input.bottom) : null,
      save: save ? Math.round(save.bottom) : null,
    };
  });

  console.log('\n1. Без клавиатуры шторка стоит у низа');
  await p.locator('.row:has-text("Продукты")').first().click();
  await p.waitForTimeout(600);
  let g = await box();
  console.log(`     панель ${g.top}–${g.bottom}, низ оболочки ${g.appBottom}`);
  check('низ панели — низ оболочки', g.bottom === g.appBottom, `${g.bottom} vs ${g.appBottom}`);
  check('поле ввода на месте', g.input != null, String(g.input));

  console.log('\n2. Клавиатура 336 — панель поднимается ровно на неё');
  let inset = await keyboard(336);
  await p.waitForTimeout(300);
  g = await box();
  console.log(`     поправка ${inset}, панель ${g.top}–${g.bottom}, кнопка до ${g.save}`);
  check('поправка 336px', inset === '336px', inset);
  check('низ панели над клавиатурой', g.bottom === g.appBottom - 336, `${g.bottom} vs ${g.appBottom - 336}`);
  check('верх панели не ушёл за край', g.top >= 0, String(g.top));
  check('поле ввода видно', g.input <= g.appBottom - 336, `${g.input} vs ${g.appBottom - 336}`);
  check('кнопка «Сохранить» видна', g.save <= g.appBottom - 336, `${g.save} vs ${g.appBottom - 336}`);

  console.log('\n3. Панель браузера в 60 пикселей клавиатурой не считается');
  inset = await keyboard(60);
  await p.waitForTimeout(200);
  g = await box();
  console.log(`     поправка ${inset}, панель ${g.top}–${g.bottom}`);
  check('поправки нет', inset === '0px', inset);
  check('панель у низа', g.bottom === g.appBottom, `${g.bottom} vs ${g.appBottom}`);

  console.log('\n4. Клавиатура убралась — всё вернулось');
  await keyboard(700);
  await p.waitForTimeout(200);
  inset = await keyboard(0);
  await p.waitForTimeout(300);
  g = await box();
  console.log(`     поправка ${inset}, панель ${g.top}–${g.bottom}`);
  check('поправка ноль', inset === '0px', inset);
  check('панель снова у низа', g.bottom === g.appBottom, `${g.bottom} vs ${g.appBottom}`);

  console.log('\n5. Высокая клавиатура: панель ужимается, а не вылезает');
  inset = await keyboard(620);
  await p.waitForTimeout(300);
  g = await box();
  console.log(`     поправка ${inset}, панель ${g.top}–${g.bottom} при оболочке ${g.appBottom}`);
  check('поправка 620px', inset === '620px', inset);
  check('верх панели на экране', g.top >= 0, String(g.top));
  check('панель не выше 92% свободного', g.bottom - g.top <= Math.round((g.appBottom - 620) * 0.92) + 1,
    `${g.bottom - g.top} vs ${Math.round((g.appBottom - 620) * 0.92)}`);
  await keyboard(0);

  console.log('\n6. Правка всё ещё работает');
  await p.locator('.sheet-body input[type=text]').fill('Еда домой');
  await p.locator('.sheet-foot .btn-primary').click();
  await p.waitForTimeout(700);
  const names = await p.evaluate(() =>
    [...document.querySelectorAll('.row-label span')].map((x) => x.textContent.trim()));
  check('переименовалось', names.includes('Еда домой'), names.slice(0, 4).join(', '));

  console.log(`\n  ошибок в консоли: ${errs.length}${errs.length ? ' — ' + errs.join(' | ') : ''}`);
  if (errs.length) bad += 1;
  await b.close();
  console.log(bad ? `\n${bad} провалов` : '\nВсё сходится');
  process.exit(bad ? 1 : 0);
})();

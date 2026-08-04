// Навигация обязана стоять на низу экрана при любом вьюпорте и не двигаться
// при прокрутке.
const { chromium } = require('playwright');
const URL = 'http://127.0.0.1:8899/app/index.html';

(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'], executablePath: process.env.CHROMIUM_PATH || undefined });
  let bad = 0;
  const check = (l, ok, d) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? ' — ' + d : ''}`); if (!ok) bad += 1; };

  // Вьюпорт нарочно много меньше экрана — как на устройстве (611 при 956).
  const c = await b.newContext({ viewport: { width: 440, height: 611 }, isMobile: true, hasTouch: true, locale: 'ru-RU', colorScheme: 'light' });
  const p = await c.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.addInitScript(`
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
    Object.defineProperty(window.screen, 'height', { get: () => 956, configurable: true });
    Object.defineProperty(window.screen, 'width', { get: () => 440, configurable: true });
  `);

  await p.goto(`${URL}#/dashboard`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  await p.evaluate(async () => (await import('./js/store.js')).loadDemo());
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(900);

  const geom = () => p.evaluate(() => {
    const app = document.getElementById('app').getBoundingClientRect();
    const bar = document.querySelector('.tabbar').getBoundingClientRect();
    const sc = document.getElementById('screen');
    return {
      appH: Math.round(app.height),
      barBottom: Math.round(bar.bottom), barTop: Math.round(bar.top),
      full: getComputedStyle(document.documentElement).getPropertyValue('--full-height').trim(),
      docScroll: document.documentElement.scrollHeight - document.documentElement.clientHeight,
      screenScroll: sc.scrollHeight - sc.clientHeight,
      screenTop: sc.scrollTop,
      fixedCount: [...document.querySelectorAll('*')].filter((n) => getComputedStyle(n).position === 'fixed').length,
    };
  });

  console.log('\n1. Оболочка в экран, а не во вьюпорт');
  let g = await geom();
  console.log(`     --full-height ${g.full}, высота оболочки ${g.appH}, панель ${g.barTop}–${g.barBottom}`);
  check('оболочка ростом с экран', g.appH === 956, String(g.appH));
  check('низ панели у нижнего края экрана', g.barBottom >= 900 && g.barBottom <= 956, String(g.barBottom));
  check('элементов с position: fixed нет', g.fixedCount === 0, String(g.fixedCount));

  // Главная помещается в экран целиком и не прокручивается вовсе — это
  // её свойство по замыслу, а не случайность. Проверять на ней прокрутку
  // содержимого нельзя: ноль сойдётся сам собой и ничего не докажет.
  // Уходим на «Настройки» — единственный экран, длина которого не зависит
  // от того, сколько у человека целей и бумаг.
  await p.evaluate(() => { location.hash = '#/more'; });
  await p.waitForTimeout(600);

  console.log('\n2. Прокручивается содержимое, а не страница');
  g = await geom();
  // Переполнение у документа есть — оболочка выше вьюпорта. Важно не это,
  // а то, что прокрутить его нельзя: overflow: hidden запрещает прокрутку,
  // а не убирает переполнение.
  // overflow: hidden отменяет жест, но не программную прокрутку. Проверяем,
  // что страховка возвращает документ на место — именно это и произойдёт,
  // когда браузер сам поедет за полем ввода.
  const docMoved = await p.evaluate(() => new Promise((resolve) => {
    window.scrollTo(0, 500);
    document.documentElement.scrollTop = 500;
    setTimeout(() => resolve({
      win: window.scrollY,
      html: document.documentElement.scrollTop,
      body: document.body.scrollTop,
    }), 120);
  }));
  console.log(`     после попытки прокрутить документ: window ${docMoved.win}, html ${docMoved.html}, body ${docMoved.body}`);
  check('документ прокрутить нельзя', docMoved.win === 0 && docMoved.html === 0 && docMoved.body === 0,
    JSON.stringify(docMoved));
  check('содержимое прокручивается', g.screenScroll > 0, String(g.screenScroll));

  console.log('\n3. Панель не двигается при прокрутке');
  const before = (await geom()).barBottom;
  // Прокручиваем до упора, а не на выбранное число пикселей. Проверяется
  // здесь то, что панель стоит на месте, а не сколько именно уехало
  // содержимое, — и жёсткие 400 привязывали проверку к росту главного
  // экрана. Стоило ему стать короче, как проверка падала, ничего
  // при этом не найдя.
  const want = await p.evaluate(() => {
    const s = document.getElementById('screen');
    const max = s.scrollHeight - s.clientHeight;
    s.scrollTop = max;
    return max;
  });
  await p.waitForTimeout(300);
  g = await geom();
  console.log(`     прокрутили на ${g.screenTop} из ${want}, панель ${g.barTop}–${g.barBottom}`);
  check('содержимое уехало', want > 0 && g.screenTop === want, `${g.screenTop} из ${want}`);
  check('панель на месте', g.barBottom === before, `${g.barBottom} было ${before}`);

  console.log('\n3а. Главная не прокручивается вовсе');
  await p.evaluate(() => { location.hash = '#/dashboard'; });
  await p.waitForTimeout(700);
  const home = await geom();
  console.log(`     главная: содержимое ${home.screenScroll} px за краем`);
  check('главная помещается в экран', home.screenScroll === 0, `${home.screenScroll} px`);

  console.log('\n4. Положение прокрутки живёт по правилам');
  await p.evaluate(() => { location.hash = '#/goals'; });
  await p.waitForTimeout(400);
  check('переход на другой экран — сверху', (await geom()).screenTop === 0, String((await geom()).screenTop));

  // Панель перестала быть стеклом. Раньше здесь проверялось обратное:
  // полупрозрачный фон, размытие и радиус капсулы. Размытие под движущимся
  // содержимым держало композитор в работе всё время, пока приложение
  // открыто, и стоило оно дороже всего остального вместе взятого.
  console.log('\n5. Панель сплошная, без размытия, во всю ширину');
  const bar = await p.evaluate(() => {
    const el = document.querySelector('.tabbar');
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      bg: cs.backgroundColor,
      blur: cs.backdropFilter || cs.webkitBackdropFilter || 'none',
      radius: cs.borderRadius,
      left: Math.round(r.left),
      width: Math.round(r.width),
      appWidth: Math.round(document.getElementById('app').getBoundingClientRect().width),
      tabs: el.querySelectorAll('.tab').length,
      fabs: el.querySelectorAll('.fab').length,
    };
  });
  console.log(`     фон ${bar.bg}, размытие ${bar.blur}, радиус ${bar.radius}, ширина ${bar.width} при ${bar.appWidth}`);
  console.log(`     вкладок ${bar.tabs}, кнопок записи ${bar.fabs}`);
  check('фон непрозрачный', !/rgba\(.*0\.\d+\)/.test(bar.bg), bar.bg);
  check('размытия нет', !/blur/.test(bar.blur), bar.blur);
  check('прямоугольник, а не капсула', parseFloat(bar.radius) === 0, bar.radius);
  check('во всю ширину экрана', bar.left === 0 && bar.width === bar.appWidth, `${bar.left}+${bar.width}`);
  // Разделов пятеро: раздел на каждый разрез, без промежуточного уровня.
  // Группа «Деньги» не убирала выбор, а переносила его на шаг вглубь.
  // Кнопка записи из панели ушла вместе с четвёртой колонкой — при пяти
  // разделах места под неё нет, и операция записывается круглым действием
  // на главной.
  check('разделов пятеро', bar.tabs === 5, String(bar.tabs));
  check('кнопки записи в панели нет', bar.fabs === 0, String(bar.fabs));

  console.log('\n6. Содержимое проходит под панелью');
  const under = await p.evaluate(() => {
    const bar = document.querySelector('.tabbar').getBoundingClientRect();
    const sc = document.getElementById('screen').getBoundingClientRect();
    return { barTop: Math.round(bar.top), screenBottom: Math.round(sc.bottom) };
  });
  console.log(`     низ прокручиваемой области ${under.screenBottom}, верх панели ${under.barTop}`);
  check('область прокрутки уходит под панель', under.screenBottom > under.barTop,
    `${under.screenBottom} vs ${under.barTop}`);

  await c.close();
  await b.close();
  if (errs.length) { console.log('\nОшибки:'); errs.forEach((e) => console.log('  ' + e)); bad += errs.length; }
  console.log(bad ? `\n${bad} провалов\n` : '\nВсё сходится\n');
  process.exit(bad ? 1 : 0);
})();

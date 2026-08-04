// Сверка приложения с макетом.
//
// Договорённость простая: макет — это описание того, как приложение должно
// выглядеть, а не картинка «в целом про это». Держалась она до сих пор
// на памяти того, кто писал код, и не выдержала: заголовки экранов пропали,
// круглые действия стали пилюлями, кегли уехали на ступень вверх, и главная
// перестала помещаться в экран. Заметили это через месяц и глазами.
//
// ЧТО ИМЕННО СВЕРЯЕТСЯ. Не пиксели. Попиксельное сравнение здесь невозможно
// в принципе: в макете выдуманные числа и выдуманные названия, в приложении —
// демо-данные, и совпасть они не могут ни при каком допуске. Сверяется то,
// что от данных не зависит и что как раз и разъехалось: размеры и положение
// опорных узлов, кегли, начертания, регистр, форма и краска действий.
//
// КАК СРАВНИВАЮТСЯ РАЗМЕРЫ. Рамка макета приводится к настоящему телефону:
// 393×852 логических пикселя вместо 375×800, которые нарисованы в стенде.
// После этого оба экрана живут в одной системе координат, и числа можно
// сравнивать прямо, без пересчёта долей — а доли врут: полпроцента ширины
// это два пикселя на телефоне и восемь на планшете.
//
// Снимки обоих экранов кладутся в tests/.out/design/ — когда проверка падает,
// смотреть надо на них, а не на числа.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const APP = 'http://127.0.0.1:8899/app/index.html';
const MOCK = 'http://127.0.0.1:8899/design/preview.html';
const OUT = path.join(__dirname, '.out', 'design');

// Настоящий телефон, а не рамка из стенда: 393×852 — iPhone 15/16
// в логических пикселях.
const W = 393;
const H = 852;

// Допуски. Не «на глаз помягче»: три пикселя — это разница, которую
// не видно рядом, а четыре ступени кегля видно всем.
const GEOM = 4;   // px по размеру и положению
const TYPE = 1;   // px по кеглю

/**
 * Опорные узлы. Слева — макет, справа — приложение.
 *
 * Список нарочно короткий и держится на том, что уже ломалось: заголовок
 * экрана, форма действия, кегли, регистр ярлыков, плотность строки, высота
 * панели. Сверять всё подряд значит завести проверку, которая падает
 * на каждой правке и которую через месяц отключат.
 */
const LANDMARKS = {
  dashboard: {
    mock: '#pd',
    items: [
      { name: 'шапка: имя приложения', m: '.d-top b', a: '.top-title', type: ['fontSize', 'fontWeight'] },
      { name: 'шапка: колокольчик', m: '.d-bell', a: '.bell', geom: ['width', 'height'] },
      // Высота главной плитки здесь не сверяется, и это не поблажка.
      // Её задаёт строка под числом: в макете там выдуманное «+15 000 ₽
      // сегодня», в приложении — настоящая фраза, которая в день без записей
      // звучит иначе и занимает другое число строк. Сверять её высоту значит
      // сверять длину фразы. Что плитка вместе с остальными помещается
      // в экран, проверяется ниже — и это как раз то, ради чего её размеры
      // и выбирались.
      { name: 'плитка капитала', m: '.d-hero', a: '.card-hero', geom: ['width'], type: ['borderRadius'] },
      { name: 'ярлык «Мой капитал»', m: '.d-hero .d-k', a: '.hero-label', type: ['fontSize', 'caps', 'fontWeight'] },
      { name: 'сумма капитала', m: '.d-hero-v', a: '.hero-value', type: ['fontSize', 'fontWeight'] },
      { name: 'период кривой', m: '.d-hero .d-k u', a: '.hero-period', type: ['fontSize', 'caps'] },
      { name: 'плашка «Доступно»', m: '.d-split div', a: '.hero-split > div', geom: ['height'], type: ['borderRadius'] },
      { name: 'ярлык плашки', m: '.d-split span', a: '.hero-split-label', type: ['fontSize', 'caps', 'fontWeight'] },
      { name: 'ряд круглых действий', m: '.d-acts', a: '.acts-round', geom: ['height'] },
      { name: 'кружок действия', m: '.d-act i', a: '.act-round-icon', geom: ['width', 'height'] },
      { name: 'подпись действия', m: '.d-act span', a: '.act-round-label', type: ['fontSize'] },
      // Высота пары задаётся содержимым — кольцом цели и числом подушки, —
      // и на демо-данных подписи под ними короче выдуманных в макете.
      // Допуск здесь шире: сверяется порядок величины плитки, а не то,
      // сколько знаков в конкретном числе.
      { name: 'пара плиток', m: '.d-goalbox', a: '.card-goals', geom: ['width', 'height'], tol: 8 },
      { name: 'ярлык плитки', m: '.d-pair:not(.d-goalbox) .d-k', a: '.card-tile-btn .tile-label', type: ['fontSize', 'caps', 'fontWeight'] },
      { name: 'число плитки', m: '.d-v', a: '.tile-value', type: ['fontSize', 'fontWeight'] },
      { name: 'панель разделов', m: '.nav', a: '.tabbar', geom: ['height'] },
      { name: 'подпись вкладки', m: '.nav b', a: '.tab-label', type: ['fontSize'] },
    ],
  },
  goals: {
    mock: '#pg',
    items: [
      { name: 'заголовок экрана', m: '.d-head h1', a: '.screen-title', text: 'Цели', type: ['fontSize', 'fontWeight'] },
      { name: 'круглое действие шапки', m: '.d-add', a: '.head-round', geom: ['width', 'height'], type: ['borderRadius', 'backgroundColor'] },
      { name: 'карточка цели', m: '.d-goalcard', a: '.card-goal', geom: ['width'], type: ['borderRadius'] },
      { name: 'имя цели', m: '.d-gh-t b', a: '.goal-name', type: ['fontSize', 'fontWeight'] },
      { name: 'сумма цели', m: '.d-money-t b', a: '.goal-current', type: ['fontSize', 'fontWeight'] },
      { name: 'ярлык метрики', m: '.d-metrics span', a: '.metric-label', type: ['fontSize', 'caps', 'fontWeight'] },
    ],
  },
  portfolio: {
    mock: '#pp',
    items: [
      { name: 'заголовок экрана', m: '.d-head h1', a: '.screen-title', text: 'Деньги', type: ['fontSize', 'fontWeight'] },
      { name: 'круглое действие шапки', m: '.d-add', a: '.head-round', geom: ['width', 'height'], type: ['borderRadius', 'backgroundColor'] },
      { name: 'переключатель разрезов', m: '.d-seg', a: '.segmented-wide', geom: ['height'] },
      { name: 'значок бумаги', m: '.d-logo', a: '.paper-logo, .paper-mono', geom: ['width', 'height'] },
    ],
  },
  spending: {
    mock: '#pt',
    items: [
      { name: 'заголовок экрана', m: '.d-head h1', a: '.screen-title', text: 'Траты', type: ['fontSize', 'fontWeight'] },
      { name: 'круглое действие шапки', m: '.d-add', a: '.head-round', geom: ['width', 'height'], type: ['borderRadius', 'backgroundColor'] },
      { name: 'ярлык числа', m: '.d-trio3 span', a: '.stat-label', type: ['fontSize', 'caps', 'fontWeight'] },
    ],
  },
  more: {
    mock: '#ps',
    items: [
      { name: 'заголовок экрана', m: '.d-head h1', a: '.screen-title', text: 'Настройки', type: ['fontSize', 'fontWeight'] },
      { name: 'ярлык группы', m: '.d-k', a: '.caption', type: ['fontSize', 'caps', 'fontWeight'] },
      { name: 'строка списка', m: '.d-line', a: '.row', geom: ['height'] },
      { name: 'подпись строки', m: '.d-line p', a: '.row-label span', type: ['fontSize'] },
      { name: 'пояснение под подписью', m: '.d-line p span', a: '.row-label small', type: ['fontSize'] },
      { name: 'переключатель', m: '.d-sw', a: '.switch', geom: ['width', 'height'] },
    ],
  },
};

let bad = 0;
const check = (label, ok, detail) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) bad += 1;
};

/**
 * Приводим рамку стенда к настоящему телефону.
 *
 * В стенде экран нарисован 375×800 — это рамка вокруг него съедает ширину,
 * а высота взята с запасом «чтобы влезло на страницу». Настоящий экран
 * 393×852, и сравнивать кегли между двумя разными ширинами нельзя:
 * разница в восемнадцать пикселей ширины сдвинет перенос строки и высоту
 * половины узлов. Поэтому стенд разворачивается в настоящий размер, и дальше
 * оба экрана меряются в одних и тех же единицах.
 */
const FRAME_CSS = `
  body { padding: 0 !important; background: #fff !important; }
  .rail { display: block !important; overflow: visible !important; }
  figure { width: ${W}px !important; }
  figcaption, .bar, .legend, h1, .lede { display: none !important; }
  .phone { width: ${W}px !important; height: ${H}px !important; padding: 0 !important;
           border-radius: 0 !important; box-shadow: none !important; }
  .screenwrap { border-radius: 0 !important; }
  .island { display: none !important; }
`;

async function measure(page, root, items, side) {
  return page.evaluate(({ rootSel, list, which }) => {
    const scope = rootSel ? document.querySelector(rootSel) : document;
    const out = {};
    for (const it of list) {
      const sel = which === 'm' ? it.m : it.a;
      const el = scope ? scope.querySelector(sel) : null;
      if (!el) { out[it.name] = null; continue; }
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      out[it.name] = {
        width: r.width, height: r.height,
        fontSize: parseFloat(cs.fontSize),
        fontWeight: String(cs.fontWeight),
        textTransform: cs.textTransform,
        letterSpacing: cs.letterSpacing,
        borderRadius: parseFloat(cs.borderTopLeftRadius),
        backgroundColor: cs.backgroundColor,
        text: el.textContent.trim(),
        // Прописные бывают двух происхождений: набраны прописными в разметке
        // (так в макете) или подняты стилем (так в приложении). На экране
        // это одно и то же, и сравнивать надо увиденное, а не способ.
        caps: cs.textTransform === 'uppercase'
          || (/\p{L}/u.test(el.textContent) && el.textContent === el.textContent.toUpperCase()),
      };
    }
    return out;
  }, { rootSel: root, list: items.map((i) => ({ name: i.name, m: i.m, a: i.a })), which: side });
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ['--no-sandbox'], executablePath: process.env.CHROMIUM_PATH || undefined });

  // ---- Макет -------------------------------------------------------------
  const mockCtx = await browser.newContext({
    viewport: { width: W + 40, height: H + 40 }, deviceScaleFactor: 2, locale: 'ru-RU',
  });
  const mockPage = await mockCtx.newPage();
  await mockPage.goto(MOCK, { waitUntil: 'networkidle' });
  await mockPage.addStyleTag({ content: FRAME_CSS });
  await mockPage.waitForTimeout(400);

  const mock = {};
  for (const [screen, spec] of Object.entries(LANDMARKS)) {
    mock[screen] = await measure(mockPage, spec.mock, spec.items, 'm');
    const frame = await mockPage.$(`${spec.mock}`);
    if (frame) await frame.screenshot({ path: path.join(OUT, `${screen}-макет.png`) });
  }
  await mockCtx.close();

  // ---- Приложение --------------------------------------------------------
  const appCtx = await browser.newContext({
    viewport: { width: W, height: H }, deviceScaleFactor: 2,
    isMobile: true, hasTouch: true, locale: 'ru-RU', colorScheme: 'dark',
  });
  const appPage = await appCtx.newPage();
  const errs = [];
  appPage.on('pageerror', (e) => errs.push(String(e)));

  await appPage.goto(`${APP}#/dashboard`, { waitUntil: 'networkidle' });
  await appPage.waitForTimeout(600);
  await appPage.evaluate(async () => {
    // Зверёк висит на Dynamic Island. Острова в браузере нет, и он висит
    // просто поверх шапки — в макете этого нет и быть не может. Гасим его
    // на время сверки: сравнивается оформление, а не наличие острова.
    localStorage.setItem('apex-finance-os:mascot', 'off');
    const store = await import('./js/store.js');
    await store.loadDemo();
  });
  await appPage.reload({ waitUntil: 'networkidle' });
  await appPage.waitForTimeout(900);

  const app = {};
  const extra = {};
  for (const [screen, spec] of Object.entries(LANDMARKS)) {
    await appPage.evaluate((s) => { location.hash = `#/${s}`; }, screen);
    await appPage.waitForTimeout(900);
    app[screen] = await measure(appPage, null, spec.items, 'a');
    extra[screen] = await appPage.evaluate(() => {
      const sc = document.getElementById('screen');
      return { overflow: sc.scrollHeight - sc.clientHeight };
    });
    await appPage.screenshot({ path: path.join(OUT, `${screen}-приложение.png`) });
  }
  await appCtx.close();
  await browser.close();

  // ---- Сверка ------------------------------------------------------------
  for (const [screen, spec] of Object.entries(LANDMARKS)) {
    console.log(`\nЭкран «${screen}»`);
    for (const it of spec.items) {
      const m = mock[screen][it.name];
      const a = app[screen][it.name];

      if (!m) { check(it.name, false, `в макете нет узла ${it.m}`); continue; }
      if (!a) { check(it.name, false, `в приложении нет узла ${it.a} — узел из макета не построен`); continue; }

      if (it.text) {
        const ok = a.text === it.text;
        check(`${it.name}: подпись`, ok, ok ? `«${a.text}»` : `«${a.text}» вместо «${it.text}»`);
      }
      const tol = it.tol || GEOM;
      for (const prop of it.geom || []) {
        const d = Math.abs(m[prop] - a[prop]);
        check(`${it.name}: ${prop}`, d <= tol,
          `макет ${Math.round(m[prop])}, приложение ${Math.round(a[prop])} (расхождение ${Math.round(d)} px)`);
      }
      for (const prop of it.type || []) {
        if (prop === 'fontSize' || prop === 'borderRadius') {
          const d = Math.abs(m[prop] - a[prop]);
          check(`${it.name}: ${prop}`, d <= TYPE,
            `макет ${m[prop]}, приложение ${a[prop]}`);
        } else {
          check(`${it.name}: ${prop}`, m[prop] === a[prop],
            `макет ${m[prop]}, приложение ${a[prop]}`);
        }
      }
    }
  }

  // Главное свойство главной: она помещается в экран целиком. Это не следствие
  // размеров плиток, а причина, по которой они такие, — и потому проверяется
  // отдельно от них.
  console.log('\nГлавная помещается в экран');
  check('за нижним краем ничего нет', extra.dashboard.overflow === 0, `${extra.dashboard.overflow} px за краем`);

  if (errs.length) { bad += 1; console.log(`\nОшибки на странице: ${errs.join(' | ')}`); }

  console.log(`\nСнимки для сравнения: tests/.out/design/`);
  console.log(bad ? `\n${bad} расхождений с макетом` : '\nПриложение совпадает с макетом');
  process.exit(bad ? 1 : 0);
})();

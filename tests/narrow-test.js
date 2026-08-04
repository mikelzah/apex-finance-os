// Узкий экран: шапка раздела не разъезжается, а действие не наезжает
// на заголовок и не выталкивает его за край.
//
// Прежде здесь проверялись две кнопки внизу портфеля — им полагалось
// сложиться в столбец, а не наехать друг на друга. Главная из них переехала
// в круглое действие шапки, и жалоба «налезают» переехала вместе с ней:
// теперь рискуют разъехаться заголовок и круг, и именно на узком экране,
// где длинному слову не хватает ширины.
const { chromium } = require('playwright');
const URL = 'http://127.0.0.1:8899/app/index.html';

const SCREENS = [
  ['goals', 'Цели'],
  ['portfolio', 'Деньги'],
  ['spending', 'Траты'],
  ['more', 'Настройки'],
];

(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'], executablePath: process.env.CHROMIUM_PATH || undefined });
  let bad = 0;
  const check = (l, ok, d) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? ' — ' + d : ''}`); if (!ok) bad += 1; };

  for (const width of [320, 375, 440]) {
    const c = await b.newContext({ viewport: { width, height: 800 }, isMobile: true, hasTouch: true, locale: 'ru-RU' });
    const p = await c.newPage();
    await p.goto(`${URL}#/dashboard`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(500);
    await p.evaluate(async () => (await import('./js/store.js')).loadDemo());
    console.log(`\n  ширина ${width}`);

    for (const [screen, title] of SCREENS) {
      await p.goto(`${URL}#/${screen}`, { waitUntil: 'networkidle' });
      await p.waitForTimeout(600);
      const r = await p.evaluate(() => {
        const head = document.querySelector('.screen-head');
        if (!head) return null;
        const box = (el) => {
          if (!el) return null;
          const q = el.getBoundingClientRect();
          return { l: Math.round(q.left), r: Math.round(q.right), t: Math.round(q.top), b: Math.round(q.bottom) };
        };
        const h1 = head.querySelector('.screen-title');
        const act = head.querySelector('.head-round');
        return {
          title: h1 ? h1.textContent.trim() : null,
          h1: box(h1), act: box(act), head: box(head),
          // Заголовок не обрезан: содержимое строки шире её самой означает
          // «Настройки» с отрезанным хвостом.
          clipped: h1 ? h1.scrollWidth > h1.clientWidth + 1 : false,
          screenW: document.getElementById('screen').clientWidth,
        };
      });

      check(`${screen}: шапка есть`, Boolean(r), null);
      if (!r) continue;
      check(`${screen}: заголовок «${title}»`, r.title === title, r.title);
      check(`${screen}: заголовок не обрезан`, !r.clipped, null);
      check(`${screen}: заголовок внутри экрана`, r.h1.r <= r.screenW + 1, `${r.h1.r} из ${r.screenW}`);

      if (r.act) {
        const ov = Math.max(0, Math.min(r.h1.r, r.act.r) - Math.max(r.h1.l, r.act.l))
          * Math.max(0, Math.min(r.h1.b, r.act.b) - Math.max(r.h1.t, r.act.t));
        check(`${screen}: действие не налезает на заголовок`, ov === 0, `${ov} px²`);
        check(`${screen}: действие внутри экрана`, r.act.r <= r.screenW + 1, `${r.act.r} из ${r.screenW}`);

        // Сорок четыре пикселя на палец — минимум, ниже которого кнопка
        // перестаёт быть кнопкой, как бы аккуратно она ни выглядела.
        //
        // Меряется не размер круга, а то, куда попадает палец: круг нарисован
        // в тридцать четыре — рядом заголовок экрана, и круг в сорок четыре
        // начинает с ним спорить, — а ловит на сорока четырёх невидимой
        // накладкой вокруг себя. Размер узла об этом ничего не знает,
        // и проверять надо тычком, а не рулеткой.
        const reach = await p.evaluate(() => {
          const act = document.querySelector('.screen-head .head-round');
          const q = act.getBoundingClientRect();
          const cx = q.left + q.width / 2;
          const cy = q.top + q.height / 2;
          const R = 21; // половина сорока четырёх минус пиксель на округление
          const hits = (x, y) => {
            const el = document.elementFromPoint(x, y);
            return Boolean(el && (el === act || act.contains(el)));
          };
          return {
            left: hits(cx - R, cy), right: hits(cx + R, cy),
            top: hits(cx, cy - R), bottom: hits(cx, cy + R),
          };
        });
        const missed = Object.entries(reach).filter(([, ok]) => !ok).map(([k]) => k);
        check(`${screen}: в действие можно попасть пальцем`, missed.length === 0,
          missed.length ? `мимо с краёв: ${missed.join(', ')}` : '44×44');
      }
    }
    await c.close();
  }

  await b.close();
  console.log(bad ? `\n${bad} провалов` : '\nВсё сходится');
  process.exit(bad ? 1 : 0);
})();

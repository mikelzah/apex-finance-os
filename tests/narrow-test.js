// Узкий экран: две кнопки обязаны сложиться в столбец, а не наехать друг
// на друга и не ужаться до нечитаемого.
const { chromium } = require('playwright');
const URL = 'http://127.0.0.1:8899/app/index.html';
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
    await p.goto(`${URL}#/portfolio`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(700);
    const r = await p.evaluate(() => {
      const row = document.querySelector('.act-row');
      const btns = [...row.querySelectorAll('.btn')].map((x) => {
        const q = x.getBoundingClientRect();
        return { t: x.textContent.trim(), l: Math.round(q.left), r: Math.round(q.right), tp: Math.round(q.top), bt: Math.round(q.bottom), sw: x.scrollWidth, cw: x.clientWidth };
      });
      return btns;
    });
    const [a, z] = r;
    const ov = Math.max(0, Math.min(a.r, z.r) - Math.max(a.l, z.l)) * Math.max(0, Math.min(a.bt, z.bt) - Math.max(a.tp, z.tp));
    const sameRow = a.tp === z.tp;
    console.log(`\n  ширина ${width}: ${sameRow ? 'в строку' : 'в столбец'} — ${r.map((x) => `«${x.t}» ${x.l}–${x.r}`).join(', ')}`);
    check(`${width}: наложения нет`, ov === 0, `${ov} px²`);
    check(`${width}: текст не обрезан`, r.every((x) => x.sw <= x.cw + 1), r.map((x) => `${x.sw}/${x.cw}`).join(' '));
    await c.close();
  }
  await b.close();
  console.log(bad ? `\n${bad} провалов` : '\nВсё сходится');
  process.exit(bad ? 1 : 0);
})();

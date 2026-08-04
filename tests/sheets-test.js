// Открыть на демо-данных всё, что открывается, и посмотреть, не сыплется ли.
//
// Разрушающее не трогаем: удаление, стирание, сброс и восстановление из файла
// проверяются отдельно и осознанно, вслепую их нажимать нельзя.
const { chromium } = require('playwright');
const URL = 'http://127.0.0.1:8899/app/index.html';

const ROUTES = [
  'dashboard', 'goals', 'portfolio', 'spending', 'more',
  'more/assets', 'more/tax', 'more/history', 'more/health',
  'more/keyrate', 'more/settings', 'more/backup', 'more/categories',
];

// Разрушающее не трогаем, а заодно и то, что лезет в сеть: Мосбиржа
// из проверок недоступна, и её отказ — не поломка приложения.
//
// «Обновить приложение» здесь же, и не из осторожности: оно стирает кэш кода
// и перезагружает страницу — с задержкой на анимацию, то есть уже посреди
// следующего экрана. Свип при этом падает с «execution context destroyed»,
// и падение выглядит поломкой того экрана, до которого он успел дойти.
const FORBIDDEN = /удал|стере|сброс|очист|восстанов|загрузить копию|выйти|отвязать|котировк|обновить приложение/i;

(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'], executablePath: process.env.CHROMIUM_PATH || undefined });
  const c = await b.newContext({ viewport: { width: 440, height: 956 }, isMobile: true, hasTouch: true, locale: 'ru-RU' });
  const p = await c.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(`pageerror: ${e}`));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  let bad = 0;
  let opened = 0;

  await p.goto(`${URL}#/dashboard`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  await p.evaluate(async () => {
    const store = await import('./js/store.js');
    await store.loadDemo();
  });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(900);

  for (const route of ROUTES) {
    await p.evaluate((r) => { location.hash = `#/${r}`; }, route);
    await p.waitForTimeout(500);

    const targets = await p.evaluate(() => {
      const list = [...document.querySelectorAll('#screen .row[onclick], #screen .btn, #screen .goal-head, #screen .op-row, #screen .cat-op, #screen .spend-op, #screen .dt tbody tr')];
      return list.map((el, i) => ({ i, text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40) }));
    });

    for (const t of targets) {
      if (FORBIDDEN.test(t.text)) continue;
      const before = errs.length;
      // Клик по индексу: список пересобирается после каждой перерисовки.
      const clicked = await p.evaluate((i) => {
        const list = [...document.querySelectorAll('#screen .row[onclick], #screen .btn, #screen .goal-head, #screen .op-row, #screen .cat-op, #screen .spend-op, #screen .dt tbody tr')];
        const el = list[i];
        if (!el) return false;
        el.click();
        return true;
      }, t.i);
      if (!clicked) continue;
      await p.waitForTimeout(350);

      const state = await p.evaluate(() => {
        const sheet = document.querySelector('.sheet-panel');
        const text = (sheet ? sheet.innerText : document.getElementById('screen').innerText);
        return {
          sheet: Boolean(sheet),
          hits: (text.match(/NaN|Infinity|undefined|\[object/g) || []).slice(0, 2),
          where: location.hash,
        };
      });
      if (state.sheet) opened += 1;
      if (state.hits.length || errs.length > before) {
        console.log(`  FAIL ${route} → «${t.text}» — ${state.hits.join(', ') || errs.slice(before).join(' | ')}`);
        bad += 1;
      }

      // Возвращаемся туда, откуда пришли: часть нажатий — это переходы.
      await p.evaluate(() => {
        const close = document.querySelector('.sheet-close');
        if (close) close.click();
      });
      await p.waitForTimeout(200);
      if (state.where !== `#/${route}`) {
        await p.evaluate((r) => { location.hash = `#/${r}`; }, route);
        await p.waitForTimeout(400);
      }
    }
    console.log(`  ok   ${route} — нажато ${targets.length}`);
  }

  console.log(`\n  шторок открылось: ${opened}`);
  console.log(`  ошибок в консоли: ${errs.length}${errs.length ? '\n   • ' + [...new Set(errs)].slice(0, 8).join('\n   • ') : ''}`);
  if (errs.length) bad += 1;
  await b.close();
  console.log(bad ? `\n${bad} провалов` : '\nВсё сходится');
  process.exit(bad ? 1 : 0);
})();

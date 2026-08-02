// Проверка, что обновление доезжает. Раньше — не доезжало: стратегия «сначала
// кэш» показывала свежий код только к следующему запуску, а установка могла
// сложить в новый кэш файлы из старого HTTP-кэша.
//
// Сценарий: собираем сборку, открываем, ждём service worker; меняем исходник,
// собираем заново, перезагружаем — новый код обязан появиться сразу.
const { chromium } = require('playwright');
const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');
const FIX = path.join(__dirname, 'fixtures');
const ROOT = path.join(__dirname, '..');
const PAGES = path.join(__dirname, '.pages');
const URL = 'http://127.0.0.1:8900/apex-finance-os/';

const rebuild = () => {
  execSync(`cd ${ROOT} && ./scripts/build-pages.sh >/dev/null 2>&1`);
  execSync(`rm -rf ${PAGES}/apex-finance-os && cp -r ${ROOT}/deploy ${PAGES}/apex-finance-os`);
  return fs.readFileSync(`${PAGES}/apex-finance-os/js/build.js`, 'utf8').match(/BUILD = '([^']+)'/)[1];
};

(async () => {
  let bad = 0;
  const check = (l, ok, d) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? ' — ' + d : ''}`); if (!ok) bad += 1; };

  const first = rebuild();
  console.log(`\nПервая сборка: ${first}`);

  const b = await chromium.launch({ args: ['--no-sandbox'], executablePath: process.env.CHROMIUM_PATH || undefined });
  const c = await b.newContext({ viewport: { width: 440, height: 956 }, isMobile: true, hasTouch: true, locale: 'ru-RU' });
  const p = await c.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));

  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  await p.evaluate(async () => (await import('./js/store.js')).loadDemo());
  await p.goto(`${URL}#/more/settings`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(900);

  const shown = () => p.evaluate(() => {
    const row = [...document.querySelectorAll('.row')].find((r) => /Сборка/.test(r.textContent));
    return row ? row.querySelector('.row-value span').textContent.trim() : null;
  });
  check('метка первой сборки видна', (await shown()) === first, `${await shown()} vs ${first}`);

  const ready = await p.evaluate(() => navigator.serviceWorker.ready.then((r) => Boolean(r.active)));
  check('service worker активен', ready);

  // Ждём минуту: метка — время с точностью до минуты, иначе она не изменится.
  console.log('\nЖдём смены минуты, чтобы метка отличалась…');
  await p.waitForTimeout(62000);
  const second = rebuild();
  console.log(`Вторая сборка: ${second}`);
  check('сборки различаются', second !== first, `${first} → ${second}`);

  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);
  await p.goto(`${URL}#/more/settings`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  const after = await shown();
  check('новая сборка доехала с первой перезагрузки', after === second, `${after} vs ${second}`);

  console.log('\nОфлайн после обновления');
  await c.setOffline(true);
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2500);
  const alive = await p.evaluate(() => Boolean(document.querySelector('.tabbar')));
  check('приложение открывается без сети', alive);
  const offlineBuild = await p.evaluate(() => {
    const row = [...document.querySelectorAll('.row')].find((r) => /Сборка/.test(r.textContent));
    return row ? row.querySelector('.row-value span').textContent.trim() : null;
  });
  console.log(`     офлайн показывает сборку ${offlineBuild}`);
  await c.setOffline(false);

  await b.close();
  if (errs.length) { console.log('\nОшибки:'); errs.forEach((e) => console.log('  ' + e)); bad += errs.length; }
  console.log(bad ? `\n${bad} провалов\n` : '\nВсё сходится\n');
  process.exit(bad ? 1 : 0);
})();

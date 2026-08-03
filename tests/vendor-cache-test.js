// Распознаватель весит пять с половиной мегабайт. Он обязан пережить
// обновление приложения и работать без сети — иначе каждая выкладка
// стоила бы человеку этих мегабайт заново, причём молча.
const { chromium } = require('playwright');
const fs = require('fs');
const { execSync } = require('child_process');

/**
 * Команда оболочки. Оболочка задаётся явно: без неё Node на Windows зовёт
 * cmd.exe, а там нет ни ./scripts/build-pages.sh, ни rm -rf, ни >/dev/null,
 * и проверка падала на сборке, ничего при этом не проверив.
 */
const sh = (cmd, cwd) => execSync(cmd, {
  cwd,
  shell: process.platform === 'win32' ? 'bash.exe' : '/bin/sh',
});

/** Путь через косые черты: обратные внутри команды bash съедаются
 *  как экранирование, и «C:\app\…» превращается в «C:app…». */
const posix = (v) => String(v).replace(/\\/g, '/');
const path = require('path');
const FIX = path.join(__dirname, 'fixtures');
const ROOT = path.join(__dirname, '..');
const DIR = FIX;
const PAGES = path.join(__dirname, '.pages');
const URL = 'http://127.0.0.1:8900/apex-finance-os/';

// Метка сборки — время с точностью до минуты, и две сборки подряд получают
// одну и ту же. Тогда имя кэша не меняется, и проверка «пережил обновление»
// не проверяет ничего. Поэтому метку второй сборки задаём сами.
const rebuild = (stamp = null) => {
  sh('./scripts/build-pages.sh >/dev/null 2>&1', ROOT);
  sh(`rm -rf "${posix(PAGES)}/apex-finance-os" && cp -r deploy "${posix(PAGES)}/apex-finance-os"`, ROOT);
  if (stamp) {
    const sw = `${PAGES}/apex-finance-os/sw.js`;
    const build = `${PAGES}/apex-finance-os/js/build.js`;
    fs.writeFileSync(sw, fs.readFileSync(sw, 'utf8').replace(/^const VERSION = .*/m, `const VERSION = '${stamp}';`));
    fs.writeFileSync(build, fs.readFileSync(build, 'utf8').replace(/^export const BUILD = .*/m, `export const BUILD = '${stamp}';`));
  }
  return fs.readFileSync(`${PAGES}/apex-finance-os/js/build.js`, 'utf8').match(/BUILD = '([^']+)'/)[1];
};

(async () => {
  let bad = 0;
  const check = (l, ok, d) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? ' — ' + d : ''}`); if (!ok) bad += 1; };

  const first = rebuild();
  console.log(`\nСборка ${first}`);

  const b = await chromium.launch({ args: ['--no-sandbox'], executablePath: process.env.CHROMIUM_PATH || undefined });
  const c = await b.newContext({ viewport: { width: 440, height: 956 }, isMobile: true, hasTouch: true, locale: 'ru-RU' });
  const p = await c.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));

  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);

  const b64 = fs.readFileSync(`${DIR}/bank-light.png`).toString('base64');
  const recognise = () => p.evaluate(async (data) => {
    const ocr = await import('./js/ocr.js');
    const S = await import('./js/screenshot.js');
    const D = await import('./js/dates.js');
    const bin = Uint8Array.from(atob(data), (ch) => ch.charCodeAt(0));
    const text = await ocr.recognise(new File([bin], 'shot.png', { type: 'image/png' }));
    return S.parseScreen(text, D.today()).rows.length;
  }, b64);

  console.log('\n1. Первое распознавание — движок скачивается');
  const one = await recognise();
  check('операции найдены', one === 6, String(one));
  const caches1 = await p.evaluate(() => caches.keys());
  console.log(`     кэши: ${caches1.join(', ')}`);
  check('движок лёг в отдельный кэш', caches1.some((k) => /vendor/.test(k)), caches1.join(', '));

  const vendorFiles = await p.evaluate(async () => {
    const cache = await caches.open('apex-finance-os-vendor-1');
    return (await cache.keys()).map((r) => r.url.split('/').pop());
  });
  console.log(`     в кэше: ${vendorFiles.join(', ')}`);
  check('ядро и модель сохранены',
    vendorFiles.some((f) => /wasm\.js$/.test(f)) && vendorFiles.some((f) => /traineddata/.test(f)),
    vendorFiles.join(', '));

  console.log('\n2. Обновление приложения');
  const second = rebuild(`${first}-next`);
  console.log(`     ${first} → ${second}`);
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);
  const shown = await p.evaluate(async () => (await import('./js/build.js')).BUILD);
  check('новая сборка доехала', shown === second, `${shown} vs ${second}`);
  const caches2 = await p.evaluate(() => caches.keys());
  console.log(`     кэши: ${caches2.join(', ')}`);
  check('кэш движка не вычищен', caches2.some((k) => /vendor/.test(k)), caches2.join(', '));

  console.log('\n3. Без сети после обновления');
  await c.setOffline(true);
  await p.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  await p.waitForTimeout(1500);
  const offline = await recognise().catch((e) => String(e.message).slice(0, 80));
  console.log(`     операций распознано: ${offline}`);
  check('распознавание работает без сети', offline === 6, String(offline));
  await c.setOffline(false);

  console.log(`\n  ошибок в консоли: ${errs.length}${errs.length ? ' — ' + errs.join(' | ') : ''}`);
  if (errs.length) bad += 1;
  await b.close();
  console.log(bad ? `\n${bad} провалов` : '\nВсё сходится');
  process.exit(bad ? 1 : 0);
})();

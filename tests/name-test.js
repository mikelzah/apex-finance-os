// Переименование: имя всюду, иконка со зверьком, старые копии по-прежнему
// открываются, а хранилище осталось прежним — иначе данные пропали бы.
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

  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(800);

  console.log('\n1. Первый экран — это Кубыш');
  const intro = await p.evaluate(() => ({
    title: document.title,
    h1: document.querySelector('.intro h1')?.textContent.trim(),
    mark: document.querySelector('.intro-mark')?.tagName,
    body: document.querySelector('.intro-mark .mascot-body') ? 'есть' : 'нет',
    eyes: document.querySelectorAll('.intro-mark .mascot-eye').length,
    arms: document.querySelectorAll('.intro-mark .mascot-svg > .mascot-limb').length,
    iosTitle: document.querySelector('meta[name="apple-mobile-web-app-title"]')?.content,
  }));
  console.log(`     ${intro.title} · «${intro.h1}» · тело ${intro.body}, глаз ${intro.eyes}, рук ${intro.arms}`);
  check('вкладка называется «Кубыш»', intro.title === 'Кубыш', intro.title);
  check('заголовок — «Кубыш»', intro.h1 === 'Кубыш', intro.h1);
  check('на домашнем экране — «Кубыш»', intro.iosTitle === 'Кубыш', intro.iosTitle);
  check('знак — сам зверёк', intro.body === 'есть' && intro.eyes === 2, `${intro.body}, ${intro.eyes}`);
  check('без рук: держаться тут не за что', intro.arms === 0, String(intro.arms));

  console.log('\n2. Манифест и иконки');
  const man = await (await p.request.get('http://127.0.0.1:8899/app/manifest.webmanifest')).json();
  console.log(`     ${man.name} / ${man.short_name} · иконок ${man.icons.length}`);
  check('name', man.name === 'Кубыш', man.name);
  check('short_name', man.short_name === 'Кубыш', man.short_name);
  for (const icon of man.icons) {
    const url = `http://127.0.0.1:8899/app/${icon.src.replace('./', '')}`;
    const res = await p.request.get(url);
    check(`иконка ${icon.src.split('/').pop()}`, res.ok(), String(res.status()));
  }
  const svg = await (await p.request.get('http://127.0.0.1:8899/app/icons/icon.svg')).text();
  check('в svg-иконке нарисован зверёк, а не уголок', /ellipse/.test(svg) && !/M112 364/.test(svg));

  console.log('\n3. Имя в приложении');
  await p.evaluate(async () => (await import('./js/store.js')).loadDemo());
  await p.goto(`${URL}#/more`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  const version = await p.evaluate(() => document.querySelector('.version')?.textContent.trim());
  console.log(`     ${version}`);
  check('подпись версии', version === 'Кубыш · локальная версия', version);

  await p.goto(`${URL}#/more/settings`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(600);
  const rows = await p.evaluate(() => [...document.querySelectorAll('.row-label span')].map((x) => x.textContent.trim()));
  console.log(`     ${rows.join(' · ')}`);
  check('строка настройки названа именем', rows.includes('Кубыш на острове'), rows.join(', '));

  console.log('\n4. Копия подписана новым именем');
  const dump = await p.evaluate(async () => {
    const store = await import('./js/store.js');
    return JSON.parse(store.exportText());
  });
  console.log(`     app: ${dump.app}`);
  check('в копии новое имя', dump.app === 'Кубыш', dump.app);

  console.log('\n5. Старая копия по-прежнему открывается');
  const restored = await p.evaluate(async () => {
    const store = await import('./js/store.js');
    const old = { app: 'APEX Finance OS', exportedAt: '2026-01-01T00:00:00Z',
      assets: [{ id: 'a1', name: 'Старый вклад', type: 'Деньги', status: 'Активен', opening: 1000 }],
      operations: [], goals: [], portfolio: [], tax: [], netWorth: [], keyRate: [], priceHistory: [] };
    await store.importText(JSON.stringify(old));
    const s = store.getState();
    return { assets: s.assets.length, name: s.assets[0]?.name, app: s.app };
  });
  console.log(`     активов ${restored.assets}: ${restored.name}`);
  check('копия под старым именем принята', restored.assets === 1 && restored.name === 'Старый вклад', JSON.stringify(restored));
  check('поле app в состоянии не осело', restored.app === undefined, String(restored.app));

  console.log('\n6. Хранилище осталось прежним — данные никуда не делись');
  const dbs = await p.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
  console.log(`     базы: ${dbs.join(', ')}`);
  check('база называется по-старому', dbs.includes('apex-finance-os'), dbs.join(', '));

  console.log(`\n  ошибок в консоли: ${errs.length}${errs.length ? ' — ' + errs.join(' | ') : ''}`);
  if (errs.length) bad += 1;
  await b.close();
  console.log(bad ? `\n${bad} провалов` : '\nВсё сходится');
  process.exit(bad ? 1 : 0);
})();

// Список операций с итогами дня — как в ОТП-банке.
//
// Здесь собраны ровно те три ошибки, что нашлись на настоящем снимке:
// итог дня записывался операцией, знак рубля прилипал к числу цифрой
// (694 ₽ → 6942), а в названии оставался след иконки.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const FIX = path.join(__dirname, 'fixtures');
const URL = 'http://127.0.0.1:8899/app/index.html';
const DIR = FIX;
const WANT = [2803.41, 598, 694, 832.17, 1900, 54.33, 480.97, 1310];

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
    await store.mutate((d) => {
      d.assets = [{ id: 'a', name: 'Карта', type: 'Деньги', status: 'Активен', liquidity: 'Мгновенная',
        assetClass: 'Вклады', opening: 100000, goalIds: [], lotSize: 1 }];
    });
  });

  const b64 = fs.readFileSync(`${DIR}/otp.png`).toString('base64');
  const out = await p.evaluate(async (data) => {
    const ocr = await import('./js/ocr.js');
    const S = await import('./js/screenshot.js');
    const D = await import('./js/dates.js');
    const bin = Uint8Array.from(atob(data), (ch) => ch.charCodeAt(0));
    const text = await ocr.recognise(new File([bin], 'shot.png', { type: 'image/png' }));
    return { text, parsed: S.parseScreen(text, D.today()) };
  }, b64);

  const rows = out.parsed.rows;
  console.log('\n1. Суммы прочитаны точно');
  for (const r of rows) console.log(`     ${r.date} · ${r.amount} · ${r.description}`);
  const amounts = rows.map((r) => r.amount);
  for (const want of WANT) check(`${want} на месте`, amounts.includes(want), amounts.join(', '));
  check('знак рубля не прилип цифрой', !amounts.some((x) => [6942, 19002, 5982, 48097.2].includes(x)), amounts.join(', '));

  console.log('\n2. Итог дня не стал операцией');
  check('операций ровно восемь', rows.length === 8, String(rows.length));
  check('«Вы потратили» в записи не попало',
    !rows.some((r) => /потратили/i.test(r.description)), rows.map((r) => r.description).join(' | '));

  console.log('\n3. Итоги банка стали проверкой');
  console.log(`     ${out.parsed.totals.map((t) => `${t.date}: ${t.amount}`).join(' · ')}`);
  check('оба итога дня найдены', out.parsed.totals.length === 2, String(out.parsed.totals.length));
  for (const total of out.parsed.totals) {
    const mine = rows.filter((r) => r.date === total.date && r.kind === 'Трата').reduce((s, r) => s + r.amount, 0);
    check(`${total.date} сходится с банком`, Math.abs(mine - total.amount) < 0.01, `${Math.round(mine * 100) / 100} vs ${total.amount}`);
  }

  console.log('\n4. Названия без следов иконок');
  console.log(`     ${rows.map((r) => r.description).join(' | ')}`);
  check('нет одиноких символов в начале',
    !rows.some((r) => /^[^\p{L}\d]/u.test(r.description)), rows.map((r) => r.description).join(' | '));
  check('нет значков в конце',
    !rows.some((r) => /[©®@|]\s*$/u.test(r.description)), rows.map((r) => r.description).join(' | '));

  console.log('\n5. Сверка показана в шторке');
  await p.goto(`${URL}#/more/spending`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  await p.locator('.btn:has-text("Со скриншота")').first().click();
  await p.waitForTimeout(300);
  const chooser = p.waitForEvent('filechooser');
  await p.locator('.sheet-body .btn:has-text("Выбрать снимок")').click();
  await (await chooser).setFiles(`${DIR}/otp.png`);
  await p.waitForFunction(() => {
    const el = document.querySelector('.sheet-body textarea');
    return el && el.value.length > 20;
  }, null, { timeout: 90000 });
  await p.waitForTimeout(600);
  const sheet = await p.evaluate(() => ({
    summary: [...document.querySelectorAll('.sheet-body .sheet-note')].map((x) => x.textContent).join(' '),
    checks: [...document.querySelectorAll('.check')].map((x) => `${x.className.includes('is-ok') ? '✓' : '✗'} ${x.textContent}`),
    preview: [...document.querySelectorAll('.preview-row')].map((r) => r.textContent),
  }));
  console.log(`     ${sheet.summary}`);
  console.log(`     ${sheet.checks.join('\n     ')}`);
  check('в шторке восемь операций', /Нашлось операций: 8/.test(sheet.summary), sheet.summary);
  check('показаны все, а не первые восемь', sheet.preview.length === 8, String(sheet.preview.length));
  check('обе сверки зелёные', sheet.checks.length === 2 && sheet.checks.every((x) => x.startsWith('✓')), sheet.checks.join(' | '));
  // Экран сверки обязан показывать копейки: «−1 240 ₽» вместо «−1 240,50 ₽»
  // прячет ровно то, ради чего в него смотрят.
  check('копейки видны', sheet.preview.some((x) => /,\d\d/.test(x)), sheet.preview[0]);

  await p.locator('.sheet-foot .btn-primary').click();
  await p.waitForTimeout(900);
  const saved = await p.evaluate(async () => {
    const store = await import('./js/store.js');
    return store.getState().spending.map((r) => r.amount);
  });
  console.log(`     записано: ${saved.length}`);
  check('записаны восемь операций', saved.length === 8, String(saved.length));
  check('суммы сохранены с копейками', saved.includes(832.17) && saved.includes(54.33), saved.join(', '));

  console.log(`\n  ошибок в консоли: ${errs.length}${errs.length ? ' — ' + errs.join(' | ') : ''}`);
  if (errs.length) bad += 1;
  await b.close();
  console.log(bad ? `\n${bad} провалов` : '\nВсё сходится');
  process.exit(bad ? 1 : 0);
})();

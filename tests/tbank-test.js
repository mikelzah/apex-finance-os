// Второй банк: кэшбэк второй строкой, перевод «между своими счетами»,
// проценты на остаток и перевод себе в другой банк.
//
// Всё это деньги, которые не доход и не трата, — и каждое из этого
// по-своему портит норму сбережений, если записать как есть.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const FIX = path.join(__dirname, 'fixtures');
const URL = 'http://127.0.0.1:8899/app/index.html';
const DIR = FIX;

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

  const read = async (name) => {
    const b64 = fs.readFileSync(`${DIR}/${name}`).toString('base64');
    return p.evaluate(async (data) => {
      const ocr = await import('./js/ocr.js');
      const S = await import('./js/screenshot.js');
      const St = await import('./js/statement.js');
      const D = await import('./js/dates.js');
      const bin = Uint8Array.from(atob(data), (ch) => ch.charCodeAt(0));
      const text = await ocr.recognise(new File([bin], 'shot.png', { type: 'image/png' }));
      const parsed = S.parseScreen(text, D.today());
      const withCat = parsed.rows.map((r) => ({ ...r, category: St.categorise(r, []) }));
      return { text, rows: St.markTransfers(withCat, []) };
    }, b64);
  };

  console.log('\n1. Кэшбэк под тратой не становится доходом');
  const t = await read('tbank.png');
  for (const r of t.rows) console.log(`     ${r.date} · ${r.kind} · ${r.amount} · ${r.description} / ${r.category}`);
  const amounts = t.rows.map((r) => r.amount);
  check('кэшбэк 23 ₽ не записан', !amounts.includes(23), amounts.join(', '));
  check('кэшбэк 77 ₽ не записан', !amounts.includes(77), amounts.join(', '));
  check('сама трата 1 174 ₽ на месте', amounts.includes(1174), amounts.join(', '));
  check('сама трата 985 ₽ на месте', amounts.includes(985), amounts.join(', '));
  // Кэшбэк ушёл не в никуда: строка с ним — это строка категории.
  const food = t.rows.find((r) => r.amount === 1174);
  check('категория с той же строки подхвачена', food.category === 'Кафе и рестораны', `${food.category} / ${food.bankCategory}`);

  console.log('\n2. Что не доход и не трата');
  const move = t.rows.filter((r) => r.kind === 'Перевод себе').map((r) => `${r.amount} ${r.description}`);
  console.log(`     ${move.join(' | ')}`);
  check('«Между своими счетами» — перевод себе',
    t.rows.some((r) => r.amount === 1640 && r.kind === 'Перевод себе'),
    JSON.stringify(t.rows.find((r) => r.amount === 1640)));
  check('проценты на остаток — не доход',
    t.rows.some((r) => r.amount === 1.42 && r.kind === 'Перевод себе'),
    JSON.stringify(t.rows.find((r) => r.amount === 1.42)));

  console.log('\n3. Ложной суммы из длинной подписи нет');
  check('трата в 1 ₽ не появилась', !amounts.includes(1), amounts.join(', '));
  check('операций ровно семь', t.rows.length === 7, String(t.rows.length));

  console.log('\n4. Перевод себе в другой банк сводится в пару');
  // Два снимка разных банков: из ОТП ушло, в Т-Банк пришло. Порядок загрузки
  // нарочно обратный — второй банк должен найти пару в уже записанном.
  const o = await read('otp.png');
  const after = await p.evaluate(async ({ first, second }) => {
    const store = await import('./js/store.js');
    const S = await import('./js/statement.js');
    await store.clearSpending();
    await store.addSpending(S.newRows(first, []), 'Т-Банк');
    await store.addSpending(S.newRows(second, store.getState().spending), 'ОТП');
    const paired = await store.pairSelfTransfers();
    const rows = store.getState().spending;
    return {
      paired,
      moved: rows.filter((r) => r.kind === 'Перевод себе').map((r) => `${r.amount} ${r.description}`),
      income: rows.filter((r) => r.kind === 'Поступление').reduce((s, r) => s + r.amount, 0),
      spent: rows.filter((r) => r.kind === 'Трата').reduce((s, r) => s + r.amount, 0),
    };
  }, { first: t.rows, second: o.rows });
  console.log(`     сведено пар: ${after.paired}`);
  console.log(`     переводы себе: ${after.moved.join(' | ')}`);
  console.log(`     доход ${after.income} · траты ${Math.round(after.spent * 100) / 100}`);
  check('пары найдены', after.paired >= 2, String(after.paired));
  check('2 803,41 сведено', after.moved.some((x) => x.startsWith('2803.41')), after.moved.join(' | '));
  check('1 900 сведено', after.moved.some((x) => x.startsWith('1900')), after.moved.join(' | '));
  // Настоящего дохода в этих двух снимках нет вовсе: всё приходное —
  // это либо перевод себе, либо проценты банка.
  check('фантомного дохода не осталось', after.income === 0, String(after.income));

  console.log(`\n  ошибок в консоли: ${errs.length}${errs.length ? ' — ' + errs.join(' | ') : ''}`);
  if (errs.length) bad += 1;
  await b.close();
  console.log(bad ? `\n${bad} провалов` : '\nВсё сходится');
  process.exit(bad ? 1 : 0);
})();

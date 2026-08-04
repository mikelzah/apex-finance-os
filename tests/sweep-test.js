// Обход всех экранов на трёх наборах данных: пусто, демо и «злые» данные.
// Ищем ошибки в консоли и следы поломки в тексте: NaN, Infinity, undefined.
const { chromium } = require('playwright');
const URL = 'http://127.0.0.1:8899/app/index.html';

const ROUTES = [
  'dashboard', 'goals', 'portfolio', 'spending', 'more',
  'more/assets', 'more/tax', 'more/history', 'more/health',
  'more/keyrate', 'more/settings', 'more/backup', 'more/categories',
];

(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'], executablePath: process.env.CHROMIUM_PATH || undefined });
  let bad = 0;
  const check = (l, ok, d) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? ' — ' + d : ''}`); if (!ok) bad += 1; };

  const seed = {
    // Пустое приложение: ни активов, ни операций.
    'пусто': async (p) => p.evaluate(async () => {
      const store = await import('./js/store.js');
      await store.startEmpty();
    }),
    'демо': async (p) => p.evaluate(async () => {
      const store = await import('./js/store.js');
      await store.loadDemo();
    }),
    // Данные, каких быть не должно, но которые может принести чужая копия.
    'битые данные': async (p) => p.evaluate(async () => {
      const store = await import('./js/store.js');
      const D = await import('./js/dates.js');
      await store.startEmpty();
      await store.mutate((d) => {
        d.assets = [
          { id: 'a1', name: 'Без всего' },
          { id: 'a2', name: 'Отрицательный', type: 'Деньги', status: 'Активен', liquidity: 'Мгновенная',
            assetClass: 'Вклады', opening: -100000, openingDate: D.addDays(D.today(), -10), goalIds: ['g1'], lotSize: 1 },
          { id: 'a3', name: 'Бумага без цены', type: 'Инвестиции', status: 'Активен', liquidity: 'T+1',
            assetClass: 'Акции', ticker: 'ZZZZ', quantity: 5, price: null, goalIds: [], lotSize: 0 },
          { id: 'a4', name: 'Облигация', type: 'Инвестиции', status: 'Активен', liquidity: 'T+1',
            assetClass: 'Облигации', ticker: 'BBBB', quantity: 2, price: 900, faceValue: null,
            couponRate: 8, couponsPerYear: 0, goalIds: [], lotSize: 1 },
        ];
        d.operations = [
          { id: 'o1', date: 'не дата', type: 'Взнос', assetId: 'a2', amount: 1000, goalId: 'g1' },
          { id: 'o2', date: D.addDays(D.today(), 5), type: 'Покупка', assetId: 'a3', quantity: 0, price: 0, amount: 0 },
          { id: 'o3', date: D.addDays(D.today(), -5), type: 'Продажа', assetId: 'a3', quantity: 99, price: 10, amount: 990 },
          { id: 'o4', date: D.addDays(D.today(), -5), type: 'Дивиденд', assetId: 'a3', amount: -50 },
        ];
        d.goals = [
          { id: 'g1', name: 'Без суммы', target: null, status: 'Активна', sort: 0 },
          { id: 'g2', name: 'Ноль', target: 0, deadline: D.addDays(D.today(), -100), planPerDay: 0, status: 'Активна', sort: 1 },
        ];
        d.spending = [
          { id: 's1', date: null, amount: 100, kind: 'Трата', category: null, description: null, key: 'k1' },
          { id: 's2', date: D.today(), amount: -50, kind: 'Поступление', category: 'Зарплата', description: '', key: 'k2' },
        ];
        d.netWorth = [{ month: '2026-13', date: '2026-13-45', total: 1000, liquid: 1000, invested: 0 }];
        d.keyRate = [{ date: 'мусор', rate: null }];
        d.portfolio = [{ class: 'Акции', targetShare: 0 }, { class: 'Вклады', targetShare: 0 }];
      });
    }),
  };

  for (const [label, apply] of Object.entries(seed)) {
    console.log(`\n=== ${label}`);
    const c = await b.newContext({ viewport: { width: 440, height: 956 }, isMobile: true, hasTouch: true, locale: 'ru-RU' });
    const p = await c.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(String(e)));
    // Значок бумаги ищется файлом по тикеру, и файла чаще всего нет: облигаций
    // и фондов тысячи, логотипов у них не бывает. Приложение рисует монограмму —
    // это штатный вид, а не сбой, и ответ сервера здесь не ошибка.
    p.on('console', (m) => {
      if (m.type() !== 'error') return;
      if (/404/.test(m.text()) && /icons\/tickers\//.test(m.location()?.url || '')) return;
      errs.push(m.text());
    });

    await p.goto(`${URL}#/dashboard`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(700);
    await apply(p);
    await p.reload({ waitUntil: 'networkidle' });
    await p.waitForTimeout(800);

    for (const route of ROUTES) {
      await p.evaluate((r) => { location.hash = `#/${r}`; }, route);
      await p.waitForTimeout(450);
      const info = await p.evaluate(() => {
        const text = document.getElementById('screen').innerText;
        return {
          empty: text.trim().length === 0,
          hits: (text.match(/NaN|Infinity|undefined|\[object|\bnull\b/g) || []).slice(0, 3),
        };
      });
      const ok = !info.hits.length && !info.empty;
      check(route, ok, info.hits.length ? info.hits.join(', ') : info.empty ? 'экран пуст' : '');
    }

    console.log(`  ошибок в консоли: ${errs.length}${errs.length ? ' — ' + errs.slice(0, 3).join(' | ') : ''}`);
    if (errs.length) bad += 1;
    await c.close();
  }

  await b.close();
  console.log(bad ? `\n${bad} провалов` : '\nВсё сходится');
  process.exit(bad ? 1 : 0);
})();

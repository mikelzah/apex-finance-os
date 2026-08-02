// Фаззинг расчётного ядра: злые входные данные против чистых функций.
//
// Ищем не «неправильное число», а признаки настоящей поломки: NaN, Infinity,
// исключение и отрицательное там, где отрицательного быть не может. Ровно
// то, что превращается на экране в «NaN ₽» и «∞%».
const { chromium } = require('playwright');
const URL = 'http://127.0.0.1:8899/app/index.html';

(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'], executablePath: process.env.CHROMIUM_PATH || undefined });
  const p = await (await b.newContext({ viewport: { width: 440, height: 956 }, locale: 'ru-RU' })).newPage();
  await p.goto(`${URL}#/dashboard`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(600);

  const found = await p.evaluate(async () => {
    const C = await import('./js/calc.js');
    const S = await import('./js/statement.js');
    const D = await import('./js/dates.js');
    const F = await import('./js/fmt.js');
    const SC = await import('./js/screenshot.js');
    const bad = [];
    const today = D.today();

    const suspicious = (label, value) => {
      const walk = (v, path) => {
        if (typeof v === 'number') {
          if (Number.isNaN(v)) bad.push(`${label}${path}: NaN`);
          else if (!Number.isFinite(v)) bad.push(`${label}${path}: ${v}`);
        } else if (typeof v === 'string') {
          if (/NaN|Infinity|undefined|null ₽/.test(v)) bad.push(`${label}${path}: «${v}»`);
        } else if (v && typeof v === 'object') {
          for (const [k, x] of Object.entries(v)) {
            if (path.split('.').length > 4) return;
            walk(x, `${path}.${k}`);
          }
        }
      };
      walk(value, '');
    };
    const guard = (label, fn) => {
      try { const out = fn(); suspicious(label, out); return out; }
      catch (e) { bad.push(`${label}: исключение ${e.message}`); return null; }
    };

    // ---- Активы и операции на грани -------------------------------------
    const asset = (over = {}) => ({
      id: 'a1', name: 'Актив', type: 'Деньги', status: 'Активен', liquidity: 'Мгновенная',
      assetClass: 'Вклады', opening: 0, openingDate: today, goalIds: [], lotSize: 1, ...over,
    });
    const paper = (over = {}) => asset({
      id: 'p1', name: 'Бумага', type: 'Инвестиции', assetClass: 'Акции',
      ticker: 'AAAA', quantity: 10, price: 100, opening: 0, ...over,
    });

    const assetCases = {
      'пустой актив': [{ id: 'x' }],
      'нулевой остаток': [asset({ opening: 0 })],
      'отрицательный остаток': [asset({ opening: -5000 })],
      'огромный остаток': [asset({ opening: 1e15 })],
      'остаток строкой': [asset({ opening: '1000' })],
      'бумага без цены': [paper({ price: null })],
      'бумага с нулевым количеством': [paper({ quantity: 0 })],
      'бумага с отрицательным количеством': [paper({ quantity: -3 })],
      'нулевой размер лота': [paper({ lotSize: 0 })],
      'дата открытия в будущем': [asset({ opening: 1000, openingDate: D.addDays(today, 30) })],
      'кривая дата открытия': [asset({ opening: 1000, openingDate: '31.02.2026' })],
      'ставка 0': [asset({ opening: 1000, rate: 0 })],
      'ставка 1000%': [asset({ opening: 1000, rate: 1000, capDay: 31 })],
      'день капитализации 31 в феврале': [asset({ opening: 1000, rate: 10, capDay: 31 })],
      'облигация без номинала': [paper({ assetClass: 'Облигации', faceValue: null, couponRate: 8, couponsPerYear: 2 })],
      'облигация с 0 купонов в год': [paper({ assetClass: 'Облигации', faceValue: 1000, couponRate: 8, couponsPerYear: 0 })],
      'проданный актив': [asset({ status: 'Продан', opening: 1000 })],
      'запланированный актив': [asset({ status: 'Планируется', opening: 1000 })],
    };

    for (const [label, assets] of Object.entries(assetCases)) {
      guard(`netWorth[${label}]`, () => C.netWorth(assets, []));
      guard(`portfolioShares[${label}]`, () => C.portfolioShares(assets, []));
      guard(`investedAt[${label}]`, () => C.investedAt(assets, [], today));
      guard(`returnOf[${label}]`, () => C.returnOf(assets, [], today));
      guard(`signals[${label}]`, () => C.signals(assets, [], today));
      guard(`pendingAccruals[${label}]`, () => C.pendingAccruals(assets, [], today));
      guard(`assetValue[${label}]`, () => C.assetValue(assets[0], [], today));
      guard(`couponCalendar[${label}]`, () => C.couponCalendar(assets, [], today));
      guard(`lotsOf[${label}]`, () => C.lotsOf(assets[0], []));
      guard(`dataHealth[${label}]`, () => C.dataHealth(
        { assets, operations: [], goals: [], spending: [], netWorth: [], keyRate: [], portfolio: [], settings: {} }, today));
    }

    // ---- Цели -----------------------------------------------------------
    const goalCases = {
      'цель без суммы': { id: 'g', name: 'Ц', target: null, status: 'Активна' },
      'цель с нулевой суммой': { id: 'g', name: 'Ц', target: 0, status: 'Активна' },
      'цель с отрицательной суммой': { id: 'g', name: 'Ц', target: -100, status: 'Активна' },
      'срок в прошлом': { id: 'g', name: 'Ц', target: 1000, deadline: D.addDays(today, -10), status: 'Активна' },
      'срок сегодня': { id: 'g', name: 'Ц', target: 1000, deadline: today, status: 'Активна' },
      'план 0 в день': { id: 'g', name: 'Ц', target: 1000, planPerDay: 0, status: 'Активна' },
      'план отрицательный': { id: 'g', name: 'Ц', target: 1000, planPerDay: -50, status: 'Активна' },
      'цель перевыполнена': { id: 'g', name: 'Ц', target: 10, status: 'Активна' },
    };
    const linked = [asset({ opening: 5000, goalIds: ['g'] })];
    for (const [label, goal] of Object.entries(goalCases)) {
      guard(`goalMetrics[${label}]`, () => C.goalMetrics(goal, linked, [], today));
      guard(`planCompletion[${label}]`, () => C.planCompletion(goal, [], today));
    }

    // ---- Продажа и налог -------------------------------------------------
    const ops = [
      { id: 'o1', date: D.addDays(today, -400), type: 'Покупка', assetId: 'p1', quantity: 10, price: 90, amount: 900 },
    ];
    guard('saleOutcome[всё]', () => C.saleOutcome(paper(), ops, 10, 100, today));
    guard('saleOutcome[больше, чем есть]', () => C.saleOutcome(paper(), ops, 100, 100, today));
    guard('saleOutcome[ноль штук]', () => C.saleOutcome(paper(), ops, 0, 100, today));
    guard('saleOutcome[отрицательная цена]', () => C.saleOutcome(paper(), ops, 5, -10, today));
    guard('saleOutcome[без сделок]', () => C.saleOutcome(paper(), [], 5, 100, today));
    guard('taxLimit[пустой ряд]', () => C.taxLimit([], today));
    guard('rateOn[пустой ряд]', () => C.rateOn([], today));

    // ---- XIRR ------------------------------------------------------------
    const xirrCases = {
      'пусто': [],
      'один поток': [{ date: today, amount: -100 }],
      'все одного знака': [{ date: D.addDays(today, -100), amount: -100 }, { date: today, amount: -100 }],
      'нулевые суммы': [{ date: D.addDays(today, -100), amount: 0 }, { date: today, amount: 0 }],
      'один день': [{ date: today, amount: -100 }, { date: today, amount: 110 }],
      'потеря всего': [{ date: D.addDays(today, -365), amount: -100 }, { date: today, amount: 0 }],
      'рост в 100 раз': [{ date: D.addDays(today, -365), amount: -100 }, { date: today, amount: 10000 }],
      'будущий поток': [{ date: today, amount: -100 }, { date: D.addDays(today, 365), amount: 110 }],
    };
    for (const [label, flows] of Object.entries(xirrCases)) guard(`xirr[${label}]`, () => C.xirr(flows, today));

    // ---- Форматирование ---------------------------------------------------
    for (const v of [0, -0, 0.004, -0.004, 1e21, -1e21, null, undefined, NaN, Infinity, '12', '']) {
      guard(`money(${String(v)})`, () => F.money(v));
      guard(`percent(${String(v)})`, () => F.percent(v));
      guard(`share(${String(v)})`, () => F.share(v));
      guard(`moneyExact(${String(v)})`, () => F.moneyExact(v));
    }
    for (const v of ['', null, undefined, '2026-13-45', 'вчера', '2026-02-30']) {
      guard(`date(${String(v)})`, () => F.date(v));
      guard(`dateShort(${String(v)})`, () => F.dateShort(v));
    }

    // ---- Даты -------------------------------------------------------------
    guard('addDays[29 февраля]', () => D.addDays('2028-02-29', 1));
    guard('addDays[конец года]', () => D.addDays('2026-12-31', 1));
    guard('addDays[минус год]', () => D.addDays('2026-01-01', -1));
    guard('addMonths[31 января]', () => D.addMonths && D.addMonths('2026-01-31', 1));
    guard('daysBetween[обратный порядок]', () => D.daysBetween && D.daysBetween(today, D.addDays(today, -10)));

    // ---- Быт --------------------------------------------------------------
    const spendCases = {
      'пусто': [],
      'только траты': [{ id: 's', date: today, amount: 100, kind: 'Трата', category: 'Прочее' }],
      'только переводы': [{ id: 's', date: today, amount: 100, kind: 'Перевод себе', category: 'Переводы' }],
      'нулевая сумма': [{ id: 's', date: today, amount: 0, kind: 'Трата', category: 'Прочее' }],
      'отрицательная трата': [{ id: 's', date: today, amount: -500, kind: 'Трата', category: 'Прочее' }],
      'без даты': [{ id: 's', date: null, amount: 100, kind: 'Трата', category: 'Прочее' }],
      'дата в будущем': [{ id: 's', date: D.addDays(today, 40), amount: 100, kind: 'Трата', category: 'Прочее' }],
      'без категории': [{ id: 's', date: today, amount: 100, kind: 'Трата' }],
      'без вида': [{ id: 's', date: today, amount: 100, category: 'Прочее' }],
    };
    for (const [label, rows] of Object.entries(spendCases)) {
      const stats = guard(`spendStats[${label}]`, () => C.spendStats(rows, today));
      guard(`cushionMonths[${label}]`, () => C.cushionMonths(linked, [], stats || { perMonth: 0 }));
      guard(`balanceVerdict[${label}]`, () => C.balanceVerdict &&
        C.balanceVerdict(stats || {}, C.cushionMonths(linked, [], stats || { perMonth: 0 }), 0));
    }

    // ---- Разбор выписки ----------------------------------------------------
    const csvCases = {
      'пустая строка': '',
      'только заголовок': 'Дата;Сумма;Описание',
      'без разделителя': 'вообще не таблица',
      'одна колонка': 'Дата\n01.08.2026',
      'кавычки без пары': 'Дата;Сумма;Описание\n01.08.2026;-100;"Магазин',
      'сумма словами': 'Дата;Сумма;Описание\n01.08.2026;много;Магазин',
      'дата мусором': 'Дата;Сумма;Описание\n31.02.2026;-100;Магазин',
      'разделитель в описании': 'Дата;Сумма;Описание\n01.08.2026;-100;"Кафе; бар"',
    };
    for (const [label, text] of Object.entries(csvCases)) {
      guard(`parseTable[${label}]`, () => {
        const table = S.parseTable ? S.parseTable(text) : null;
        if (!table) return null;
        const head = S.findHeaderRow(table);
        return { rows: table.length, head };
      });
    }
    for (const raw of ['', null, '31.02.2026', '2026-13-01', '45000', '0', 'вчера', '01/08/26']) {
      guard(`toDate(${String(raw)})`, () => S.toDate(raw));
    }
    guard('categoriesForKind[без настроек]', () => S.categoriesForKind(null, 'Трата'));
    guard('categoriesForKind[пустой список]', () => S.categoriesForKind({ categories: { spend: [] } }, 'Трата'));
    guard('newRows[пусто]', () => S.newRows([], []));
    guard('markTransfers[пусто]', () => S.markTransfers([], []));
    guard('learnCategories[мусор]', () => S.learnCategories([{ description: null, category: null }]));

    // ---- Разбор снимка -----------------------------------------------------
    for (const text of ['', 'просто текст', '1 000 ₽', '\n\n\n', '12:00 Wi-Fi 100%']) {
      guard(`parseScreen(${JSON.stringify(text).slice(0, 20)})`, () => SC.parseScreen(text, today));
    }

    return bad;
  });

  console.log(`\nПодозрительных мест: ${found.length}`);
  for (const line of found) console.log(`  • ${line}`);
  await b.close();
  process.exit(0);
})();

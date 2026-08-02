// Подсказки убраны с экранов. Проверяем, что их нет, что вместо них не
// осталось пустых карточек и что экраны по-прежнему живые.
const { chromium } = require('playwright');
const URL = 'http://127.0.0.1:8899/app/index.html';

const GONE = [
  'Пустая клетка — день без взноса',
  'Прогноз линейный по плану',
  'Класс без целевой доли появляется',
  'Цены тянутся прямо с iss.moex.com',
  'Как устроена система',
  'Деньги живут только в активах',
  'Взнос и доход — разные типы операций',
  'Начисление процентов — это модель',
  'Это расчётная оценка с последней капитализации',
  'Считаются проценты по всем вашим вкладам',
  'Лимит — 1 млн ₽',
  'Налог начисляет ФНС',
  'Снимок пишется вручную',
  'Ставка ЦБ меняется несколько раз в год',
  'Активы без тикера',
  'Загрузка из копии заменяет текущие данные',
];

// Предупреждение про стирание данных ушло вместе с блоком «Заменить данные».
// Осталось то, что объясняет не действие, а положение дел: данные лежат
// только в телефоне.
const KEPT = [
  ['more/backup', 'Данные хранятся только в этом телефоне'],
  ['more/settings', 'Стирает сохранённую копию кода'],
];

(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'], executablePath: process.env.CHROMIUM_PATH || undefined });
  const c = await b.newContext({ viewport: { width: 440, height: 956 }, isMobile: true, hasTouch: true, locale: 'ru-RU', colorScheme: 'light' });
  const p = await c.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

  let bad = 0;
  const check = (l, ok, d) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? ' — ' + d : ''}`); if (!ok) bad += 1; };

  await p.goto(`${URL}#/dashboard`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(600);
  await p.evaluate(async () => (await import('./js/store.js')).loadDemo());
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(800);

  const SCREENS = ['dashboard', 'goals', 'portfolio', 'journal', 'more',
    'more/assets', 'more/tax', 'more/history', 'more/keyrate', 'more/classes', 'more/settings', 'more/backup'];

  console.log('\nПодсказок нет ни на одном экране');
  const seen = [];
  for (const hash of SCREENS) {
    await p.goto(`${URL}#/${hash}`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(400);
    const info = await p.evaluate(() => {
      const s = document.getElementById('screen');
      const empties = [...s.querySelectorAll('.card')].filter((card) => card.textContent.trim() === '').length;
      return { text: s.textContent, empties, cards: s.querySelectorAll('.card').length };
    });
    const found = GONE.filter((t) => info.text.includes(t));
    if (found.length) { seen.push([hash, found]); }
    check(`${hash.padEnd(15)} подсказок ${found.length}, пустых карточек ${info.empties}, карточек ${info.cards}`,
      found.length === 0 && info.empties === 0, found.join('; '));
  }

  console.log('\nОставленное на месте');
  for (const [hash, text] of KEPT) {
    await p.goto(`${URL}#/${hash}`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(400);
    const ok = await p.evaluate((t) => document.getElementById('screen').textContent.includes(t), text);
    check(`${hash}: «${text.slice(0, 40)}…»`, ok);
  }

  console.log('\nПодсказки в формах остались (появляются только при редактировании)');
  await p.goto(`${URL}#/more/assets`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(500);
  await p.locator('.dt tbody tr').first().click();
  await p.waitForTimeout(600);
  const inSheet = await p.evaluate(() => {
    const s = document.querySelector('.sheet');
    return s ? s.querySelectorAll('.callout').length : -1;
  });
  console.log(`     подсказок в карточке актива: ${inSheet}`);
  check('форма актива открылась', inSheet >= 0, String(inSheet));

  await c.close();
  await b.close();
  if (errs.length) { console.log('\nОшибки:'); errs.forEach((e) => console.log('  ' + e)); bad += errs.length; }
  console.log(bad ? `\n${bad} провалов\n` : '\nВсё сходится\n');
  process.exit(bad ? 1 : 0);
})();

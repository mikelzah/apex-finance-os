// Переименование в существующее имя не должно раздваивать список.
const { chromium } = require('playwright');
const URL = 'http://127.0.0.1:8899/app/index.html';
(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'], executablePath: process.env.CHROMIUM_PATH || undefined });
  const p = await (await b.newContext({ viewport: { width: 440, height: 956 }, locale: 'ru-RU' })).newPage();
  let bad = 0;
  const check = (l, ok, d) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${d ? ' — ' + d : ''}`); if (!ok) bad += 1; };
  await p.goto(`${URL}#/dashboard`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(700);

  const r = await p.evaluate(async () => {
    const store = await import('./js/store.js');
    const D = await import('./js/dates.js');
    await store.startEmpty();
    await store.mutate((d) => {
      d.settings.categories = { spend: ['Продукты', 'Кафе', 'Прочее'], income: ['Зарплата', 'Прочий доход'] };
      d.settings.spendRules = [{ word: 'ЛАВКА', category: 'Продукты' }];
      d.spending = [
        { id: 's1', date: D.today(), amount: 100, kind: 'Трата', category: 'Продукты', description: 'Лавка', key: 'k1' },
        { id: 's2', date: D.today(), amount: 200, kind: 'Трата', category: 'Кафе', description: 'Кофе', key: 'k2' },
      ];
    });

    const merged = await store.renameCategory('spend', 'Продукты', 'Кафе');
    const afterMerge = {
      list: [...store.getState().settings.categories.spend],
      rows: store.getState().spending.map((x) => x.category),
      rules: store.getState().settings.spendRules.map((x) => x.category),
      touched: merged,
    };

    // Другой регистр — та же категория, а не новая строка.
    await store.renameCategory('spend', 'Кафе', 'кАФЕ');
    const afterCase = [...store.getState().settings.categories.spend];

    // Обычное переименование по-прежнему работает.
    // После смены регистра имя в списке — «кАФЕ», от него и переименовываем.
    await store.renameCategory('spend', 'кАФЕ', 'Еда вне дома');
    const afterPlain = {
      list: [...store.getState().settings.categories.spend],
      rows: store.getState().spending.map((x) => x.category),
    };
    return { afterMerge, afterCase, afterPlain };
  });

  console.log('\n1. Слияние с существующей категорией');
  console.log(`     список: ${r.afterMerge.list.join(', ')}`);
  console.log(`     записи: ${r.afterMerge.rows.join(', ')} · правила: ${r.afterMerge.rules.join(', ')}`);
  check('в списке нет двойника', new Set(r.afterMerge.list).size === r.afterMerge.list.length, r.afterMerge.list.join(', '));
  check('«Продукты» ушли', !r.afterMerge.list.includes('Продукты'), r.afterMerge.list.join(', '));
  check('обе записи в «Кафе»', r.afterMerge.rows.every((x) => x === 'Кафе'), r.afterMerge.rows.join(', '));
  check('правило переехало', r.afterMerge.rules[0] === 'Кафе', r.afterMerge.rules.join(', '));

  console.log('\n2. Смена регистра не плодит строку');
  console.log(`     список: ${r.afterCase.join(', ')}`);
  check('строк столько же', r.afterCase.length === 2, r.afterCase.join(', '));

  console.log('\n3. Обычное переименование цело');
  console.log(`     список: ${r.afterPlain.list.join(', ')} · записи: ${r.afterPlain.rows.join(', ')}`);
  check('имя сменилось', r.afterPlain.list.includes('Еда вне дома'), r.afterPlain.list.join(', '));
  check('и в записях тоже', r.afterPlain.rows.every((x) => x === 'Еда вне дома'), r.afterPlain.rows.join(', '));

  await b.close();
  console.log(bad ? `\n${bad} провалов` : '\nВсё сходится');
  process.exit(bad ? 1 : 0);
})();

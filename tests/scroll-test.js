// Прокрутка: переход на другой экран начинается сверху, перерисовка того же
// экрана сохраняет положение.
const { chromium } = require('playwright');
const URL = 'http://127.0.0.1:8899/app/index.html';

let failed = 0;
const check = (label, ok, extra = '') => {
  if (!ok) failed += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${extra ? ` (${extra})` : ''}`);
};

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'], executablePath: process.env.CHROMIUM_PATH || undefined });
  const context = await browser.newContext({
    viewport: { width: 440, height: 956 },
    isMobile: true, hasTouch: true, locale: 'ru-RU', timezoneId: 'Europe/Moscow',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(`${URL}#/dashboard`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  await page.evaluate(async () => (await import('./js/store.js')).loadDemo());
  await page.waitForTimeout(600);

  // Прокручивается #screen, а не документ: после перехода на оболочку
  // в высоту экрана страница не прокручивается вовсе, и window.scrollY
  // всегда ноль — на нём набор проходил бы, ничего не проверяя.
  const y = () => page.evaluate(() => Math.round(document.getElementById('screen').scrollTop));
  // Прокручиваем и возвращаем то, что получилось: если экран короткий,
  // прокрутка не состоится, и проверка «перешли — начали сверху» пройдёт
  // впустую. Такую проверку надо ловить, а не радоваться ей.
  const scroll = async (to) => {
    const got = await page.evaluate((v) => {
      const el = document.getElementById('screen');
      el.scrollTop = Math.min(v, el.scrollHeight - el.clientHeight);
      return Math.round(el.scrollTop);
    }, to);
    await page.waitForTimeout(250);
    return got;
  };
  // Разделов пятеро, по разделу на разрез: «Главная», «Цели», «Портфель»,
  // «Траты», «Настройки». Кнопки записи в панели нет — записывают круглым
  // действием на главной, — поэтому вкладка выбирается по подписи, и порядок
  // тут ни при чём.
  const tab = async (label) => {
    await page.click(`.tabbar .tab:has-text("${label}")`);
    await page.waitForTimeout(500);
  };
  // Разрезы остались только у портфеля: «Портфель» и «Журнал» — два взгляда
  // на одни деньги. Переключатель стоит второй строкой, под шапкой раздела.
  const part = async (label) => {
    await page.click(`.segmented-wide .segment:has-text("${label}")`);
    await page.waitForTimeout(500);
  };

  console.log('\nПереход на другой экран начинается сверху');
  // Начинаем с заведомо длинного экрана: главная помещается целиком
  // и по замыслу не прокручивается вовсе — с неё проверка ничего
  // бы не доказала.
  await page.goto(`${URL}#/portfolio`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  let from = await scroll(400);
  check('«Портфель» прокрутился', from > 0, `${from} px`);
  await tab('Цели');
  check('«Портфель» → «Цели»', (await y()) === 0, `было ${from}`);

  from = await scroll(300);
  check('«Цели» прокрутились', from > 0, `${from} px`);
  await tab('Траты');
  check('«Цели» → «Траты»', (await y()) === 0, `было ${from}`);

  from = await scroll(300);
  check('«Траты» прокрутились', from > 0, `${from} px`);
  await tab('Главная');
  check('«Траты» → «Главная»', (await y()) === 0, `было ${from}`);

  console.log('\nВложенный раздел');
  // На демо-данных ни один вложенный раздел не длиннее экрана, а проверять
  // возврат прокрутки на непрокручиваемой странице — проверка ни о чём.
  // Поэтому длинную страницу делаем сами: операции по счёту.
  // Укоротить вьюпорт нельзя: высота оболочки берётся от экрана, а не от него.
  await page.evaluate(async () => {
    const store = await import('./js/store.js');
    await store.mutate((d) => {
      for (let i = 0; i < 40; i += 1) {
        d.operations.push({
          id: store.newId('op'), date: `2026-03-${String((i % 28) + 1).padStart(2, '0')}`,
          type: 'Взнос', amount: 100 + i, assetId: 'demo-savings', goalId: null,
          source: 'Вручную', comment: null,
        });
      }
    });
  });
  // Заходим на страницу самого счёта: длинной её делает список операций,
  // а список активов от них не растёт.
  await tab('Портфель');
  await part('Портфель');
  await page.waitForTimeout(400);
  await page.click('.paper:has-text("Накопительный счёт")');
  await page.waitForTimeout(600);
  check('«Портфель» → страница счёта', (await y()) === 0);
  const deep = await scroll(300);
  check('вложенный раздел прокрутился', deep > 0, `${deep} px`);
  await page.click('.back');
  await page.waitForTimeout(500);
  check('назад в «Портфель»', (await y()) === 0, `было ${deep}`);

  console.log('\nПерерисовка того же экрана сохраняет положение');
  // Проверяется на тратах, а не на главной: главная в экран помещается
  // целиком и не прокручивается вовсе, а «положение сохранилось» на нуле
  // сходится само собой и не значит ничего.
  await tab('Траты');
  await page.waitForTimeout(600);
  await scroll(260);
  const kept = await y();
  // Смена окна периода — настоящая перерисовка того же экрана: пересчитано
  // и перерисовано всё, кроме положения прокрутки.
  await page.click('.segmented .segment:has-text("Полгода")');
  await page.waitForTimeout(600);
  const after = await y();
  // Сравниваем не с прежним положением, а с тем, докуда вообще можно
  // прокрутить после перерисовки: за полгода данных больше, экран длиннее,
  // но короче он стать тоже может — и упёршееся в новый предел положение
  // означало бы не потерю позиции, а лишь то, что прокручивать стало некуда.
  const max = await page.evaluate(() => {
    const s = document.getElementById('screen');
    return s.scrollHeight - s.clientHeight;
  });
  const want = Math.min(kept, max);
  check('смена периода не выкидывает наверх', Math.abs(after - want) <= 4,
    `${kept} → ${after}, предел ${max}`);
  check('период и правда сменился', await page.isVisible('.segment.is-on:has-text("Полгода")'));

  console.log('\nЗапись взноса с главной');
  await tab('Главная');
  await page.waitForTimeout(3400); // ждём, пока уйдёт тост
  await page.evaluate(() => document.querySelector('.act-round.is-key').click());
  await page.waitForTimeout(600);
  // Капитал изменился — перерисовка была настоящей. Изменение за день стоит
  // в строке под числом: рядом с ним метка роста за период, и двум числам
  // нужна одна строка на двоих.
  check('взнос записан', (await page.textContent('.hero-row')).includes('+'));
  check('главная так и не прокручивается', (await page.evaluate(() => {
    const s = document.getElementById('screen');
    return s.scrollHeight - s.clientHeight;
  })) === 0);

  await browser.close();
  if (errors.length) { failed += 1; console.log(`\nОшибки: ${errors.join('; ')}`); }
  console.log(failed ? `\n${failed} проверок провалено\n` : '\nВсе проверки прошли\n');
  process.exit(failed ? 1 : 0);
})();

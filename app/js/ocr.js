// Распознавание текста на снимке экрана.
//
// Движок лежит в vendor/tesseract7 и грузится только тогда, когда человек
// выбрал картинку: это пять с половиной мегабайт, и тянуть их при каждом
// запуске ради возможности, которой пользуются раз в неделю, нельзя.
// После первого раза они остаются в кэше — дальше работает и без сети.
//
// Само распознавание идёт в телефоне. Картинка никуда не отправляется:
// сервера у приложения нет, а движок работает на WebAssembly прямо здесь.

const BASE = new URL('../vendor/tesseract7/', import.meta.url).href;

let workerPromise = null;

/**
 * Готовый рабочий поток. Один на всё время жизни страницы: инициализация
 * стоит несколько секунд, и делать её на каждый снимок значило бы платить
 * их заново при каждой загрузке.
 */
async function getWorker(onProgress) {
  if (workerPromise) return workerPromise;

  workerPromise = (async () => {
    // Сборка ES-модулем отдаёт всё одним экспортом по умолчанию,
    // именованных в ней нет.
    const module = await import(`${BASE}tesseract.esm.min.js`);
    const lib = module.default || module;
    return lib.createWorker('rus', 1, {
      workerPath: `${BASE}worker.min.js`,
      // Путь файлом, а не папкой: так движок берёт именно это ядро
      // и не выбирает между четырьмя вариантами, которых здесь нет.
      corePath: `${BASE}tesseract-core-simd-lstm.wasm.js`,
      langPath: BASE,
      gzip: true,
      logger: (m) => {
        if (!onProgress) return;
        if (m.status === 'recognizing text') onProgress('Читаю', m.progress);
        else if (/traineddata|core|initializ/i.test(m.status)) onProgress('Загружаю распознавание', m.progress);
      },
    });
  })().catch((err) => {
    // Неудачную попытку не запоминаем: со второго раза может и получиться,
    // если в первый раз просто не было сети.
    workerPromise = null;
    throw err;
  });

  return workerPromise;
}

/**
 * Текст с картинки — в два прохода.
 *
 * Первый проход читает всё подряд и даёт названия, категории и даты.
 * Второй читает одну правую колонку — ту, где стоят суммы.
 *
 * Второй нужен из-за знака рубля. В общем потоке текста движок принимает
 * его за двойку и приклеивает к числу: «756 ₽» становится «7562», а «1 500 ₽»
 * — «15002». Ошибка тихая: сумма выглядит правдоподобно, сходится только
 * итог месяца, и то если его кто-то проверит. Стоит распознать ту же колонку
 * отдельно — и рубль читается рублём, потому что рядом нет длинных слов,
 * под которые движок подгоняет разбор. На снимке из банка это разница
 * между тремя верными суммами из восьми и восемью из восьми.
 *
 * Ограничивать набор символов цифрами, наоборот, вредно: проверено —
 * рубль тогда всё равно становится двойкой, выбирать больше не из чего.
 *
 * @param {File|Blob} file      снимок экрана
 * @param {Function} onProgress (подпись, доля) — для полосы ожидания
 */
export async function recognise(file, onProgress) {
  const image = await prepare(file);
  const worker = await getWorker(onProgress);
  // Пробелы между словами сохраняются: по ним видно, где кончается название
  // и начинается колонка сумм.
  await worker.setParameters({ preserve_interword_spaces: '1' });

  const full = await worker.recognize(image, {}, { blocks: true });
  const lines = linesOf(full.data);
  const left = amountColumn(lines, image.width);
  if (left >= image.width - 40) return full.data.text || '';

  const column = await worker.recognize(
    image,
    { rectangle: { left, top: 0, width: image.width - left, height: image.height } },
    { blocks: true },
  );
  return rebuild(lines, linesOf(column.data), left);
}

/** Строки с их прямоугольниками — из вложенных блоков движка. */
function linesOf(data) {
  const out = [];
  for (const block of data.blocks || []) {
    for (const paragraph of block.paragraphs || []) {
      for (const line of paragraph.lines || []) {
        out.push({
          text: (line.text || '').trim(),
          top: line.bbox.y0,
          bottom: line.bbox.y1,
          middle: (line.bbox.y0 + line.bbox.y1) / 2,
          words: (line.words || []).map((w) => ({ text: w.text, x0: w.bbox.x0 })),
        });
      }
    }
  }
  return out;
}

/**
 * Где начинается колонка сумм.
 *
 * Границу берём из самой картинки, а не долей ширины: у одного банка суммы
 * прижаты к краю, у другого начинаются от середины, и обрезать наугад значит
 * однажды отрезать половину числа. Ищем самое левое число в правой части
 * экрана и отступаем от него.
 */
function amountColumn(lines, width) {
  let left = width;
  for (const line of lines) {
    for (const word of line.words) {
      if (!/\d/.test(word.text)) continue;
      if (word.x0 < width * 0.45) continue;
      if (word.x0 < left) left = word.x0;
    }
  }

  // Уже 55% ширины не режем никогда, даже если по данным кажется можно.
  // Данные тут сами могут быть неверными: если начало самой длинной суммы
  // прочиталось не как число, граница уезжает вправо и отрезает ей голову —
  // «+145 000,00» превращается в «000,00», то есть в ноль, и строка пропадает.
  // Лишний текст слева от сумм разбору не мешает, отрезанная цифра — мешает.
  const safe = Math.round(width * 0.55);
  return left < width ? Math.min(Math.max(0, left - 30), safe) : safe;
}

// Хвост строки, похожий на сумму. Знак и разделители внутри допускаются,
// хвост из букв и значков к этому моменту уже отрезан.
const TAIL = /[-−–—+]?\s*\d[\d\s   ]*(?:[.,]\d{1,2})?$/u;

/**
 * Собирает строки заново: название из общего прохода, сумма из колонки.
 *
 * Строки сшиваются по вертикали — колонка распознаётся в координатах всей
 * картинки, поэтому середина строки совпадает. Рубль дописывается свой:
 * дальше разбор ищет валюту, а какой буквой её прочитал движок — неважно.
 */
function rebuild(lines, amounts, left) {
  return lines.map((line) => {
    const near = amounts.find((a) => a.middle >= line.top && a.middle <= line.bottom);
    const tail = near ? (near.text.replace(/[^\d]*$/u, '').match(TAIL) || [])[0] : null;
    if (!tail) return line.text;
    const amount = normaliseAmount(tail.trim());

    const before = line.words.filter((w) => w.x0 < left).map((w) => w.text).join(' ').trim();
    return `${before} ${amount} ₽`.trim();
  }).join('\n');
}

/**
 * Убирает из суммы знак рубля, прочитанный цифрой.
 *
 * Даже в отдельной колонке рубль иногда становится двойкой — «−756 ₽»
 * читается как «−756 2». Отличить её от настоящей цифры можно по разрядам:
 * в рублях они всегда по три, и группа из одной-двух цифр в конце числом
 * быть не может. Копейки при этом остаются копейками — их проверяем отдельно,
 * до разбора разрядов.
 */
function normaliseAmount(raw) {
  const text = raw.replace(/([.,]\d{1,2})\s+\d{1,2}$/u, '$1');
  const parts = text.match(/^([-−–—+]?)\s*([\d\s   ]+)((?:[.,]\d{1,2})?)$/u);
  if (!parts) return text;

  const groups = parts[2].trim().split(/[\s   ]+/);
  while (groups.length > 1 && groups[groups.length - 1].length !== 3) groups.pop();
  return `${parts[1]}${groups.join(' ')}${parts[3]}`;
}

/** Освобождает память: движок держит несколько десятков мегабайт. */
export async function release() {
  if (!workerPromise) return;
  const worker = await workerPromise.catch(() => null);
  workerPromise = null;
  if (worker) await worker.terminate();
}

// --------------------------------------------------------------------------
// Подготовка картинки
// --------------------------------------------------------------------------

// Ниже этой ширины буквы в списке операций разваливаются, выше — распознавание
// начинает занимать десятки секунд, ничего не выигрывая.
const TARGET_WIDTH = 1400;
const MAX_HEIGHT = 6000;

/**
 * Готовит снимок к распознаванию: приводит к одной ширине и убирает цвет.
 *
 * Размер важен: снимок с телефона приходит шириной 1290 точек, а снятый
 * с увеличением — вчетверо больше, и движок читает их по-разному.
 */
async function prepare(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(TARGET_WIDTH / bitmap.width, MAX_HEIGHT / bitmap.height, 3);
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  // Качество сглаживания при уменьшении — не косметика: на быстром
  // уменьшении тонкие штрихи выпадают, и запятая в сумме исчезает вместе
  // с ними. Разница на снимке из банка — пять неверных сумм из восьми.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  const pixels = ctx.getImageData(0, 0, width, height);
  const data = pixels.data;

  // Меряем не яркость, а расстояние до цвета фона.
  //
  // По яркости зелёная сумма «+145 000 ₽» на тёмном фоне почти неотличима
  // от самого фона — и приход пропадал со снимка целиком, а это ровно та
  // строка, ради которой считается норма сбережений. Расстояние от фона
  // делает тёмным любой текст, какого бы он ни был цвета, и заодно снимает
  // вопрос про тёмную тему: переворачивать больше нечего.
  const back = background(data);
  for (let i = 0; i < data.length; i += 4) {
    const dr = data[i] - back[0];
    const dg = data[i + 1] - back[1];
    const db = data[i + 2] - back[2];
    const distance = Math.sqrt(dr * dr + dg * dg + db * db);
    // Множитель растягивает слабый контраст: цветной текст отстоит от фона
    // на полсотни единиц там, где чёрный отстоит на две сотни.
    const value = Math.max(0, 255 - distance * 2);
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
  }

  // Порога здесь нет намеренно.
  //
  // Приведение к чистому чёрно-белому выглядит разумно и портит ровно то,
  // что дороже всего: запятую в сумме и тонкий штрих у знака рубля.
  // На снимке из банка это стоило «4 127,24» → «4 12724» и «756 ₽» → «7562».
  // Проверено перебором: карта расстояний без порога читает все суммы,
  // с порогом — теряет одну из восьми.
  ctx.putImageData(pixels, 0, 0);
  return canvas;
}

/**
 * Цвет фона — самый частый цвет картинки.
 *
 * В списке операций фон занимает больше половины площади, и никакой другой
 * цвет с ним не спорит. Оттенки сводятся к пяти битам на канал: без этого
 * сглаживание краёв даёт тысячи почти одинаковых цветов, и самым частым
 * оказывается не фон, а случайный из них.
 */
function background(data) {
  const buckets = new Uint32Array(32 * 32 * 32);
  // Каждый четвёртый пиксель: фон от этого не меняется, а работы вчетверо меньше.
  for (let i = 0; i < data.length; i += 16) {
    const key = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
    buckets[key] += 1;
  }
  let best = 0;
  for (let i = 1; i < buckets.length; i += 1) {
    if (buckets[i] > buckets[best]) best = i;
  }
  return [
    ((best >> 10) & 31) * 8 + 4,
    ((best >> 5) & 31) * 8 + 4,
    (best & 31) * 8 + 4,
  ];
}


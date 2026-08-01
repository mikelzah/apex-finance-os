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
 * Текст с картинки.
 *
 * @param {File|Blob} file      снимок экрана
 * @param {Function} onProgress (подпись, доля) — для полосы ожидания
 */
export async function recognise(file, onProgress) {
  const image = await prepare(file);
  const worker = await getWorker(onProgress);
  const { data } = await worker.recognize(image);
  return data.text || '';
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
 * Готовит снимок к распознаванию.
 *
 * Три вещи, без которых на снимке из банка получается каша:
 *
 * 1. Тёмная тема. Половина людей держит телефон в тёмной теме, и снимок
 *    выходит белым по чёрному. Движок обучен на чёрном по белому и на
 *    инверсии теряет строки целиком — поэтому яркость меряется и картинка
 *    при необходимости переворачивается.
 * 2. Размер. Скриншот с телефона приходит шириной 1290 точек, но снятый
 *    с увеличением — вчетверо больше. Приводим к одной ширине.
 * 3. Цвет. Серый вместо цветного — меньше работы движку и никакой потери:
 *    цвет в списке операций несёт разве что знак суммы, а знак есть и в тексте.
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

  // Порог по Оцу — чистый чёрный по чистому белому.
  //
  // Без него тёмная тема после переворота даёт серые буквы с ореолами,
  // и знак рубля читается как двойка. Ошибка тихая и дорогая: строка
  // с суммой просто исчезает, потому что «40 000 2» — уже не сумма.
  // На снимке экрана порог безопасен: текст там нарисован, а не снят
  // на камеру, и полутонов между фоном и буквой почти нет.
  const threshold = otsu(data);
  for (let i = 0; i < data.length; i += 4) {
    const value = data[i] < threshold ? 0 : 255;
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
  }

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

/**
 * Порог, делящий картинку на две части с наименьшим разбросом внутри каждой.
 *
 * Классический способ Оцу: перебираем все 256 порогов и берём тот, где
 * разброс между «фоном» и «буквами» наибольший. Считается по накопленным
 * суммам за один проход по гистограмме, а не за 256 проходов по картинке.
 */
function otsu(data) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < data.length; i += 4) hist[data[i]] += 1;

  const total = data.length / 4;
  let sum = 0;
  for (let i = 0; i < 256; i += 1) sum += i * hist[i];

  let sumB = 0;
  let weightB = 0;
  let best = 0;
  let bestVariance = -1;

  for (let t = 0; t < 256; t += 1) {
    weightB += hist[t];
    if (!weightB) continue;
    const weightF = total - weightB;
    if (!weightF) break;

    sumB += t * hist[t];
    const meanB = sumB / weightB;
    const meanF = (sum - sumB) / weightF;
    const variance = weightB * weightF * (meanB - meanF) ** 2;
    if (variance > bestVariance) { bestVariance = variance; best = t; }
  }
  return best;
}

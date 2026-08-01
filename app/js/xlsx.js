// Чтение xlsx без библиотек.
//
// Банк отдаёт выписку таблицей Excel, а не CSV — Альфа-Банк только так.
// Тянуть ради этого стороннюю библиотеку нельзя: приложение работает офлайн
// и грузится целиком в кэш, а любой внешний скрипт — это и лишние сотни
// килобайт, и чужой код рядом с деньгами.
//
// Внутри xlsx — обычный zip с XML. Распаковка делается штатным
// DecompressionStream, разбор XML — штатным DOMParser. Своего кода здесь
// только то, что читает оглавление zip.

/**
 * Разбирает xlsx в таблицу строк. Возвращает массив массивов строк —
 * ту же форму, что даёт разбор CSV, чтобы дальше всё шло общим путём.
 */
export async function readSheet(buffer) {
  const files = await unzip(new Uint8Array(buffer));

  const sheetName = Object.keys(files).find((n) => /^xl\/worksheets\/sheet1\.xml$/i.test(n))
    || Object.keys(files).find((n) => /^xl\/worksheets\/.*\.xml$/i.test(n));
  if (!sheetName) throw new Error('в файле нет листа с данными');

  const strings = files['xl/sharedStrings.xml'] ? sharedStrings(decode(files['xl/sharedStrings.xml'])) : [];
  return rowsOf(decode(files[sheetName]), strings);
}

// --------------------------------------------------------------------------
// zip
// --------------------------------------------------------------------------

const decoder = new TextDecoder('utf-8');
const decode = (bytes) => decoder.decode(bytes);

/**
 * Распаковывает zip целиком.
 *
 * Идём от конца: в хвосте лежит запись о центральном каталоге, в каталоге —
 * смещения файлов. Читать zip с начала подряд нельзя — размер сжатого куска
 * в локальном заголовке бывает нулевым, а настоящий лежит только в каталоге.
 */
async function unzip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEOCD(view);
  if (eocd < 0) throw new Error('это не xlsx');

  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const out = {};

  for (let i = 0; i < count; i += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) break;
    const method = view.getUint16(offset + 10, true);
    const compressed = view.getUint32(offset + 20, true);
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const localAt = view.getUint32(offset + 42, true);
    const name = decode(bytes.subarray(offset + 46, offset + 46 + nameLen));

    // Нужны два файла из десятка — остальные (стили, темы, картинки)
    // распаковывать незачем, а на телефоне это заметная разница.
    if (/^xl\/(worksheets\/.*\.xml|sharedStrings\.xml)$/i.test(name)) {
      const localNameLen = view.getUint16(localAt + 26, true);
      const localExtraLen = view.getUint16(localAt + 28, true);
      const start = localAt + 30 + localNameLen + localExtraLen;
      const chunk = bytes.subarray(start, start + compressed);
      out[name] = method === 0 ? chunk : await inflate(chunk);
    }
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function findEOCD(view) {
  // Хвостовая запись длиной 22 байта плюс комментарий до 64 КБ.
  const from = Math.max(0, view.byteLength - 66000);
  for (let i = view.byteLength - 22; i >= from; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) return i;
  }
  return -1;
}

async function inflate(chunk) {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('этот браузер не умеет распаковывать xlsx — сохраните выписку в CSV');
  }
  const stream = new Blob([chunk]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// --------------------------------------------------------------------------
// XML листа
// --------------------------------------------------------------------------

function parseXml(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('лист повреждён');
  return doc;
}

/**
 * Общая таблица строк. Excel хранит повторяющийся текст один раз, а в ячейках
 * держит номера — без неё вместо описаний операций получатся числа.
 */
function sharedStrings(text) {
  const doc = parseXml(text);
  return [...doc.getElementsByTagName('si')].map((si) =>
    [...si.getElementsByTagName('t')].map((t) => t.textContent).join(''));
}

function rowsOf(text, strings) {
  const doc = parseXml(text);
  const rows = [];

  for (const row of doc.getElementsByTagName('row')) {
    const cells = [];
    for (const cell of row.getElementsByTagName('c')) {
      // Пустые ячейки в xlsx просто отсутствуют, и без разбора адреса
      // «A1» соседние столбцы съезжают влево — вместе с суммами.
      const index = columnIndex(cell.getAttribute('r'));
      const type = cell.getAttribute('t');
      let value = '';

      if (type === 's') {
        const at = Number(cell.getElementsByTagName('v')[0]?.textContent);
        value = strings[at] ?? '';
      } else if (type === 'inlineStr') {
        value = [...cell.getElementsByTagName('t')].map((t) => t.textContent).join('');
      } else {
        value = cell.getElementsByTagName('v')[0]?.textContent ?? '';
      }

      while (cells.length < index) cells.push('');
      cells[index] = String(value).trim();
    }
    rows.push(cells);
  }

  // Хвост пустых строк ни на что не влияет, но сбивает счётчик «строк в файле»,
  // который человек сверяет глазами с банком.
  while (rows.length && rows[rows.length - 1].every((x) => !x)) rows.pop();
  return rows;
}

/** «BC12» → 54. Адрес ячейки несёт номер столбца, и он единственный надёжный. */
function columnIndex(ref) {
  const letters = String(ref || '').match(/^[A-Z]+/i);
  if (!letters) return 0;
  let n = 0;
  for (const ch of letters[0].toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

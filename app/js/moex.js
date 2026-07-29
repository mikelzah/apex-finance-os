// Котировки Мосбиржи. ISS — публичный, без ключа.
//
// Браузер ходит туда напрямую, и это работает ровно до тех пор, пока ISS
// отдаёт заголовки CORS. Проверить это заранее нельзя, поведение может
// измениться в любой момент, поэтому любая ошибка здесь не считается
// поломкой: приложение просто оставляет последнюю известную цену
// и предлагает ввести новую руками.

const ISS = 'https://iss.moex.com/iss/engines/stock/markets/shares/boards/{board}/securities/{ticker}.json';

// Для фондов у Мосбиржи встречается и TQTF, и TQTD. Сначала пробуем режим
// из карточки актива, потом остальные по очереди — при смене кода не сломается.
const FALLBACK_BOARDS = ['TQBR', 'TQTF', 'TQTD'];

const TIMEOUT_MS = 8000;

function firstValue(payload, block, column) {
  const section = payload[block];
  if (!section || !section.columns || !section.data || !section.data.length) return null;
  const i = section.columns.indexOf(column);
  if (i === -1) return null;
  for (const row of section.data) {
    if (row[i] != null) return row[i];
  }
  return null;
}

async function fetchBoard(ticker, board) {
  const url = ISS.replace('{board}', board).replace('{ticker}', encodeURIComponent(ticker));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${url}?iss.meta=off`, { signal: controller.signal });
    if (!res.ok) return null;
    const payload = await res.json();

    // LAST — цена последней сделки, есть только пока идут торги.
    // После закрытия берём цену закрытия, затем итог предыдущего дня.
    for (const [block, column, source] of [
      ['marketdata', 'LAST', 'LAST'],
      ['marketdata', 'LCLOSEPRICE', 'LCLOSE'],
      ['marketdata', 'MARKETPRICE', 'MARKET'],
      ['securities', 'PREVPRICE', 'PREV'],
      ['securities', 'PREVLEGALCLOSEPRICE', 'PREVLEGAL'],
    ]) {
      const value = firstValue(payload, block, column);
      if (value) return { price: Number(value), board, source };
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Цена одного тикера. null — не удалось, вызывающий решает что делать. */
export async function price(ticker, board) {
  const order = board ? [board, ...FALLBACK_BOARDS.filter((b) => b !== board)] : FALLBACK_BOARDS;
  for (const candidate of order) {
    const hit = await fetchBoard(ticker, candidate);
    if (hit) return hit;
  }
  return null;
}

/**
 * Цены пачкой. Возвращает и удачи, и промахи — экран показывает,
 * что именно не обновилось, вместо молчаливого «всё хорошо».
 */
export async function prices(tickers) {
  const results = await Promise.all(
    tickers.map(async ({ ticker, board }) => {
      const hit = await price(ticker, board);
      return { ticker, ok: Boolean(hit), ...(hit || {}) };
    }),
  );
  return results;
}

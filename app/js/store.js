// Хранилище. Всё живёт в телефоне и никуда не уходит.
//
// Данных мало — активов единицы, операций сотни в год, — поэтому состояние
// держится целиком в памяти и пишется одним документом. Так запись атомарна:
// не бывает состояния, где операция уже сохранилась, а остаток актива ещё нет.
// Разносить по отдельным хранилищам имело бы смысл на десятках тысяч записей.

// Список классов живёт в расчётном ядре — там же, где им пользуются.
// Дублировать его здесь значило бы однажды разойтись.
import * as C from './calc.js';
const { ASSET_CLASSES } = C;

// Имя базы не меняется вместе с названием приложения — и не должно:
// в IndexedDB это адрес хранилища, а не подпись. Переименуй его — и телефон
// откроет пустую базу, а все данные останутся лежать под прежним именем,
// невидимые. То же и с ключом в localStorage ниже.
const DB_NAME = 'apex-finance-os';
const DB_VERSION = 1;
const STORE = 'kv';
const KEY = 'state';
const LS_KEY = 'apex-finance-os:state';

let state = null;
const listeners = new Set();

// --------------------------------------------------------------------------
// Низкий уровень: IndexedDB, с откатом на localStorage
// --------------------------------------------------------------------------

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in self)) {
      reject(new Error('IndexedDB недоступен'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch((err) => {
    // Приватный режим Safari умеет отдавать открытую базу, которая падает
    // на первой же транзакции. Тогда работаем через localStorage.
    console.warn('IndexedDB недоступен, переключаюсь на localStorage:', err);
    return null;
  });
  return dbPromise;
}

async function readRaw() {
  const db = await openDB();
  if (!db) {
    const text = localStorage.getItem(LS_KEY);
    return text ? JSON.parse(text) : null;
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(KEY);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  }).catch(() => {
    const text = localStorage.getItem(LS_KEY);
    return text ? JSON.parse(text) : null;
  });
}

async function writeRaw(value) {
  const db = await openDB();
  if (!db) {
    localStorage.setItem(LS_KEY, JSON.stringify(value));
    return;
  }
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, KEY);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }).catch((err) => {
    console.warn('Запись в IndexedDB не удалась, пишу в localStorage:', err);
    localStorage.setItem(LS_KEY, JSON.stringify(value));
  });
}

// --------------------------------------------------------------------------
// Состояние
// --------------------------------------------------------------------------

function emptyState() {
  return {
    schemaVersion: 1,
    seedVersion: 0,
    assets: [],
    goals: [],
    operations: [],
    portfolio: [],
    tax: [],
    netWorth: [],
    keyRate: [],
    priceHistory: [],
    settings: {
      quickAmount: 1250,
      quickAssetId: null,
      quickGoalId: null,
      backupReminderDays: 14,
      taxLimitBase: 1000000,
      autoQuotes: true,
      // Скрытые сигналы: [{ key, text }]. Формулировка хранится рядом с
      // ключом, чтобы изменившийся сигнал показался заново.
      mutedSignals: [],
      // Развёрнут ли блок сигналов. null — человек ещё не выбирал, тогда
      // блок открывается сам, если есть ошибки.
      signalsOpen: null,
    },
    meta: {
      lastBackupAt: null,
      createdAt: new Date().toISOString(),
      // Сделан ли выбор на первом запуске. Пустота сама по себе не признак
      // новичка: «начать с нуля» тоже оставляет пустое состояние, и без
      // этого флага такой человек бесконечно возвращался бы на экран выбора.
      onboarded: false,
    },
  };
}

/** Дотягивает старое сохранённое состояние до текущей формы. */
function migrate(loaded) {
  const base = emptyState();
  const next = { ...base, ...loaded };
  next.settings = { ...base.settings, ...(loaded.settings || {}) };
  if (!Array.isArray(next.settings.mutedSignals)) next.settings.mutedSignals = [];
  migrateClasses(next, loaded.settings || {});
  next.meta = { ...base.meta, ...(loaded.meta || {}) };
  for (const key of ['assets', 'goals', 'operations', 'portfolio', 'tax', 'netWorth', 'keyRate', 'priceHistory']) {
    if (!Array.isArray(next[key])) next[key] = [];
  }
  // Размер лота появился вместе со сделками. Единица — не догадка, а самый
  // частый случай на Мосбирже; где не так, поправляется в карточке бумаги.
  for (const a of next.assets) {
    if (a.lotSize == null) a.lotSize = 1;
  }
  return next;
}

/**
 * Класс портфеля переехал из таблицы «тикер → класс» в поле самого актива.
 *
 * Разбираем старое соответствие по смыслу, а не по совпадению строки:
 * «Денежный рынок» — это фонды, «ОФЗ» — облигации. Что не разобралось,
 * остаётся пустым: пустой класс значит «не входит в расчёт долей», и это
 * честнее, чем угадать и молча перекосить портфель. Машина и квартира
 * попадают сюда же — им класс задавать и не нужно.
 */
function guessClass(text) {
  const t = String(text || '').toLowerCase();
  if (!t) return null;
  if (t.includes('облигац') || t.includes('офз') || t.includes('бонд')) return 'Облигации';
  if (t.includes('фонд') || t.includes('денежн') || t.includes('etf') || t.includes('бпиф')) return 'Фонды';
  if (t.includes('акц')) return 'Акции';
  if (t.includes('вклад') || t.includes('депозит') || t.includes('счёт') || t.includes('счет')) return 'Вклады';
  return null;
}

function migrateClasses(next, oldSettings) {
  const byTicker = oldSettings.classByTicker || {};

  for (const a of next.assets) {
    if (a.assetClass !== undefined && a.assetClass !== null) continue;
    a.assetClass = a.ticker ? guessClass(byTicker[a.ticker]) : null;
    // Вклад и накопительный счёт тикера не имеют, но в портфель входят:
    // раньше попасть туда они не могли вовсе.
    if (!a.assetClass && !a.ticker && a.rate) a.assetClass = 'Вклады';
  }

  // Целевые доли: оставляем только те, что относятся к нынешним классам.
  const known = new Map();
  for (const row of next.portfolio) {
    const cls = ASSET_CLASSES.includes(row.class) ? row.class : guessClass(row.class);
    if (!cls || known.has(cls)) continue;
    known.set(cls, { ...row, class: cls });
  }
  next.portfolio = [...known.values()];

  delete next.settings.classByTicker;
  delete next.settings.classFallback;
}

/**
 * Загрузка состояния.
 *
 * Ничего не подставляется само: приложение не имеет права молча положить
 * человеку чужие цифры и выдать их за его капитал. Если сохранённого
 * состояния нет, возвращаем признак пустоты — экран первого запуска
 * спросит, начать с нуля или посмотреть на демо-данных.
 */
export async function init() {
  const loaded = await readRaw();
  if (loaded) {
    state = migrate(loaded);
    return { empty: false };
  }
  state = emptyState();
  return { empty: true };
}

async function loadFile(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const next = migrate({ ...emptyState(), ...data, seedVersion: data.seedVersion || 1 });
  next.meta.onboarded = true;
  delete next.note;
  delete next.generatedAt;
  return next;
}

/** Начать с чистого листа: активов нет, экраны показывают пустые состояния. */
export async function startEmpty() {
  state = emptyState();
  state.meta.onboarded = true;
  await writeRaw(state);
  notify();
}

/** Вымышленные демо-данные — посмотреть, как всё работает. */
export async function loadDemo() {
  state = await loadFile('./data/demo.json');
  await writeRaw(state);
  notify();
}


export function getState() {
  if (!state) throw new Error('Хранилище не инициализировано');
  return state;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  for (const fn of listeners) fn(state);
}

/** Единственный способ изменить данные: мутируем черновик, потом сохраняем. */
export async function mutate(fn) {
  const draft = structuredClone(state);
  const result = fn(draft);
  state = draft;
  await writeRaw(state);
  notify();
  return result;
}

// --------------------------------------------------------------------------
// Операции над коллекциями
// --------------------------------------------------------------------------

export function newId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function upsert(list, item) {
  const i = list.findIndex((x) => x.id === item.id);
  if (i === -1) list.push(item);
  else list[i] = { ...list[i], ...item };
  return item;
}

export function remove(list, id) {
  const i = list.findIndex((x) => x.id === id);
  if (i !== -1) list.splice(i, 1);
}

// --------------------------------------------------------------------------
// Сделки
// --------------------------------------------------------------------------

/**
 * Операция по бумаге и движение денег записываются одной правкой.
 *
 * Двойной записи в приложении нет — операция принадлежит одному активу.
 * Поэтому денежная сторона сделки это обычная операция по счёту, привязанная
 * к сделке полем linkedTo. Так её видно в журнале как настоящее списание,
 * и она сама уходит вслед за сделкой при удалении.
 *
 * Вид денежной операции выбран не произвольно. Покупка — расход: он уменьшает
 * базу начисления процентов ровно так, как уменьшил её реальный платёж.
 * Всё остальное — продажа, дивиденд, купон — взнос без цели: доходом их
 * записать нельзя, доходы читает расчёт процентов и налоговый лимит по
 * вкладам, и выручка с выплатами испортили бы оба. Пустая цель оставляет
 * в стороне и дисциплину: план по цели считает только взносы, относящиеся
 * к ней.
 */
export function savePaperOp(draft, op, cashAssetId) {
  upsert(draft.operations, op);

  const legs = draft.operations.filter((x) => x.linkedTo === op.id);
  for (const leg of legs) remove(draft.operations, leg.id);
  if (!cashAssetId) return op;

  upsert(draft.operations, {
    id: legs[0]?.id || newId('op'),
    date: op.date,
    type: op.type === C.OP_BUY ? C.OP_EXPENSE : C.OP_CONTRIBUTION,
    amount: op.amount,
    assetId: cashAssetId,
    goalId: null,
    source: C.SOURCE_MANUAL,
    comment: `${op.type}: ${op.ticker || ''}`.trim(),
    linkedTo: op.id,
  });
  return op;
}

/** Операция по бумаге уходит вместе со своим движением денег. */
export function removePaperOp(draft, id) {
  for (const leg of draft.operations.filter((op) => op.linkedTo === id)) {
    remove(draft.operations, leg.id);
  }
  remove(draft.operations, id);
}

/** Счёт, через который прошли деньги, — чтобы форма открылась как есть. */
export function linkedCashAsset(operations, id) {
  return operations.find((op) => op.linkedTo === id)?.assetId || '';
}

// --------------------------------------------------------------------------
// Снимки капитала
// --------------------------------------------------------------------------

/**
 * Снимок капитала за текущий месяц.
 *
 * Одна строка на месяц, она же и перезаписывается: к концу месяца в ней
 * последнее известное состояние, а база не разрастается на 250 строк в год.
 *
 * Вызывается и кнопкой, и сама при запуске. Само по себе это важнее кнопки:
 * история, которую надо помнить записывать, не набирается никогда, а без неё
 * нечего и раскладывать на вложенное и наросшее.
 */
export async function snapshotWorth(day) {
  const worth = C.netWorth(state.assets, state.operations);
  const month = day.slice(0, 7);
  const existing = state.netWorth.find((r) => r.month === month);

  // Ничего не изменилось — не пишем: запись дёргает подписчиков и заставляет
  // приложение перерисоваться на ровном месте.
  if (existing
      && existing.date === day
      && Math.abs((existing.total || 0) - C.round2(worth.total)) < 0.01) {
    return false;
  }

  await mutate((draft) => {
    const payload = {
      month,
      date: day,
      total: C.round2(worth.total),
      liquid: C.round2(worth.liquid),
      invested: C.round2(worth.invested),
    };
    const row = draft.netWorth.find((r) => r.month === month);
    if (row) Object.assign(row, payload);
    else draft.netWorth.push(payload);
  });
  return true;
}

// --------------------------------------------------------------------------
// Резервная копия
// --------------------------------------------------------------------------

export function exportPayload() {
  return {
    app: 'Кубыш',
    exportedAt: new Date().toISOString(),
    ...state,
  };
}

export function exportText() {
  return JSON.stringify(exportPayload(), null, 2);
}

/**
 * Импорт заменяет состояние целиком, а не сливает.
 * Слияние двух расходящихся копий журнала операций без общей истории
 * даёт дубли, которые потом руками не разберёшь.
 */
export async function importText(text) {
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object') throw new Error('Это не похоже на копию данных');
  if (!Array.isArray(parsed.assets) || !Array.isArray(parsed.operations)) {
    throw new Error('В файле нет активов и операций — похоже, это не та копия');
  }
  const next = migrate(parsed);
  next.meta.onboarded = true;
  delete next.app;
  delete next.exportedAt;
  state = next;
  await writeRaw(state);
  notify();
  return {
    assets: state.assets.length,
    operations: state.operations.length,
    goals: state.goals.length,
  };
}

export async function markBackedUp() {
  await mutate((draft) => {
    draft.meta.lastBackupAt = new Date().toISOString();
  });
}

export async function wipe() {
  state = emptyState();
  await writeRaw(state);
  notify();
}

/** Показывать ли экран первого запуска: выбор ещё не сделан. */
export function needsOnboarding() {
  return !state.meta.onboarded;
}

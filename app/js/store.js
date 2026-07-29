// Хранилище. Всё живёт в телефоне и никуда не уходит.
//
// Данных мало — активов единицы, операций сотни в год, — поэтому состояние
// держится целиком в памяти и пишется одним документом. Так запись атомарна:
// не бывает состояния, где операция уже сохранилась, а остаток актива ещё нет.
// Разносить по отдельным хранилищам имело бы смысл на десятках тысяч записей.

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
      classByTicker: {},
      classFallback: 'Прочее',
      autoQuotes: true,
    },
    meta: { lastBackupAt: null, createdAt: new Date().toISOString() },
  };
}

/** Дотягивает старое сохранённое состояние до текущей формы. */
function migrate(loaded) {
  const base = emptyState();
  const next = { ...base, ...loaded };
  next.settings = { ...base.settings, ...(loaded.settings || {}) };
  next.meta = { ...base.meta, ...(loaded.meta || {}) };
  for (const key of ['assets', 'goals', 'operations', 'portfolio', 'tax', 'netWorth', 'keyRate', 'priceHistory']) {
    if (!Array.isArray(next[key])) next[key] = [];
  }
  return next;
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
  delete next.note;
  delete next.generatedAt;
  return next;
}

/** Начать с чистого листа: активов нет, экраны показывают пустые состояния. */
export async function startEmpty() {
  state = emptyState();
  await writeRaw(state);
  notify();
}

/** Вымышленные демо-данные — посмотреть, как всё работает. */
export async function loadDemo() {
  state = await loadFile('./data/demo.json');
  await writeRaw(state);
  notify();
}

/** Личный слепок из Notion. Отдельно от демо и намеренно не по умолчанию. */
export async function loadSeed() {
  state = await loadFile('./data/seed.json');
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
// Резервная копия
// --------------------------------------------------------------------------

export function exportPayload() {
  return {
    app: 'APEX Finance OS',
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

/** Есть ли вообще с чем работать — от этого зависит, показывать ли первый запуск. */
export function isEmpty() {
  return !state.assets.length && !state.operations.length && !state.goals.length;
}

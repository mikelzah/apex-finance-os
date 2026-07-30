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
 * Сделка и списание с денежного счёта записываются одной правкой.
 *
 * Двойной записи в приложении нет — операция принадлежит одному активу.
 * Поэтому денежная сторона сделки это обычная операция по счёту, привязанная
 * к сделке полем linkedTo. Так её видно в журнале как настоящее списание,
 * и она сама уходит вслед за сделкой при удалении.
 *
 * Вид денежной операции выбран не произвольно. Покупка — расход: он уменьшает
 * базу начисления процентов ровно так, как уменьшил её реальный платёж.
 * Продажа — взнос без цели: доходом её записать нельзя, доходы читает расчёт
 * процентов и налог, и выручка от продажи испортила бы оба. Пустая цель
 * оставляет в стороне и дисциплину: план по цели считает только взносы,
 * относящиеся к ней.
 */
export function saveTrade(draft, trade, cashAssetId) {
  upsert(draft.operations, trade);

  const legs = draft.operations.filter((op) => op.linkedTo === trade.id);
  for (const leg of legs) remove(draft.operations, leg.id);
  if (!cashAssetId) return trade;

  const isBuy = trade.type === C.OP_BUY;
  upsert(draft.operations, {
    id: legs[0]?.id || newId('op'),
    date: trade.date,
    type: isBuy ? C.OP_EXPENSE : C.OP_CONTRIBUTION,
    amount: trade.amount,
    assetId: cashAssetId,
    goalId: null,
    source: C.SOURCE_MANUAL,
    comment: `${trade.type}: ${trade.ticker || ''}`.trim(),
    linkedTo: trade.id,
  });
  return trade;
}

/** Сделка уходит вместе со своим списанием: одна без другой — перекос. */
export function removeTrade(draft, tradeId) {
  for (const leg of draft.operations.filter((op) => op.linkedTo === tradeId)) {
    remove(draft.operations, leg.id);
  }
  remove(draft.operations, tradeId);
}

/** Денежный счёт, с которого оплачена сделка, — чтобы форма открылась как есть. */
export function tradeCashAsset(operations, tradeId) {
  return operations.find((op) => op.linkedTo === tradeId)?.assetId || '';
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

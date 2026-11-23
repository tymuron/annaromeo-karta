/**
 * Локальное сохранение и восстановление сессии работы ученицы
 * (IndexedDB с запасным вариантом в localStorage).
 * Сохраняется уменьшенная копия плана, углы контура, Север и настройки отображения.
 */

const DB_NAME = 'anna_romeo_vastu_karta_db';
const DB_VERSION = 1;
const STORE_NAME = 'sessions';
const SESSION_KEY = 'active_session_v2';
const LS_FALLBACK_KEY = 'anna_romeo_vastu_karta_session_v2';

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open error'));
  });
}

async function idbSet(key, value) {
  const db = await openDatabase();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('IndexedDB write error'));
    });
  } finally {
    db.close();
  }
}

async function idbGet(key) {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error || new Error('IndexedDB read error'));
    });
  } finally {
    db.close();
  }
}

async function idbClearAll() {
  const db = await openDatabase();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.delete(SESSION_KEY);
      store.clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('IndexedDB clear error'));
    });
  } finally {
    db.close();
  }
}

/**
 * Создаёт компактную уменьшенную копию базового холста плана для хранения на устройстве.
 */
export function downscalePlanToDataUrl(sourceCanvas, maxSide = 1400) {
  if (!sourceCanvas) return null;
  const sw = sourceCanvas.width || 1;
  const sh = sourceCanvas.height || 1;
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));

  const temp = document.createElement('canvas');
  temp.width = w;
  temp.height = h;
  const tctx = temp.getContext('2d');
  tctx.fillStyle = '#FFFFFF';
  tctx.fillRect(0, 0, w, h);
  tctx.drawImage(sourceCanvas, 0, 0, w, h);
  return temp.toDataURL('image/jpeg', 0.85);
}

/**
 * Восстанавливает холст базового плана исходного логического размера (logicalWidth × logicalHeight)
 * из сохранённого dataUrl, чтобы координаты всех углов совпадали без погрешности.
 */
export function restorePlanCanvasFromDataUrl(dataUrl, logicalWidth, logicalHeight) {
  return new Promise((resolve, reject) => {
    if (!dataUrl) {
      reject(new Error('Empty plan dataUrl'));
      return;
    }
    const img = new Image();
    img.onload = () => {
      const w = Math.max(1, Math.round(logicalWidth || img.naturalWidth || 1));
      const h = Math.max(1, Math.round(logicalHeight || img.naturalHeight || 1));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas);
    };
    img.onerror = () => reject(new Error('Failed to decode saved plan'));
    img.src = dataUrl;
  });
}

export async function saveWorkspaceSession(record) {
  try {
    await idbSet(SESSION_KEY, record);
  } catch {
    // Запасной путь через localStorage
  }

  try {
    localStorage.setItem(LS_FALLBACK_KEY, JSON.stringify(record));
  } catch {
    // Если снимок велик для localStorage, сохраняем хотя бы метаданные без картинки,
    // пока полная версия лежит в IndexedDB
    try {
      const slim = { ...record, basePlanDataUrl: null };
      localStorage.setItem(LS_FALLBACK_KEY, JSON.stringify(slim));
    } catch {
      // Игнорируем переполнение квоты
    }
  }
}

export async function loadWorkspaceSession() {
  try {
    const fromIdb = await idbGet(SESSION_KEY);
    if (fromIdb && fromIdb.version === 2) {
      return fromIdb;
    }
  } catch {
    // Переходим к запасному хранилищу
  }

  try {
    const raw = localStorage.getItem(LS_FALLBACK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.version === 2) {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Полностью очищает сохранённую сессию из IndexedDB, localStorage и sessionStorage
 * (используется кнопкой «Новая карта»).
 */
export async function clearWorkspaceSession() {
  try {
    await idbClearAll();
  } catch {
    // IndexedDB может быть недоступен (например, приватный режим или тестовая среда Node)
  }

  for (const store of [
    typeof localStorage !== 'undefined' ? localStorage : null,
    typeof sessionStorage !== 'undefined' ? sessionStorage : null,
  ]) {
    if (!store) continue;
    try {
      store.removeItem(LS_FALLBACK_KEY);
      if (typeof store.length === 'number' && typeof store.key === 'function') {
        const toRemove = [];
        for (let i = 0; i < store.length; i++) {
          const k = store.key(i);
          if (k && k.startsWith('anna_romeo_vastu_karta')) {
            toRemove.push(k);
          }
        }
        for (const k of toRemove) {
          store.removeItem(k);
        }
      }
    } catch {
      // Игнорируем ограничения доступа к хранилищу
    }
  }
}

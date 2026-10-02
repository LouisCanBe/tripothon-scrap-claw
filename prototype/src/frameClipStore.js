// 相框成品缓存。键 = 像素范围 + 校准。值是已经织好的 PNG。
export const YAW_STEPS = 24;
export const DROP_FRAME_MS = 50;

export function clipBase(size, cal) {
  const n = (v, d) => Number(v).toFixed(d);
  return [
    `${size.w}x${size.h}`,
    n(cal.pitch, 5),
    n(cal.offset, 4),
    n(cal.tan, 2),
    cal.views,
    cal.viewWidth,
    n(cal.spacing, 4),
  ].join('|');
}

export function clipKey(base, id) {
  return `${base}|${id}`;
}

function openClipDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('tripo-frame-clips', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('clips')) db.createObjectStore('clips');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function clipGet(key) {
  const db = await openClipDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction('clips', 'readonly').objectStore('clips').get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function clipPut(key, value) {
  const db = await openClipDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction('clips', 'readwrite').objectStore('clips').put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function clipList(base) {
  const db = await openClipDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction('clips', 'readonly').objectStore('clips').getAllKeys();
    req.onsuccess = () => {
      const prefix = `${base}|`;
      resolve(req.result
        .map((k) => String(k))
        .filter((k) => k.startsWith(prefix))
        .map((k) => k.slice(prefix.length)));
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * videoStorage.js
 *
 * Cross-tab storage for local video files selected in the Admin screen (#admin).
 * Uses IndexedDB so the admin tab can store a File/Blob of any size (hundreds of MB)
 * without server uploads or localStorage quota limits, and the game tab on the
 * same origin can immediately read it as a Blob and play it via URL.createObjectURL.
 */

const DB_NAME = 'cuida-media-db';
const DB_VERSION = 1;
const STORE_NAME = 'videos';
const ACTIVE_VIDEO_KEY = 'active-video';

function openMediaDB() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB no está disponible en este navegador.'));
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
    req.onerror = () => reject(req.error || new Error('No se pudo abrir IndexedDB.'));
  });
}

/**
 * Save a File or Blob selected in the Admin panel.
 * @param {File} file
 * @returns {Promise<{ name: string, size: number, type: string, updatedAt: number }>}
 */
export async function saveVideoFile(file) {
  const db = await openMediaDB();
  const updatedAt = Date.now();
  const record = {
    blob: file,
    name: file.name || 'video.mp4',
    size: file.size || 0,
    type: file.type || 'video/mp4',
    updatedAt,
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(record, ACTIVE_VIDEO_KEY);
    tx.oncomplete = () => {
      db.close();
      resolve({
        name: record.name,
        size: record.size,
        type: record.type,
        updatedAt: record.updatedAt,
      });
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error || new Error('Error al guardar el archivo de video.'));
    };
  });
}

/**
 * Load the currently stored video File/Blob in the game tab.
 * @returns {Promise<{ blob: Blob, name: string, size: number, type: string, updatedAt: number } | null>}
 */
export async function loadVideoFile() {
  const db = await openMediaDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(ACTIVE_VIDEO_KEY);
    req.onsuccess = () => {
      db.close();
      resolve(req.result || null);
    };
    req.onerror = () => {
      db.close();
      reject(req.error || new Error('Error al leer el archivo de video.'));
    };
  });
}

/**
 * Delete the stored video file from IndexedDB.
 */
export async function clearVideoFile() {
  const db = await openMediaDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(ACTIVE_VIDEO_KEY);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}


/**
 * Receipt photos kept on the phone until there is signal again (#47).
 *
 * IndexedDB, because it holds files and survives the browser being closed.
 * public/offline.html — the page the service worker shows when there is no
 * connection at all — writes to the same database with the same names, so
 * change them in both places or not at all.
 */

export const OFFLINE_DB = "fmb-offline";
export const OFFLINE_DB_VERSION = 1;
export const OFFLINE_STORE = "receipts";

/** Fired on the window when a photo is kept, so the sender knows to look. */
export const QUEUED_EVENT = "fmb-receipt-queued";

export type QueuedReceipt = {
  id: string;
  blob: Blob;
  name: string;
  type: string;
  /** When it was taken, as an ISO timestamp. */
  takenAt: string;
};

export function offlineQueueSupported(): boolean {
  return typeof indexedDB !== "undefined";
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(OFFLINE_DB, OFFLINE_DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(OFFLINE_STORE)) {
        request.result.createObjectStore(OFFLINE_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(OFFLINE_STORE, mode);
      const request = work(tx.objectStore(OFFLINE_STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function queueReceipt(file: Blob, name: string): Promise<void> {
  const entry: QueuedReceipt = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    blob: file,
    name,
    type: file.type || "image/jpeg",
    takenAt: new Date().toISOString(),
  };
  await withStore("readwrite", (store) => store.put(entry));
  window.dispatchEvent(new Event(QUEUED_EVENT));
}

export async function queuedReceipts(): Promise<QueuedReceipt[]> {
  if (!offlineQueueSupported()) return [];
  const all = await withStore<QueuedReceipt[]>("readonly", (store) => store.getAll() as IDBRequest<QueuedReceipt[]>);
  return all.sort((a, b) => a.takenAt.localeCompare(b.takenAt));
}

export async function removeQueued(id: string): Promise<void> {
  await withStore("readwrite", (store) => store.delete(id));
}

/**
 * Whether a failed call failed for want of a connection, rather than because
 * the server said no — only the first is worth keeping the photo for.
 */
export function isConnectionFailure(error: unknown, online: boolean): boolean {
  if (!online) return true;
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /failed to fetch|network ?error|load failed|networkerror|fetch failed/i.test(message);
}

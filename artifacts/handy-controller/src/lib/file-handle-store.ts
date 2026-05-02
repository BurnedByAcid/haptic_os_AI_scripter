/**
 * Persists FileSystemFileHandle objects in IndexedDB so local-video library
 * entries can be replayed without the user having to re-select the file each
 * time (as long as the browser still holds permission for it).
 *
 * Key: `library_fh_<entryId>`
 */

const DB_NAME = "hc_fh_store";
const STORE = "handles";
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function storeFileHandle(
  entryId: number,
  handle: FileSystemFileHandle
): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const req = store.put(handle, `library_fh_${entryId}`);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function loadFileHandle(
  entryId: number
): Promise<FileSystemFileHandle | null> {
  try {
    const db = await openDb();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE, "readonly");
      const store = tx.objectStore(STORE);
      const req = store.get(`library_fh_${entryId}`);
      req.onsuccess = () => resolve((req.result as FileSystemFileHandle) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function deleteFileHandle(entryId: number): Promise<void> {
  try {
    const db = await openDb();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(`library_fh_${entryId}`);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // best-effort
  }
}

/** Returns true when the handle is still valid (permission granted). */
export async function verifyHandlePermission(
  handle: FileSystemFileHandle
): Promise<boolean> {
  try {
    // `queryPermission` / `requestPermission` are part of the File System
    // Access API and may not appear in older TypeScript lib types — cast to any.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const h = handle as any;
    if (typeof h.queryPermission === "function") {
      const perm = await h.queryPermission({ mode: "read" });
      if (perm === "granted") return true;
    }
    if (typeof h.requestPermission === "function") {
      const req = await h.requestPermission({ mode: "read" });
      return req === "granted";
    }
    // If neither method exists, assume permission is valid (older browsers)
    return true;
  } catch {
    return false;
  }
}

/** True when the current videoUrl is a blob: URL (local file source). */
export function isLocalBlob(videoUrl: string | null): boolean {
  return typeof videoUrl === "string" && videoUrl.startsWith("blob:");
}

/** True when videoUrl is a real remote URL (not a blob). */
export function isRemoteUrl(videoUrl: string | null): boolean {
  return (
    typeof videoUrl === "string" &&
    (videoUrl.startsWith("http://") || videoUrl.startsWith("https://"))
  );
}

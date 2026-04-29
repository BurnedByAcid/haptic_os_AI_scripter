import { openDB, DBSchema } from 'idb';

export interface LibraryEntry {
  id: string;
  name: string;
  type: "video" | "funscript";
  blob: Blob;
  addedAt: number;
  linkedTo?: string;
}

interface HandyDB extends DBSchema {
  entries: {
    key: string;
    value: LibraryEntry;
  };
}

const DB_NAME = 'handy-library';
const STORE_NAME = 'entries';

async function getDB() {
  return openDB<HandyDB>(DB_NAME, 1, {
    upgrade(db) {
      db.createObjectStore(STORE_NAME, { keyPath: 'id' });
    },
  });
}

export async function addEntry(entry: LibraryEntry) {
  const db = await getDB();
  await db.put(STORE_NAME, entry);
}

export async function getEntry(id: string) {
  const db = await getDB();
  return db.get(STORE_NAME, id);
}

export async function getAllEntries() {
  const db = await getDB();
  return db.getAll(STORE_NAME);
}

export async function deleteEntry(id: string) {
  const db = await getDB();
  await db.delete(STORE_NAME, id);
}

export async function updateEntry(entry: LibraryEntry) {
  const db = await getDB();
  await db.put(STORE_NAME, entry);
}

import { openDB, DBSchema } from 'idb';

export interface LibraryEntry {
  id: string;
  name: string;
  type: "video" | "funscript";
  blob?: Blob;
  fileHandle?: FileSystemFileHandle;
  url?: string;
  addedAt: number;
  thumbnail?: string;
  linkedTo?: string;
  sharedCommunityId?: number;
}

export interface Playlist {
  id: string;
  name: string;
  itemIds: string[];
  createdAt: number;
}

interface HandyDB extends DBSchema {
  entries: {
    key: string;
    value: LibraryEntry;
  };
  playlists: {
    key: string;
    value: Playlist;
  };
}

const DB_NAME = 'handy-library';
const STORE_NAME = 'entries';
const PLAYLIST_STORE = 'playlists';

async function getDB() {
  return openDB<HandyDB>(DB_NAME, 2, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
      if (oldVersion < 2) {
        db.createObjectStore(PLAYLIST_STORE, { keyPath: 'id' });
      }
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

export async function addPlaylist(playlist: Playlist) {
  const db = await getDB();
  await db.put(PLAYLIST_STORE, playlist);
}

export async function getPlaylist(id: string) {
  const db = await getDB();
  return db.get(PLAYLIST_STORE, id);
}

export async function getAllPlaylists() {
  const db = await getDB();
  return db.getAll(PLAYLIST_STORE);
}

export async function updatePlaylist(playlist: Playlist) {
  const db = await getDB();
  await db.put(PLAYLIST_STORE, playlist);
}

export async function deletePlaylist(id: string) {
  const db = await getDB();
  await db.delete(PLAYLIST_STORE, id);
}

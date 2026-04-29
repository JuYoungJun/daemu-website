// 사용자가 선택한 다운로드 폴더 핸들을 보관·재사용.
//
// File System Access API 의 FileSystemDirectoryHandle 은 IndexedDB 에는
// 직렬화/역직렬화 가능하지만 localStorage 에는 못 저장한다. 그래서 IndexedDB
// 단일 store 에 'csv_dir' 키로 보관한다.
//
// 권한은 브라우저가 세션 사이에 자동 만료할 수 있어 매번 ensureWritePermission
// 으로 다시 확인 — 만료됐으면 한 번 더 prompt 가 뜨고, 사용자가 허용하면
// 즉시 사용 가능. 이마저도 거부되면 폴백(브라우저 기본 다운로드 폴더).
//
// 지원 브라우저: Chrome 86+ / Edge 86+ / Opera 72+ / 사용자 기준 macOS Safari 와
// Firefox / iOS 는 미지원 — isDirectoryPickerSupported() 로 확인 가능.

const DB_NAME = 'daemu_downloads';
const DB_VERSION = 1;
const STORE = 'handles';
const KEY = 'csv_dir';
const NAME_KEY = 'daemu_csv_dir_label';

export function isDirectoryPickerSupported() {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

function openIDB() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB 미지원'));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function putHandle(handle) {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(handle, KEY);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

async function getHandle() {
  try {
    const db = await openIDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => { db.close(); resolve(req.result || null); };
      req.onerror = () => { db.close(); reject(req.error); };
    });
  } catch { return null; }
}

async function clearHandle() {
  try {
    const db = await openIDB();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); resolve(); };
    });
  } catch { /* ignore */ }
}

// 폴더 선택 다이얼로그 → 선택된 핸들을 IDB 에 저장 + 라벨도 localStorage 에.
// 라벨은 UI 표시용(handle.name), 실제 저장은 handle 자체로 IDB.
export async function pickDownloadDirectory() {
  if (!isDirectoryPickerSupported()) {
    throw new Error('이 브라우저는 폴더 선택을 지원하지 않습니다 (Chrome/Edge/Opera 86+ 만 지원).');
  }
  const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
  await putHandle(handle);
  try { localStorage.setItem(NAME_KEY, handle.name || ''); } catch { /* ignore */ }
  return handle;
}

// 핸들 + 라벨 모두 제거 — 다시 기본 다운로드 폴더로 회귀.
export async function clearDownloadDirectory() {
  await clearHandle();
  try { localStorage.removeItem(NAME_KEY); } catch { /* ignore */ }
}

// 현재 저장된 폴더 라벨(이름). 없으면 ''.
export function getDownloadDirectoryLabel() {
  try { return localStorage.getItem(NAME_KEY) || ''; }
  catch { return ''; }
}

// 권한 확인 — 만료됐으면 prompt. true 면 쓰기 가능.
async function ensureWritePermission(handle) {
  if (!handle) return false;
  const opts = { mode: 'readwrite' };
  try {
    const status = (await handle.queryPermission?.(opts)) ?? 'granted';
    if (status === 'granted') return true;
    const requested = (await handle.requestPermission?.(opts)) ?? 'denied';
    return requested === 'granted';
  } catch { return false; }
}

// 저장된 폴더에 파일을 쓴다. 핸들 없거나 권한 없으면 false 반환 → caller 가 폴백.
export async function writeBlobToSavedDirectory(filename, blob) {
  if (!isDirectoryPickerSupported()) return false;
  const handle = await getHandle();
  if (!handle) return false;
  const ok = await ensureWritePermission(handle);
  if (!ok) return false;
  try {
    const fileHandle = await handle.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
    return true;
  } catch (e) {
    console.warn('[downloadDir] write failed', e);
    return false;
  }
}

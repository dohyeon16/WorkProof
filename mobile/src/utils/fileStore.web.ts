import type { PersistFileInput } from './fileStore.types';

// 웹 영구 저장 전략
// ─────────────────
// blob:/object URL은 새로고침하면 무효화되고, 큰 파일을 base64 data: URI로 만들어
// AsyncStorage(localStorage, ~5MB)에 넣으면 사진/PDF 하나만으로도 용량이 초과돼
// setItem이 던진다(근무지 저장·증빙 추가 실패의 실제 원인).
//
// 그래서 파일 '바이트'는 용량이 넉넉한 IndexedDB에 저장하고, AsyncStorage에는
// 가벼운 참조 문자열(`idb://<key>`)만 남긴다. 읽을 때는 참조로 IndexedDB에서
// Blob을 꺼내 base64/data: URI로 되돌린다.

const DB_NAME = 'workproof-files';
const STORE = 'files';
const REF_PREFIX = 'idb://';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open 실패'));
  });
}

async function idbPut(key: string, blob: Blob): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(blob, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB put 실패'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB put 중단'));
    });
  } finally {
    db.close();
  }
}

async function idbGet(key: string): Promise<Blob | null> {
  const db = await openDb();
  try {
    return await new Promise<Blob | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result as Blob | undefined) ?? null);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB get 실패'));
    });
  } finally {
    db.close();
  }
}

function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string); // "data:<mime>;base64,<content>"
    reader.onerror = () => reject(new Error('파일을 읽지 못했어요.'));
    reader.readAsDataURL(blob);
  });
}

/** 선택기 결과(base64 또는 blob/temp URI)를 Blob으로 변환한다. */
async function toBlob(input: PersistFileInput): Promise<Blob> {
  if (input.base64) {
    // 이미지 선택기: 순수 base64 / 문서 선택기: data: URI. fetch로 안전하게 디코드.
    const dataUri = input.base64.startsWith('data:')
      ? input.base64
      : `data:${input.mimeType || 'application/octet-stream'};base64,${input.base64}`;
    return (await fetch(dataUri)).blob();
  }
  // base64가 없으면 아직 유효한 blob URL을 즉시 읽는다.
  return (await fetch(input.uri)).blob();
}

/** 파일 바이트를 IndexedDB에 저장하고 `idb://<key>` 참조를 돌려준다. */
export async function persistPickedFile(input: PersistFileInput): Promise<string> {
  const blob = await toBlob(input);
  const key = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  await idbPut(key, blob);
  return `${REF_PREFIX}${key}`;
}

async function loadBlob(uri: string): Promise<Blob | null> {
  if (uri.startsWith(REF_PREFIX)) return idbGet(uri.slice(REF_PREFIX.length));
  // 구버전 데이터(직접 저장된 data:/blob: URI) 하위호환 — blob:은 만료됐으면 throw.
  return (await fetch(uri)).blob();
}

/** 저장된 URI를 base64로 읽는다. 파일이 사라졌으면 null. */
export async function readFileBase64(uri: string): Promise<string | null> {
  try {
    const blob = await loadBlob(uri);
    if (!blob) return null;
    const dataUri = await blobToDataUri(blob);
    return dataUri.split(',')[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * 미리보기/열기/공유에서 실제로 쓸 수 있는 URI로 되돌린다.
 * `idb://` 참조는 data: URI로 복원하고(그대로 <Image>·webOpen에서 사용 가능),
 * 그 외(data:/blob:/http/file:)는 그대로 반환한다. 파일이 없으면 null.
 */
export async function resolveReadableUri(uri: string): Promise<string | null> {
  if (!uri.startsWith(REF_PREFIX)) return uri;
  const blob = await idbGet(uri.slice(REF_PREFIX.length));
  if (!blob) return null;
  return blobToDataUri(blob);
}

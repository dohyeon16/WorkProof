import { Directory, File, Paths } from 'expo-file-system';
import type { PersistFileInput } from './fileStore.types';

// 네이티브(Expo Go/iOS/Android): 선택기의 임시(cache/content) 파일을 앱
// documentDirectory 안으로 복사해 영구 URI를 얻는다. 이렇게 해야 앱 재실행이나
// 화면 이동 뒤에도 파일을 다시 읽을 수 있다.

const DIR_NAME = 'evidence';

function evidenceDir(): Directory {
  const dir = new Directory(Paths.document, DIR_NAME);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

function extensionFor(name: string, mimeType?: string): string {
  const dot = name.lastIndexOf('.');
  if (dot > 0 && dot < name.length - 1) return name.slice(dot).toLowerCase();
  if (mimeType === 'application/pdf') return '.pdf';
  if (mimeType === 'image/png') return '.png';
  if (mimeType === 'image/webp') return '.webp';
  if (mimeType === 'image/heic') return '.heic';
  return '.jpg';
}

/** 임시 URI의 파일을 documentDirectory로 복사하고 영구 file:// URI를 돌려준다. */
export async function persistPickedFile(input: PersistFileInput): Promise<string> {
  const dir = evidenceDir();
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const dest = new File(dir, `${unique}${extensionFor(input.name, input.mimeType)}`);
  new File(input.uri).copy(dest);
  return dest.uri;
}

/**
 * 저장된 URI를 base64로 읽는다. 파일이 사라졌거나 읽을 수 없으면 null을 돌려준다
 * (호출부에서 "원본 파일을 찾을 수 없어요" 안내로 이어진다).
 */
export async function readFileBase64(uri: string): Promise<string | null> {
  try {
    if (uri.startsWith('data:')) return uri.split(',')[1] ?? null;
    const file = new File(uri);
    if (!file.exists) return null;
    return await file.base64();
  } catch {
    return null;
  }
}

/**
 * 미리보기/열기/공유에서 쓸 수 있는 URI로 되돌린다. 네이티브의 file:// URI는
 * <Image>·Sharing·OCR에서 그대로 쓸 수 있으므로 그대로 반환한다(웹과 인터페이스 통일).
 * 파일이 사라졌으면 null.
 */
export async function resolveReadableUri(uri: string): Promise<string | null> {
  try {
    if (uri.startsWith('file:')) {
      return new File(uri).exists ? uri : null;
    }
    return uri;
  } catch {
    return uri;
  }
}

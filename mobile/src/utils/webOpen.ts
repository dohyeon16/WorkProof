// Web-only helpers for opening generated/stored content (reports, picked files) in a new tab.
//
// Chrome (and other Chromium browsers) block top-level navigation to `data:` URLs entirely —
// window.open(dataUri) silently fails, no error, no new tab. blob: URLs aren't restricted the
// same way, but they die once revoked or the page that created them is gone, so they can't be
// persisted for later use (e.g. reopening from the vault after a reload). The fix: persist
// content as a `data:` URI (safe to store, self-contained, survives reload), but always convert
// it to a fresh blob: URL at the moment of opening.

export function openHtmlInNewTab(html: string): boolean {
  const blob = new Blob([html], { type: 'text/html' });
  const blobUrl = URL.createObjectURL(blob);
  const win = window.open(blobUrl, '_blank');
  setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
  return !!win;
}

export function toHtmlDataUri(html: string): string {
  return `data:text/html;charset=utf-8;base64,${btoa(unescape(encodeURIComponent(html)))}`;
}

// Matches everything up to the last comma as the mime type (which may itself contain
// `;`-separated params like `;charset=utf-8`), then the base64 payload after it.
const DATA_URI_RE = /^data:([^,]+);base64,(.*)$/;

function decodeDataUri(uri: string): { blob: Blob; mime: string } | null {
  const match = uri.match(DATA_URI_RE);
  if (!match) return null;
  const [, mime, base64] = match;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { blob: new Blob([bytes], { type: mime }), mime };
}

/** Opens any stored URI in a new tab. `data:` URIs are decoded into a fresh blob: URL first
 *  (binary-safe, works for images/PDFs/HTML alike) since Chrome blocks navigating to them directly. */
export function openStoredUriInNewTab(uri: string): boolean {
  const decoded = decodeDataUri(uri);
  if (!decoded) return !!window.open(uri, '_blank');
  const blobUrl = URL.createObjectURL(decoded.blob);
  const win = window.open(blobUrl, '_blank');
  setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
  return !!win;
}

type ShareResult = 'shared' | 'cancelled' | 'downloaded' | 'failed';

/** Real "share" on web: tries the Web Share API (file sharing) first — where supported this
 *  opens the OS share sheet just like on mobile — and falls back to a real file download so the
 *  user ends up with an actual file they can attach/send elsewhere, instead of just a preview tab. */
export async function shareStoredUri(uri: string, name: string): Promise<ShareResult> {
  const decoded = decodeDataUri(uri);
  if (!decoded) return !!window.open(uri, '_blank') ? 'shared' : 'failed';

  const { blob, mime } = decoded;
  const nav = navigator as Navigator & {
    canShare?: (data: { files: File[] }) => boolean;
    share?: (data: { files?: File[]; title?: string }) => Promise<void>;
  };
  if (nav.share && nav.canShare) {
    const file = new File([blob], name, { type: mime });
    if (nav.canShare({ files: [file] })) {
      try {
        await nav.share({ files: [file], title: name });
        return 'shared';
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return 'cancelled';
        // fall through to download
      }
    }
  }

  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
  return 'downloaded';
}

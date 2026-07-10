export type OcrResult =
  | { status: 'success'; text: string }
  | { status: 'not_configured' }
  | { status: 'error'; message: string };

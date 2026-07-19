export interface PersistFileInput {
  /** 선택기에서 받은 임시 URI(file:// / content:// / blob:) */
  uri: string;
  /** 원본 파일명(확장자 판별에 사용) */
  name: string;
  /** 원본 MIME 타입(있으면) */
  mimeType?: string;
  /**
   * 선택기가 이미 만들어준 base64. 웹 ImagePicker는 순수 base64,
   * 웹 DocumentPicker는 `data:` URI 형태로 준다. 네이티브에서는 무시한다.
   * (ImagePicker asset.base64는 null일 수 있어 null도 허용한다.)
   */
  base64?: string | null;
}

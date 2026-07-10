// 웹에서는 expo-file-system 대신 fetch + FileReader로 blob URI를 base64로 변환한다.
export async function readAsBase64(uri: string): Promise<string> {
  const response = await fetch(uri);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string; // "data:<mime>;base64,<content>"
      resolve(result.split(',')[1] ?? '');
    };
    reader.onerror = () => reject(new Error('파일을 읽지 못했어요.'));
    reader.readAsDataURL(blob);
  });
}

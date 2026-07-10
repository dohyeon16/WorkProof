import { EncodingType, readAsStringAsync } from 'expo-file-system/legacy';

export async function readAsBase64(uri: string): Promise<string> {
  return readAsStringAsync(uri, { encoding: EncodingType.Base64 });
}

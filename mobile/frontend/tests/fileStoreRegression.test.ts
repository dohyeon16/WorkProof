import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

test('native picked files wait for the Expo SDK copy to finish', async () => {
  const source = await readFile(path.resolve(process.cwd(), 'src/services/files/fileStore.ts'), 'utf8');

  assert.match(
    source,
    /await\s+new\s+File\(input\.uri\)\.copy\(dest\)/,
    'persistPickedFile must await File.copy before returning a URI'
  );
  assert.doesNotMatch(
    source,
    /(?<!await\s)new\s+File\(input\.uri\)\.copy\(dest\)/,
    'a fire-and-forget copy can race immediate OCR reads'
  );
});

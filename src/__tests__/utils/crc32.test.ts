import { describe, it, expect } from 'vitest';
import { crc32 } from '../../utils/crc32';

describe('crc32', () => {
  it('空文字列 → 0 を返す', () => {
    expect(crc32('')).toBe(0);
  });

  it('Unityのアニメーションのpathハッシュと一致する', () => {
    expect(crc32('Armature/Root/Page_R')).toBe(2510012211);
    expect(crc32('Armature/Root/Page_L')).toBe(1872003664);
  });

  it('Unityのアニメーションのattributeハッシュと一致する', () => {
    expect(crc32('m_IsActive')).toBe(2086281974);
    expect(crc32('m_AnchoredPosition.x')).toBe(1460864421);
  });

  it('マルチバイト文字を UTF-8 として扱う', () => {
    // Python: zlib.crc32('あ'.encode()) == 1976302829
    expect(crc32('あ')).toBe(1976302829);
  });
});

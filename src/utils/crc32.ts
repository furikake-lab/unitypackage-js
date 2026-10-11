// CRC32ハッシュに関するユーティリティ
// これらの関数群はパッケージ外には公開しない

let crcTable: Uint32Array | undefined;

function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable;
  crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    crcTable[n] = c >>> 0;
  }
  return crcTable;
}

/**
 * 文字列のCRC32ハッシュ値を計算する（UTF-8エンコード）
 * UnityのAnimationClipのgenericBindings(path/attribute)で用いられる形式
 * @param str 文字列
 * @returns 符号なし32bit整数のハッシュ値
 */
export function crc32(str: string): number {
  const table = getCrcTable();
  const bytes = new TextEncoder().encode(str);
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

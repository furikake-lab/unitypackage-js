// tar.gz形式のUnityPackageを扱うためのnanotarのラッパースクリプト
// これらの関数群はパッケージ外には公開しない
import { parseTarGzip, createTarGzip } from 'nanotar';

/**
 * tar.gzアーカイブの展開結果
 */
export interface TarGzEntry {
  name: string;
  data: Uint8Array;
  isDirectory: boolean;
}

/**
 * tar.gzアーカイブを展開する
 * @param compressedData 圧縮されたtar.gzデータ
 * @returns 展開されたファイル一覧
 */
export async function extractTarGz(
  compressedData: ArrayBuffer,
): Promise<Map<string, TarGzEntry>> {
  try {
    const gzipData = new Uint8Array(compressedData);
    const files = await parseTarGzip(gzipData);

    const entries = new Map<string, TarGzEntry>();

    for (const file of files) {
      entries.set(file.name, {
        name: file.name,
        data: file.data || new Uint8Array(0),
        isDirectory: file.name.endsWith('/'),
      });
    }

    return entries;
  } catch (error) {
    throw new Error(
      `tar.gz展開エラー: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

/**
 * ファイル一覧をtar.gzアーカイブに圧縮する
 * @param entries 圧縮するファイル一覧
 * @returns 圧縮されたtar.gzデータ
 */
export async function compressTarGz(
  entries: Map<string, TarGzEntry>,
): Promise<ArrayBuffer> {
  try {
    const files = Array.from(entries.values()).map((entry) => ({
      name: entry.name,
      data: entry.data,
      type: entry.isDirectory ? ('directory' as const) : ('file' as const),
    }));

    const compressed = await createTarGzip(files);

    const buffer = compressed.buffer as ArrayBuffer;
    return buffer.slice(
      compressed.byteOffset,
      compressed.byteOffset + compressed.byteLength,
    );
  } catch (error) {
    throw new Error(
      `tar.gz圧縮エラー: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

/**
 * gzipデータのバイト列にNAMEメタデータを追加する
 * 参考: https://www.rfc-editor.org/rfc/rfc1952
 * @param data gzipデータ
 * @param name 指定したいNAMEメタデータ
 * @returns 変更後のgzipデータ
 */
export function addOriginalNameToGzip(
  data: ArrayBuffer,
  name: string,
): ArrayBuffer {
  const dataArray = new Uint8Array(data);

  // 元のデータのheaderを取得し、FNAMEフラグを立てる
  const header = dataArray.subarray(0, 10);
  header[3] |= 0x08;

  const result = new Uint8Array(dataArray.length + name.length + 1); // 1はname末尾のnull文字
  result.set(header, 0);
  result.set(new TextEncoder().encode(name), header.length);
  result.set(
    dataArray.subarray(header.length),
    header.length + name.length + 1,
  );

  return result.buffer.slice(
    result.byteOffset,
    result.byteOffset + result.byteLength,
  );
}

import { describe, it, expect, beforeAll } from 'vitest';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { UnityPackage } from '../unitypackage';

// フィクスチャファイルのパス
const FIXTURES_DIR = join(__dirname, 'fixtures');
const MINIMAL_PACKAGE_PATH = join(FIXTURES_DIR, 'minimal.unitypackage');
const STANDARD_PACKAGE_PATH = join(FIXTURES_DIR, 'standard.unitypackage');

// テスト用のフィクスチャデータ
let minimalPackageData: ArrayBuffer;
let standardPackageData: ArrayBuffer;

beforeAll(async () => {
  // フィクスチャファイルを読み込む
  const minimalBuffer = await readFile(MINIMAL_PACKAGE_PATH);
  const standardBuffer = await readFile(STANDARD_PACKAGE_PATH);

  minimalPackageData = minimalBuffer.buffer.slice(
    minimalBuffer.byteOffset,
    minimalBuffer.byteOffset + minimalBuffer.byteLength,
  );
  standardPackageData = standardBuffer.buffer.slice(
    standardBuffer.byteOffset,
    standardBuffer.byteOffset + standardBuffer.byteLength,
  );
});

describe('UnityPackage.fromArrayBuffer', () => {
  describe('基本的な機能', () => {
    it('最小構成のUnityPackageを正しくインポートできる', async () => {
      const pkg = await UnityPackage.fromArrayBuffer(minimalPackageData);

      expect(pkg.assets.size).toBeGreaterThan(0);

      // 少なくとも1つのアセットが存在する
      const firstAsset = Array.from(pkg.assets.values())[0];
      expect(firstAsset).toBeDefined();
      expect(firstAsset.guid).toBeTruthy();
      expect(firstAsset.assetPath).toBeTruthy();
      expect(firstAsset.assetData).toBeInstanceOf(Uint8Array);
    });

    it('標準構成のUnityPackageを正しくインポートできる', async () => {
      const pkg = await UnityPackage.fromArrayBuffer(standardPackageData);

      // 複数のアセットが含まれている
      expect(pkg.assets.size).toBeGreaterThan(1);

      // すべてのアセットが必須フィールドを持っている
      for (const asset of pkg.assets.values()) {
        expect(asset.guid).toBeTruthy();
        expect(asset.assetPath).toBeTruthy();
        expect(asset.assetData).toBeInstanceOf(Uint8Array);
        expect(asset.assetData.length).toBeGreaterThan(0);
      }
    });

    it('アセットパスからアセットを取得できる', async () => {
      const pkg = await UnityPackage.fromArrayBuffer(standardPackageData);

      // いずれかのアセットパスでアクセス
      const assetPath = Array.from(pkg.assets.keys())[0];
      const asset = pkg.assets.get(assetPath);

      expect(asset).toBeDefined();
      expect(asset!.assetPath).toBe(assetPath);
    });
  });

  describe('アセットの種類', () => {
    it('メタデータ付きアセットを正しく処理できる', async () => {
      const pkg = await UnityPackage.fromArrayBuffer(standardPackageData);

      // メタデータを持つアセットが存在するはず
      const assetsWithMeta = Array.from(pkg.assets.values()).filter(
        (asset) => asset.metaData !== undefined,
      );

      expect(assetsWithMeta.length).toBeGreaterThan(0);

      for (const asset of assetsWithMeta) {
        expect(asset.metaData).toBeInstanceOf(Uint8Array);
        expect(asset.metaData!.length).toBeGreaterThan(0);
      }
    });

    it('プレビュー画像付きアセットを正しく処理できる', async () => {
      const pkg = await UnityPackage.fromArrayBuffer(standardPackageData);

      // プレビュー画像を持つアセットを探す
      const assetsWithPreview = Array.from(pkg.assets.values()).filter(
        (asset) => asset.previewData !== undefined,
      );

      // プレビュー画像がある場合のみチェック
      if (assetsWithPreview.length > 0) {
        for (const asset of assetsWithPreview) {
          expect(asset.previewData).toBeInstanceOf(Uint8Array);
          expect(asset.previewData!.length).toBeGreaterThan(0);
        }
      }
    });

    it('テキストファイルとバイナリファイルの両方を処理できる', async () => {
      const pkg = await UnityPackage.fromArrayBuffer(standardPackageData);

      // 異なるサイズのアセットが存在することを確認
      const assetSizes = Array.from(pkg.assets.values()).map(
        (asset) => asset.assetData.length,
      );
      const uniqueSizes = new Set(assetSizes);

      expect(uniqueSizes.size).toBeGreaterThan(1);
    });
  });

  describe('エラーハンドリング', () => {
    it('不正なtar.gzデータに対してエラーをスローする', async () => {
      const invalidData = new ArrayBuffer(100);
      const view = new Uint8Array(invalidData);
      view.fill(0xff); // 無効なデータで埋める

      await expect(UnityPackage.fromArrayBuffer(invalidData)).rejects.toThrow();
    });

    it('空のデータに対してエラーをスローする', async () => {
      const emptyData = new ArrayBuffer(0);

      await expect(UnityPackage.fromArrayBuffer(emptyData)).rejects.toThrow();
    });
  });
});

describe('UnityPackage.export', () => {
  describe('基本的な機能', () => {
    it('UnityPackage からパッケージをエクスポートできる', async () => {
      // まずインポート
      const pkg = await UnityPackage.fromArrayBuffer(minimalPackageData);

      // エクスポート
      const exported = await pkg.export();

      expect(exported).toBeInstanceOf(ArrayBuffer);
      expect(exported.byteLength).toBeGreaterThan(0);
    });

    it('複数アセットを含むパッケージをエクスポートできる', async () => {
      const pkg = await UnityPackage.fromArrayBuffer(standardPackageData);
      const exported = await pkg.export();

      expect(exported).toBeInstanceOf(ArrayBuffer);
      expect(exported.byteLength).toBeGreaterThan(0);
    });

    it('エクスポートされたパッケージにgzip NAMEメタデータが含まれる', async () => {
      const pkg = await UnityPackage.fromArrayBuffer(minimalPackageData);
      const exported = await pkg.export();

      // gzipヘッダーを確認
      const view = new Uint8Array(exported);

      // gzipマジックナンバー確認
      expect(view[0]).toBe(0x1f);
      expect(view[1]).toBe(0x8b);

      // FNAMEフラグが立っているか確認
      expect(view[3] & 0x08).toBe(0x08);

      // FNAMEフィールドの値を確認 (gzipヘッダーの10バイト目から開始)
      const fnameStart = 10;
      let fnameEnd = fnameStart;
      while (view[fnameEnd] !== 0) {
        fnameEnd++;
      }
      const fname = new TextDecoder().decode(view.slice(fnameStart, fnameEnd));
      expect(fname).toBe('archtemp.tar');
    });
  });

  describe('データの整合性', () => {
    it('すべてのアセットがエクスポートされる', async () => {
      const pkg = await UnityPackage.fromArrayBuffer(standardPackageData);
      const exported = await pkg.export();

      // 再度インポートして比較
      const reimported = await UnityPackage.fromArrayBuffer(exported);

      expect(reimported.assets.size).toBe(pkg.assets.size);
    });
  });
});

describe('UnityPackage.updateAssetData', () => {
  it('アセットデータを更新できる', async () => {
    const pkg = await UnityPackage.fromArrayBuffer(minimalPackageData);
    const assetPath = Array.from(pkg.assets.keys())[0];

    const newData = new TextEncoder().encode('updated asset data');
    const result = pkg.updateAssetData(assetPath, newData);

    expect(result).toBe(true);
    expect(pkg.assets.get(assetPath)!.assetData).toEqual(newData);
  });

  it('存在しないアセットの更新は失敗する', async () => {
    const pkg = await UnityPackage.fromArrayBuffer(minimalPackageData);

    const result = pkg.updateAssetData(
      'Assets/NonExistent.asset',
      new TextEncoder().encode('data'),
    );

    expect(result).toBe(false);
  });

  it('更新後にエクスポート・再インポートしてもデータが保持される', async () => {
    const pkg = await UnityPackage.fromArrayBuffer(minimalPackageData);
    const assetPath = Array.from(pkg.assets.keys())[0];

    const newData = new TextEncoder().encode('roundtrip update');
    pkg.updateAssetData(assetPath, newData);

    const exported = await pkg.export();
    const reimported = await UnityPackage.fromArrayBuffer(exported);

    expect(reimported.assets.get(assetPath)!.assetData).toEqual(newData);
  });
});

describe('UnityPackage.getAnimation', () => {
  it('アニメーションアセットからUnityAnimationを取得できる', async () => {
    const pkg = await UnityPackage.fromArrayBuffer(standardPackageData);

    const animAssetPath = Array.from(pkg.assets.keys()).find((path) =>
      path.endsWith('TextureMove.anim'),
    );
    expect(animAssetPath).toBeDefined();

    const anim = pkg.getAnimation(animAssetPath!);
    expect(anim).toBeDefined();
    expect(anim!.getName()).toBe('TextureMove');

    const curves = anim!.getFloatCurves();
    expect(curves.length).toBe(4);
    const mainTexCurve = anim!.getCurve('material._MainTex_ST.x', '');
    expect(mainTexCurve).toBeDefined();
    expect(mainTexCurve!.keyframes.length).toBe(2);
  });

  it('存在しないアセット名はundefinedを返す', async () => {
    const pkg = await UnityPackage.fromArrayBuffer(standardPackageData);

    expect(pkg.getAnimation('Assets/NonExistent.anim')).toBeUndefined();
  });

  it('不適切なファイル名ではエラーをスローする', async () => {
    const pkg = await UnityPackage.fromArrayBuffer(standardPackageData);

    const animAssetPath = Array.from(pkg.assets.keys()).find((path) =>
      path.endsWith('TextureMove.anim'),
    );
    expect(animAssetPath).toBeDefined();

    expect(() => pkg.getPrefab(animAssetPath!)).toThrow(
      /アセット '.+TextureMove\.anim' はPrefabではありません/,
    );
  });
});

describe('UnityPackage.getPrefab', () => {
  it('PrefabアセットからUnityPrefabを取得できる', async () => {
    const pkg = await UnityPackage.fromArrayBuffer(standardPackageData);

    const prefabAssetPath = Array.from(pkg.assets.keys()).find((path) =>
      path.endsWith('Cube.prefab'),
    );
    expect(prefabAssetPath).toBeDefined();

    const prefab = pkg.getPrefab(prefabAssetPath!);
    expect(prefab).toBeDefined();
    expect(prefab!.components.length).toBeGreaterThan(0);

    for (const component of prefab!.components) {
      expect(component.unityType).toBe('114');
      expect(component.fileId.length).toBeGreaterThan(0);
      expect(component.scriptGuid).toMatch(/^[0-9a-fA-F]+$/);
      expect(component.rawYaml).toContain('MonoBehaviour');
    }

    const scriptAssetPath = Array.from(pkg.assets.keys()).find((path) =>
      path.endsWith('DummyScript.cs'),
    );
    expect(scriptAssetPath).toBeDefined();
    const scriptAsset = pkg.assets.get(scriptAssetPath!);
    expect(scriptAsset?.metaData).toBeDefined();

    const metaContent = new TextDecoder().decode(scriptAsset!.metaData!);
    const guidMatch = metaContent.match(/^guid: ([0-9a-fA-F]{32})$/m);
    expect(guidMatch).toBeTruthy();

    const componentsByScript = prefab!.findComponentsByScriptGuid(
      guidMatch![1],
    );
    expect(componentsByScript.length).toBeGreaterThan(0);
  });

  it('存在しないアセット名はundefinedを返す', async () => {
    const pkg = await UnityPackage.fromArrayBuffer(standardPackageData);

    expect(pkg.getPrefab('Assets/NonExistent.prefab')).toBeUndefined();
  });

  it('不適切なファイル名ではエラーをスローする', async () => {
    const pkg = await UnityPackage.fromArrayBuffer(standardPackageData);

    const prefabAssetPath = Array.from(pkg.assets.keys()).find((path) =>
      path.endsWith('Cube.prefab'),
    );
    expect(prefabAssetPath).toBeDefined();

    expect(() => pkg.getAnimation(prefabAssetPath!)).toThrow(
      /アセット '.+Cube\.prefab' はアニメーションではありません/,
    );
  });
});

describe('ラウンドトリップテスト', () => {
  it('最小構成: import → export → import でデータが保持される', async () => {
    const original = await UnityPackage.fromArrayBuffer(minimalPackageData);
    const exported = await original.export();
    const reimported = await UnityPackage.fromArrayBuffer(exported);

    // アセット数が同じ
    expect(reimported.assets.size).toBe(original.assets.size);

    // すべてのアセットが一致
    for (const [path, originalAsset] of original.assets.entries()) {
      const reimportedAsset = reimported.assets.get(path);

      expect(reimportedAsset).toBeDefined();
      expect(reimportedAsset!.guid).toBe(originalAsset.guid);
      expect(reimportedAsset!.assetPath).toBe(originalAsset.assetPath);
      expect(reimportedAsset!.assetData).toEqual(originalAsset.assetData);

      if (originalAsset.metaData) {
        expect(reimportedAsset!.metaData).toEqual(originalAsset.metaData);
      }

      if (originalAsset.previewData) {
        expect(reimportedAsset!.previewData).toEqual(originalAsset.previewData);
      }
    }
  });

  it('標準構成: import → export → import でデータが保持される', async () => {
    const original = await UnityPackage.fromArrayBuffer(standardPackageData);
    const exported = await original.export();
    const reimported = await UnityPackage.fromArrayBuffer(exported);

    // アセット数が同じ
    expect(reimported.assets.size).toBe(original.assets.size);

    // すべてのアセットが一致
    for (const [path, originalAsset] of original.assets.entries()) {
      const reimportedAsset = reimported.assets.get(path);

      expect(reimportedAsset).toBeDefined();
      expect(reimportedAsset!.guid).toBe(originalAsset.guid);
      expect(reimportedAsset!.assetPath).toBe(originalAsset.assetPath);
      expect(reimportedAsset!.assetData).toEqual(originalAsset.assetData);

      if (originalAsset.metaData) {
        expect(reimportedAsset!.metaData).toEqual(originalAsset.metaData);
      }

      if (originalAsset.previewData) {
        expect(reimportedAsset!.previewData).toEqual(originalAsset.previewData);
      }
    }
  });

  it('バイナリデータが正確に保持される', async () => {
    const original = await UnityPackage.fromArrayBuffer(standardPackageData);
    const exported = await original.export();
    const reimported = await UnityPackage.fromArrayBuffer(exported);

    // すべてのアセットのバイト単位での一致を確認
    for (const [path, originalAsset] of original.assets.entries()) {
      const reimportedAsset = reimported.assets.get(path);

      expect(reimportedAsset).toBeDefined();

      // assetDataのバイト単位での比較
      expect(reimportedAsset!.assetData.length).toBe(
        originalAsset.assetData.length,
      );
      for (let i = 0; i < originalAsset.assetData.length; i++) {
        expect(reimportedAsset!.assetData[i]).toBe(originalAsset.assetData[i]);
      }
    }
  });

  it('複数回のラウンドトリップでデータが保持される', async () => {
    let current = await UnityPackage.fromArrayBuffer(minimalPackageData);

    // 3回のラウンドトリップ
    for (let i = 0; i < 3; i++) {
      const exported = await current.export();
      current = await UnityPackage.fromArrayBuffer(exported);
    }

    // 元のデータと比較
    const original = await UnityPackage.fromArrayBuffer(minimalPackageData);
    expect(current.assets.size).toBe(original.assets.size);

    for (const [path, originalAsset] of original.assets.entries()) {
      const currentAsset = current.assets.get(path);
      expect(currentAsset).toBeDefined();
      expect(currentAsset!.assetData).toEqual(originalAsset.assetData);
    }
  });
});

describe('データ整合性', () => {
  it('GUIDが一意である', async () => {
    const pkg = await UnityPackage.fromArrayBuffer(standardPackageData);

    const guids = Array.from(pkg.assets.values()).map((asset) => asset.guid);
    const uniqueGuids = new Set(guids);

    expect(uniqueGuids.size).toBe(guids.length);
  });

  it('アセットパスが一意である', async () => {
    const pkg = await UnityPackage.fromArrayBuffer(standardPackageData);

    const paths = Array.from(pkg.assets.keys());
    const uniquePaths = new Set(paths);

    expect(uniquePaths.size).toBe(paths.length);
  });

  it('マッピングの一貫性が保たれている', async () => {
    const pkg = await UnityPackage.fromArrayBuffer(standardPackageData);

    for (const [assetPath, asset] of pkg.assets.entries()) {
      // assets の整合性
      expect(asset.assetPath).toBe(assetPath);
    }
  });
});

describe('実際のUnityPackageとの互換性', () => {
  it('標準構成のパッケージに期待されるアセットが含まれている', async () => {
    const pkg = await UnityPackage.fromArrayBuffer(standardPackageData);

    // READMEによれば以下のファイルが含まれているはず
    const expectedFiles = [
      'DummyScript.cs',
      'Hop.anim',
      'Cube.controller',
      'Colorful.mat',
      'Colorful.png',
      'Cube.prefab',
      'Rotate.anim',
      'RotateRoot.controller',
      'RotateRoot.prefab',
      'README.md',
    ];

    for (const fileName of expectedFiles) {
      // ファイル名が含まれるパスがあるか確認
      const found = Array.from(pkg.assets.keys()).some((path) =>
        path.includes(fileName),
      );
      expect(found).toBe(true);
    }
  });

  it('C#スクリプトファイルが正しく読み込まれる', async () => {
    const pkg = await UnityPackage.fromArrayBuffer(standardPackageData);

    // .csファイルを探す
    const csAssets = Array.from(pkg.assets.values()).filter((asset) =>
      asset.assetPath.endsWith('.cs'),
    );

    expect(csAssets.length).toBeGreaterThan(0);

    for (const asset of csAssets) {
      // テキストとしてデコード可能か確認
      const text = new TextDecoder('utf-8').decode(asset.assetData);
      expect(text.length).toBeGreaterThan(0);
    }
  });

  it('アニメーションファイルが正しく読み込まれる', async () => {
    const pkg = await UnityPackage.fromArrayBuffer(standardPackageData);

    // .animファイルを探す
    const animAssets = Array.from(pkg.assets.values()).filter((asset) =>
      asset.assetPath.endsWith('.anim'),
    );

    expect(animAssets.length).toBeGreaterThan(0);

    for (const asset of animAssets) {
      expect(asset.assetData.length).toBeGreaterThan(0);
    }
  });

  it('画像ファイルが正しく読み込まれる', async () => {
    const pkg = await UnityPackage.fromArrayBuffer(standardPackageData);

    // .pngファイルを探す
    const pngAssets = Array.from(pkg.assets.values()).filter((asset) =>
      asset.assetPath.endsWith('.png'),
    );

    expect(pngAssets.length).toBeGreaterThan(0);

    for (const asset of pngAssets) {
      // PNGヘッダーの確認
      const header = asset.assetData.slice(0, 8);
      expect(header[0]).toBe(0x89);
      expect(header[1]).toBe(0x50); // 'P'
      expect(header[2]).toBe(0x4e); // 'N'
      expect(header[3]).toBe(0x47); // 'G'
    }
  });
});

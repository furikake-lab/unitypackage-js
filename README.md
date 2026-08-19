# Unity Package Utils

UnityPackage（.unitypackage）ファイルの読み込み・変更・生成を行うライブラリです。クライアントサイドで完全に動作し、実際のUnityPackageファイルとの互換性を保証します。

> NOTE: 本リポジトリは、`@furikake6000`がサービスを作成する際に必要な機能を私的に集めたものです。公開していますが、網羅的・恒久的なサポートを保証するものではありません。不完全なライブラリである点をご了承ください。ご利用の際は、forkの上で不足している機能を追加していただくことを推奨します（追加後の本リポジトリへのPR作成は歓迎します）。

## 概要

Unity PackageはUnityエディタで使用されるアセットパッケージ形式で、内部的にはtar.gz形式で圧縮されています。このライブラリは以下の機能を提供します：

- **tar.gz形式の完全サポート**: nanotar ライブラリによる軽量で高速な処理
- **UnityPackage構造解析**: GUID/pathname/asset/metaなどの解析
- **アセット操作API**: 画像・アニメーション・Prefabパラメータ等の置換・書き換え
- **ファイルの関連を保持したままリネーム**: 紐づけを保持したままGUID・ファイルパスを変更
- **クライアントサイド処理**: サーバー負荷なし、UGCアップロードなし

## インストール

このパッケージはnpmレジストリには公開していません。GitHubリポジトリから直接インストールしてください。

```bash
npm install github:furikake-lab/unitypackage-js
```

`package.json`へ直接追加する場合は、次のように指定できます。

```json
{
  "dependencies": {
    "unitypackage-js": "github:furikake-lab/unitypackage-js"
  }
}
```

再現可能なビルドにする場合は、ブランチ名、タグ、またはコミットSHAを`#`に続けて指定してください。

```bash
npm install github:furikake-lab/unitypackage-js#<commit-sha>
```

## 基本的な使い方

### 1. UnityPackageの読み込み

```typescript
import { UnityPackage } from 'unitypackage-js';

// File等のArrayBufferを取得
const file: File = ...;
const buffer = await file.arrayBuffer();

// パッケージを解析
const unityPackage = await UnityPackage.fromArrayBuffer(buffer);
```

### 2. アセット情報の取得

```typescript
// すべてのアセットを取得（ReadonlyMapとして公開）
const assets = unityPackage.assets;

// 特定のパスのアセットを取得
const asset = unityPackage.assets.get('Assets/Image.png');

// アセット数を取得
console.log(`Total assets: ${assets.size}`);

// すべてのアセットを列挙
for (const [path, asset] of assets) {
  console.log(`Path: ${path}, GUID: ${asset.guid}`);
}
```

### 3. アセットの変更

#### 画像ファイルの置き換え

```typescript
import { UnityPackage } from 'unitypackage-js';

const pkg = await UnityPackage.fromArrayBuffer(buffer);

// 置き換えたいアセットパス
const targetPath = 'Assets/Textures/Logo.png';

// 新しい画像データ（Uint8Arrayなど）を用意
const newImageData: Uint8Array = await fetch('/new/logo.png')
  .then((res) => res.arrayBuffer())
  .then((buf) => new Uint8Array(buf));

// アセットデータを置き換え
const replaced = pkg.updateAssetData(targetPath, newImageData);
if (!replaced) {
  throw new Error('指定した画像が見つかりません');
}

// 必要に応じてプレビュー画像を再生成
await pkg.refreshThumbnail(targetPath, 256);

// パッケージを再エクスポート
const newPackageData = await pkg.export();
```

#### アニメーションの書き換え

```typescript
import { UnityPackage, UnityAnimation } from 'unitypackage-js';

// UnityPackageからアニメーションを抽出
const pkg = await UnityPackage.fromArrayBuffer(buffer);
const asset = pkg.assets.get('Assets/Animations/MyAnim.anim');
if (!asset) {
  throw new Error('アニメーションが見つかりません');
}

// YAMLコンテンツをデコード
const yamlContent = new TextDecoder().decode(asset.assetData);

// UnityAnimationクラスでアニメーションを編集
const anim = new UnityAnimation(yamlContent);

// アニメーション名を変更
anim.setName('NewAnimationName');

// 既存のFloatCurveを取得
const curves = anim.getFloatCurves();
console.log(`FloatCurve数: ${curves.length}`);

// 特定のFloatCurveを取得
const curve = anim.getCurve('material._MainTex_ST.x', '');
if (curve) {
  console.log(`キーフレーム数: ${curve.curve.m_Curve.length}`);
}

// 新しいキーフレームを追加
anim.addKeyframe('material._MainTex_ST.x', '', {
  time: 0.5,
  value: 0.5,
  inSlope: 0,
  outSlope: 0,
  tangentMode: 136,
  weightedMode: 0,
  inWeight: 0.33333334,
  outWeight: 0.33333334,
});

// 特定の時間のキーフレームを削除
anim.removeKeyframe('material._MainTex_ST.x', '', 0.5);

// 新しいFloatCurveを追加
anim.addCurve({
  curve: {
    path: '',
    attribute: 'material._Color.r',
    script: { fileID: 0 },
    classID: 0,
    m_Curve: [
      {
        time: 0,
        value: 1,
        inSlope: 0,
        outSlope: 0,
        tangentMode: 136,
        weightedMode: 0,
        inWeight: 0.33333334,
        outWeight: 0.33333334,
      },
    ],
    m_PreInfinity: 2,
    m_PostInfinity: 2,
    m_RotationOrder: 4,
  },
  attribute: 'material._Color.r',
});

// FloatCurveを削除
anim.removeCurve('material._Color.r', '');

// 編集したYAMLをエクスポート
const updatedYaml = anim.exportToYaml();

// UnityPackageのアセットデータを更新
const updatedAssetData = new TextEncoder().encode(updatedYaml);
const updated = pkg.updateAssetData(asset.assetPath, updatedAssetData);
if (!updated) {
  throw new Error('アセット更新に失敗しました');
}

// パッケージをエクスポート
const newPackageData = await pkg.export();
```

**注意事項:**

- `UnityAnimation`クラスは現在FloatCurveのみをサポートしています。PositionCurves、RotationCurves、ScaleCurves等は未対応であり、これらを含むアニメーションへの利用は非推奨です

#### 構造化データの書き換え

Prefab内のMonoBehaviourコンポーネントを編集する例です。`UnityPackage.getPrefab`でPrefabを取得し、`UnityPrefab.updateComponentProperties`でプロパティを更新します。

```typescript
import { UnityPackage } from 'unitypackage-js';

// パッケージの読み込み
const pkg = await UnityPackage.fromArrayBuffer(buffer);

// Prefabを取得
const prefabAssetPath = 'Assets/Standard/Cube.prefab';
const prefab = pkg.getPrefab(prefabAssetPath);
if (!prefab) {
  throw new Error('Prefabが見つかりません');
}

// MonoBehaviourスクリプトのGUIDを特定
const scriptGuid = 'fea934192617d364d952c97c88563ef9'; // 例: DummyScript.cs の GUID

// プロパティを更新
prefab.updateComponentProperties(scriptGuid, {
  m_Enabled: '0',
  m_ObjectHideFlags: '1',
});

// 更新後のYAMLをエクスポートしてアセットデータを差し替え
const updatedData = new TextEncoder().encode(prefab.exportToYaml());
pkg.updateAssetData(prefabAssetPath, updatedData);

// エクスポート
const newPackageData = await pkg.export();
```

#### アセットパスのリネーム

```typescript
// アセットのパスを変更（GUIDは保持される）
const success = unityPackage.renameAsset(
  'Assets/OldPath/Image.png',
  'Assets/NewPath/Image.png',
);

if (success) {
  console.log('リネーム成功');
} else {
  console.log('指定されたアセットが見つかりません');
}
```

#### アセットGUIDの変更

```typescript
// アセットのGUIDを変更し、すべての参照を自動更新
const assetPath = 'Assets/Image.png';

// GUIDを自動生成して変更
const success = unityPackage.replaceAssetGuid(assetPath);

// または、特定のGUIDを指定して変更
const newGuid = 'a1b2c3d4e5f6789012345678abcdef00';
const success2 = unityPackage.replaceAssetGuid(assetPath, newGuid);

if (success) {
  console.log('GUID変更成功');
  // 他のアセット内の参照も自動的に更新されます
} else {
  console.log('指定されたアセットが見つかりません');
}
```

#### リネームとGUID変更の組み合わせ

```typescript
// アセットパスとGUIDの両方を変更
const oldPath = 'Assets/OldPath/Asset.prefab';
const newPath = 'Assets/NewPath/Asset.prefab';
const newGuid = '12345678901234567890123456789012';

// まずパスを変更
unityPackage.renameAsset(oldPath, newPath);

// 次にGUIDを変更
unityPackage.replaceAssetGuid(newPath, newGuid);

// パッケージをエクスポート
const newPackageData = await unityPackage.export();
```

#### サムネイルの再生成

```typescript
// 画像アセットのサムネイル（preview.png）を再生成
const assetPath = 'Assets/Image.png';

// デフォルトサイズ（128x128）で再生成
await unityPackage.refreshThumbnail(assetPath);

// カスタムサイズで再生成
await unityPackage.refreshThumbnail(assetPath, 256);

// パッケージをエクスポート
const newPackageData = await unityPackage.export();
```

### 4. UnityPackageの再構築と出力

```typescript
// UnityPackageインスタンスから.unitypackage（tar.gz）データを生成
const newPackageData = await unityPackage.export();

// ブラウザでダウンロードさせる場合などの処理
const blob = new Blob([newPackageData], { type: 'application/gzip' });
// ...
```

## 型定義

### `UnityPackage`

```typescript
class UnityPackage {
  /**
   * ArrayBufferからUnityPackageをインポートする
   */
  static async fromArrayBuffer(data: ArrayBuffer): Promise<UnityPackage>;

  /**
   * UnityPackageをエクスポートする
   */
  async export(): Promise<ArrayBuffer>;

  /**
   * アセット情報のマップを取得する（読み取り専用）
   */
  get assets(): ReadonlyMap<string, UnityAsset>;
}
```

### `UnityAsset`

```typescript
interface UnityAsset {
  guid: string; // アセットのGUID
  assetPath: string; // プロジェクト内パス (例: Assets/Image.png)
  assetData: Uint8Array; // アセット本体のバイナリデータ
  metaData?: Uint8Array; // metaファイルのバイナリデータ
  previewData?: Uint8Array; // プレビュー画像のバイナリデータ (存在する場合)
}
```

## APIリファレンス

### `UnityPackage`クラス

| メソッド/プロパティ                     | 型                                                                     | 説明                                                                                                                                     |
| :-------------------------------------- | :--------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------- |
| `UnityPackage.fromArrayBuffer` (static) | `(data: ArrayBuffer) => Promise<UnityPackage>`                         | .unitypackageファイル（tar.gz）のバイナリデータを解析し、UnityPackageインスタンスを返します。                                            |
| `export`                                | `() => Promise<ArrayBuffer>`                                           | UnityPackageインスタンスから.unitypackageファイル（tar.gz）のバイナリデータを生成して返します。                                          |
| `assets`                                | `ReadonlyMap<string, UnityAsset>`                                      | パスをキーとしたアセット情報のマップ（読み取り専用）を取得します。                                                                       |
| `updateAssetData`                       | `(assetPath: string, assetData: Uint8Array \| ArrayBuffer) => boolean` | 指定したアセットのデータを更新します。成功時はtrue、失敗時はfalseを返します。                                                            |
| `renameAsset`                           | `(oldPath: string, newPath: string) => boolean`                        | アセットのパスを変更します。GUIDは保持されます。成功時はtrue、失敗時はfalseを返します。                                                  |
| `replaceAssetGuid`                      | `(assetPath: string, newGuid?: string) => boolean`                     | アセットのGUIDを変更し、パッケージ内のすべての参照を更新します。newGuid省略時は自動生成されます。成功時はtrue、失敗時はfalseを返します。 |
| `refreshThumbnail`                      | `(assetPath: string, size?: number) => Promise<void>`                  | 画像アセットのサムネイル（preview.png）を再生成します。size省略時は128。ブラウザ環境専用。                                               |

## サンプル

### React Demo

`examples/react-demo` ディレクトリに、Reactを使用した簡易なサンプルアプリケーションが含まれています。
UnityPackageファイルの読み込み、アセット一覧の表示、および再生成などの機能をブラウザ上で試すことができます。

```bash
# サンプルの実行方法
npm install
npm run example:react

> unitypackage-js@1.0.0 example:react
> cd examples/react-demo && npm run dev

> react-demo@0.0.0 dev
> vite

  VITE v7.2.7  ready in 257 ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
  ➜  press h + enter to show help

# ブラウザで表示(デフォルトはhttp://localhost:5173)
```

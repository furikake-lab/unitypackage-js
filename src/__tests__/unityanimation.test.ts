import { describe, it, expect, beforeAll } from 'vitest';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { UnityPackage } from '../unitypackage';
import { UnityAnimation } from '../unityanimation';
import type { Keyframe } from '../unityanimation';

// フィクスチャファイルのパス
const FIXTURES_DIR = join(__dirname, 'fixtures');
const STANDARD_PACKAGE_PATH = join(FIXTURES_DIR, 'standard.unitypackage');

// テスト用のアニメーションデータ
let textureMoveAnimYaml: string;

beforeAll(async () => {
  // standard.unitypackageからTextureMove.animを抽出
  const standardBuffer = await readFile(STANDARD_PACKAGE_PATH);
  const standardPackageData = standardBuffer.buffer.slice(
    standardBuffer.byteOffset,
    standardBuffer.byteOffset + standardBuffer.byteLength,
  );

  const pkg = await UnityPackage.fromArrayBuffer(standardPackageData);

  // TextureMove.animを探す
  for (const [assetPath, asset] of pkg.assets) {
    if (assetPath.endsWith('TextureMove.anim')) {
      textureMoveAnimYaml = new TextDecoder().decode(asset.assetData);
      break;
    }
  }

  if (!textureMoveAnimYaml) {
    throw new Error('TextureMove.anim not found in standard.unitypackage');
  }
});

describe('UnityAnimation', () => {
  describe('基本的な機能', () => {
    it('YAMLからアニメーションを正しく読み込める', () => {
      const anim = new UnityAnimation(textureMoveAnimYaml);

      expect(anim).toBeInstanceOf(UnityAnimation);
      expect(anim.getName()).toBe('TextureMove');
    });

    it('アニメーション名を取得できる', () => {
      const anim = new UnityAnimation(textureMoveAnimYaml);

      expect(anim.getName()).toBe('TextureMove');
    });

    it('アニメーション名を設定できる', () => {
      const anim = new UnityAnimation(textureMoveAnimYaml);

      anim.setName('NewAnimationName');
      expect(anim.getName()).toBe('NewAnimationName');
    });

    it('すべてのFloatCurvesを取得できる', () => {
      const anim = new UnityAnimation(textureMoveAnimYaml);
      const curves = anim.getFloatCurves();

      // TextureMove.animには4つのFloatCurvesが含まれている
      expect(curves.length).toBe(4);

      // 各curveが必須フィールドを持っている
      for (const curve of curves) {
        expect(curve.attribute).toBeTruthy();
        expect(curve.path).toBeDefined();
        expect(Array.isArray(curve.keyframes)).toBe(true);
      }
    });

    it('特定のattributeとpathでFloatCurveを取得できる', () => {
      const anim = new UnityAnimation(textureMoveAnimYaml);

      // material._MainTex_ST.xのcurveを取得
      const curve = anim.getCurve('material._MainTex_ST.x', '');

      expect(curve).toBeDefined();
      expect(curve!.attribute).toBe('material._MainTex_ST.x');
      expect(curve!.path).toBe('');
      expect(curve!.keyframes.length).toBe(2);
    });

    it('存在しないcurveを取得するとundefinedを返す', () => {
      const anim = new UnityAnimation(textureMoveAnimYaml);

      const curve = anim.getCurve('nonexistent.attribute', 'nonexistent/path');

      expect(curve).toBeUndefined();
    });
  });

  describe('FloatCurves操作', () => {
    it('既存のcurveにキーフレームを追加できる', () => {
      const anim = new UnityAnimation(textureMoveAnimYaml);

      const newKeyframe: Keyframe = {
        time: 0.5,
        value: 0.5,
        inSlope: 0,
        outSlope: 0,
        tangentMode: 136,
        weightedMode: 0,
        inWeight: 0.33333334,
        outWeight: 0.33333334,
      };

      anim.addKeyframe('material._MainTex_ST.x', '', newKeyframe);

      const curve = anim.getCurve('material._MainTex_ST.x', '');
      expect(curve!.keyframes.length).toBe(3);

      // キーフレームが時間順にソートされている
      expect(curve!.keyframes[0].time).toBe(0);
      expect(curve!.keyframes[1].time).toBe(0.5);
      expect(curve!.keyframes[2].time).toBe(1);
    });

    it('キーフレームを削除できる', () => {
      const anim = new UnityAnimation(textureMoveAnimYaml);

      // time=0のキーフレームを削除
      anim.removeKeyframe('material._MainTex_ST.x', '', 0);

      const curve = anim.getCurve('material._MainTex_ST.x', '');
      expect(curve!.keyframes.length).toBe(1);
      expect(curve!.keyframes[0].time).toBe(1);
    });

    it('新しいFloatCurveを追加できる', () => {
      const anim = new UnityAnimation(textureMoveAnimYaml);

      const newCurve = {
        attribute: 'test.attribute',
        path: 'test/path',
        classID: 1,
        keyframes: [
          {
            time: 0,
            value: 1,
            inSlope: 0,
            outSlope: 0,
            tangentMode: 0,
            weightedMode: 0,
            inWeight: 0.33333334,
            outWeight: 0.33333334,
          },
        ],
      };

      anim.addCurve(newCurve);

      const curves = anim.getFloatCurves();
      expect(curves.length).toBe(5);

      const addedCurve = anim.getCurve('test.attribute', 'test/path');
      expect(addedCurve).toBeDefined();
      expect(addedCurve!.keyframes.length).toBe(1);
    });

    it('既存のcurveを更新できる', () => {
      const anim = new UnityAnimation(textureMoveAnimYaml);

      const updatedCurve = {
        attribute: 'material._MainTex_ST.x',
        path: '',
        classID: 23,
        keyframes: [
          {
            time: 0,
            value: 2,
            inSlope: 1,
            outSlope: 1,
            tangentMode: 0,
            weightedMode: 0,
            inWeight: 0.5,
            outWeight: 0.5,
          },
        ],
      };

      anim.addCurve(updatedCurve);

      const curves = anim.getFloatCurves();
      expect(curves.length).toBe(4); // 数は変わらない

      const curve = anim.getCurve('material._MainTex_ST.x', '');
      expect(curve!.keyframes.length).toBe(1);
      expect(curve!.keyframes[0].value).toBe(2);
    });

    it('FloatCurveを削除できる', () => {
      const anim = new UnityAnimation(textureMoveAnimYaml);

      anim.removeCurve('material._MainTex_ST.x', '');

      const curves = anim.getFloatCurves();
      expect(curves.length).toBe(3);

      const curve = anim.getCurve('material._MainTex_ST.x', '');
      expect(curve).toBeUndefined();
    });
  });

  describe('エクスポート機能', () => {
    it('YAMLにエクスポートできる', () => {
      const anim = new UnityAnimation(textureMoveAnimYaml);

      const exportedYaml = anim.exportToYaml();

      expect(typeof exportedYaml).toBe('string');
      expect(exportedYaml.length).toBeGreaterThan(0);
      expect(exportedYaml).toContain('AnimationClip:');
      expect(exportedYaml).toContain('m_Name: TextureMove');
    });

    it('変更後のアニメーション名がエクスポートに反映される', () => {
      const anim = new UnityAnimation(textureMoveAnimYaml);

      anim.setName('ModifiedAnimation');
      const exportedYaml = anim.exportToYaml();

      expect(exportedYaml).toContain('m_Name: ModifiedAnimation');
    });

    it('ラウンドトリップでデータが保持される', () => {
      const original = new UnityAnimation(textureMoveAnimYaml);

      const exportedYaml = original.exportToYaml();
      const reimported = new UnityAnimation(exportedYaml);

      // アニメーション名が保持される
      expect(reimported.getName()).toBe(original.getName());

      // FloatCurvesの数が保持される
      expect(reimported.getFloatCurves().length).toBe(
        original.getFloatCurves().length,
      );

      // 各curveのデータが保持される
      for (const originalCurve of original.getFloatCurves()) {
        const reimportedCurve = reimported.getCurve(
          originalCurve.attribute,
          originalCurve.path,
        );

        expect(reimportedCurve).toBeDefined();
        expect(reimportedCurve!.keyframes.length).toBe(
          originalCurve.keyframes.length,
        );

        // 各キーフレームのデータが保持される
        for (let i = 0; i < originalCurve.keyframes.length; i++) {
          const originalKf = originalCurve.keyframes[i];
          const reimportedKf = reimportedCurve!.keyframes[i];

          expect(reimportedKf.time).toBeCloseTo(originalKf.time, 5);
          expect(reimportedKf.value).toBeCloseTo(originalKf.value, 5);
          expect(reimportedKf.inSlope).toBeCloseTo(originalKf.inSlope, 5);
          expect(reimportedKf.outSlope).toBeCloseTo(originalKf.outSlope, 5);
          expect(reimportedKf.tangentMode).toBe(originalKf.tangentMode);
        }
      }
    });

    it('curve追加後のラウンドトリップでデータが保持される', () => {
      const original = new UnityAnimation(textureMoveAnimYaml);

      // 新しいcurveを追加
      original.addCurve({
        attribute: 'new.attribute',
        path: 'new/path',
        classID: 224,
        keyframes: [
          {
            time: 0,
            value: 5,
            inSlope: 0,
            outSlope: 0,
            tangentMode: 0,
            weightedMode: 0,
            inWeight: 0.33333334,
            outWeight: 0.33333334,
          },
        ],
      });

      const exportedYaml = original.exportToYaml();
      const reimported = new UnityAnimation(exportedYaml);

      expect(reimported.getFloatCurves().length).toBe(5);

      const newCurve = reimported.getCurve('new.attribute', 'new/path');
      expect(newCurve).toBeDefined();
      expect(newCurve!.keyframes[0].value).toBe(5);
      expect(newCurve!.classID).toBe(224);
    });

    it('複数回のラウンドトリップでデータが保持される', () => {
      let current = new UnityAnimation(textureMoveAnimYaml);

      // 3回のラウンドトリップ
      for (let i = 0; i < 3; i++) {
        const exported = current.exportToYaml();
        current = new UnityAnimation(exported);
      }

      // 元のデータと比較
      const original = new UnityAnimation(textureMoveAnimYaml);
      expect(current.getName()).toBe(original.getName());
      expect(current.getFloatCurves().length).toBe(
        original.getFloatCurves().length,
      );
    });
  });

  describe('エラーハンドリング', () => {
    it('不正なYAMLデータに対してエラーをスローする', () => {
      const invalidYaml = 'invalid yaml content {[}]';

      expect(() => new UnityAnimation(invalidYaml)).toThrow();
    });

    it('AnimationClipが含まれないYAMLに対してエラーをスローする', () => {
      const yamlWithoutAnimationClip = `
%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!1 &100000
GameObject:
  m_Name: TestObject
`;

      expect(() => new UnityAnimation(yamlWithoutAnimationClip)).toThrow(
        'AnimationClip not found in YAML',
      );
    });

    it('空のYAMLに対してエラーをスローする', () => {
      const emptyYaml = '';

      expect(() => new UnityAnimation(emptyYaml)).toThrow();
    });
  });

  describe('キーフレームデータの詳細', () => {
    it('各FloatCurveが正しいattributeを持つ', () => {
      const anim = new UnityAnimation(textureMoveAnimYaml);
      const curves = anim.getFloatCurves();

      const attributes = curves.map((c) => c.attribute).sort();
      expect(attributes).toEqual([
        'material._MainTex_ST.w',
        'material._MainTex_ST.x',
        'material._MainTex_ST.y',
        'material._MainTex_ST.z',
      ]);
    });

    it('各FloatCurveが2つのキーフレームを持つ', () => {
      const anim = new UnityAnimation(textureMoveAnimYaml);
      const curves = anim.getFloatCurves();

      for (const curve of curves) {
        expect(curve.keyframes.length).toBe(2);
      }
    });

    it('キーフレームが正しい時間範囲を持つ', () => {
      const anim = new UnityAnimation(textureMoveAnimYaml);
      const curve = anim.getCurve('material._MainTex_ST.x', '');

      expect(curve!.keyframes[0].time).toBe(0);
      expect(curve!.keyframes[1].time).toBe(1);
    });

    it('キーフレームが正しい値を持つ', () => {
      const anim = new UnityAnimation(textureMoveAnimYaml);

      // material._MainTex_ST.x と y は値が1
      const curveX = anim.getCurve('material._MainTex_ST.x', '');
      expect(curveX!.keyframes[0].value).toBe(1);
      expect(curveX!.keyframes[1].value).toBe(1);

      // material._MainTex_ST.z は 0 -> 1
      const curveZ = anim.getCurve('material._MainTex_ST.z', '');
      expect(curveZ!.keyframes[0].value).toBe(0);
      expect(curveZ!.keyframes[1].value).toBe(1);
    });
  });
});

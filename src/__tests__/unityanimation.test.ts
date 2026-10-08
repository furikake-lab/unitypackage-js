import { describe, it, expect, beforeAll } from 'vitest';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { UnityPackage } from '../unitypackage';
import * as yaml from 'js-yaml';
import { UnityAnimation } from '../unityanimation';
import type {
  EulerCurve,
  Keyframe,
  Vector3,
  Vector3Keyframe,
} from '../unityanimation';
import { crc32 } from '../utils/crc32';

// フィクスチャファイルのパス
const FIXTURES_DIR = join(__dirname, 'fixtures');
const STANDARD_PACKAGE_PATH = join(FIXTURES_DIR, 'standard.unitypackage');

// テスト用のアニメーションデータ
let textureMoveAnimYaml: string;
let hopAnimYaml: string;
let rotateAnimYaml: string;

/**
 * YAMLのAnimationClip部分を解析する（空の値はnullになるため空文字列に正規化）
 */
function parseAnimationClip(yamlContent: string): Record<string, unknown> {
  const match = yamlContent.match(/AnimationClip:([\s\S]*?)(?=\n\S|$)/);
  const normalize = (v: unknown): unknown => {
    if (v === null) return '';
    if (Array.isArray(v)) return v.map(normalize);
    if (typeof v === 'object') {
      return Object.fromEntries(
        Object.entries(v as object).map(([k, x]) => [k, normalize(x)]),
      );
    }
    return v;
  };
  return normalize(yaml.load(match![1])) as Record<string, unknown>;
}

type ParsedEntry = Record<string, unknown>;

const vec = (x: number, y: number, z: number): Vector3 => ({ x, y, z });
const defaultWeight = vec(0.33333334, 0.33333334, 0.33333334);

function eulerKeyframe(
  time: number,
  value: Vector3,
  slope: Vector3 = vec(0, 0, 0),
): Vector3Keyframe {
  return {
    time,
    value,
    inSlope: slope,
    outSlope: slope,
    tangentMode: 0,
    weightedMode: 0,
    inWeight: defaultWeight,
    outWeight: defaultWeight,
  };
}

function createEulerCurve(path: string): EulerCurve {
  return {
    path,
    rotationOrder: 4,
    keyframes: [
      eulerKeyframe(0, vec(0, 0, 0)),
      eulerKeyframe(2, vec(0, 0, 180)),
    ],
  };
}

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
    } else if (assetPath.endsWith('Hop.anim')) {
      hopAnimYaml = new TextDecoder().decode(asset.assetData);
    } else if (assetPath.endsWith('Rotate.anim')) {
      rotateAnimYaml = new TextDecoder().decode(asset.assetData);
    }
  }

  if (!textureMoveAnimYaml) {
    throw new Error('TextureMove.anim not found in standard.unitypackage');
  }
  if (!hopAnimYaml) {
    throw new Error('Hop.anim not found in standard.unitypackage');
  }
  if (!rotateAnimYaml) {
    throw new Error('Rotate.anim not found in standard.unitypackage');
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

  describe('ラウンドトリップでの元データの保持', () => {
    it('変更せずに書き出すとFloatCurveのアニメーションの内容が変わらない', () => {
      const anim = new UnityAnimation(textureMoveAnimYaml);

      expect(parseAnimationClip(anim.exportToYaml())).toEqual(
        parseAnimationClip(textureMoveAnimYaml),
      );
    });

    it('変更せずに書き出すと未対応のPositionCurveのアニメーションの内容が変わらない', () => {
      const anim = new UnityAnimation(hopAnimYaml);

      expect(parseAnimationClip(anim.exportToYaml())).toEqual(
        parseAnimationClip(hopAnimYaml),
      );
    });

    it('FloatCurveを追加しても未対応のcurveのm_EditorCurvesとbindingが残る', () => {
      const anim = new UnityAnimation(hopAnimYaml);
      anim.addCurve({
        attribute: 'm_IsActive',
        path: 'Child',
        classID: 1,
        keyframes: [
          {
            time: 0,
            value: 1,
            inSlope: Infinity,
            outSlope: Infinity,
            tangentMode: 103,
            weightedMode: 0,
            inWeight: 0.33333334,
            outWeight: 0.33333334,
          },
        ],
      });

      const original = parseAnimationClip(hopAnimYaml);
      const exported = parseAnimationClip(anim.exportToYaml());

      // PositionCurveはそのまま
      expect(exported.m_PositionCurves).toEqual(original.m_PositionCurves);

      // m_LocalPosition.x/y/zのeditor curvesが残り、追加分が末尾に入る
      const editorCurves = exported.m_EditorCurves as ParsedEntry[];
      expect(editorCurves.slice(0, 3)).toEqual(original.m_EditorCurves);
      expect(editorCurves.map((c) => c.attribute)).toEqual([
        'm_LocalPosition.x',
        'm_LocalPosition.y',
        'm_LocalPosition.z',
        'm_IsActive',
      ]);

      // PositionCurveのbindingが残り、追加分のbindingはCRC32で出力される
      const bindings = (exported.m_ClipBindingConstant as ParsedEntry)
        .genericBindings as ParsedEntry[];
      expect(bindings.length).toBe(2);
      expect(bindings[0]).toEqual(
        (
          (original.m_ClipBindingConstant as ParsedEntry)
            .genericBindings as ParsedEntry[]
        )[0],
      );
      expect(bindings[1]).toMatchObject({
        path: crc32('Child'),
        attribute: crc32('m_IsActive'),
        typeID: 1,
        customType: 0,
      });
    });

    it('FloatCurveのキーフレームを変更すると対応するm_EditorCurvesのみ更新される', () => {
      const anim = new UnityAnimation(textureMoveAnimYaml);
      anim.getCurve('material._MainTex_ST.z', '')!.keyframes[1].value = 2;

      const original = parseAnimationClip(textureMoveAnimYaml);
      const exported = parseAnimationClip(anim.exportToYaml());

      const editorCurves = exported.m_EditorCurves as ParsedEntry[];
      const originalEditorCurves = original.m_EditorCurves as ParsedEntry[];
      expect(editorCurves.length).toBe(4);
      expect(editorCurves[0]).toEqual(originalEditorCurves[0]);
      const zCurve = editorCurves[2].curve as { m_Curve: ParsedEntry[] };
      expect(editorCurves[2].attribute).toBe('material._MainTex_ST.z');
      expect(zCurve.m_Curve[1].value).toBe(2);

      // bindingは変わらない
      expect(exported.m_ClipBindingConstant).toEqual(
        original.m_ClipBindingConstant,
      );
    });
  });

  describe('Unityで作成したEulerCurveの読み込み', () => {
    it('EulerCurveを読み込める', () => {
      const anim = new UnityAnimation(rotateAnimYaml);

      expect(anim.getName()).toBe('Rotate');
      expect(anim.getFloatCurves()).toEqual([]);
      expect(anim.getEulerCurves().length).toBe(1);

      const curve = anim.getEulerCurve('Pivot');
      expect(curve).toBeDefined();
      expect(curve!.rotationOrder).toBe(4);
      expect(curve!.keyframes.map((kf) => kf.time)).toEqual([0, 0.5, 1]);
      expect(curve!.keyframes.map((kf) => kf.value)).toEqual([
        vec(0, 0, 0),
        vec(90, 0, 90),
        vec(0, 0, 180),
      ]);
    });

    it('段差のキー（Infinityの傾き）を読み込める', () => {
      const anim = new UnityAnimation(rotateAnimYaml);
      const stepKey = anim.getEulerCurve('Pivot')!.keyframes[1];

      expect(stepKey.inSlope.x).toBe(Infinity);
      expect(stepKey.outSlope.x).toBe(Infinity);
      expect(stepKey.inSlope.z).toBe(180);
    });

    it('変更せずに書き出すと内容が変わらない', () => {
      const anim = new UnityAnimation(rotateAnimYaml);

      expect(parseAnimationClip(anim.exportToYaml())).toEqual(
        parseAnimationClip(rotateAnimYaml),
      );
    });

    it('UnityのgenericBindingのpathがCRC32と一致する', () => {
      const original = parseAnimationClip(rotateAnimYaml);
      const bindings = (original.m_ClipBindingConstant as ParsedEntry)
        .genericBindings as ParsedEntry[];

      expect(bindings[0]).toMatchObject({
        path: crc32('Pivot'),
        attribute: 4,
        typeID: 4,
        customType: 4,
      });
    });

    it('キーフレームを追加するとm_EditorCurvesの各軸に反映される', () => {
      const anim = new UnityAnimation(rotateAnimYaml);
      anim.addEulerKeyframe(
        'Pivot',
        eulerKeyframe(2, vec(0, 0, 0), vec(0, 0, Infinity)),
      );

      const original = parseAnimationClip(rotateAnimYaml);
      const exported = parseAnimationClip(anim.exportToYaml());

      const editorCurves = exported.m_EditorCurves as ParsedEntry[];
      expect(editorCurves.map((c) => c.attribute)).toEqual([
        'localEulerAnglesRaw.x',
        'localEulerAnglesRaw.y',
        'localEulerAnglesRaw.z',
      ]);
      const zKeys = (editorCurves[2].curve as { m_Curve: ParsedEntry[] })
        .m_Curve;
      expect(zKeys.map((kf) => kf.time)).toEqual([0, 0.5, 1, 2]);
      expect(zKeys[3].inSlope).toBe('Infinity');

      // bindingとm_EulerEditorCurvesは変わらず、終了時間が延びる
      expect(exported.m_ClipBindingConstant).toEqual(
        original.m_ClipBindingConstant,
      );
      expect(exported.m_EulerEditorCurves).toEqual(
        original.m_EulerEditorCurves,
      );
      expect((exported.m_AnimationClipSettings as ParsedEntry).m_StopTime).toBe(
        2,
      );
    });

    it('EulerCurveを削除すると派生データも削除される', () => {
      const anim = new UnityAnimation(rotateAnimYaml);
      anim.removeEulerCurve('Pivot');

      const exported = parseAnimationClip(anim.exportToYaml());

      expect(exported.m_EulerCurves).toEqual([]);
      expect(exported.m_EditorCurves).toEqual([]);
      expect(exported.m_EulerEditorCurves).toEqual([]);
      expect(
        (exported.m_ClipBindingConstant as ParsedEntry).genericBindings,
      ).toEqual([]);
    });
  });

  describe('EulerCurves操作', () => {
    it('EulerCurveがないアニメーションでは空配列を返す', () => {
      const anim = new UnityAnimation(textureMoveAnimYaml);

      expect(anim.getEulerCurves()).toEqual([]);
      expect(anim.getEulerCurve('')).toBeUndefined();
    });

    it('EulerCurveを追加・取得できる', () => {
      const anim = new UnityAnimation(textureMoveAnimYaml);
      anim.addEulerCurve(createEulerCurve('Armature/Page_Flip'));

      expect(anim.getEulerCurves().length).toBe(1);
      const curve = anim.getEulerCurve('Armature/Page_Flip');
      expect(curve).toBeDefined();
      expect(curve!.keyframes[1].value).toEqual(vec(0, 0, 180));
    });

    it('同じpathのEulerCurveを追加すると更新される', () => {
      const anim = new UnityAnimation(textureMoveAnimYaml);
      anim.addEulerCurve(createEulerCurve('Armature/Page_Flip'));
      anim.addEulerCurve({
        path: 'Armature/Page_Flip',
        rotationOrder: 4,
        keyframes: [eulerKeyframe(0, vec(10, 20, 30))],
      });

      expect(anim.getEulerCurves().length).toBe(1);
      expect(anim.getEulerCurve('Armature/Page_Flip')!.keyframes).toEqual([
        eulerKeyframe(0, vec(10, 20, 30)),
      ]);
    });

    it('EulerCurveを削除できる', () => {
      const anim = new UnityAnimation(textureMoveAnimYaml);
      anim.addEulerCurve(createEulerCurve('Armature/Page_Flip'));
      anim.removeEulerCurve('Armature/Page_Flip');

      expect(anim.getEulerCurves()).toEqual([]);
    });

    it('EulerCurveにキーフレームを時間順で追加できる', () => {
      const anim = new UnityAnimation(textureMoveAnimYaml);
      anim.addEulerCurve(createEulerCurve('Armature/Page_Flip'));
      anim.addEulerKeyframe(
        'Armature/Page_Flip',
        eulerKeyframe(1, vec(0, 0, 90)),
      );

      const times = anim
        .getEulerCurve('Armature/Page_Flip')!
        .keyframes.map((kf) => kf.time);
      expect(times).toEqual([0, 1, 2]);
    });

    it('EulerCurveからキーフレームを削除できる', () => {
      const anim = new UnityAnimation(textureMoveAnimYaml);
      anim.addEulerCurve(createEulerCurve('Armature/Page_Flip'));
      anim.removeEulerKeyframe('Armature/Page_Flip', 0);

      const keyframes = anim.getEulerCurve('Armature/Page_Flip')!.keyframes;
      expect(keyframes.length).toBe(1);
      expect(keyframes[0].time).toBe(2);
    });

    it('存在しないEulerCurveへのキーフレーム操作は無視される', () => {
      const anim = new UnityAnimation(textureMoveAnimYaml);
      anim.addEulerKeyframe('nonexistent', eulerKeyframe(0, vec(0, 0, 0)));
      anim.removeEulerKeyframe('nonexistent', 0);

      expect(anim.getEulerCurves()).toEqual([]);
    });
  });

  describe('EulerCurvesのエクスポート', () => {
    it('追加したEulerCurveがラウンドトリップで保持される', () => {
      const anim = new UnityAnimation(textureMoveAnimYaml);
      anim.addEulerCurve(createEulerCurve('Armature/Page_Flip'));

      const reimported = new UnityAnimation(anim.exportToYaml());

      expect(reimported.getEulerCurves()).toEqual([
        createEulerCurve('Armature/Page_Flip'),
      ]);
      // FloatCurveも保持される
      expect(reimported.getFloatCurves().length).toBe(4);
    });

    it('段差のキー（±Infinityの傾き）がラウンドトリップで保持される', () => {
      const anim = new UnityAnimation(textureMoveAnimYaml);
      anim.addEulerCurve({
        path: 'Armature/Page_Flip',
        rotationOrder: 4,
        keyframes: [
          eulerKeyframe(0, vec(0, 0, 0), vec(0, 0, Infinity)),
          eulerKeyframe(1, vec(0, 0, 180), vec(0, 0, -Infinity)),
        ],
      });

      const exportedYaml = anim.exportToYaml();
      expect(exportedYaml).toMatch(/z: Infinity$/m);
      expect(exportedYaml).toMatch(/z: -Infinity$/m);

      const curve = new UnityAnimation(exportedYaml).getEulerCurve(
        'Armature/Page_Flip',
      )!;
      expect(curve.keyframes[0].inSlope.z).toBe(Infinity);
      expect(curve.keyframes[0].outSlope.z).toBe(Infinity);
      expect(curve.keyframes[1].inSlope.z).toBe(-Infinity);
      expect(curve.keyframes[1].outSlope.z).toBe(-Infinity);
    });

    it('EulerCurveに対応するm_EditorCurvesが軸ごとに出力される', () => {
      const anim = new UnityAnimation(textureMoveAnimYaml);
      anim.addEulerCurve(createEulerCurve('Armature/Page_Flip'));

      const exported = parseAnimationClip(anim.exportToYaml());
      const eulerEditorCurves = (
        exported.m_EditorCurves as ParsedEntry[]
      ).filter((c) => c.path === 'Armature/Page_Flip');

      expect(eulerEditorCurves.map((c) => c.attribute)).toEqual([
        'localEulerAnglesRaw.x',
        'localEulerAnglesRaw.y',
        'localEulerAnglesRaw.z',
      ]);
      for (const c of eulerEditorCurves) {
        expect(c.classID).toBe(4);
      }
      const zCurve = eulerEditorCurves[2].curve as { m_Curve: ParsedEntry[] };
      expect(zCurve.m_Curve.map((kf) => kf.value)).toEqual([0, 180]);

      // FloatCurveのm_EditorCurvesも残る
      expect((exported.m_EditorCurves as ParsedEntry[]).length).toBe(7);
    });

    it('EulerCurveに対応するm_EulerEditorCurvesが出力される', () => {
      const anim = new UnityAnimation(textureMoveAnimYaml);
      anim.addEulerCurve(createEulerCurve('Armature/Page_Flip'));

      const exported = parseAnimationClip(anim.exportToYaml());
      const entries = exported.m_EulerEditorCurves as ParsedEntry[];

      expect(entries.map((c) => [c.attribute, c.path, c.classID])).toEqual([
        ['m_LocalEulerAngles.x', 'Armature/Page_Flip', 4],
        ['m_LocalEulerAngles.y', 'Armature/Page_Flip', 4],
        ['m_LocalEulerAngles.z', 'Armature/Page_Flip', 4],
      ]);
    });

    it('EulerCurveに対応するgenericBindingが出力される', () => {
      const anim = new UnityAnimation(textureMoveAnimYaml);
      anim.addEulerCurve(createEulerCurve('Armature/Page_Flip'));

      const original = parseAnimationClip(textureMoveAnimYaml);
      const exported = parseAnimationClip(anim.exportToYaml());
      const bindings = (exported.m_ClipBindingConstant as ParsedEntry)
        .genericBindings as ParsedEntry[];
      const originalBindings = (original.m_ClipBindingConstant as ParsedEntry)
        .genericBindings as ParsedEntry[];

      // FloatCurveのbindingは元のまま残る
      expect(bindings.length).toBe(5);
      expect(bindings.slice(0, 4)).toEqual(originalBindings);
      expect(bindings[4]).toMatchObject({
        path: crc32('Armature/Page_Flip'),
        attribute: 4,
        typeID: 4,
        customType: 4,
      });
    });

    it('アニメーションの開始・終了時間にEulerCurveのキーが含まれる', () => {
      const anim = new UnityAnimation(textureMoveAnimYaml);
      anim.addEulerCurve(createEulerCurve('Armature/Page_Flip'));

      const exported = parseAnimationClip(anim.exportToYaml());
      const settings = exported.m_AnimationClipSettings as ParsedEntry;

      expect(settings.m_StartTime).toBe(0);
      expect(settings.m_StopTime).toBe(2);
    });

    it('削除したEulerCurveのm_EditorCurves・bindingが出力されない', () => {
      const withEuler = new UnityAnimation(textureMoveAnimYaml);
      withEuler.addEulerCurve(createEulerCurve('Armature/Page_Flip'));

      const anim = new UnityAnimation(withEuler.exportToYaml());
      anim.removeEulerCurve('Armature/Page_Flip');

      const exported = parseAnimationClip(anim.exportToYaml());
      const original = parseAnimationClip(textureMoveAnimYaml);

      expect(exported.m_EulerCurves).toEqual([]);
      expect(exported.m_EditorCurves).toEqual(original.m_EditorCurves);
      expect(exported.m_EulerEditorCurves).toEqual([]);
      expect(exported.m_ClipBindingConstant).toEqual(
        original.m_ClipBindingConstant,
      );
    });

    it('EulerCurveを含むアニメーションは変更せずに書き出すと内容が変わらない', () => {
      const withEuler = new UnityAnimation(textureMoveAnimYaml);
      withEuler.addEulerCurve(createEulerCurve('Armature/Page_Flip'));
      const yamlWithEuler = withEuler.exportToYaml();

      const anim = new UnityAnimation(yamlWithEuler);

      expect(parseAnimationClip(anim.exportToYaml())).toEqual(
        parseAnimationClip(yamlWithEuler),
      );
    });

    it('FloatCurveを編集してもEulerCurveとその派生データが消えない', () => {
      const withEuler = new UnityAnimation(textureMoveAnimYaml);
      withEuler.addEulerCurve(createEulerCurve('Armature/Page_Flip'));
      const yamlWithEuler = withEuler.exportToYaml();

      const anim = new UnityAnimation(yamlWithEuler);
      anim.removeCurve('material._MainTex_ST.x', '');

      const before = parseAnimationClip(yamlWithEuler);
      const exported = parseAnimationClip(anim.exportToYaml());

      expect(exported.m_EulerCurves).toEqual(before.m_EulerCurves);
      expect(exported.m_EulerEditorCurves).toEqual(before.m_EulerEditorCurves);
      const editorAttributes = (exported.m_EditorCurves as ParsedEntry[]).map(
        (c) => c.attribute,
      );
      expect(editorAttributes).toContain('localEulerAnglesRaw.z');
      expect(editorAttributes).not.toContain('material._MainTex_ST.x');
      const bindings = (exported.m_ClipBindingConstant as ParsedEntry)
        .genericBindings as ParsedEntry[];
      expect(bindings.some((b) => b.typeID === 4 && b.attribute === 4)).toBe(
        true,
      );
    });
  });
});

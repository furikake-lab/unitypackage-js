import * as yaml from 'js-yaml';
import { crc32 } from './utils/crc32';

/**
 * Unity アニメーションファイルのキーフレーム情報
 */
export interface Keyframe {
  time: number;
  value: number;
  inSlope: number;
  outSlope: number;
  tangentMode: number;
  weightedMode: number;
  inWeight: number;
  outWeight: number;
}

/**
 * Unity アニメーションのFloat曲線情報
 */
export interface FloatCurve {
  attribute: string;
  path: string;
  keyframes: Keyframe[];
  classID: number;
}

/**
 * 3次元ベクトル
 */
export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Unity アニメーションファイルのベクトル値キーフレーム情報
 */
export interface Vector3Keyframe {
  time: number;
  value: Vector3;
  inSlope: Vector3;
  outSlope: Vector3;
  tangentMode: number;
  weightedMode: number;
  inWeight: Vector3;
  outWeight: Vector3;
}

/**
 * Unity アニメーションのEuler回転曲線情報（Transformのローカル回転）
 */
export interface EulerCurve {
  path: string;
  keyframes: Vector3Keyframe[];
  rotationOrder: number;
}

type RawData = Record<string, unknown>;

const AXES = ['x', 'y', 'z'] as const;
type Axis = (typeof AXES)[number];

// Transform(classID 4)のEuler回転に関する定数
const TRANSFORM_CLASS_ID = 4;
const EULER_BINDING_ATTRIBUTE = 4;
const EULER_CUSTOM_TYPE = 4;
const MATERIAL_CUSTOM_TYPE = 22;
const EULER_EDITOR_ATTRIBUTE_PREFIX = 'localEulerAnglesRaw.';
const EULER_EULER_EDITOR_ATTRIBUTE_PREFIX = 'm_LocalEulerAngles.';

const DEFAULT_WEIGHT = 0.33333334;
const DEFAULT_ROTATION_ORDER = 4;

// 未対応のcurve（キーの時間範囲の計算にのみ利用する）
// m_PPtrCurvesは`curve`が{time, value}の配列で、他は`curve.m_Curve`にキーを持つ
const UNMANAGED_CURVE_KEYS = [
  'm_RotationCurves',
  'm_PositionCurves',
  'm_ScaleCurves',
  'm_PPtrCurves',
] as const;

/**
 * Unityアニメーションファイル情報
 */
export class UnityAnimation {
  // animation clipは非YAMLのヘッダーとYAMLのメイン部分に分かれている
  // このクラスで編集したいのは主にfloatCurvesとeulerCurvesのみで、他はあまり触りたくない
  // そのため、元のデータを保持し必要な部分のみを更新して再構築する
  private _originalYaml: string = '';
  private _animationName: string = '';
  private _floatCurves: FloatCurve[] = [];
  private _eulerCurves: EulerCurve[] = [];
  private _originalParsedData: RawData = {};

  // 読み込み時点の各curveの元データとスナップショット
  // 書き出し時、変更のないcurveは元データをそのまま出力するために使う
  private _originalFloatCurves = new Map<
    string,
    { raw: RawData; snapshot: string; curve: FloatCurve }
  >();
  private _originalEulerCurves = new Map<
    string,
    { raw: RawData; snapshot: string }
  >();

  // Note:
  //   このクラスで編集できるのはfloatCurvesとeulerCurvesのみで、以下のcurveは編集できない
  //   以下のcurveは元データ（対応するm_EditorCurves・genericBindingsを含む）をそのまま保持する
  // private _positionCurves: []
  // private _rotationCurves: []
  // private _scaleCurves: []
  // private _compressedRotationCurves: []
  // private _pPtrCurves: []

  /**
   * YAML文字列からアニメーションデータを読み込み
   */
  constructor(yamlContent: string) {
    this._originalYaml = yamlContent;
    this.parseNameAndCurves();
  }

  /**
   * アニメーション名を取得
   */
  getName(): string {
    return this._animationName;
  }

  /**
   * アニメーション名を設定
   */
  setName(name: string): void {
    this._animationName = name;
  }

  /**
   * すべてのFloat曲線を取得
   */
  getFloatCurves(): FloatCurve[] {
    return this._floatCurves;
  }

  /**
   * 指定されたattributeとpathのFloat曲線を取得
   */
  getCurve(attribute: string, path: string): FloatCurve | undefined {
    return this._floatCurves.find(
      (c) => c.attribute === attribute && c.path === path,
    );
  }

  /**
   * Float曲線を追加または更新
   */
  addCurve(curve: FloatCurve): void {
    const existing = this.getCurve(curve.attribute, curve.path);
    if (existing) {
      existing.keyframes = curve.keyframes;
    } else {
      this._floatCurves.push(curve);
    }
  }

  /**
   * Float曲線を削除
   */
  removeCurve(attribute: string, path: string): void {
    this._floatCurves = this._floatCurves.filter(
      (c) => !(c.attribute === attribute && c.path === path),
    );
  }

  /**
   * 指定されたFloat曲線にキーフレームを追加
   */
  addKeyframe(attribute: string, path: string, keyframe: Keyframe): void {
    const curve = this.getCurve(attribute, path);
    if (curve) {
      curve.keyframes.push(keyframe);
      curve.keyframes.sort((a, b) => a.time - b.time);
    }
  }

  /**
   * 指定されたFloat曲線からキーフレームを削除（時間による検索）
   */
  removeKeyframe(attribute: string, path: string, time: number): void {
    const curve = this.getCurve(attribute, path);
    if (curve) {
      curve.keyframes = curve.keyframes.filter(
        (k) => Math.abs(k.time - time) > 0.001,
      );
    }
  }

  /**
   * すべてのEuler回転曲線を取得
   */
  getEulerCurves(): EulerCurve[] {
    return this._eulerCurves;
  }

  /**
   * 指定されたpathのEuler回転曲線を取得
   */
  getEulerCurve(path: string): EulerCurve | undefined {
    return this._eulerCurves.find((c) => c.path === path);
  }

  /**
   * Euler回転曲線を追加または更新
   */
  addEulerCurve(curve: EulerCurve): void {
    const existing = this.getEulerCurve(curve.path);
    if (existing) {
      existing.keyframes = curve.keyframes;
      existing.rotationOrder = curve.rotationOrder;
    } else {
      this._eulerCurves.push(curve);
    }
  }

  /**
   * Euler回転曲線を削除
   */
  removeEulerCurve(path: string): void {
    this._eulerCurves = this._eulerCurves.filter((c) => c.path !== path);
  }

  /**
   * 指定されたEuler回転曲線にキーフレームを追加
   */
  addEulerKeyframe(path: string, keyframe: Vector3Keyframe): void {
    const curve = this.getEulerCurve(path);
    if (curve) {
      curve.keyframes.push(keyframe);
      curve.keyframes.sort((a, b) => a.time - b.time);
    }
  }

  /**
   * 指定されたEuler回転曲線からキーフレームを削除（時間による検索）
   */
  removeEulerKeyframe(path: string, time: number): void {
    const curve = this.getEulerCurve(path);
    if (curve) {
      curve.keyframes = curve.keyframes.filter(
        (k) => Math.abs(k.time - time) > 0.001,
      );
    }
  }

  /**
   * 修正されたYAMLを出力
   */
  exportToYaml(): string {
    return this.rebuildYaml();
  }

  /**
   * Float曲線を識別するキー
   */
  private floatCurveKey(curve: {
    classID: number;
    path: string;
    attribute: string;
  }): string {
    return `${curve.classID}|${curve.path}|${curve.attribute}`;
  }

  /**
   * 変更検知用のスナップショット文字列を生成（±Infinityを区別する）
   */
  private snapshot(value: unknown): string {
    return JSON.stringify(value, (_key, v) =>
      typeof v === 'number' && !Number.isFinite(v) ? String(v) : v,
    );
  }

  /**
   * 読み込み時点から変更されていないFloat曲線であれば元データを返す
   */
  private unchangedFloatOriginal(curve: FloatCurve): RawData | undefined {
    const original = this._originalFloatCurves.get(this.floatCurveKey(curve));
    if (original && original.snapshot === this.snapshot(curve)) {
      return original.raw;
    }
    return undefined;
  }

  /**
   * 読み込み時点から変更されていないEuler回転曲線であれば元データを返す
   */
  private unchangedEulerOriginal(curve: EulerCurve): RawData | undefined {
    const original = this._originalEulerCurves.get(curve.path);
    if (original && original.snapshot === this.snapshot(curve)) {
      return original.raw;
    }
    return undefined;
  }

  /**
   * 数値をUnityのYAML形式に変換（±InfinityはUnityの表記に合わせる）
   */
  private serializeNumber(value: number): number | string {
    if (value === Infinity) return 'Infinity';
    if (value === -Infinity) return '-Infinity';
    return value;
  }

  private serializeVector(v: Vector3): RawData {
    return {
      x: this.serializeNumber(v.x),
      y: this.serializeNumber(v.y),
      z: this.serializeNumber(v.z),
    };
  }

  private buildKeyframeData(kf: Keyframe): RawData {
    return {
      serializedVersion: 3,
      time: kf.time,
      value: this.serializeNumber(kf.value),
      inSlope: this.serializeNumber(kf.inSlope),
      outSlope: this.serializeNumber(kf.outSlope),
      tangentMode: kf.tangentMode,
      weightedMode: kf.weightedMode,
      inWeight: kf.inWeight,
      outWeight: kf.outWeight,
    };
  }

  private buildVector3KeyframeData(kf: Vector3Keyframe): RawData {
    return {
      serializedVersion: 3,
      time: kf.time,
      value: this.serializeVector(kf.value),
      inSlope: this.serializeVector(kf.inSlope),
      outSlope: this.serializeVector(kf.outSlope),
      tangentMode: kf.tangentMode,
      weightedMode: kf.weightedMode,
      inWeight: this.serializeVector(kf.inWeight),
      outWeight: this.serializeVector(kf.outWeight),
    };
  }

  /**
   * Euler回転曲線のキーフレームから指定軸成分のfloatキーフレームを取り出す
   */
  private eulerComponentKeyframes(curve: EulerCurve, axis: Axis): Keyframe[] {
    return curve.keyframes.map((kf) => ({
      time: kf.time,
      value: kf.value[axis],
      inSlope: kf.inSlope[axis],
      outSlope: kf.outSlope[axis],
      tangentMode: kf.tangentMode,
      weightedMode: kf.weightedMode,
      inWeight: kf.inWeight[axis],
      outWeight: kf.outWeight[axis],
    }));
  }

  /**
   * curveデータ（m_Curveを含むAnimationCurve部分）を生成
   * baseがあれば、m_PreInfinityなどの元の値を引き継ぐ
   */
  private buildAnimationCurve(
    base: unknown,
    keyframes: RawData[],
    rotationOrder: number = DEFAULT_ROTATION_ORDER,
  ): RawData {
    if (base && typeof base === 'object') {
      return { ...(base as RawData), m_Curve: keyframes };
    }
    return {
      serializedVersion: 2,
      m_Curve: keyframes,
      m_PreInfinity: 2,
      m_PostInfinity: 2,
      m_RotationOrder: rotationOrder,
    };
  }

  /**
   * Float曲線1本分のデータ（m_FloatCurves・m_EditorCurves共通の形式）を生成
   * baseがあれば、script・flagsなどの元の値を引き継ぐ
   */
  private buildFloatCurveEntry(
    curve: FloatCurve,
    base: RawData | undefined,
  ): RawData {
    const curveData = this.buildAnimationCurve(
      base?.curve,
      curve.keyframes.map((kf) => this.buildKeyframeData(kf)),
    );
    if (base) {
      return {
        ...base,
        curve: curveData,
        attribute: curve.attribute,
        path: curve.path,
        classID: curve.classID,
      };
    }
    return {
      serializedVersion: 2,
      curve: curveData,
      attribute: curve.attribute,
      path: curve.path,
      classID: curve.classID,
      script: { fileID: 0 },
      flags: 16,
    };
  }

  /**
   * Euler回転曲線の1軸分のm_EditorCurvesエントリを生成
   */
  private buildEulerEditorEntry(
    curve: EulerCurve,
    axis: Axis,
    base: RawData | undefined,
  ): RawData {
    const curveData = this.buildAnimationCurve(
      base?.curve,
      this.eulerComponentKeyframes(curve, axis).map((kf) =>
        this.buildKeyframeData(kf),
      ),
      curve.rotationOrder,
    );
    if (base) {
      return { ...base, curve: curveData };
    }
    return {
      serializedVersion: 2,
      curve: curveData,
      attribute: `${EULER_EDITOR_ATTRIBUTE_PREFIX}${axis}`,
      path: curve.path,
      classID: TRANSFORM_CLASS_ID,
      script: { fileID: 0 },
      flags: 0,
    };
  }

  /**
   * m_FloatCurvesを生成
   */
  private buildFloatCurvesData(): RawData[] {
    return this._floatCurves.map((curve) => {
      const unchanged = this.unchangedFloatOriginal(curve);
      if (unchanged) return unchanged;
      const original = this._originalFloatCurves.get(this.floatCurveKey(curve));
      return this.buildFloatCurveEntry(curve, original?.raw);
    });
  }

  /**
   * m_EulerCurvesを生成
   */
  private buildEulerCurvesData(): RawData[] {
    return this._eulerCurves.map((curve) => {
      const unchanged = this.unchangedEulerOriginal(curve);
      if (unchanged) return unchanged;
      const original = this._originalEulerCurves.get(curve.path)?.raw;
      const curveData = this.buildAnimationCurve(
        original?.curve,
        curve.keyframes.map((kf) => this.buildVector3KeyframeData(kf)),
        curve.rotationOrder,
      );
      curveData.m_RotationOrder = curve.rotationOrder;
      return { ...(original ?? {}), curve: curveData, path: curve.path };
    });
  }

  /**
   * Euler回転曲線として管理しているpath（読み込み時点・現在の両方）
   */
  private managedEulerPaths(): Set<string> {
    return new Set([
      ...this._originalEulerCurves.keys(),
      ...this._eulerCurves.map((c) => c.path),
    ]);
  }

  /**
   * 指定されたprefixを持つEuler回転のエディタ用エントリであれば、その軸を返す
   */
  private eulerEntryAxis(
    entry: RawData,
    prefix: string,
    managedPaths: Set<string>,
  ): Axis | undefined {
    if (entry.classID !== TRANSFORM_CLASS_ID) return undefined;
    if (typeof entry.attribute !== 'string') return undefined;
    if (!entry.attribute.startsWith(prefix)) return undefined;
    if (!managedPaths.has(this.normalizePath(entry.path))) return undefined;
    const axis = entry.attribute.slice(prefix.length);
    return (AXES as readonly string[]).includes(axis)
      ? (axis as Axis)
      : undefined;
  }

  /**
   * m_EditorCurvesを生成
   * 元の配列の順序を保ち、管理しているcurveのエントリのみ更新・削除し、新規分を末尾に追加する
   * position等の未対応curveのエントリはそのまま保持する
   */
  private buildEditorCurvesData(): RawData[] {
    const originalEntries = this.asRawArray(
      this._originalParsedData.m_EditorCurves,
    );
    const managedFloatKeys = new Set([
      ...this._originalFloatCurves.keys(),
      ...this._floatCurves.map((c) => this.floatCurveKey(c)),
    ]);
    const managedEulerPaths = this.managedEulerPaths();
    const emitted = new Set<string>();
    const result: RawData[] = [];

    for (const entry of originalEntries) {
      const eulerAxis = this.eulerEntryAxis(
        entry,
        EULER_EDITOR_ATTRIBUTE_PREFIX,
        managedEulerPaths,
      );
      if (eulerAxis) {
        const curve = this.getEulerCurve(this.normalizePath(entry.path));
        const emitKey = `euler|${curve?.path}|${eulerAxis}`;
        if (!curve || emitted.has(emitKey)) continue;
        emitted.add(emitKey);
        result.push(
          this.unchangedEulerOriginal(curve)
            ? entry
            : this.buildEulerEditorEntry(curve, eulerAxis, entry),
        );
        continue;
      }

      const key = this.floatCurveKey({
        classID: entry.classID as number,
        path: this.normalizePath(entry.path),
        attribute: String(entry.attribute ?? ''),
      });
      if (managedFloatKeys.has(key)) {
        const curve = this._floatCurves.find(
          (c) => this.floatCurveKey(c) === key,
        );
        const emitKey = `float|${key}`;
        if (!curve || emitted.has(emitKey)) continue;
        emitted.add(emitKey);
        result.push(
          this.unchangedFloatOriginal(curve)
            ? entry
            : this.buildFloatCurveEntry(curve, entry),
        );
        continue;
      }

      // 未対応のcurveのエントリはそのまま保持
      result.push(entry);
    }

    // 元のm_EditorCurvesに存在しないcurveのエントリを追加
    for (const curve of this._eulerCurves) {
      for (const axis of AXES) {
        if (!emitted.has(`euler|${curve.path}|${axis}`)) {
          result.push(this.buildEulerEditorEntry(curve, axis, undefined));
        }
      }
    }
    for (const curve of this._floatCurves) {
      if (!emitted.has(`float|${this.floatCurveKey(curve)}`)) {
        const original = this._originalFloatCurves.get(
          this.floatCurveKey(curve),
        );
        result.push(this.buildFloatCurveEntry(curve, original?.raw));
      }
    }

    return result;
  }

  /**
   * m_EulerEditorCurvesを生成（元の配列が存在しない場合はundefined）
   */
  private buildEulerEditorCurvesData(): RawData[] | undefined {
    const originalValue = this._originalParsedData.m_EulerEditorCurves;
    if (originalValue === undefined && this._eulerCurves.length === 0) {
      return undefined;
    }

    const managedEulerPaths = this.managedEulerPaths();
    const emitted = new Set<string>();
    const result: RawData[] = [];

    for (const entry of this.asRawArray(originalValue)) {
      const axis = this.eulerEntryAxis(
        entry,
        EULER_EULER_EDITOR_ATTRIBUTE_PREFIX,
        managedEulerPaths,
      );
      if (axis) {
        const path = this.normalizePath(entry.path);
        const emitKey = `${path}|${axis}`;
        if (!this.getEulerCurve(path) || emitted.has(emitKey)) continue;
        emitted.add(emitKey);
      }
      result.push(entry);
    }

    for (const curve of this._eulerCurves) {
      for (const axis of AXES) {
        if (!emitted.has(`${curve.path}|${axis}`)) {
          result.push({
            serializedVersion: 2,
            curve: this.buildAnimationCurve(undefined, [], curve.rotationOrder),
            attribute: `${EULER_EULER_EDITOR_ATTRIBUTE_PREFIX}${axis}`,
            path: curve.path,
            classID: TRANSFORM_CLASS_ID,
            script: { fileID: 0 },
            flags: 0,
          });
        }
      }
    }

    return result;
  }

  /**
   * genericBindingsのpath/attributeが指定された文字列に対応するか
   * Unityは文字列のCRC32を書き出すが、旧バージョンの本ライブラリは文字列をそのまま書き出していた
   */
  private bindingValueMatches(value: unknown, str: string): boolean {
    if (value === null || value === undefined) return str === '';
    return value === crc32(str) || value === str;
  }

  private isEulerBinding(binding: RawData, path: string): boolean {
    return (
      binding.typeID === TRANSFORM_CLASS_ID &&
      binding.attribute === EULER_BINDING_ATTRIBUTE &&
      this.bindingValueMatches(binding.path, path)
    );
  }

  // Note: material系プロパティ(customType 22)のattributeは素のCRC32ではないため一致しない
  //       その場合、削除したcurveのbindingが残るが、Unityのインポート時に再構築される想定
  private isFloatBinding(binding: RawData, curve: FloatCurve): boolean {
    return (
      binding.typeID === curve.classID &&
      this.bindingValueMatches(binding.path, curve.path) &&
      this.bindingValueMatches(binding.attribute, curve.attribute)
    );
  }

  /**
   * m_ClipBindingConstant.genericBindingsを生成
   * 元の配列を保持し、削除されたcurveのbindingを除き、新規curveのbindingを追加する
   */
  private buildGenericBindings(original: unknown): RawData[] {
    const currentFloatKeys = new Set(
      this._floatCurves.map((c) => this.floatCurveKey(c)),
    );
    const removedFloatCurves = [...this._originalFloatCurves]
      .filter(([key]) => !currentFloatKeys.has(key))
      .map(([, original]) => original.curve);
    const removedEulerPaths = [...this._originalEulerCurves.keys()].filter(
      (path) => !this.getEulerCurve(path),
    );

    const result = this.asRawArray(original).filter(
      (binding) =>
        !removedEulerPaths.some((path) => this.isEulerBinding(binding, path)) &&
        !removedFloatCurves.some((curve) =>
          this.isFloatBinding(binding, curve),
        ),
    );

    for (const curve of this._eulerCurves) {
      if (result.some((binding) => this.isEulerBinding(binding, curve.path))) {
        continue;
      }
      result.push({
        serializedVersion: 2,
        path: crc32(curve.path),
        attribute: EULER_BINDING_ATTRIBUTE,
        script: { fileID: 0 },
        typeID: TRANSFORM_CLASS_ID,
        customType: EULER_CUSTOM_TYPE,
        isPPtrCurve: 0,
        isIntCurve: 0,
        isSerializeReferenceCurve: 0,
      });
    }

    for (const curve of this._floatCurves) {
      if (this._originalFloatCurves.has(this.floatCurveKey(curve))) continue;
      if (result.some((binding) => this.isFloatBinding(binding, curve))) {
        continue;
      }
      result.push({
        serializedVersion: 2,
        path: crc32(curve.path),
        attribute: crc32(curve.attribute),
        script: { fileID: 0 },
        typeID: curve.classID,
        customType: curve.attribute.startsWith('material.')
          ? MATERIAL_CUSTOM_TYPE
          : 0,
        isPPtrCurve: 0,
        isIntCurve: 0,
        isSerializeReferenceCurve: 0,
      });
    }

    return result;
  }

  /**
   * m_ClipBindingConstantを生成
   */
  private buildClipBindingConstant(): RawData {
    const original = this._originalParsedData.m_ClipBindingConstant as
      RawData | undefined;
    if (!original) {
      return {
        genericBindings: this.buildGenericBindings([]),
        pptrCurveMapping: [],
      };
    }
    return {
      ...original,
      genericBindings: this.buildGenericBindings(original.genericBindings),
    };
  }

  /**
   * 読み込み時点からFloat曲線・Euler回転曲線のいずれかが変更（追加・削除を含む）されたか
   */
  private hasCurveChanges(): boolean {
    return (
      this._floatCurves.length !== this._originalFloatCurves.size ||
      this._eulerCurves.length !== this._originalEulerCurves.size ||
      this._floatCurves.some((c) => !this.unchangedFloatOriginal(c)) ||
      this._eulerCurves.some((c) => !this.unchangedEulerOriginal(c))
    );
  }

  /**
   * アニメーションクリップの設定を生成
   * curveが変更された場合のみ、開始・終了時間を全キーフレームに合わせて更新する
   */
  private buildAnimationClipSettings(): RawData {
    const original =
      (this._originalParsedData.m_AnimationClipSettings as RawData) ?? {};
    if (!this.hasCurveChanges()) return original;

    const times: number[] = [
      ...this._floatCurves.flatMap((c) => c.keyframes.map((kf) => kf.time)),
      ...this._eulerCurves.flatMap((c) => c.keyframes.map((kf) => kf.time)),
    ];
    // 未対応のcurveのキーフレームも時間範囲に含める
    for (const key of UNMANAGED_CURVE_KEYS) {
      for (const entry of this.asRawArray(this._originalParsedData[key])) {
        const keyframes = Array.isArray(entry.curve)
          ? entry.curve
          : (entry.curve as { m_Curve?: unknown } | undefined)?.m_Curve;
        for (const kf of this.asRawArray(keyframes)) {
          if (typeof kf.time === 'number') times.push(kf.time);
        }
      }
    }
    if (times.length === 0) return original;

    let minTime = Infinity;
    let maxTime = -Infinity;
    for (const time of times) {
      minTime = Math.min(minTime, time);
      maxTime = Math.max(maxTime, time);
    }

    const settings = { ...original };
    // 開始時間は元の値（多くは0）を保ち、それより前のキーがある場合のみ広げる
    settings.m_StartTime =
      typeof original.m_StartTime === 'number'
        ? Math.min(original.m_StartTime, minTime)
        : minTime;
    // m_CompressedRotationCurvesはキー時間を読めないため、元の終了時間より短くしない
    const hasCompressedCurves =
      this.asRawArray(this._originalParsedData.m_CompressedRotationCurves)
        .length > 0;
    settings.m_StopTime =
      hasCompressedCurves && typeof original.m_StopTime === 'number'
        ? Math.max(original.m_StopTime, maxTime)
        : maxTime;
    return settings;
  }

  /**
   * YAML内のm_NameとFloatCurves・EulerCurvesを解析
   */
  private parseNameAndCurves(): void {
    try {
      // AnimationClip部分のみを抽出
      const animationClipMatch = this._originalYaml.match(
        /AnimationClip:([\s\S]*?)(?=\n\S|$)/,
      );

      if (animationClipMatch) {
        const animationClipYaml = animationClipMatch[1];
        const parsed = yaml.load(animationClipYaml) as RawData;

        // 元のデータを保存（m_EditorCurvesやm_ClipBindingConstantなどを保持）
        this._originalParsedData = { ...parsed };

        // m_Nameを抽出
        this._animationName = (parsed.m_Name as string) || '';

        // m_FloatCurvesを抽出
        // Note: 同じclassID・path・attributeのcurveが重複している場合（Unityは通常出力しない）、
        //       元データとしては後のものが優先され、m_EditorCurvesの重複エントリは1本にまとめられる
        const floatCurvesData = this.asRawArray(parsed.m_FloatCurves);
        this._floatCurves = floatCurvesData.map((raw) =>
          this.parseFloatCurve(raw),
        );
        this._floatCurves.forEach((curve, i) => {
          this._originalFloatCurves.set(this.floatCurveKey(curve), {
            raw: floatCurvesData[i],
            snapshot: this.snapshot(curve),
            curve: { ...curve, keyframes: [] },
          });
        });

        // m_EulerCurvesを抽出
        const eulerCurvesData = this.asRawArray(parsed.m_EulerCurves);
        this._eulerCurves = eulerCurvesData.map((raw) =>
          this.parseEulerCurve(raw),
        );
        this._eulerCurves.forEach((curve, i) => {
          this._originalEulerCurves.set(curve.path, {
            raw: eulerCurvesData[i],
            snapshot: this.snapshot(curve),
          });
        });
      } else {
        throw new Error('AnimationClip not found in YAML');
      }
    } catch (error) {
      console.error('UnityAnimation YAML parse error:', error);
      throw error;
    }
  }

  /**
   * 解析済みm_FloatCurvesの要素からFloatCurveを生成
   */
  private parseFloatCurve(raw: RawData): FloatCurve {
    const curve = raw.curve as { m_Curve?: unknown } | undefined;
    return {
      attribute: typeof raw.attribute === 'string' ? raw.attribute : '',
      path: this.normalizePath(raw.path),
      classID: typeof raw.classID === 'number' ? raw.classID : 0,
      keyframes: this.asRawArray(curve?.m_Curve).map((kf) => ({
        time: typeof kf.time === 'number' ? kf.time : 0,
        value: this.parseNumericValue(kf.value),
        inSlope: this.parseNumericValue(kf.inSlope),
        outSlope: this.parseNumericValue(kf.outSlope),
        tangentMode: typeof kf.tangentMode === 'number' ? kf.tangentMode : 0,
        weightedMode: typeof kf.weightedMode === 'number' ? kf.weightedMode : 0,
        inWeight: this.parseNumericValue(kf.inWeight, DEFAULT_WEIGHT),
        outWeight: this.parseNumericValue(kf.outWeight, DEFAULT_WEIGHT),
      })),
    };
  }

  /**
   * 解析済みm_EulerCurvesの要素からEulerCurveを生成
   */
  private parseEulerCurve(raw: RawData): EulerCurve {
    const curve = raw.curve as
      { m_Curve?: unknown; m_RotationOrder?: unknown } | undefined;
    return {
      path: this.normalizePath(raw.path),
      rotationOrder:
        typeof curve?.m_RotationOrder === 'number'
          ? curve.m_RotationOrder
          : DEFAULT_ROTATION_ORDER,
      keyframes: this.asRawArray(curve?.m_Curve).map((kf) => ({
        time: typeof kf.time === 'number' ? kf.time : 0,
        value: this.parseVector(kf.value),
        inSlope: this.parseVector(kf.inSlope),
        outSlope: this.parseVector(kf.outSlope),
        tangentMode: typeof kf.tangentMode === 'number' ? kf.tangentMode : 0,
        weightedMode: typeof kf.weightedMode === 'number' ? kf.weightedMode : 0,
        inWeight: this.parseVector(kf.inWeight, DEFAULT_WEIGHT),
        outWeight: this.parseVector(kf.outWeight, DEFAULT_WEIGHT),
      })),
    };
  }

  /**
   * ベクトル値を解析
   */
  private parseVector(value: unknown, defaultValue: number = 0): Vector3 {
    const v = (value ?? {}) as Partial<Record<Axis, unknown>>;
    return {
      x: this.parseNumericValue(v.x, defaultValue),
      y: this.parseNumericValue(v.y, defaultValue),
      z: this.parseNumericValue(v.z, defaultValue),
    };
  }

  /**
   * 数値または±Infinityを適切に解析
   */
  private parseNumericValue(value: unknown, defaultValue: number = 0): number {
    if (typeof value === 'number') return value;
    if (value === 'Infinity') return Infinity;
    if (value === '-Infinity') return -Infinity;
    return defaultValue;
  }

  /**
   * pathを正規化（空のpathはYAML上でnullとして読み込まれるため）
   */
  private normalizePath(path: unknown): string {
    return typeof path === 'string' ? path : '';
  }

  private asRawArray(value: unknown): RawData[] {
    return Array.isArray(value) ? (value as RawData[]) : [];
  }

  /**
   * js-yamlの出力をUnityの書式に近づける
   */
  private toUnityYamlStyle(dumped: string): string {
    return (
      dumped
        // 空文字列は値なしで出力（Unityは `path: ` のように出力する）
        .replace(/: ''$/gm, ': ')
        // -InfinityはUnityの表記に合わせて引用符なしで出力
        .replace(/: '-Infinity'$/gm, ': -Infinity')
        // YAML 1.1で真偽値と解釈されうるキー `y` の引用符を外す
        .replace(/^(\s*(?:- )?)'y':/gm, '$1y:')
    );
  }

  /**
   * nullを空文字列に置き換える（Unityの空の値はnullとして読み込まれるため）
   */
  private replaceNullWithEmpty(value: unknown): unknown {
    if (value === null) return '';
    if (Array.isArray(value)) {
      return value.map((v) => this.replaceNullWithEmpty(v));
    }
    if (typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as RawData).map(([k, v]) => [
          k,
          this.replaceNullWithEmpty(v),
        ]),
      );
    }
    return value;
  }

  /**
   * 元のYAMLを基に、変更された部分のみを更新して再構築
   */
  private rebuildYaml(): string {
    try {
      // AnimationClip部分を抽出
      const animationClipMatch = this._originalYaml.match(
        /AnimationClip:([\s\S]*?)(?=\n\S|$)/,
      );

      if (animationClipMatch) {
        // 元のデータをベースに更新（元のデータ自体は変更しない）
        const updatedData: RawData = { ...this._originalParsedData };

        updatedData.m_Name = this._animationName;
        updatedData.m_EulerCurves = this.buildEulerCurvesData();
        updatedData.m_FloatCurves = this.buildFloatCurvesData();
        updatedData.m_ClipBindingConstant = this.buildClipBindingConstant();
        updatedData.m_AnimationClipSettings = this.buildAnimationClipSettings();
        updatedData.m_EditorCurves = this.buildEditorCurvesData();
        const eulerEditorCurves = this.buildEulerEditorCurvesData();
        if (eulerEditorCurves) {
          updatedData.m_EulerEditorCurves = eulerEditorCurves;
        }

        // 新しいAnimationClipYAMLを生成
        const newAnimationClipYaml = this.toUnityYamlStyle(
          yaml.dump(this.replaceNullWithEmpty(updatedData), {
            indent: 2,
            flowLevel: -1,
            noRefs: true,
          }),
        );

        // インデントを調整（元のインデントに合わせる）
        const indentedNewYaml = newAnimationClipYaml
          .split('\n')
          .map((line) => (line ? '  ' + line : line))
          .join('\n');

        // 元のYAMLの該当部分を置換
        return this._originalYaml.replace(
          /AnimationClip:[\s\S]*?(?=\n\S|$)/,
          () => `AnimationClip:\n${indentedNewYaml}`,
        );
      }

      throw new Error('AnimationClip not found for rebuild');
    } catch (error) {
      console.error('UnityAnimation YAML rebuild error:', error);
      throw error;
    }
  }
}

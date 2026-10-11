import {
  Accordion,
  Badge,
  Button,
  Checkbox,
  Group,
  NumberInput,
  Paper,
  Stack,
  Table,
  Text,
  TextInput,
} from '@mantine/core';
import {
  type EulerCurve,
  type UnityAnimation,
  type Vector3,
  type Vector3Keyframe,
} from 'unitypackage-js';

export interface EulerKeyframeDraft {
  time: number | string;
  x: number | string;
  y: number | string;
  z: number | string;
  step: boolean;
}

export interface EulerCurveDraft extends EulerKeyframeDraft {
  path: string;
}

const emptyEulerKeyframeDraft: EulerKeyframeDraft = {
  time: 0,
  x: 0,
  y: 0,
  z: 0,
  step: false,
};

interface EulerCurveEditorProps {
  animation: UnityAnimation;
  // curveのpathごとの新規キーフレームの入力内容
  drafts: Record<string, EulerKeyframeDraft>;
  newCurveDraft: EulerCurveDraft;
  onDraftChange: (path: string, draft: EulerKeyframeDraft) => void;
  onNewCurveDraftChange: (draft: EulerCurveDraft) => void;
  onChange: (status?: string) => void;
}

const AXES = ['x', 'y', 'z'] as const;

// ライブラリのremoveEulerKeyframeと同じ許容誤差で同じ時間のキーを判定する
const hasKeyframeAt = (curve: EulerCurve, time: number, exceptIndex?: number) =>
  curve.keyframes.some(
    (kf, index) => index !== exceptIndex && Math.abs(kf.time - time) <= 0.001,
  );

const toNumber = (value: number | string) =>
  typeof value === 'number' ? value : 0;

const uniform = (value: number): Vector3 => ({ x: value, y: value, z: value });

// 段差のキーは傾きを∞にする（Unityの Both Tangents > Constant 相当）
// Stepを外した場合は傾きを一律0に戻す（元の傾きは保持しない簡易実装）
const isStep = (kf: Vector3Keyframe) =>
  AXES.every(
    (axis) => kf.inSlope[axis] === Infinity && kf.outSlope[axis] === Infinity,
  );

const createKeyframe = (draft: EulerKeyframeDraft): Vector3Keyframe => {
  const slope = uniform(draft.step ? Infinity : 0);
  return {
    time: toNumber(draft.time),
    value: { x: toNumber(draft.x), y: toNumber(draft.y), z: toNumber(draft.z) },
    inSlope: slope,
    outSlope: slope,
    tangentMode: 0,
    weightedMode: 0,
    inWeight: uniform(0.33333334),
    outWeight: uniform(0.33333334),
  };
};

/**
 * Euler回転曲線(m_EulerCurves)の簡易エディタ
 */
export function EulerCurveEditor({
  animation,
  drafts,
  newCurveDraft,
  onDraftChange,
  onNewCurveDraftChange,
  onChange,
}: EulerCurveEditorProps) {
  const curves = animation.getEulerCurves();

  const updateKeyframe = (
    curve: EulerCurve,
    index: number,
    partial: Partial<Vector3Keyframe>,
  ) => {
    if (
      partial.time !== undefined &&
      hasKeyframeAt(curve, partial.time, index)
    ) {
      onChange(`A keyframe already exists at time ${partial.time}.`);
      return;
    }
    curve.keyframes[index] = { ...curve.keyframes[index], ...partial };
    curve.keyframes.sort((a, b) => a.time - b.time);
    onChange();
  };

  const handleAddKeyframe = (curve: EulerCurve) => {
    const keyframe = createKeyframe(
      drafts[curve.path] ?? emptyEulerKeyframeDraft,
    );
    if (hasKeyframeAt(curve, keyframe.time)) {
      onChange(`A keyframe already exists at time ${keyframe.time}.`);
      return;
    }
    animation.addEulerKeyframe(curve.path, keyframe);
    onDraftChange(curve.path, emptyEulerKeyframeDraft);
    onChange();
  };

  const handleAddCurve = () => {
    const path = newCurveDraft.path.trim();
    if (animation.getEulerCurve(path)) {
      onChange(`Euler curve for "${path || '(root)'}" already exists.`);
      return;
    }
    animation.addEulerCurve({
      path,
      rotationOrder: 4,
      keyframes: [createKeyframe(newCurveDraft)],
    });
    onNewCurveDraftChange({ ...emptyEulerKeyframeDraft, path: '' });
    onChange('New euler curve added.');
  };

  return (
    <Stack gap="xs">
      <Text fw={600}>Euler rotation curves</Text>

      {curves.length > 0 && (
        <Accordion multiple>
          {curves.map((curve) => {
            const draft = drafts[curve.path] ?? emptyEulerKeyframeDraft;
            return (
              <Accordion.Item
                value={curve.path || '(root)'}
                key={curve.path || '(root)'}
              >
                <Accordion.Control>
                  <Group gap="xs">
                    <Text fw={600}>localEulerAngles</Text>
                    <Badge variant="dot" color="gray">
                      {curve.path || '(root)'}
                    </Badge>
                    <Badge variant="outline" color="teal">
                      {curve.keyframes.length} keyframes
                    </Badge>
                  </Group>
                </Accordion.Control>
                <Accordion.Panel>
                  <Stack gap="xs">
                    <Table striped highlightOnHover withRowBorders={false}>
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>Time</Table.Th>
                          <Table.Th>X</Table.Th>
                          <Table.Th>Y</Table.Th>
                          <Table.Th>Z</Table.Th>
                          <Table.Th>Step</Table.Th>
                          <Table.Th></Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {curve.keyframes.map((kf, index) => (
                          <Table.Tr key={`${curve.path}-${index}`}>
                            <Table.Td width={110}>
                              {/* 入力途中の値で他のキーと時間が重複しないよう、フォーカスを外したときに反映する */}
                              <NumberInput
                                key={`${index}-${kf.time}`}
                                defaultValue={kf.time}
                                step={0.01}
                                size="xs"
                                onBlur={(event) => {
                                  const input =
                                    event.currentTarget.value.trim();
                                  const time = Number(input);
                                  if (
                                    input !== '' &&
                                    Number.isFinite(time) &&
                                    time !== kf.time
                                  ) {
                                    updateKeyframe(curve, index, { time });
                                  }
                                }}
                              />
                            </Table.Td>
                            {AXES.map((axis) => (
                              <Table.Td width={110} key={axis}>
                                <NumberInput
                                  value={kf.value[axis]}
                                  step={1}
                                  size="xs"
                                  onChange={(value) =>
                                    updateKeyframe(curve, index, {
                                      value: {
                                        ...kf.value,
                                        [axis]:
                                          typeof value === 'number'
                                            ? value
                                            : kf.value[axis],
                                      },
                                    })
                                  }
                                />
                              </Table.Td>
                            ))}
                            <Table.Td>
                              <Checkbox
                                checked={isStep(kf)}
                                onChange={(event) => {
                                  const slope = uniform(
                                    event.currentTarget.checked ? Infinity : 0,
                                  );
                                  updateKeyframe(curve, index, {
                                    inSlope: slope,
                                    outSlope: slope,
                                  });
                                }}
                              />
                            </Table.Td>
                            <Table.Td width={90}>
                              <Button
                                color="red"
                                variant="light"
                                size="xs"
                                onClick={() => {
                                  animation.removeEulerKeyframe(
                                    curve.path,
                                    kf.time,
                                  );
                                  onChange();
                                }}
                              >
                                Delete
                              </Button>
                            </Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>

                    <Group align="flex-end">
                      <NumberInput
                        label="New keyframe time"
                        value={draft.time}
                        onChange={(value) =>
                          onDraftChange(curve.path, { ...draft, time: value })
                        }
                        step={0.01}
                        w={110}
                      />
                      {AXES.map((axis) => (
                        <NumberInput
                          key={axis}
                          label={axis.toUpperCase()}
                          value={draft[axis]}
                          onChange={(value) =>
                            onDraftChange(curve.path, {
                              ...draft,
                              [axis]: value,
                            })
                          }
                          w={90}
                        />
                      ))}
                      <Checkbox
                        label="Step"
                        checked={draft.step}
                        onChange={(event) =>
                          onDraftChange(curve.path, {
                            ...draft,
                            step: event.currentTarget.checked,
                          })
                        }
                        mb={8}
                      />
                      <Button onClick={() => handleAddKeyframe(curve)}>
                        Add keyframe
                      </Button>
                      <Button
                        color="red"
                        variant="subtle"
                        onClick={() => {
                          animation.removeEulerCurve(curve.path);
                          onChange('Euler curve removed.');
                        }}
                      >
                        Remove curve
                      </Button>
                    </Group>
                  </Stack>
                </Accordion.Panel>
              </Accordion.Item>
            );
          })}
        </Accordion>
      )}

      <Paper withBorder p="sm" bg="gray.0">
        <Stack gap="xs">
          <Text fw={600}>Add new euler curve</Text>
          <Group align="flex-end">
            <TextInput
              label="Path"
              value={newCurveDraft.path}
              onChange={(event) =>
                onNewCurveDraftChange({
                  ...newCurveDraft,
                  path: event.currentTarget.value,
                })
              }
              placeholder="Armature/Root/Bone"
            />
            <NumberInput
              label="First keyframe time"
              value={newCurveDraft.time}
              onChange={(value) =>
                onNewCurveDraftChange({ ...newCurveDraft, time: value })
              }
              step={0.01}
              w={140}
            />
            {AXES.map((axis) => (
              <NumberInput
                key={axis}
                label={axis.toUpperCase()}
                value={newCurveDraft[axis]}
                onChange={(value) =>
                  onNewCurveDraftChange({ ...newCurveDraft, [axis]: value })
                }
                w={90}
              />
            ))}
            <Button variant="outline" onClick={handleAddCurve}>
              Add curve
            </Button>
          </Group>
        </Stack>
      </Paper>
    </Stack>
  );
}

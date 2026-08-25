import { useCallback, useMemo, useState } from 'react';
import {
  Accordion,
  Alert,
  Badge,
  Button,
  Group,
  NumberInput,
  Paper,
  Stack,
  Table,
  Text,
  TextInput,
} from '@mantine/core';
import {
  type FloatCurve,
  type Keyframe,
  type UnityAsset,
  type UnityPackage,
} from 'unitypackage-js';

interface AnimationEditorProps {
  unityPackage: UnityPackage;
  asset: UnityAsset;
  onSave: (updatedData: Uint8Array) => void;
}

interface KeyframeDraft {
  time: number | string;
  value: number | string;
}

interface CurveDraft extends KeyframeDraft {
  attribute: string;
  path: string;
  classID: number | string;
}

const loadAnimation = (unityPackage: UnityPackage, assetPath: string) => {
  const source = { sourcePackage: unityPackage, sourcePath: assetPath };
  try {
    const animation = unityPackage.getAnimation(assetPath);
    if (!animation) {
      return {
        animation: null,
        parseError: 'Animation asset not found in the package.',
        ...source,
      };
    }
    return { animation, parseError: null, ...source };
  } catch (error) {
    return {
      animation: null,
      parseError:
        error instanceof Error
          ? error.message
          : 'Failed to load animation from UnityPackage',
      ...source,
    };
  }
};

const defaultKeyframeValues: Keyframe = {
  time: 0,
  value: 0,
  inSlope: 0,
  outSlope: 0,
  tangentMode: 0,
  weightedMode: 0,
  inWeight: 0.33333334,
  outWeight: 0.33333334,
};

export function AnimationEditor({
  unityPackage,
  asset,
  onSave,
}: AnimationEditorProps) {
  const [version, setVersion] = useState(0);
  const [loadedAnimation, setLoadedAnimation] = useState(() =>
    loadAnimation(unityPackage, asset.assetPath),
  );
  const [statusByAsset, setStatusByAsset] = useState<Record<string, string>>(
    {},
  );
  const [newCurve, setNewCurve] = useState<CurveDraft>(
    () =>
      ({
        attribute: '',
        path: '',
        classID: 1,
        time: 0,
        value: 0,
      }) satisfies CurveDraft,
  );
  const [draftKeyframesByAsset, setDraftKeyframesByAsset] = useState<
    Record<string, Record<string, KeyframeDraft>>
  >({});

  const encoder = useMemo(() => new TextEncoder(), []);

  const assetKey = asset.assetPath;
  const status = statusByAsset[assetKey] ?? null;
  const draftKeyframes = draftKeyframesByAsset[assetKey] ?? {};

  if (
    loadedAnimation.sourcePackage !== unityPackage ||
    loadedAnimation.sourcePath !== asset.assetPath
  ) {
    setLoadedAnimation(loadAnimation(unityPackage, asset.assetPath));
  }

  const { animation, parseError } = loadedAnimation;

  const refresh = () => setVersion((v) => v + 1);

  const reloadAnimation = useCallback(() => {
    setStatusByAsset((prev) => {
      if (!(assetKey in prev)) return prev;
      const next = { ...prev };
      delete next[assetKey];
      return next;
    });
    setDraftKeyframesByAsset((prev) => ({
      ...prev,
      [assetKey]: {},
    }));
    setLoadedAnimation(loadAnimation(unityPackage, assetKey));
    refresh();
  }, [assetKey, unityPackage]);

  const updateKeyframe = (
    curve: FloatCurve,
    index: number,
    partial: Partial<Keyframe>,
  ) => {
    if (!animation) return;
    curve.keyframes[index] = { ...curve.keyframes[index], ...partial };
    curve.keyframes.sort((a, b) => a.time - b.time);
    refresh();
  };

  const removeKeyframe = (curve: FloatCurve, time: number) => {
    if (!animation) return;
    animation.removeKeyframe(curve.attribute, curve.path, time);
    refresh();
  };

  const handleAddKeyframe = (curveKey: string, curve: FloatCurve) => {
    const draft = draftKeyframes[curveKey];
    const time = typeof draft?.time === 'number' ? draft.time : 0;
    const value = typeof draft?.value === 'number' ? draft.value : 0;

    if (!animation) return;
    animation.addKeyframe(curve.attribute, curve.path, {
      ...defaultKeyframeValues,
      time,
      value,
    });
    setDraftKeyframesByAsset((prev) => ({
      ...prev,
      [assetKey]: {
        ...(prev[assetKey] ?? {}),
        [curveKey]: { time: 0, value: 0 },
      },
    }));
    refresh();
  };

  const handleAddCurve = () => {
    if (!animation) return;
    if (!newCurve.attribute.trim()) {
      setStatusByAsset((prev) => ({
        ...prev,
        [assetKey]: 'Attribute is required to add a curve.',
      }));
      return;
    }

    animation.addCurve({
      attribute: newCurve.attribute.trim(),
      path: newCurve.path.trim(),
      classID: typeof newCurve.classID === 'number' ? newCurve.classID : 1,
      keyframes: [
        {
          ...defaultKeyframeValues,
          time: typeof newCurve.time === 'number' ? newCurve.time : 0,
          value: typeof newCurve.value === 'number' ? newCurve.value : 0,
        },
      ],
    });

    setNewCurve({ attribute: '', path: '', classID: 1, time: 0, value: 0 });
    refresh();
    setStatusByAsset((prev) => ({
      ...prev,
      [assetKey]: 'New float curve added.',
    }));
  };

  const handleSave = () => {
    if (!animation) return;
    try {
      const updatedYaml = animation.exportToYaml();
      const data = encoder.encode(updatedYaml);
      onSave(data);
      setStatusByAsset((prev) => ({
        ...prev,
        [assetKey]: 'Animation data updated in the selected asset.',
      }));
    } catch (error) {
      setStatusByAsset((prev) => ({
        ...prev,
        [assetKey]:
          error instanceof Error
            ? `Failed to rebuild YAML: ${error.message}`
            : 'Failed to rebuild YAML',
      }));
    }
  };

  const formatSlope = (value: number) =>
    Number.isFinite(value) ? value.toFixed(3) : '∞';

  const curves = animation?.getFloatCurves() ?? [];

  return (
    <Paper withBorder p="md" radius="sm">
      <Stack gap="sm">
        <Group justify="space-between" align="center">
          <Group gap="xs" align="center">
            <Text fw={700}>Animation Editor</Text>
            <Badge color="blue" variant="light">
              YAML
            </Badge>
          </Group>
          <Button size="xs" variant="light" onClick={reloadAnimation}>
            Reset from asset
          </Button>
        </Group>

        <Text size="sm" c="dimmed">
          Adjust AnimationClip name and float curves using the unityanimations
          helper.
        </Text>

        {parseError && (
          <Alert color="red" title="Failed to load animation" variant="light">
            {parseError}
          </Alert>
        )}

        {animation && (
          <Stack gap="sm" key={version}>
            <TextInput
              label="Animation Name"
              value={animation.getName()}
              onChange={(event) => {
                animation.setName(event.currentTarget.value);
                refresh();
              }}
            />

            <Accordion multiple>
              {curves.map((curve, curveIndex) => {
                const curveKey = `${curve.path || 'root'}-${curve.attribute}-${curveIndex}`;
                const draft = draftKeyframes[curveKey] ?? { time: 0, value: 0 };
                return (
                  <Accordion.Item value={curveKey} key={curveKey}>
                    <Accordion.Control>
                      <Group gap="xs">
                        <Text fw={600}>{curve.attribute}</Text>
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
                              <Table.Th>Value</Table.Th>
                              <Table.Th>In Slope</Table.Th>
                              <Table.Th>Out Slope</Table.Th>
                              <Table.Th>Weighted</Table.Th>
                              <Table.Th></Table.Th>
                            </Table.Tr>
                          </Table.Thead>
                          <Table.Tbody>
                            {curve.keyframes.map((kf, keyframeIndex) => (
                              <Table.Tr key={`${curveKey}-${keyframeIndex}`}>
                                <Table.Td width={120}>
                                  <NumberInput
                                    value={kf.time}
                                    step={0.01}
                                    size="xs"
                                    onChange={(value) =>
                                      updateKeyframe(curve, keyframeIndex, {
                                        time:
                                          typeof value === 'number'
                                            ? value
                                            : kf.time,
                                      })
                                    }
                                  />
                                </Table.Td>
                                <Table.Td width={120}>
                                  <NumberInput
                                    value={kf.value}
                                    step={0.01}
                                    size="xs"
                                    onChange={(value) =>
                                      updateKeyframe(curve, keyframeIndex, {
                                        value:
                                          typeof value === 'number'
                                            ? value
                                            : kf.value,
                                      })
                                    }
                                  />
                                </Table.Td>
                                <Table.Td>
                                  <Text size="sm">
                                    {formatSlope(kf.inSlope)}
                                  </Text>
                                </Table.Td>
                                <Table.Td>
                                  <Text size="sm">
                                    {formatSlope(kf.outSlope)}
                                  </Text>
                                </Table.Td>
                                <Table.Td>
                                  <Text size="sm">
                                    {kf.weightedMode ? 'Weighted' : 'Linear'}
                                  </Text>
                                </Table.Td>
                                <Table.Td width={90}>
                                  <Button
                                    color="red"
                                    variant="light"
                                    size="xs"
                                    onClick={() =>
                                      removeKeyframe(curve, kf.time)
                                    }
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
                              setDraftKeyframesByAsset((prev) => ({
                                ...prev,
                                [assetKey]: {
                                  ...(prev[assetKey] ?? {}),
                                  [curveKey]: { ...draft, time: value ?? 0 },
                                },
                              }))
                            }
                            step={0.01}
                          />
                          <NumberInput
                            label="New keyframe value"
                            value={draft.value}
                            onChange={(value) =>
                              setDraftKeyframesByAsset((prev) => ({
                                ...prev,
                                [assetKey]: {
                                  ...(prev[assetKey] ?? {}),
                                  [curveKey]: { ...draft, value: value ?? 0 },
                                },
                              }))
                            }
                            step={0.01}
                          />
                          <Button
                            onClick={() => handleAddKeyframe(curveKey, curve)}
                          >
                            Add keyframe
                          </Button>
                        </Group>
                      </Stack>
                    </Accordion.Panel>
                  </Accordion.Item>
                );
              })}
            </Accordion>

            <Paper withBorder p="sm" bg="gray.0">
              <Stack gap="xs">
                <Text fw={600}>Add new float curve</Text>
                <Group grow>
                  <TextInput
                    label="Attribute"
                    value={newCurve.attribute}
                    onChange={(event) =>
                      setNewCurve((prev) => ({
                        ...prev,
                        attribute: event.currentTarget.value,
                      }))
                    }
                    placeholder="m_LocalPosition.x"
                  />
                  <TextInput
                    label="Path"
                    value={newCurve.path}
                    onChange={(event) =>
                      setNewCurve((prev) => ({
                        ...prev,
                        path: event.currentTarget.value,
                      }))
                    }
                    placeholder="Armature/Root"
                  />
                </Group>
                <Group>
                  <NumberInput
                    label="Class ID"
                    value={newCurve.classID}
                    onChange={(value) =>
                      setNewCurve((prev) => ({ ...prev, classID: value ?? 1 }))
                    }
                    min={1}
                    step={1}
                  />
                  <NumberInput
                    label="First keyframe time"
                    value={newCurve.time}
                    onChange={(value) =>
                      setNewCurve((prev) => ({ ...prev, time: value ?? 0 }))
                    }
                    step={0.01}
                  />
                  <NumberInput
                    label="First keyframe value"
                    value={newCurve.value}
                    onChange={(value) =>
                      setNewCurve((prev) => ({ ...prev, value: value ?? 0 }))
                    }
                    step={0.01}
                  />
                  <Button variant="outline" onClick={handleAddCurve}>
                    Add curve
                  </Button>
                </Group>
              </Stack>
            </Paper>

            <Group justify="flex-end">
              <Button variant="default" onClick={reloadAnimation}>
                Discard changes
              </Button>
              <Button onClick={handleSave}>Save animation to asset</Button>
            </Group>

            {status && (
              <Text size="sm" c="dimmed">
                {status}
              </Text>
            )}
          </Stack>
        )}

        {!animation && !parseError && (
          <Text c="dimmed" size="sm">
            No animation data found in this asset.
          </Text>
        )}
      </Stack>
    </Paper>
  );
}

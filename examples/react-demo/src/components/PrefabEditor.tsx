import { useMemo, useState } from 'react';
import {
  Accordion,
  Alert,
  Badge,
  Button,
  Group,
  Paper,
  Stack,
  Table,
  Text,
  TextInput,
} from '@mantine/core';
import type { UnityAsset, UnityPackage } from 'unitypackage-js';

interface PrefabEditorProps {
  unityPackage: UnityPackage;
  asset: UnityAsset;
  onSave: (updatedData: Uint8Array) => void;
}

type PropertyDrafts = Record<string, Record<string, string>>;

const componentKey = (fileId: string, scriptGuid?: string) =>
  `${fileId}-${scriptGuid ?? 'unknown'}`;

const loadPrefab = (unityPackage: UnityPackage, assetPath: string) => {
  const source = { sourcePackage: unityPackage, sourcePath: assetPath };
  try {
    const prefab = unityPackage.getPrefab(assetPath);
    if (!prefab) {
      return {
        prefab: null,
        parseError: 'Prefab asset not found in the package.',
        ...source,
      };
    }
    return { prefab, parseError: null, ...source };
  } catch (error) {
    return {
      prefab: null,
      parseError:
        error instanceof Error
          ? error.message
          : 'Failed to load Prefab from UnityPackage',
      ...source,
    };
  }
};

export function PrefabEditor({
  unityPackage,
  asset,
  onSave,
}: PrefabEditorProps) {
  const [loadedPrefab, setLoadedPrefab] = useState(() =>
    loadPrefab(unityPackage, asset.assetPath),
  );
  const [statusByAsset, setStatusByAsset] = useState<Record<string, string>>(
    {},
  );
  const [propertyDrafts, setPropertyDrafts] = useState<PropertyDrafts>({});

  const encoder = useMemo(() => new TextEncoder(), []);

  const assetKey = asset.assetPath;
  const status = statusByAsset[assetKey] ?? null;

  if (
    loadedPrefab.sourcePackage !== unityPackage ||
    loadedPrefab.sourcePath !== asset.assetPath
  ) {
    setLoadedPrefab(loadPrefab(unityPackage, asset.assetPath));
  }

  const { prefab, parseError } = loadedPrefab;

  const resetPrefab = () => {
    setPropertyDrafts({});
    setStatusByAsset((prev) => {
      if (!(assetKey in prev)) return prev;
      const next = { ...prev };
      delete next[assetKey];
      return next;
    });
    setLoadedPrefab(loadPrefab(unityPackage, assetKey));
  };

  const handlePropertyChange = (
    componentId: string,
    propertyKey: string,
    value: string,
  ) => {
    setPropertyDrafts((prev) => ({
      ...prev,
      [componentId]: {
        ...(prev[componentId] ?? {}),
        [propertyKey]: value,
      },
    }));
  };

  const handleSave = () => {
    if (!prefab) return;

    for (const component of prefab.components) {
      if (!component.scriptGuid) continue;
      const draftKey = componentKey(component.fileId, component.scriptGuid);
      const draft = propertyDrafts[draftKey];
      if (!draft) continue;

      prefab.updateComponentProperties(component.scriptGuid, draft);
    }

    const updatedData = encoder.encode(prefab.exportToYaml());
    onSave(updatedData);
    setStatusByAsset((prev) => ({
      ...prev,
      [assetKey]: 'Prefab data updated in the selected asset.',
    }));
  };

  return (
    <Paper withBorder p="md" radius="sm">
      <Stack gap="sm">
        <Group justify="space-between" align="center">
          <Group gap="xs" align="center">
            <Text fw={700}>Prefab Editor</Text>
            <Badge color="grape" variant="light">
              YAML
            </Badge>
          </Group>
          <Button size="xs" variant="light" onClick={resetPrefab}>
            Reset from asset
          </Button>
        </Group>

        <Text size="sm" c="dimmed">
          Inspect MonoBehaviour components in the Prefab and update their
          serialized properties.
        </Text>

        {parseError && (
          <Alert color="red" title="Failed to load prefab" variant="light">
            {parseError}
          </Alert>
        )}

        {prefab && (
          <Stack gap="sm">
            <Accordion multiple>
              {prefab.components.map((component) => {
                const key = componentKey(
                  component.fileId,
                  component.scriptGuid,
                );
                const properties = Object.entries(component.properties);
                return (
                  <Accordion.Item value={key} key={key}>
                    <Accordion.Control>
                      <Group gap="xs" align="center">
                        <Text fw={600}>MonoBehaviour</Text>
                        <Badge variant="light" color="gray">
                          fileID: {component.fileId}
                        </Badge>
                        <Badge variant="dot" color="indigo">
                          {component.scriptGuid ?? 'No GUID'}
                        </Badge>
                        <Badge variant="outline" color="teal">
                          {properties.length} properties
                        </Badge>
                      </Group>
                    </Accordion.Control>
                    <Accordion.Panel>
                      <Stack gap="xs">
                        {component.scriptGuid ? (
                          <Text size="sm" c="dimmed">
                            GUID: {component.scriptGuid}
                          </Text>
                        ) : (
                          <Alert color="yellow" variant="light">
                            Script GUID
                            が見つからないため、このコンポーネントは編集できません。
                          </Alert>
                        )}

                        <Table
                          striped
                          highlightOnHover
                          withRowBorders={false}
                          verticalSpacing="xs"
                        >
                          <Table.Thead>
                            <Table.Tr>
                              <Table.Th>Property</Table.Th>
                              <Table.Th>Value</Table.Th>
                            </Table.Tr>
                          </Table.Thead>
                          <Table.Tbody>
                            {properties.map(([propertyKey, value]) => (
                              <Table.Tr key={`${key}-${propertyKey}`}>
                                <Table.Td width={200}>{propertyKey}</Table.Td>
                                <Table.Td>
                                  <TextInput
                                    value={
                                      propertyDrafts[key]?.[propertyKey] ??
                                      value
                                    }
                                    disabled={!component.scriptGuid}
                                    onChange={(event) =>
                                      handlePropertyChange(
                                        key,
                                        propertyKey,
                                        event.currentTarget.value,
                                      )
                                    }
                                  />
                                </Table.Td>
                              </Table.Tr>
                            ))}
                          </Table.Tbody>
                        </Table>
                      </Stack>
                    </Accordion.Panel>
                  </Accordion.Item>
                );
              })}
            </Accordion>

            <Group justify="flex-end">
              <Button variant="default" onClick={resetPrefab}>
                Discard changes
              </Button>
              <Button onClick={handleSave}>Save prefab to asset</Button>
            </Group>

            {status && (
              <Text size="sm" c="dimmed">
                {status}
              </Text>
            )}
          </Stack>
        )}

        {!prefab && !parseError && (
          <Text c="dimmed" size="sm">
            No prefab data found in this asset.
          </Text>
        )}
      </Stack>
    </Paper>
  );
}

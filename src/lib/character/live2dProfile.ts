import type { FileMap } from "@/lib/file-map";
import type {
  SemanticExpressionKey,
  SemanticExpressionMappingSnapshot,
  SemanticMappingOption,
} from "./types";

export type Live2dSemanticTargetMode = "add" | "lerp";

export interface Live2dSemanticTarget {
  id: string;
  valueAtOne: number;
  mode: Live2dSemanticTargetMode;
}

export interface Live2dSemanticOption extends SemanticMappingOption {
  targets: readonly Live2dSemanticTarget[];
}

export interface Live2dSemanticProfile {
  readonly options: Record<SemanticExpressionKey, readonly Live2dSemanticOption[]>;
  readonly initialMapping: Partial<SemanticExpressionMappingSnapshot>;
}

interface Model3Group {
  Name?: string;
  Target?: string;
  Ids?: string[];
}

interface Model3Json {
  FileReferences?: {
    DisplayInfo?: string;
  };
  Groups?: Model3Group[];
}

interface Cdi3Parameter {
  Id?: string;
  GroupId?: string;
  Name?: string;
}

interface Cdi3Group {
  Id?: string;
  Name?: string;
}

interface Cdi3Json {
  Parameters?: Cdi3Parameter[];
  ParameterGroups?: Cdi3Group[];
}

const EMPTY_PROFILE: Live2dSemanticProfile = {
  options: {
    blink: [],
    blinkLeft: [],
    blinkRight: [],
    aa: [],
    ih: [],
    ou: [],
    ee: [],
    oh: [],
  },
  initialMapping: {},
};

const LEGACY_VISEME_FALLBACKS: Record<
  Exclude<SemanticExpressionKey, "blink" | "blinkLeft" | "blinkRight">,
  readonly Live2dSemanticTarget[]
> = {
  aa: [
    { id: "ParamMouthOpenY", valueAtOne: 1, mode: "add" },
    { id: "ParamMouthForm", valueAtOne: 0, mode: "add" },
  ],
  ih: [
    { id: "ParamMouthOpenY", valueAtOne: 0.3, mode: "add" },
    { id: "ParamMouthForm", valueAtOne: 1, mode: "add" },
  ],
  ou: [
    { id: "ParamMouthOpenY", valueAtOne: 0.6, mode: "add" },
    { id: "ParamMouthForm", valueAtOne: -1, mode: "add" },
  ],
  ee: [
    { id: "ParamMouthOpenY", valueAtOne: 0.4, mode: "add" },
    { id: "ParamMouthForm", valueAtOne: 0.5, mode: "add" },
  ],
  oh: [
    { id: "ParamMouthOpenY", valueAtOne: 0.7, mode: "add" },
    { id: "ParamMouthForm", valueAtOne: -0.5, mode: "add" },
  ],
};

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

function resolveAsset(modelUrl: string, fileMap: FileMap | null, relPath: string): string | null {
  if (!relPath) return null;
  if (fileMap) {
    const normalized = normalizePath(relPath);
    if (fileMap.has(normalized)) return fileMap.get(normalized)!;

    const filename = normalized.split("/").pop() ?? normalized;
    if (fileMap.has(filename)) return fileMap.get(filename)!;

    for (const [key, value] of fileMap.entries()) {
      const normalizedKey = normalizePath(key);
      if (
        normalized.endsWith(normalizedKey) ||
        normalizedKey.endsWith(normalized)
      ) {
        return value;
      }
    }
    return null;
  }

  const base = modelUrl.substring(0, modelUrl.lastIndexOf("/") + 1);
  return `${base}${normalizePath(relPath)}`;
}

async function fetchJson<T>(url: string | null): Promise<T | null> {
  if (!url) return null;
  const response = await fetch(url);
  if (!response.ok) {
    return null;
  }
  return (await response.json()) as T;
}

function uniq(values: Iterable<string>): string[] {
  return Array.from(new Set(Array.from(values).filter(Boolean)));
}

function findGroupIds(modelJson: Model3Json | null, groupName: string): string[] {
  const groups = modelJson?.Groups ?? [];
  const target = groups.find(
    (group) => group.Target === "Parameter" && group.Name === groupName
  );
  return uniq(target?.Ids ?? []);
}

function buildParameterMeta(cdiJson: Cdi3Json | null) {
  const params = cdiJson?.Parameters ?? [];
  const groups = new Map<string, string>();
  for (const group of cdiJson?.ParameterGroups ?? []) {
    if (group.Id) {
      groups.set(group.Id, group.Name ?? group.Id);
    }
  }

  const map = new Map<
    string,
    {
      name: string;
      groupName: string;
    }
  >();

  for (const param of params) {
    if (!param.Id) continue;
    map.set(param.Id, {
      name: param.Name ?? param.Id,
      groupName: groups.get(param.GroupId ?? "") ?? "",
    });
  }

  return map;
}

function findParameterIdsByPattern(
  parameterMeta: Map<string, { name: string; groupName: string }>,
  matcher: (id: string, name: string, groupName: string) => boolean
): string[] {
  const result: string[] = [];
  for (const [id, meta] of parameterMeta.entries()) {
    if (matcher(id, meta.name, meta.groupName)) {
      result.push(id);
    }
  }
  return uniq(result);
}

function findLabel(
  id: string,
  parameterMeta: Map<string, { name: string; groupName: string }>
): string {
  const meta = parameterMeta.get(id);
  if (!meta) return id;
  return meta.name === id ? id : `${meta.name} (${id})`;
}

function pushOption(
  target: Live2dSemanticOption[],
  option: Live2dSemanticOption
): void {
  if (target.some((current) => current.value === option.value)) {
    return;
  }
  target.push(option);
}

function createSingleTargetOption(
  id: string,
  parameterMeta: Map<string, { name: string; groupName: string }>
): Live2dSemanticOption {
  return {
    value: `param:${id}`,
    label: findLabel(id, parameterMeta),
    targets: [{ id, valueAtOne: 1, mode: "add" }],
  };
}

export async function loadLive2dProfile(
  modelUrl: string,
  fileMap: FileMap | null
): Promise<Live2dSemanticProfile> {
  const modelJson = await fetchJson<Model3Json>(modelUrl);
  if (!modelJson) {
    return EMPTY_PROFILE;
  }

  const displayInfoUrl = resolveAsset(
    modelUrl,
    fileMap,
    modelJson.FileReferences?.DisplayInfo ?? ""
  );
  const cdiJson = await fetchJson<Cdi3Json>(displayInfoUrl);
  const parameterMeta = buildParameterMeta(cdiJson);

  const eyeBlinkIds = findGroupIds(modelJson, "EyeBlink");
  const lipSyncIds = findGroupIds(modelJson, "LipSync");
  const leftEyeIds = uniq([
    ...eyeBlinkIds.filter((id) => /EyeL.*Open|EyeLOpen/i.test(id)),
    ...findParameterIdsByPattern(
      parameterMeta,
      (id) => /EyeL.*Open|EyeLOpen/i.test(id)
    ),
  ]);
  const rightEyeIds = uniq([
    ...eyeBlinkIds.filter((id) => /EyeR.*Open|EyeROpen/i.test(id)),
    ...findParameterIdsByPattern(
      parameterMeta,
      (id) => /EyeR.*Open|EyeROpen/i.test(id)
    ),
  ]);
  const mouthParamIds = uniq([
    ...lipSyncIds,
    ...findParameterIdsByPattern(parameterMeta, (id, _name, groupName) => {
      if (/^Param[AIUEO]$/i.test(id)) return true;
      return /(mouth|口)/i.test(groupName);
    }),
  ]);

  const options: Record<SemanticExpressionKey, Live2dSemanticOption[]> = {
    blink: [],
    blinkLeft: [],
    blinkRight: [],
    aa: [],
    ih: [],
    ou: [],
    ee: [],
    oh: [],
  };
  const initialMapping: Partial<SemanticExpressionMappingSnapshot> = {};

  if (leftEyeIds.length > 0 || rightEyeIds.length > 0) {
    const bothTargets = [
      ...leftEyeIds.map((id) => ({ id, valueAtOne: 0, mode: "lerp" as const })),
      ...rightEyeIds.map((id) => ({ id, valueAtOne: 0, mode: "lerp" as const })),
    ];
    if (bothTargets.length > 0) {
      pushOption(options.blink, {
        value: "blink",
        label: `auto (${bothTargets.map((target) => target.id).join(", ")})`,
        targets: bothTargets,
      });
      initialMapping.blink = "blink";
    }
  }

  if (leftEyeIds.length > 0) {
    pushOption(options.blinkLeft, {
      value: "blinkLeft",
      label: `auto (${leftEyeIds.join(", ")})`,
      targets: leftEyeIds.map((id) => ({
        id,
        valueAtOne: 0,
        mode: "lerp" as const,
      })),
    });
    initialMapping.blinkLeft = "blinkLeft";
  }

  if (rightEyeIds.length > 0) {
    pushOption(options.blinkRight, {
      value: "blinkRight",
      label: `auto (${rightEyeIds.join(", ")})`,
      targets: rightEyeIds.map((id) => ({
        id,
        valueAtOne: 0,
        mode: "lerp" as const,
      })),
    });
    initialMapping.blinkRight = "blinkRight";
  }

  for (const id of uniq([...leftEyeIds, ...rightEyeIds])) {
    const option = {
      value: `param:${id}`,
      label: findLabel(id, parameterMeta),
      targets: [{ id, valueAtOne: 0, mode: "lerp" as const }],
    };
    pushOption(options.blink, option);
    if (leftEyeIds.includes(id)) {
      pushOption(options.blinkLeft, option);
    }
    if (rightEyeIds.includes(id)) {
      pushOption(options.blinkRight, option);
    }
  }

  const visemeToParamId: Record<
    Exclude<SemanticExpressionKey, "blink" | "blinkLeft" | "blinkRight">,
    string
  > = {
    aa: "ParamA",
    ih: "ParamI",
    ou: "ParamU",
    ee: "ParamE",
    oh: "ParamO",
  };

  for (const key of ["aa", "ih", "ou", "ee", "oh"] as const) {
    const directId = mouthParamIds.find(
      (id) => id.toLowerCase() === visemeToParamId[key].toLowerCase()
    );
    if (directId) {
      pushOption(options[key], {
        value: key,
        label: `auto (${findLabel(directId, parameterMeta)})`,
        targets: [{ id: directId, valueAtOne: 1, mode: "add" }],
      });
      initialMapping[key] = key;
    } else {
      pushOption(options[key], {
        value: key,
        label: "auto legacy fallback",
        targets: LEGACY_VISEME_FALLBACKS[key],
      });
      initialMapping[key] = key;
    }

    for (const id of mouthParamIds) {
      if (!/^Param[AIUEO]$/i.test(id)) continue;
      pushOption(options[key], createSingleTargetOption(id, parameterMeta));
    }
  }

  return { options, initialMapping };
}

export function resolveLive2dSemanticOption(
  profile: Live2dSemanticProfile,
  key: SemanticExpressionKey,
  selection: string | null
): readonly Live2dSemanticTarget[] {
  if (!selection) return [];
  const option = profile.options[key].find((candidate) => candidate.value === selection);
  return option?.targets ?? [];
}

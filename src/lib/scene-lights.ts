export interface SceneDirectionalLight {
  id: string;
  name: string;
  type: "directional";
  color: string;
  intensity: number;
  position: [number, number, number];
  target: [number, number, number];
  visible: boolean;
  objectVisible: boolean;
  shadowCameraSize: number;
  shadowCameraNear: number;
  shadowCameraFar: number;
  shadowBias: number;
  shadowNormalBias: number;
}

export type SceneLight = SceneDirectionalLight;

function createLightId() {
  return `light-${crypto.randomUUID()}`;
}

export function createDirectionalLight(
  partial?: Partial<Omit<SceneDirectionalLight, "id" | "type">>
): SceneDirectionalLight {
  return {
    id: createLightId(),
    type: "directional",
    name: partial?.name ?? "Directional Light",
    color: partial?.color ?? "#ffffff",
    intensity: partial?.intensity ?? 0.55,
    position: partial?.position ?? [5, 20, 10],
    target: partial?.target ?? [0, 10, 0],
    visible: partial?.visible ?? true,
    objectVisible: partial?.objectVisible ?? true,
    shadowCameraSize: partial?.shadowCameraSize ?? 20,
    shadowCameraNear: partial?.shadowCameraNear ?? 0.1,
    shadowCameraFar: partial?.shadowCameraFar ?? 200,
    shadowBias: partial?.shadowBias ?? -0.0005,
    shadowNormalBias: partial?.shadowNormalBias ?? 0.02,
  };
}

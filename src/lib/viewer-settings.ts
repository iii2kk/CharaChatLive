export interface ViewerSettings {
  ambientLightIntensity: number;
  directionalLightIntensity: number;
  directionalLightX: number;
  directionalLightY: number;
  directionalLightZ: number;
  hemisphereLightIntensity: number;
  diffuseMultiplier: number;
  emissiveMultiplier: number;
}

export const defaultViewerSettings: ViewerSettings = {
  ambientLightIntensity: 0.35,
  directionalLightIntensity: 0.55,
  directionalLightX: 5,
  directionalLightY: 20,
  directionalLightZ: 10,
  hemisphereLightIntensity: 0.2,
  diffuseMultiplier: 1,
  emissiveMultiplier: 0.0,
};

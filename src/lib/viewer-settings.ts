export interface ViewerSettings {
  ambientLightIntensity: number;
  directionalLightIntensity: number;
  directionalLightX: number;
  directionalLightY: number;
  directionalLightZ: number;
  hemisphereLightIntensity: number;
  diffuseMultiplier: number;
  emissiveMultiplier: number;
  physicsEnabled: boolean;
  gravityX: number;
  gravityY: number;
  gravityZ: number;
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
  physicsEnabled: true,
  gravityX: 0,
  gravityY: -98,
  gravityZ: 0,
};

export interface ViewerSettings {
  ambientLightIntensity: number;
  hemisphereLightIntensity: number;
  hemisphereLightSkyColor: string;
  hemisphereLightGroundColor: string;
  diffuseMultiplier: number;
  emissiveMultiplier: number;
  live2dCanvasScale: number;
  live2dPlaneScale: number;
  live2dRenderFps: number;
  physicsEnabled: boolean;
  gravityX: number;
  gravityY: number;
  gravityZ: number;
}

export const defaultViewerSettings: ViewerSettings = {
  ambientLightIntensity: 0.35,
  hemisphereLightIntensity: 0.2,
  hemisphereLightSkyColor: "#ffffff",
  hemisphereLightGroundColor: "#444444",
  diffuseMultiplier: 1,
  emissiveMultiplier: 0.0,
  live2dCanvasScale: 0.75,
  live2dPlaneScale: 1.17,
  live2dRenderFps: 60,
  physicsEnabled: true,
  gravityX: 0,
  gravityY: -98,
  gravityZ: 0,
};

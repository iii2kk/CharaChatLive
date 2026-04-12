export interface ViewerSettings {
  diffuseMultiplier: number;
  emissiveMultiplier: number;
  physicsEnabled: boolean;
  gravityX: number;
  gravityY: number;
  gravityZ: number;
}

export const defaultViewerSettings: ViewerSettings = {
  diffuseMultiplier: 1,
  emissiveMultiplier: 0.0,
  physicsEnabled: true,
  gravityX: 0,
  gravityY: -98,
  gravityZ: 0,
};

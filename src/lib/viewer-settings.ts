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
  /** 全 Live2D モデル共通。最終解像度に乗算される品質係数 (1.0=ベース) */
  live2dQualityMultiplier: number;
  /** 全 Live2D モデル共通。ビューポート高さに対するモデル描画解像度の割合 */
  live2dViewportHeightUsage: number;
  /** 全 Live2D モデル共通。スロットの片辺の上限 (VRAM 抑制用) */
  live2dMaxEdge: number;
  physicsEnabled: boolean;
  gravityX: number;
  gravityY: number;
  gravityZ: number;
  /** MMD 物理: 位置減衰の下限 (0..0.999)。PMX 値がこれ未満なら持ち上げる */
  mmdPhysicsPositionDamping: number;
  /** MMD 物理: 回転減衰の下限 (0..0.999)。PMX 値がこれ未満なら持ち上げる */
  mmdPhysicsRotationDamping: number;
  /** MMD 物理: 自動スリープ。true で静止時の微振動を抑制 */
  mmdPhysicsSleepEnabled: boolean;
  /** MMD 物理: ジョイント spring の減衰 (0..1)。0=減衰なし(MMDPhysics既定)、典型 0.3〜0.7 */
  mmdPhysicsJointSpringDamping: number;
  showGrid: boolean;
  groundTextureUrl: string | null;
  groundTextureRepeat: number;
  groundSize: number;
  backgroundTextureUrl: string | null;
  backgroundIsEquirect: boolean;
  backgroundColor: string;
  /** カメラ位置を基準にキャラクタの位置から音の方向を変える */
  spatialAudioEnabled: boolean;
  spatialAudioMode: "simple" | "builtin-hrtf";
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
  live2dQualityMultiplier: 1.25,
  live2dViewportHeightUsage: 1.0,
  live2dMaxEdge: 4096,
  physicsEnabled: true,
  gravityX: 0,
  gravityY: -98,
  gravityZ: 0,
  mmdPhysicsPositionDamping: 0,
  mmdPhysicsRotationDamping: 0,
  mmdPhysicsSleepEnabled: true,
  mmdPhysicsJointSpringDamping: 0.5,
  showGrid: true,
  groundTextureUrl: null,
  groundTextureRepeat: 10,
  groundSize: 50,
  backgroundTextureUrl: null,
  backgroundIsEquirect: true,
  backgroundColor: "#1a1a2e",
  spatialAudioEnabled: true,
  spatialAudioMode: "builtin-hrtf",
};

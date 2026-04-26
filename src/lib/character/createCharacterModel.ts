import * as THREE from "three";
import type { FileMap, ModelKind } from "@/lib/file-map";
import { Live2dCharacterModel } from "./Live2dCharacterModel";
import { MmdCharacterModel } from "./MmdCharacterModel";
import { VrmCharacterModel } from "./VrmCharacterModel";
import type { CharacterModel } from "./types";

export interface CreateCharacterModelOptions {
  id: string;
  name: string;
  live2dCanvasScale: number;
  live2dPlaneScale: number;
  /** PMX 用の初期物理設定。VRM では無視される（spring-bone は常時オン） */
  initialPhysics: {
    enabled: boolean;
    gravity: THREE.Vector3;
  };
  /** PMX が T ポーズの場合に A ポーズへ補正する。VMD は A ポーズ前提のため。 */
  tPoseCorrection?: {
    enabled: boolean;
    /** 度数。デフォルト 35。左右で同じ値を使う。 */
    armAngleDeg?: number;
  };
}

export async function createCharacterModel(
  kind: ModelKind,
  url: string,
  fileMap: FileMap | null,
  options: CreateCharacterModelOptions
): Promise<CharacterModel> {
  if (kind === "vrm") {
    return VrmCharacterModel.load({
      id: options.id,
      name: options.name,
      url,
      fileMap,
    });
  }

  if (kind === "live2d") {
    return Live2dCharacterModel.load({
      id: options.id,
      name: options.name,
      url,
      fileMap,
      renderScale: options.live2dCanvasScale,
      planeScale: options.live2dPlaneScale,
    });
  }

  return MmdCharacterModel.load({
    id: options.id,
    name: options.name,
    url,
    fileMap,
    initialPhysics: {
      enabled: options.initialPhysics.enabled,
      gravity: options.initialPhysics.gravity,
    },
    tPoseCorrection: options.tPoseCorrection,
  });
}

export type { CharacterModel } from "./types";

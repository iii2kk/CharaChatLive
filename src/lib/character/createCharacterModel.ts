import * as THREE from "three";
import type { FileMap, ModelKind } from "@/lib/file-map";
import { Live2dCharacterModel } from "./Live2dCharacterModel";
import { MmdCharacterModel } from "./MmdCharacterModel";
import { VrmCharacterModel } from "./VrmCharacterModel";
import type { CharacterModel } from "./types";

export interface CreateCharacterModelOptions {
  id: string;
  name: string;
  /** PMX 用の初期物理設定。VRM では無視される（spring-bone は常時オン） */
  initialPhysics: {
    enabled: boolean;
    gravity: THREE.Vector3;
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
  });
}

export type { CharacterModel } from "./types";

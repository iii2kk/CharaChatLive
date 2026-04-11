declare module "three/examples/jsm/loaders/MMDLoader" {
  import {
    AnimationClip,
    FileLoader,
    LoadingManager,
    SkinnedMesh,
  } from "three";

  export class MMDLoader {
    constructor(manager?: LoadingManager);
    animationPath: string;
    loader: FileLoader;

    setAnimationPath(animationPath: string): this;

    load(
      url: string,
      onLoad: (mesh: SkinnedMesh) => void,
      onProgress?: (event: ProgressEvent) => void,
      onError?: (event: ErrorEvent) => void
    ): void;

    loadAnimation(
      url: string | string[],
      object: SkinnedMesh,
      onLoad: (clip: AnimationClip | AnimationClip[]) => void,
      onProgress?: (event: ProgressEvent) => void,
      onError?: (event: ErrorEvent) => void
    ): void;

    loadWithAnimation(
      modelUrl: string,
      vmdUrl: string | string[],
      onLoad: (result: { mesh: SkinnedMesh; animation: AnimationClip }) => void,
      onProgress?: (event: ProgressEvent) => void,
      onError?: (event: ErrorEvent) => void
    ): void;
  }
}

declare module "three/examples/jsm/animation/MMDAnimationHelper" {
  import {
    AnimationClip,
    Audio,
    Camera,
    Object3D,
    SkinnedMesh,
    Vector3,
  } from "three";

  export class MMDAnimationHelper {
    meshes: SkinnedMesh[];
    camera: Camera | null;
    cameraTarget: Object3D;
    audio: Audio | null;
    enabled: {
      animation: boolean;
      ik: boolean;
      grant: boolean;
      physics: boolean;
      cameraAnimation: boolean;
    };

    constructor(params?: {
      sync?: boolean;
      afterglow?: number;
      resetPhysicsOnLoop?: boolean;
      pmxAnimation?: boolean;
    });

    add(
      object: SkinnedMesh | Camera | Audio,
      params?: {
        animation?: AnimationClip | AnimationClip[];
        physics?: boolean;
        warmup?: number;
        unitStep?: number;
        maxStepNum?: number;
        gravity?: Vector3;
      }
    ): this;

    remove(object: SkinnedMesh | Camera | Audio): this;
    update(delta: number): this;
    enable(key: string, enabled: boolean): this;
    pose(
      mesh: SkinnedMesh,
      vpd: object,
      params?: {
        resetPose?: boolean;
        ik?: boolean;
        grant?: boolean;
      }
    ): this;
  }
}

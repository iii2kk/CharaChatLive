import * as THREE from "three";

const basePositions = new WeakMap<THREE.Object3D, THREE.Vector3>();
const layoutOffsets = new WeakMap<THREE.Object3D, number>();
const manualOffsets = new WeakMap<THREE.Object3D, THREE.Vector3>();

export function ensureModelTransformState(object: THREE.Object3D): void {
  if (!basePositions.has(object)) {
    basePositions.set(object, object.position.clone());
  }

  if (!manualOffsets.has(object)) {
    manualOffsets.set(object, new THREE.Vector3());
  }
}

export function getModelBasePosition(object: THREE.Object3D): THREE.Vector3 {
  ensureModelTransformState(object);
  return basePositions.get(object)!;
}

export function getModelLayoutOffset(object: THREE.Object3D): number {
  return layoutOffsets.get(object) ?? 0;
}

export function setModelLayoutOffset(
  object: THREE.Object3D,
  offset: number
): void {
  layoutOffsets.set(object, offset);
}

export function getModelManualOffset(object: THREE.Object3D): THREE.Vector3 {
  ensureModelTransformState(object);
  return manualOffsets.get(object)!;
}

export function setModelManualWorldPosition(
  object: THREE.Object3D,
  position: THREE.Vector3
): void {
  ensureModelTransformState(object);

  const basePosition = basePositions.get(object)!;
  const layoutOffset = getModelLayoutOffset(object);

  object.position.copy(position);
  manualOffsets.set(
    object,
    new THREE.Vector3(
      position.x - (basePosition.x + layoutOffset),
      position.y - basePosition.y,
      position.z - basePosition.z
    )
  );
}

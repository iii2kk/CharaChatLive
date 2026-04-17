import * as THREE from "three";

const basePositions = new WeakMap<THREE.Object3D, THREE.Vector3>();
const layoutOffsets = new WeakMap<THREE.Object3D, number>();
const manualOffsets = new WeakMap<THREE.Object3D, THREE.Vector3>();
const interactionMetrics = new WeakMap<THREE.Object3D, ModelInteractionMetrics>();

export interface ModelInteractionMetrics {
  footOffsetY: number;
  radius: number;
}

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

export function computeModelInteractionMetrics(
  object: THREE.Object3D
): ModelInteractionMetrics | null {
  object.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) {
    return null;
  }

  const size = box.getSize(new THREE.Vector3());

  return {
    footOffsetY: box.min.y - object.position.y,
    radius: Math.max(size.x, size.z) * 0.35 + 0.8,
  };
}

export function ensureModelInteractionMetrics(
  object: THREE.Object3D
): ModelInteractionMetrics | null {
  if (!interactionMetrics.has(object)) {
    const metrics = computeModelInteractionMetrics(object);
    if (!metrics) {
      return null;
    }
    interactionMetrics.set(object, metrics);
  }

  return interactionMetrics.get(object) ?? null;
}

export function refreshModelInteractionMetrics(
  object: THREE.Object3D
): ModelInteractionMetrics | null {
  const metrics = computeModelInteractionMetrics(object);
  if (!metrics) {
    interactionMetrics.delete(object);
    return null;
  }

  interactionMetrics.set(object, metrics);
  return metrics;
}

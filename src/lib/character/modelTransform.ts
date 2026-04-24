import * as THREE from "three";

const interactionMetrics = new WeakMap<THREE.Object3D, ModelInteractionMetrics>();

export interface ModelInteractionMetrics {
  footOffsetY: number;
  radius: number;
}

export function setModelWorldPosition(
  object: THREE.Object3D,
  position: THREE.Vector3
): void {
  object.position.copy(position);
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

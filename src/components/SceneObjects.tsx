"use client";

import type { ThreeEvent } from "@react-three/fiber";
import type { SceneObject } from "@/types/sceneObjects";

interface SceneObjectsProps {
  sceneObjects: SceneObject[];
  activeSceneObjectId: string | null;
  onActiveSceneObjectChange: (id: string) => void;
  selectionEnabled: boolean;
}

export default function SceneObjects({
  sceneObjects,
  activeSceneObjectId,
  onActiveSceneObjectChange,
  selectionEnabled,
}: SceneObjectsProps) {
  void activeSceneObjectId;
  return (
    <>
      {sceneObjects.map((obj) => (
        <primitive
          key={obj.id}
          object={obj.object}
          onClick={(event: ThreeEvent<MouseEvent>) => {
            if (!selectionEnabled) return;
            event.stopPropagation();
            onActiveSceneObjectChange(obj.id);
          }}
        />
      ))}
    </>
  );
}

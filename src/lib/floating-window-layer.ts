export interface FloatingWindowLayerConfig {
  minZIndex: number;
  maxZIndex: number;
}

export interface WindowZState {
  zIndex: number;
}

/**
 * Assign the next z-index to a window, bringing it to the front.
 * When nextZIndex exceeds maxZIndex, recompact all windows.
 *
 * Returns the updated z-index map and the new nextZIndex.
 */
export function bringWindowToFront<K extends string>(
  windowId: K,
  zMap: Record<K, number>,
  nextZIndex: number,
  config: FloatingWindowLayerConfig
): { zMap: Record<K, number>; nextZIndex: number } {
  const ids = Object.keys(zMap) as K[];
  const capacity = config.maxZIndex - config.minZIndex + 1;
  if (ids.length > capacity) {
    throw new Error(
      `FloatingWindowLayer: window count (${ids.length}) exceeds available z-index range (${capacity})`
    );
  }

  if (nextZIndex <= config.maxZIndex) {
    return {
      zMap: { ...zMap, [windowId]: nextZIndex },
      nextZIndex: nextZIndex + 1,
    };
  }

  // Recompact: sort all windows by current z-index, reassign from minZIndex
  const sorted = ids.slice().sort((a, b) => {
    // The window being brought to front should be last (highest)
    if (a === windowId) return 1;
    if (b === windowId) return -1;
    return zMap[a] - zMap[b];
  });

  const newZMap = { ...zMap };
  sorted.forEach((id, i) => {
    newZMap[id] = config.minZIndex + i;
  });

  return {
    zMap: newZMap,
    nextZIndex: config.minZIndex + sorted.length,
  };
}

/**
 * Initialize nextZIndex from existing z-index values.
 */
export function computeNextZIndex(
  zMap: Record<string, number>,
  config: FloatingWindowLayerConfig
): number {
  const values = Object.values(zMap);
  if (values.length === 0) return config.minZIndex;
  return Math.min(Math.max(...values) + 1, config.maxZIndex + 1);
}

/**
 * Assign initial z-index values to a set of window IDs, starting from minZIndex.
 */
export function initializeZMap<K extends string>(
  ids: K[],
  config: FloatingWindowLayerConfig
): Record<K, number> {
  const capacity = config.maxZIndex - config.minZIndex + 1;
  if (ids.length > capacity) {
    throw new Error(
      `FloatingWindowLayer: window count (${ids.length}) exceeds available z-index range (${capacity})`
    );
  }
  const zMap = {} as Record<K, number>;
  ids.forEach((id, i) => {
    zMap[id] = config.minZIndex + i;
  });
  return zMap;
}

import type { AnimationEvent, AnimationEventType } from "./types";

type Listener = (event: AnimationEvent) => void;

export class AnimationEventEmitter {
  private listeners = new Map<AnimationEventType, Set<Listener>>();

  on(type: AnimationEventType, cb: Listener): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(cb);
    return () => {
      set!.delete(cb);
    };
  }

  emit(event: AnimationEvent): void {
    const set = this.listeners.get(event.type);
    if (!set) return;
    for (const cb of set) {
      try {
        cb(event);
      } catch (err) {
        console.error("[animation event listener error]", err);
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}

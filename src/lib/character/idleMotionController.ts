import type { CharacterModel } from "./types";

/**
 * idle モーションが motionMapping に割り当てられている場合に、
 * base レイヤーが空になったら自動的に idle をループ再生する。
 * - animation.on("end") で base が空になったときに再評価
 * - motionMapping.subscribe で割当変更時に再評価
 * - attach 直後にも一度評価して即時再生開始
 */
export function attachIdleMotion(model: CharacterModel): () => void {
  let disposed = false;
  let playing = false;

  const tryPlayIdle = () => {
    if (disposed || playing) return;
    const idleId = model.motionMapping.idle;
    if (!idleId) return;
    if (model.animation.getActive("base") !== null) return;

    const handle = model.animation.library
      .list()
      .find((h) => h.id === idleId);
    if (!handle) return;

    playing = true;
    void model.animation
      .play(handle, "base", { loop: true })
      .finally(() => {
        playing = false;
      });
  };

  const unsubscribeEnd = model.animation.on("end", () => {
    tryPlayIdle();
  });
  const unsubscribeMapping = model.motionMapping.subscribe(() => {
    tryPlayIdle();
  });

  tryPlayIdle();

  return () => {
    disposed = true;
    unsubscribeEnd();
    unsubscribeMapping();
  };
}

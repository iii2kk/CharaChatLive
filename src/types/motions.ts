import type { AnimationKind } from "@/lib/file-map";

export interface PresetMotion {
  /** UI 表示用の名前 (相対パス) */
  name: string;
  /** public/motions 以下の URL (例: /motions/...) */
  path: string;
  /** 拡張子から判定した種別 */
  kind: AnimationKind;
}

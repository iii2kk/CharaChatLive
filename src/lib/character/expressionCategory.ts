import type { ExpressionCategory } from "./types";

const EYE_PATTERNS = [
  /まばたき/,
  /瞬き/,
  /ｳｨﾝｸ/,
  /ウインク/,
  /ウィンク/,
  /笑い/,
  /なごみ/,
  /びっくり/,
  /ｷﾘｯ/,
  /じと目/,
  /じとめ/,
  /はぅ/,
  /目/,
];

const LIP_PATTERNS = [
  /^あ$/,
  /^い$/,
  /^う$/,
  /^え$/,
  /^お$/,
  /^ん$/,
  /^ワ$/,
  /^▲$/,
  /^∧$/,
  /^口/,
  /口角/,
  /にやり/,
  /ぺろっ/,
];

const BROW_PATTERNS = [
  /^眉/,
  /まゆ/,
  /ﾏﾕ/,
  /真面目/,
  /困る/,
  /怒り/,
  /上下/,
];

/**
 * PMX モーフ名から UI グルーピング用カテゴリを推定する。
 * MMDLoader が PMX の panel フィールドを保持しないため、名前ベースの
 * 単純なヒューリスティック。当たらないものは "other" に集約。
 */
export function categorizeMmdMorph(name: string): ExpressionCategory {
  for (const re of EYE_PATTERNS) {
    if (re.test(name)) return "eye";
  }
  for (const re of LIP_PATTERNS) {
    if (re.test(name)) return "lip";
  }
  for (const re of BROW_PATTERNS) {
    if (re.test(name)) return "brow";
  }
  return "other";
}

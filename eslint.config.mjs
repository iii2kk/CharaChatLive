import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Live2D Cubism Core/Framework は Live2D 配布物なので lint 対象外。
    // ライセンス上 改変不可 で、かつ IIFE の括弧関数呼び出しを no-unused-expressions が
    // 大量に誤検知するため。
    "public/live2dcubismcore.min.js",
    "vendor/**",
    "src/vendor/**",
  ]),
]);

export default eslintConfig;

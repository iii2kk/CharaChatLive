# CharaChatLive

Next.js ベースのキャラクタービューアです。MMD / VRM / Live2D を読み込み、Three.js 上で表示します。

## Development

開発サーバーを起動します。

```bash
npm run dev
```

ブラウザで `http://localhost:3000` を開いて確認します。

## Live2D Notes

Live2D は `pixi-live2d-display-lipsyncpatch` と Cubism Core を組み合わせて描画しています。
Cubism Core は [public/live2dcubismcore.min.js](/f:/TempProject/CharaChatLive/public/live2dcubismcore.min.js) を `<Script>` でそのまま読み込み、`src/lib/character/live2dPixi.ts` で初期化しています。

### Cubism Core Compatibility Patch

`src/lib/character/live2dPixi.ts` では、`window.Live2DCubismCore.Model.fromMoc()` に互換パッチを入れています。

背景:

- `pixi-live2d-display-lipsyncpatch@0.5.0-ls-8` は Cubism model に `model.drawables.renderOrders` がある前提で描画順を参照します
- 一方で、このプロジェクトで使っている `live2dcubismcore.min.js` では `renderOrders` は `model` 本体側にあり、`model.getRenderOrders()` で取得する実装です
- そのため未補正のままだと Live2D 初回描画時に `Cannot read properties of undefined (reading '0')` が発生します

対応内容:

- `fromMoc()` の戻り値に `drawables` があり
- `getRenderOrders()` が存在し
- `drawables.renderOrders` が未定義

である場合に、`drawables.renderOrders = model.getRenderOrders()` を補完しています。

これは `F:\\TempProject\\temp\\live2d-test2` の検証用サンプルと同じ互換対応です。

### 注意

- このパッチは Cubism Core と `pixi-live2d-display-lipsyncpatch` の API 差分を吸収するためのものです
- `live2dcubismcore.min.js` を差し替えたり、`pixi-live2d-display-lipsyncpatch` のバージョンを更新した場合は不要になるか、別の調整が必要になる可能性があります
- Live2D 周りで再び描画エラーが出た場合は、まず `renderOrders` 周辺の互換性を確認してください

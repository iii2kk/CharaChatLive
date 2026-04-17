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

## DirectionalLight 影パラメータ

「ライト」ウィンドウで調整できる影関連パラメータの解説です。DirectionalLight は `light.position` を起点に `light.target` 方向を見る正射投影カメラでシーンを撮影し、その深度情報を影マップとして使います。以下のパラメータはその「影用カメラ」と深度比較の挙動を制御します。

### ShadowCameraSize

影用カメラの正射投影の範囲（`left/right/top/bottom = ±size`）。この範囲内にあるオブジェクトだけが影を落とす／受ける対象になります。

- 小さすぎる: キャラがはみ出し、影が欠ける／境界が見える
- 大きすぎる: 同じ shadow map 解像度を広い範囲に割り当てるので、影がボケたりシャドウアクネ（ざらつき）が出やすい

### ShadowCameraNear / ShadowCameraFar

影用カメラの near/far クリップ。ライトから見て `near`〜`far` の奥行き範囲にあるものだけが影マップに描画されます。

- Near を大きくし過ぎる: ライトに近いオブジェクトが描画されず影が抜ける
- Far を小さくし過ぎる: 遠いオブジェクトが影マップから抜ける
- Far を大きくし過ぎる: 深度の精度（depth precision）が落ちてアクネや影の欠けが発生
- 目安: 実際にシーンに存在する奥行き範囲にぴったり合わせるのが最適

### ShadowBias

深度比較時に加算する一定のオフセット。自己影（シャドウアクネ）を消すために使います。

- 0 付近: 表面がザラザラと自分自身の影で汚れる（アクネ）
- 負に大きく: アクネは消えるが、影が本体から「浮いて」見える（peter-panning）
- 通常は `-0.001`〜`-0.0001` 程度の小さい負の値

### ShadowNormalBias

サーフェスの法線方向にオフセットを入れる bias。斜めから光が当たる面のアクネに有効で、ShadowBias より副作用（peter-panning）が少ないのが特徴です。

- 値を上げるほどアクネは消えるが、細いオブジェクトの影が痩せる
- 通常は `0.01`〜`0.1` 程度

実運用では **NormalBias を先に上げてアクネを消し、足りない分だけ Bias を負に振る** のが定石です。

### 参考: three.js デフォルトと本プロジェクト初期値

| パラメータ | three.js デフォルト | 本プロジェクト初期値 |
| --- | --- | --- |
| ShadowCameraSize | ±5 | ±20 |
| ShadowCameraNear | 0.5 | 0.1 |
| ShadowCameraFar | 500 | 200 |
| ShadowBias | 0 | -0.0005 |
| ShadowNormalBias | 0 | 0.02 |

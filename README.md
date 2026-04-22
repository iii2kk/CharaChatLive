# CharaChatLive

Next.js ベースのキャラクタービューアです。MMD / VRM / Live2D を読み込み、Three.js 上で表示します。

## Development

開発サーバーを起動します。

```bash
npm run dev
```

ブラウザで `http://localhost:3000` を開いて確認します。

## 使い方

### 画面構成

複数のフローティングウインドウを「メニュー」から開閉できます。主なウインドウ:

| ウインドウ | 用途 |
| --- | --- |
| プリセットモデル | `public/models/` 以下のモデルを一覧からワンクリック読み込み |
| 背景・地面 | `public/textures/` 以下のテクスチャプリセット |
| ファイル読み込み | モデル / アニメーションの手動読み込み |
| 読み込み済みモデル | 現在シーンにいるモデルの選択・削除 |
| ライト / 環境ライト | ライティング調整 |
| 操作モード | カメラ操作・モデル配置モードの切替 (Esc で配置モード終了) |
| 表示調整 | 物理演算・Live2D 解像度・板ポリスケール等 |
| 表情コントロール | 目・口・眉モーフの手動調整、セマンティックキー (blink/aa/ih...) の割当 |
| モーションコントロール | モーション再生・レイヤー・idle 割当 (後述) |

### モデルの読み込み

対応形式は **MMD (.pmx / .pmd)**、**VRM**、**Live2D (model3.json)** です。

1. **プリセットから**: 「プリセットモデル」ウインドウから選択
2. **フォルダから**: 「ファイル読み込み」→「モデルフォルダを選択」で、モデル本体 + 関連ファイル (テクスチャ・物理設定等) を含むフォルダを指定。ドラッグ&ドロップも可
3. **座標の配置**: 「操作モード」→「配置」にするとクリックした地点にモデルを移動

複数モデルを同時に読み込んでシーンに並べられます。「読み込み済みモデル」でアクティブなモデルを切り替えてください。

### モーションの読み込み

対応形式は **VMD** (MMD用)、**VRMA** (VRM用)、**motion3.json** (Live2D用、モデル同梱のみ) です。

#### 自動読み込み (プリセット)

`public/motions/` 以下を再帰的にスキャンし、MMD/VRM モデル読み込み時に自動で一括登録されます。追加したいモーションはこのフォルダ配下に置くだけで反映されます (サブフォルダ・日本語名 OK)。

#### 手動読み込み

「ファイル読み込み」の 🎬 エリアから:

- **ファイル選択**: 複数の `.vmd` / `.vrma` をまとめて選択
- **フォルダ選択**: フォルダ内の対応ファイル全てを一括登録
- **ドラッグ&ドロップ**: ファイルを放り込む

1ファイル = 1モーション = モーションコントロールに 1 項目 として登録されます。

### モーションコントロールの使い方

2 レイヤー方式 (**base** と **overlay**) でモーションを制御します。

#### base と overlay

| レイヤー | 役割 | デフォルト | 典型例 |
| --- | --- | --- | --- |
| **base** | 土台となる常時モーション | loop: true | 待機・歩行・ダンス |
| **overlay** | 一時的に重ねる単発モーション | loop: false | 手振り・頷き・ポーズ |

- overlay は「base を止めずに上から差し込む」イメージで、終了後は base だけの状態に戻ります
- base を別モーションに差し替えると crossfade (VRM/Live2D) で遷移します

#### idle 割当

モーションコントロールの各項目の右側にあるラジオボタンで **idle** を指定できます。`idle 割当` は **そのモーションを base でループ再生するショートカット** です。

- 割当あり → 即座に base レイヤーでループ開始
- 割当なし (デフォルト) → 何もしない
- 「idle 解除」ボタンで base を停止 (overlay は影響なし)

#### ボタンの見方

- ▶ base: base レイヤーでループ再生開始
- ▶ overlay: overlay レイヤーでワンショット再生 (overlay 非対応モデルは無効化表示)
- idle ラジオ: このモーションを idle (デフォルト再生) に割当
- idle 解除: idle 割当を外して base 停止
- 全停止: base / overlay 両方を停止

ウインドウ下部に現在のモデルの **capability** (対応レイヤー / crossfade 可否 / seek 可否) が表示されます。

### バックエンド別の対応状況

| 形式 | base | overlay | crossfade | seek |
| --- | :---: | :---: | :---: | :---: |
| VRM (VRMA) | ✓ | ✓ | ✓ | ✓ |
| Live2D (motion3) | ✓ | ✓ | ✓ | ✗ |
| MMD (VMD) | ✓ | ✗ (警告のみ) | ✗ (hard-cut) | ✗ |

MMD は単一モーション前提の仕様のため overlay は非対応です。

### 表情コントロール

「表情コントロール」ウインドウで各モーフの重みを直接スライダー操作できます。

- **セマンティックキー** (blink / blinkLeft / blinkRight / aa / ih / ou / ee / oh) は、モデルの表情名と自由にマッピング可能
- VRM / MMD: 任意のモーフ名に割当 (セレクトで選択)
- Live2D: プリセット表情 (`.exp3.json`) をボタンで適用可能

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

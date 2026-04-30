# TODO

長期で残っている拡張ポイント。領域別に並べる。

## PMX モーフ — 未対応の type

現状 [src/lib/mmd/PmxMaterialMorphController.ts](src/lib/mmd/PmxMaterialMorphController.ts) で **type 8 (材質モーフ)** のみ対応済み。type 1 (頂点) は Three.js が `morphTargetInfluences` 経由で自動適用するため別実装不要。残る type は未対応で、対応する場合は以下を参考に。

共通の基盤として、生 PMX morph データは [loadPmxMesh.ts](src/lib/mmd/loadPmxMesh.ts) が `LoadedPmxMesh.allMorphs` に保持しているので、新たにパースし直す必要は無い。現状は [loadPmxMesh.ts:57-80](src/lib/mmd/loadPmxMesh.ts#L57-L80) の `collectMaterialAndGroupMorphs` で type 8 とそれを子に持つグループモーフだけを抽出している。新 type 対応時は同様に collect 関数を増やす。

`PmxMaterialMorphController` の構造（**初期スナップショット → 全 active morph を走査して mul/add accumulator に集約 → ベース値から再計算 → 影響対象のみ書き戻し**）はボーン・UV モーフでもそのまま流用できる。

---

### type 2 — ボーンモーフ

**データ**: `{ index: boneIndex, position: [x,y,z], rotation: [x,y,z,w] }[]`

**できる動き**:
- 装飾品の角度・位置調整（メガネをずらす、髪飾りの傾き）
- 髪型シルエット切替（後ろ髪・横髪を別ポーズへ）
- 武器の構え変更、衣装ディテール（袖まくり、襟立て）
- カメラへ目線を向けるモーフ
- スカートのボリューム調整
- プロップなら**ドアや引き出しの開閉**

**実装ヒント**:
- 適用先は `mesh.skeleton.bones[idx]` の `position` / `quaternion`。ベース pose をスナップショットし、毎フレーム「ベース → 全モーフ寄与を加算 → 適用」
- weight w に対して `position += morph.position * w`、回転は `quat.slerp(identity, morph.rotation, w)` を順に乗算
- VMD アニメーションのボーン更新と**重ねる**必要がある。MMDAnimationHelper が helper.update(delta) で skeleton を書き換えた**直後**に morph 寄与を加算する。タイミングを誤ると物理 (Ammo) が暴れる
- 物理ボーン（rigid body 連動ボーン）への適用は要注意。原則、物理対象ボーンにはモーフ寄与を入れない方が安全

**プロップ側の追加対応**:
- 現状 [src/lib/sceneObject/loadSceneObject.ts](src/lib/sceneObject/loadSceneObject.ts) の `loadMmdAsObject` は SkinnedMesh→Mesh に変換して skeleton を捨てている（ボーン 0 個の PMX のシェーダエラー回避のため）
- ボーンモーフを持つ PMX は SkinnedMesh のまま使う分岐を追加する必要がある。「ボーン 0 個ならば Mesh、それ以外（or ボーンモーフがある）ならば SkinnedMesh」の判定に変更

---

### type 3 — UV モーフ (主 UV)

**データ**: `{ index: vertexIndex, uv: [Δu, Δv, _, _] }[]` ※後ろ 2 要素は主 UV では未使用

**できる動き**:
- **顔差分**: 目・口の形状差分をテクスチャアトラスから切替（瞳孔の形、ハート目、×目、泣き目）
- 頬染め・汗・涙を透明領域から色付き領域へずらして表示
- **看板・モニタの表示切替**（ON/OFF、画面 1/画面 2）
- 時計の針を円形タイルテクスチャで進める
- スプライトシートのアニメテクスチャ（連番フレームを送る）
- 目のハイライト位置による視線ニュアンス

**実装ヒント**:
- 適用先は `geometry.attributes.uv`。ベース UV を `Float32Array` で 1 度だけスナップショット
- 再計算: `uv[i*2] = baseUv[i*2] + Σ(morph.uv[0] * weight)`、`uv[i*2+1] = baseUv[i*2+1] + Σ(morph.uv[1] * weight)`
- 書き換え後は `geometry.attributes.uv.needsUpdate = true`
- **ベースからの再計算必須**。差分加算で済ませると weight 変更時に値が累積する
- 影響頂点だけ更新する dirty range 管理（`addUpdateRange`）にすると軽い。教室一棟で UV モーフ 1 個 = 数十頂点なら不要

**ユーザインパクトが大きいので Phase 2 として最優先候補**

---

### type 4-7 — 追加 UV モーフ (additionalUV1-4)

**データ**: `{ index: vertexIndex, uv: [Δu, Δv, Δs, Δt] }[]` ※4 要素全部使う

**用途**: PMX 拡張シェーダ向けデータチャネル（頂点ごとに vec4 の係数を持たせる）。発光係数、ノイズ強度、テクスチャブレンド係数など。

**対応見送り推奨**:
- [MMDLoader](node_modules/three/examples/jsm/loaders/MMDLoader.js) は追加 UV を `geometry.attributes` に展開していない（`uv1`/`uv2` BufferAttribute が作られない）
- 対応するには (a) MMDParser の `data.vertices[i].additionalVec4s` から自前で `Float32BufferAttribute` を生成し、(b) これらを参照する**カスタムシェーダ**を書く必要がある
- 標準 PMX シェーダ自体がこれらを見ないので、追加 UV を活用しているモデルは MMD 上でもプラグイン前提で表示されている
- 本プロジェクトの `public/objects/` 内のモデルでこの機能を使う想定が無い限り、**コスト ≫ 効果**

着手するときは Phase 4 以降で、対応モデルの実例とユーザ要望が揃ってから。

---

## その他のメモ

（必要に応じて追記）

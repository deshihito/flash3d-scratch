# Flash — TSベース 3D エンジン for Scratch Pen（sb3 生成互換）

**Flash** は、純 Vanilla Scratch 3.0 のペン描画だけで 3D 描画を行うための、TypeScript ベースの 3D エンジンである。シーンを TS で記述し、公式 Scratch / TurboWarp の双方でそのまま動く `.sb3` を生成する（生成 sb3 は純 Vanilla、拡張は `pen` のみ）。レイヤ構成は L0 sb3 ビルダー / L1 エンジンコア（Scratch へ emit されるデバイスコード）/ L2 シーン記述 API / L2.5 ホスト側ベイク。

土台は研究レポ **[deshihito/scratch-ue5-pen-research](https://github.com/deshihito/scratch-ue5-pen-research)** の **UE5 hybrid**（`ue5_lumen_hybrid.sb3`、Antigravity が作成）—「ベイク済みラスタライザ＋解析的レイトレのヒーローオブジェクト＋平面反射の二重描画パス」という描画配分で品質と実用速度を両立させた実証作である。Flash はその方式と数値を引き継ぎ、固定シーンのデモから「シーンを差し替えられるエンジン」へ汎用化した。**本レポはエンジン専用**であり、ゲーム固有ロジック（貴重品の価値・破損・ノルマ・敵の具体仕様など）は入れない。エンジンは「物理的な出来事の検出と数値化」までを担い、意味付けはゲーム側（将来の別レポ）の仕事である。

## 状態: エンジン完成（フェーズ6完了、2026-11-26）

| フェーズ | 内容 | 状態 |
|---|---|---|
| 0 | L0 sb3 ビルダー（`sb3_builder.py` の TS 移植）＋構造一致の検証 | ✅ 完了 |
| 1 | L1 エンジンコア＋L2 シーン記述 API＋神殿シーン再現（MVP） | ✅ 完了 |
| 2 | 動的オブジェクト基盤（SoA テーブル＋N個ソート統合＋実行時シェーディング）＋衝突（プレイヤー vs 動的オブジェクト、押す挙動） | ✅ 完了 |
| 3 | 入力 intent / PlayerState、汎用レイキャスト、掴む/運ぶ、簡易物理（重力・接地・スリープ）、衝撃量イベント | ✅ 完了 |
| 4 | 最適化・高優先群（ペン色キャッシュ、床リスト事前計算、移動中反射の時間分割ほか） | ✅ 完了 |
| 5 | マップ/ルーム表現＋部屋単位カリング＋汎用AIステートマシン基盤 | ✅ 完了 |
| 6 | 最適化・中優先群（fill 行ループ増分化、円柱ストリップ適応、適応解像度）＋仕上げ | ✅ 完了 |
| 追加 | 動的球の環境反射シェーディング化＋出荷デモのデバッグモニタ非表示化（ユーザー実機FB対応） | ✅ 完了 |

実機（TurboWarp / Scratch 公式）での起動・描画目視・操作・FPS 計測はユーザー確認待ち（本レポの検証は構造検証＋ヘッドレス実測ベース）。

## ビルド

```bash
npm install
npm test              # tsc＋単体テスト全件＋Python版ビルダーとの構造一致比較
npm run build:temple  # dist/temple.sb3（神殿シーン単体 = フェーズ1の再現）
npm run build:demo    # dist/demo.sb3（神殿＋動的オブジェクト＋物理のデモ）
npm run build:rooms   # dist/rooms.sb3（4部屋マップ＋巡回AIのデモ）
npm run verify:temple # 原本 sb3 との等価性比較＋構造検証
npm run verify:demo   # 構造検証（0 issues が合格）
npm run verify:rooms  # 構造検証
```

`dist/` は .gitignore 済み（生成物は git 管理しない）。デモのデバッグ用ステージモニタ（evLastImpact / evVal / psRoom / agState 等）は出荷ビルドでは非表示。表示したい場合は `FLASH_MONITORS=1 npm run build:demo` のように環境変数で有効化する（`DynSceneSpec.debugMonitors` オプション）。

デモの操作（暫定のデモ側バインドであり、キー割り当てはゲーム側の未決事項）: WASD/QE 移動、矢印またはドラッグで視点、F 長押しで掴む/運ぶ・離して落とす、保持中に G で投げる、Shift でダッシュ（rooms デモ）。

## 公開インターフェース（L2 シーン記述 API）

すべて `src/scene/` の TS API。デバイス側の実装は `src/engine/`。

### 静的シーン
- `SceneSpec`（`src/scene/temple.ts`）＋ `bakeCinemaScene()`（L2.5 ベイク: Lumen 風 HDR 評価＋ACES で頂点色を焼く）。`buildTempleProject(baked)` が神殿カーネルの15プロシージャを emit する。

### 動的オブジェクト（`src/scene/dynamic.ts`: `DynSceneSpec`）
- オブジェクト宣言: `kind`（`sphere` / `cylinder` / `box`）、`pos`、`yawDeg`、`radius` / `height` / `halfExtents`、`material.albedo`（0..1）、`metal`（0..1、球の環境反射シェーディング用、既定1）、`pushable`、`fluted`、`physical`、`room`
- SoA テーブル（dynKind / dynX / … / dynMetal）に載り、静的オブジェクトと距離ソートで統合描画される（ID 101〜）。行は実行時に書き換わるため、移動・出現/消去は行の更新として扱える
- 描画: 球 = 環境反射ストリップ（`trace_refl_fast` で反射ベクトルをトレースし、マテリアルティント＋フレネル＋ACES）、円柱 = 既存のスムース円柱（距離適応ストリップ数）、箱 = 太陽ドット陰影＋面ごとの環境ティント。すべてに床への接触影（blob）が付く
- 衝突: プレイヤー（XZ 円）vs 球/円柱（XZ 円）/ 箱（世界軸 AABB）。pushable な物は押し出され、範囲外ならプレイヤー側が押し戻される

### 入力・物理・イベント（フェーズ3）
- 入力抽象: intent（移動軸・視点デルタ・掴む/投げる）と `PlayerState`（`ps*` レジスタ群）。入力デバイス差し替えは intent の供給側で行う
- `dyn_raycast`: 動的オブジェクト＋床平面＋バウンズ壁へのレイキャスト（掴み判定・AI 知覚が共用）
- 掴む/運ぶ: キネマティック追従（バネ追従は未決事項 E1 のため未実装）、離す/投げる
- 簡易物理: 重力・速度・床接地・スリープ・物同士の非弾性マージ。パラメータは `DynSceneSpec.physics` で上書き可能（既定値はすべて暫定・可逆の作業値）
- 衝撃イベント: 並行リスト `evType / evObj / evOther / evVal / evFrame`＋最新値ミラー `evLastImpact / evLastObj`。エンジンは衝撃量（|Δv|）の算出と通知まで。破損等への換算はゲーム側

### 部屋・マップ（`src/scene/rooms.ts`: `RoomsSpec`、フェーズ5）
- 部屋 = XZ 矩形＋隣接集合。部屋2以降の床・壁はホスト側でベイクされ `render_rooms` が描く（部屋1は静的ベイク幾何）
- `room_update` が所属部屋 `psRoom` と有効集合（所属＋隣接）`rmActive` を維持し、描画・物理・衝突・AI が非アクティブ部屋を間引く
- プレイヤー vs 部屋壁は `room_collide`（静的 AABB 押し出し）

### 汎用 AI 基盤（`src/scene/ai.ts`: `AgentSpec`、フェーズ5）
- 状態は数値 ID の SoA テーブル（`agState` 等）で公開。知覚プリミティブ（視界 = 距離＋視野角＋レイキャスト遮蔽、聴覚 = 半径）とステアリング（目標点 seek）を提供
- 参照ステートマシン（巡回→追跡→帰還）は `agAuto=1` のエージェントにのみ適用される参照実装。状態の意味付け・遷移の追加はゲーム側

## 実測コスト（distilled ハーネス、実行ブロック範囲の実カウント）

壁時計は共有マシンのノイズで判定できないため、最適化の合否は V8 カバレッジによる実行範囲カウントで測った（数値は事実としての実測であり、合否基準値そのものは未決事項）。

- フェーズ4: ペン色設定 −28.7%、床リスト読み −23.1%（神殿6ポーズ、静止画は画素完全一致を維持）
- フェーズ6-A（fill 行ループ増分化）: `fill_quad_scan` 実行範囲 −22〜−28%/ポーズ、画素完全一致
- フェーズ6-C（円柱ストリップ適応）: `render_smooth_cylinder` 実行範囲 −26〜−54%/ポーズ（遠距離のみ画が変わる）
- フェーズ6-D（適応解像度）: step 4 で fill 実行範囲 −37.4%（P2）。既定は無効（`ADAPT_RES=0`）、有効化時の画の変化は行量子化のみ（step3 で 1.0〜6.5%セル）
- 部屋カリング: リスト読み −64.9%、ペン色設定 −92.6%（同一視点・全室有効との比較）
- AI: 約 0.35〜0.45ms / エージェント / フレーム（ブロック数からの算出値、実測ではない）
- 動的球の環境反射化: フレーム実行範囲 +0.27%（demo 初期視点、球2個）

## 制約と既知の残件

- 生成 sb3 は純 Vanilla（拡張 `pen` のみ）。最適化は Vanilla 基準で測っている
- 箱コライダは世界軸 AABB（yaw は描画のみ）。円柱の色は石材固定（マテリアル色は球・箱のみ）
- `dyn_raycast` の遮蔽は床とバウンズ壁のみ（ベイク建築・部屋壁は対象外）。AI の視界も部屋壁を透過する場合がある
- 部屋壁コライダはプレイヤーのみ（動的オブジェクト・AI は部屋壁と衝突しない）
- 動的球の反射トレースシーンは神殿カーネルのもの（動的オブジェクト同士・部屋壁は反射に映らない）。各帯は中央列のみサンプリング（グリントは縦に伸びる）
- fill_tri 経路（床・クリスタルの三角描画）は適応解像度の対象外
- 保持方式のバネ追従（E1）ほか、設計上の未決事項（E1〜E6: アクティブ数上限・点光寄与上限・知覚間引き間隔・AI 経路方式など）は未決のまま残してある。ゲーム側の数値（G1〜G8: 重力・破損閾値・ノルマ・敵パラメータ等）は別レポの未決事項
- 同時アクティブな動的オブジェクト数の上限目安は Vanilla 実測ベースで 10〜16 個（要実測）
- 実機 FPS は未測（ヘッドレス実測のみ）

## 構成

```
src/builder/        # L0: sb3 ビルダー（sb3_builder.py の TS 移植）
                    #   index.ts   Expr DSL、決定的 ID 採番、project.json 組立
                    #   pyjson.ts  Python json.dumps 互換シリアライザ
                    #   zip.ts     決定的 ZIP ライタ（固定タイムスタンプ）
src/engine/         # L1: エンジンコア（デバイスコード = Scratch へ emit される汎用部品）
                    #   hybrid-engine.ts  hybrid の15プロシージャ＋メインループ＋最適化群
                    #   dynamic.ts        動的オブジェクト（SoA管理・描画・衝突）
                    #   physics.ts        入力intent/PlayerState・レイキャスト・掴む/運ぶ・簡易物理・衝撃イベント
                    #   rooms.ts          部屋データ・所属判定・部屋描画・部屋壁衝突・部屋単位カリング
                    #   ai.ts             汎用AI基盤: 知覚・ステアリング・参照ステートマシン
src/scene/          # L2: シーン記述 API
                    #   temple.ts           神殿シーンの宣言（SceneSpec）とビルド入口
                    #   temple-constants.ts シーン定数（原典値の転記）
                    #   dynamic.ts          動的オブジェクトの宣言 API（DynSceneSpec、物理パラメータ含む）
                    #   demo.ts             デモシーン（神殿＋動的オブジェクト）
                    #   rooms.ts            部屋の宣言 API（RoomsSpec）
                    #   ai.ts               エージェントの宣言 API（AgentSpec）
                    #   rooms-demo.ts       4部屋＋AIデモシーン
src/bake/           # L2.5: ホスト側ベイク（temple-bake.ts: Lumen HDR 評価＋ACES）
src/pycompat.ts     # Python 意味論ヘルパー（銀行丸め・剰余・range 等）
examples/temple/    # 神殿シーンの sb3 生成 CLI
examples/demo/      # デモの sb3 生成 CLI（FLASH_MONITORS=1 でモニタ表示）
examples/rooms/     # 部屋＋AIデモの sb3 生成 CLI（同上）
tests/
  fixtures/python/  # 移植元の正: sb3_builder.py（原典コピー）＋最小シーン生成
  builder.test.ts   # 単体テスト（MD5・ID 規約・mutation 書式・決定性）
  temple.test.ts    # 神殿シーンの構造シグネチャ（4,427ブロック/263変数/76リスト/15 proc）
  demo.test.ts      # デモシーンの構造シグネチャ（7,313ブロック/387変数/103リスト/21 proc）＋SoA初期値
  physics.test.ts   # 物理パラメータ解決・静止高さ導出・神殿ビルドへの混入なし確認
  render-policy.test.ts # 最適化配線の回帰（反射LOD・適応解像度フィードバック等）
  rooms.test.ts     # 部屋＋AIデモの構造シグネチャ・隣接行列・部屋幾何カウント・到達可能性
tools/compare.mjs   # Python 版と TS 版の project.json 構造一致を機械比較
tools/validate.mjs  # sb3 構造検証（validate_sb3.py の TS 移植＋拡張チェック）
tools/compare-temple.mjs # 生成 temple.sb3 と原本 hybrid sb3 の等価性比較
benchmarks/         # 研究レポから移した計測基準一式（詳細は benchmarks/README.md）
```

### 神殿シーン（フェーズ1 MVP）の等価性

現行 UE5 hybrid（`build_ue5_lumen_hybrid.py`）のデバイスコードとベイクを L1/L2/L2.5 に分離移植したもの。数値はすべて原典値の転記で、新規の仕様・数値は導入していない。原本 `ue5_lumen_hybrid.sb3` との比較（移植当時）: ブロック 4,196 = 4,196、変数 232 = 232、リスト 76 = 76（初期値すべて数値一致）、プロシージャ 15 = 15、opcode ヒストグラム完全一致。ブロック単位では 4,105 / 4,196 が JSON 完全一致し、残り 91 件は数値リテラルの表記差のみ（`1.0` vs `1` 等、数値として同一）。distilled の transpile.py を両 sb3 に当てた生成 TS は 8,982 / 8,994 行一致、`rt.unimplemented` は両側 0 件。現在の神殿ビルドはフェーズ4/6の最適化を含むためブロック数は 4,427 に増えているが、静止ポーズの画素は最適化前と完全一致を回帰確認している。

既知の移植上の差異: Python の int / float の区別は JS の number では表現できないため、整数値の float（例 `32.0`）を入力リテラルに使うと Python は `"32.0"`、TS は `"32"` と印字する。現行の利用範囲（整数と短い小数）では一致する。

## ライセンス

**CC BY-SA 2.0**（レポ所有者が 2026-11-26 に決定）。LICENSE ファイルにリーガルコード全文を置く。土台となった scratch-ue5-pen-research の UE5 hybrid は Antigravity が作成したもので、本レポはその派生である。

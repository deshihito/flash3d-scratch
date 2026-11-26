# Flash — TSベース 3D エンジン for Scratch Pen（sb3 生成互換）

**Flash** は、純 Vanilla Scratch 3.0 のペン描画だけで 3D 描画を行うための、TypeScript ベースの 3D エンジンである。シーンを TS で記述し、公式 Scratch / TurboWarp の双方でそのまま動く `.sb3` を生成する（TS → sb3 変換互換が必須要件）。

土台は研究レポ **[deshihito/scratch-ue5-pen-research](https://github.com/deshihito/scratch-ue5-pen-research)** の **UE5 hybrid**（`ue5_lumen_hybrid.sb3`）—「ベイク済みラスタライザ＋解析的レイトレのヒーローオブジェクト＋平面反射の二重描画パス」という描画配分で、品質と実用速度を両立させた実証作である。Flash はその方式を引き継ぎ、固定シーンのデモから「シーンを差し替えられるエンジン」へ汎用化する。画質は現行水準を維持し、主眼は**最適化**と**不足コンポーネントの補完**に置く。

## 現在の状態: フェーズ5（マップ/ルーム表現＋汎用AI基盤）

| フェーズ | 内容 | 状態 |
|---|---|---|
| 0 | L0 sb3 ビルダー（`sb3_builder.py` の TS 移植）＋構造一致の検証 | ✅ 完了 |
| 1 | L1 エンジンコア＋L2 シーン記述 API＋神殿シーン再現（MVP） | ✅ 完了（実機目視はユーザー確認待ち） |
| 2 | 動的オブジェクト基盤（SoA テーブル＋N個ソート統合＋実行時シェーディング描画）＋衝突（プレイヤー vs 動的オブジェクト、押す挙動） | ✅ 完了（実機確認はユーザー待ち） |
| 3 | 掴む/運ぶ＋簡易物理（重力・接地・スリープ、衝撃量イベント） | ✅ 完了（実機確認はユーザー待ち） |
| 4 | 最適化（反射 LOD / RT 時間分割 / ペン色キャッシュ / 床シェーディング事前計算） | ✅ 完了（実機確認はユーザー待ち） |
| 5 | マップ/ルーム表現＋部屋単位カリング＋汎用AIステートマシン基盤 | ✅ 完了（実機確認はユーザー待ち） |
| 6 | 最適化（中優先群）＋仕上げ | 未着手 |

フェーズ2の詳細: 動的オブジェクトは `src/scene/dynamic.ts`（L2 宣言: 球/円柱/箱、位置・yaw・マテリアル・pushable）で宣言し、`buildTempleProject(baked, dynSpec)` に渡すと `src/engine/dynamic.ts`（L1）が SoA リスト（dynKind/dynX/... 全15本）・描画プロシージャ（dyn_draw_sphere / dyn_draw_box）・衝突プロシージャ（dyn_collide）を追加で emit する。動的オブジェクトは既存の距離ソート（sort_5_objects を 5+N 件へ一般化、ID 101〜）に統合され、静的ベイクシーンと共存する。dynSpec を渡さない神殿ビルドはフェーズ1と完全に同一の出力のまま。

フェーズ3の詳細: `src/engine/physics.ts`（L1）が入力抽象と PlayerState を追加する。入力は intent（移動軸・視点デルタ・掴む/投げる）に分離され、プレイヤー状態は `ps*` レジスタ群に集約される（DYN ビルドのメインループのみ差し替え）。汎用レイキャスト `dyn_raycast`（動的オブジェクト＋床平面＋バウンズ壁）、掴む/運ぶ `dyn_grab`（キネマティック追従が暫定既定、離す/投げる対応）、簡易物理 `dyn_physics`（重力・速度・床接地・スリープ・物同士の衝突応答）が乗り、衝突/落下の衝撃量（|Δv|）はイベントリスト `evType/evObj/evOther/evVal/evFrame` と最新値 `evLastImpact` 等でゲーム側へ公開される（破損等の意味付けはエンジンではしない）。物理パラメータは `DynSceneSpec.physics` で上書き可能で、既定値はすべて暫定・可逆の作業値。

```bash
npm run build:demo    # dist/demo.sb3（神殿＋物理球・箱＋落下球＋固定円柱のデモ: F長押しで掴む/離して落とす、保持中にGで投げる）
npm run verify:demo   # 構造検証
```

フェーズ4の詳細: 実行ブロック数ハーネス（distilled ランタイム）で実測しながら、反射 LOD（鏡像のフラット化＋行間引き）／ペン色キャッシュ＋シェーディング量子化／RT チェッカーボード時間分割（移動中のみ）／床シェーディング事前計算（視錐台棄却＋スペキュラ省略）を入れた。神殿6ポーズ合計（静止画）でペン色設定 −28.7%・床リスト読み −23.1%。現行の神殿シグネチャは 4,346ブロック/242変数/76リスト/15 proc。

フェーズ5の詳細: `src/scene/rooms.ts`（L2）で部屋を「XZ 矩形＋隣接集合」として宣言し、部屋2以降の床タイル・壁はホスト側で神殿と同じ照明ベイクを施して `src/engine/rooms.ts`（L1）の `render_rooms` が描く（部屋1は従来のベイク幾何が担う）。`room_update` がプレイヤーの所属部屋 `psRoom` と有効部屋集合（所属＋隣接）`rmActive` を維持し、描画・物理・衝突・AI は非アクティブ部屋のオブジェクトを間引く。プレイヤー vs 部屋の壁は `room_collide`（静的 AABB 押し出し）。`src/scene/ai.ts`（L2）＋`src/engine/ai.ts`（L1）は汎用 AI 基盤: 状態は数値 ID の SoA テーブル（`agState` 等）で公開し、知覚（視界＝距離＋視野角＋レイキャスト遮蔽、聴覚＝移動音＋衝撃ノイズの半径再公開）とステアリング（目標点 seek、壁回避は衝突解決任せ、経路探索なし）をプリミティブとして提供する。参照ステートマシン（巡回→追跡→帰還→巡回）は `agAuto=1` のエージェントにだけ適用され、状態の意味付け・遷移先の追加はゲーム側の仕事。AI の速度・知覚範囲等の数値はすべてデモ側の暫定値で、エンジン既定値ではない。

```bash
npm run build:rooms   # dist/rooms.sb3（4部屋マップ＋巡回AI 2体のデモ: WASD/矢印で移動、Shiftでダッシュ）
npm run verify:rooms  # 構造検証
```

## 構成

```
src/builder/        # L0: sb3 ビルダー（sb3_builder.py の TS 移植）
                    #   index.ts   Expr DSL、決定的 ID 採番、project.json 組立
                    #   pyjson.ts  Python json.dumps 互換シリアライザ
                    #   zip.ts     決定的 ZIP ライタ（固定タイムスタンプ）
src/engine/         # L1: エンジンコア（デバイスコード = Scratch へ emit される汎用部品）
                    #   hybrid-engine.ts  現行 hybrid の15プロシージャ＋メインループ
                    #   dynamic.ts        動的オブジェクト（SoA管理・描画・衝突、フェーズ2）
                    #   physics.ts        入力intent/PlayerState・レイキャスト・掴む/運ぶ・簡易物理・衝撃イベント（フェーズ3）
                    #   rooms.ts          部屋データ・所属判定・部屋描画・部屋壁衝突・部屋単位カリング（フェーズ5）
                    #   ai.ts             汎用AI基盤: 知覚・ステアリング・参照ステートマシン（フェーズ5）
src/scene/          # L2: シーン記述 API
                    #   temple.ts           神殿シーンの宣言（SceneSpec）とビルド入口
                    #   temple-constants.ts シーン定数（現行値の転記）
                    #   dynamic.ts          動的オブジェクトの宣言 API（DynSceneSpec、物理パラメータ含む）
                    #   demo.ts             デモシーン（神殿＋動的オブジェクト、フェーズ2/3の機能確認用）
                    #   rooms.ts            部屋の宣言 API（RoomsSpec: 矩形・隣接・床タイル・壁、フェーズ5）
                    #   ai.ts               エージェントの宣言 API（AgentSpec・AI_DEFAULTS、フェーズ5）
                    #   rooms-demo.ts       4部屋＋AIデモシーン（フェーズ5の機能確認用）
src/bake/           # L2.5: ホスト側ベイク（temple-bake.ts: Lumen HDR 評価＋ACES）
src/pycompat.ts     # Python 意味論ヘルパー（銀行丸め・剰余・range 等）
examples/temple/    # 神殿シーンの sb3 生成 CLI（dist/temple.sb3 を出力）
examples/demo/      # デモの sb3 生成 CLI（dist/demo.sb3 を出力）
examples/rooms/     # 部屋＋AIデモの sb3 生成 CLI（dist/rooms.sb3 を出力）
tests/
  fixtures/python/  # 移植元の正: sb3_builder.py（原典コピー）＋最小シーン生成
  fixtures/         # TS 側の最小シーン生成（Python 版と同一シーン）
  builder.test.ts   # 単体テスト（MD5・ID 規約・mutation 書式・決定性）
  temple.test.ts    # 神殿シーンの構造シグネチャ（4196ブロック/232変数/76リスト/15 proc）
  demo.test.ts      # デモシーンの構造シグネチャ（6411ブロック/345変数/102リスト/21 proc）＋SoA初期値
  physics.test.ts   # 物理パラメータ解決・静止高さ導出・神殿ビルドへのフェーズ3データ混入なしの確認
  rooms.test.ts     # 部屋＋AIデモの構造シグネチャ・隣接行列・部屋幾何カウント・到達可能性の確認
tools/compare.mjs   # Python 版と TS 版の project.json 構造一致を機械比較
tools/validate.mjs  # sb3 構造検証（validate_sb3.py の TS 移植＋拡張チェック）
tools/compare-temple.mjs # 生成 temple.sb3 と原本 hybrid sb3 の等価性比較
benchmarks/         # 研究レポから移した計測基準一式（詳細は benchmarks/README.md）
```

### 神殿シーン（フェーズ1 MVP）

現行 UE5 hybrid（`build_ue5_lumen_hybrid.py`）のデバイスコードとベイクを、境界規約（ホストコード vs デバイスコード）に従って L1/L2/L2.5 に分離移植したもの。数値はすべて現行値の転記で、新規の仕様・数値は導入していない。

```bash
npm run build:temple   # dist/temple.sb3 を生成（dist/ は .gitignore 済み）
npm run verify:temple  # 原本 sb3 との比較＋構造検証（要: 研究レポと distilled の transpile.py）
```

検証結果（原本 `ue5_lumen_hybrid.sb3` との比較）: ブロック 4,196 = 4,196、変数 232 = 232、リスト 76 = 76（初期値すべて数値一致）、プロシージャ 15 = 15、opcode ヒストグラム完全一致。ブロック単位では 4,105 / 4,196 が JSON 完全一致し、残り 91 件は数値リテラルの表記差のみ（`1.0` vs `1`、`1e-05` vs `0.00001` — 下記「既知の移植上の差異」、数値として同一）。distilled の transpile.py を両 sb3 に当てた生成 TS は 8,982 / 8,994 行一致（差分12行はすべてリスト初期値の表記差）、`rt.unimplemented` は両側 0 件。構造検証（validate）は生成・原本とも 0 issues、拡張は `pen` のみ（純 Vanilla Scratch 3.0 で読み込み可能な形）。実機（TurboWarp / Scratch 公式）での起動・目視確認は未実施（ユーザー確認待ち）。

レイヤ構成（L0 ビルダー / L1 エンジンコア / L2 シーン記述 API / L2.5 ベイク / L4 検証）と境界規約の全体設計は、設計書に従う（本レポには設計フェーズで順次反映する）。

## ビルドと検証

```bash
npm install
npm test            # tsc ビルド＋単体テスト＋Python版との構造一致比較
npm run gen:minimal # 最小シーンの sb3 を TS 側だけで生成
```

`tools/compare.mjs` は、同一の最小テストシーン（Stage＋1スプライト、カスタムプロシージャ、変数・リスト、ペン描画を含む）を Python 版 `sb3_builder` と TS 版の両方で生成し、`project.json` の構造一致（ブロック木の opcode・入力・親子関係、変数/リスト、決定的 ID）を機械比較する。zip コンテナのバイト一致は狙わない（タイムスタンプ等の扱いは未決事項）。

既知の移植上の差異: Python の int / float の区別は JS の number では表現できないため、整数値の float（例 `32.0`）を入力リテラルに使うと Python は `"32.0"`、TS は `"32"` と印字する。現行の利用範囲（整数と短い小数）では一致する。

## ライセンス

**CC BY-SA 2.0**（レポ所有者が 2026-11-26 に決定）。LICENSE ファイルにリーガルコード全文を置く。土台となった scratch-ue5-pen-research の UE5 hybrid は Antigravity が作成したもので、本レポはその派生である。

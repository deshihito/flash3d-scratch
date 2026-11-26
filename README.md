# Flash — TSベース 3D エンジン for Scratch Pen（sb3 生成互換）

**Flash** は、純 Vanilla Scratch 3.0 のペン描画だけで 3D 描画を行うための、TypeScript ベースの 3D エンジンである。シーンを TS で記述し、公式 Scratch / TurboWarp の双方でそのまま動く `.sb3` を生成する（TS → sb3 変換互換が必須要件）。

土台は研究レポ **[deshihito/scratch-ue5-pen-research](https://github.com/deshihito/scratch-ue5-pen-research)** の **UE5 hybrid**（`ue5_lumen_hybrid.sb3`）—「ベイク済みラスタライザ＋解析的レイトレのヒーローオブジェクト＋平面反射の二重描画パス」という描画配分で、品質と実用速度を両立させた実証作である。Flash はその方式を引き継ぎ、固定シーンのデモから「シーンを差し替えられるエンジン」へ汎用化する。画質は現行水準を維持し、主眼は**最適化**と**不足コンポーネントの補完**に置く。

## 現在の状態: フェーズ0（ビルダー移植）

| フェーズ | 内容 | 状態 |
|---|---|---|
| 0 | L0 sb3 ビルダー（`sb3_builder.py` の TS 移植）＋構造一致の検証 | ✅ 本レポの現行スコープ |
| 1 | L1 エンジンコア汎用化＋神殿シーン再現（MVP） | 未着手 |
| 2–3 | 最適化（反射 LOD / RT 時間分割 / ペン色キャッシュ ほか） | 未着手 |
| 4 | 不足コンポーネント補完（アニメーション、衝突、テクスチャ等） | 未着手 |

## 構成

```
src/builder/        # L0: sb3 ビルダー（sb3_builder.py の TS 移植）
                    #   index.ts   Expr DSL、決定的 ID 採番、project.json 組立
                    #   pyjson.ts  Python json.dumps 互換シリアライザ
                    #   zip.ts     決定的 ZIP ライタ（固定タイムスタンプ）
tests/
  fixtures/python/  # 移植元の正: sb3_builder.py（原典コピー）＋最小シーン生成
  fixtures/         # TS 側の最小シーン生成（Python 版と同一シーン）
  builder.test.ts   # 単体テスト（MD5・ID 規約・mutation 書式・決定性）
tools/compare.mjs   # Python 版と TS 版の project.json 構造一致を機械比較
benchmarks/         # 研究レポから移した計測基準一式（詳細は benchmarks/README.md）
```

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

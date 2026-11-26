# benchmarks/ — 計測基準（研究レポから移行）

このディレクトリ一式は、研究レポ **[deshihito/scratch-ue5-pen-research](https://github.com/deshihito/scratch-ue5-pen-research)** から移したものである。Flash の最適化フェーズ（フェーズ2以降）で、速度改善の**比較基準（ベースライン）**として使うためにここへ集約した。エンジン本体（`src/`）とは独立しており、ビルド対象には含めない。

## 移したもの

| ファイル | 原典での場所 | 内容 |
|---|---|---|
| `bench_pen_vm.sb3` | `sb3/bench_pen_vm.sb3` | VM & PenSkin 診断ベンチマーク本体（下記7項目＋診断パネル） |
| `build_bench.py` | `build_bench.py` | ベンチ本体の生成元（Python / sb3_builder 使用）。**ソースとして保管するもので、ここでは実行しない** |
| `runner.py` | `runner.py` | Headless Chrome + @turbowarp/scaffolding の実機計測ランナー |
| `scripts/setup.sh` | `scripts/setup.sh` | 計測環境のセットアップ（scaffolding 取得＋Playwright 確認）。`benchmarks/` を基点に動作する（`ROOT_DIR` はこのディレクトリになるよう配置した） |
| `docs/research-report.md` | `docs/REPORT.md` | 技術探索レポート全体。ベンチ実測値（§2.2）と PenSkin の低レベル法則が Flash 最適化の根拠資料になる |
| `images/bench_diag_tw.png` | `images/bench_diag_tw.png` | 診断パネルを TurboWarp で実行したスクリーンショット（基準画） |

## ベンチ項目（bench_pen_vm.sb3 が測るもの）

すべて `warp=true` カスタムブロック内で `days_since_2000 × 86400000`（ms、約0.1ms 精度）により計測し、結果は同名変数に入る。全項目完了で `DONE=1`。

| 変数 | 項目 | 内容 | 研究レポ実測 (TurboWarp / Vanilla) |
|---|---|---|---|
| `MS_MATH_50K` | 算術 + sqrt | 50,000 回ループ（ブロック解釈コストの代表） | 10 ms / 99 ms（9.9×） |
| `MS_LIST_50K` | リスト読み書き | 1,000 要素リストへ 50,000 回 read-modify-write | 8 ms / 88 ms（11.0×） |
| `MS_PEN_DOT_10K` | ペン・ドット描画 | 10,000 回 `goto+color+down+up` | 45 ms / 47 ms |
| `MS_PEN_SCAN_10K` | ペン・連続スキャンライン | 行ごとに penDown 1 回、10,000 px | 26 ms / 32 ms |
| `MS_PEN_SPAN_1K` | ペン・水平 RLE スパン | 1,000 スパン（10,000 px 相当） | 12 ms / 6 ms |
| `MS_PEN_ARGB_5K` | 32-bit ARGB 半透明ドット | 5,000 回（alpha=32） | 14 ms / 20 ms |
| `MS_STAMP_2K` | pen_stamp（参考） | ラジアルグロー SVG を 2,000 回 | 830 ms / 957 ms |

加えて診断パネル `draw_visual_diag` が4象限を描く（左上: size=2 ドット格子の角抜け、右上: 水平セグメント、左下: 連続スキャンラインのキャップ滲み、右下: ARGB 多層 GPU Bloom）。基準画は `images/bench_diag_tw.png`。

**読み取り方（研究レポ §2.2 の知見）**: Vanilla ではペン描画自体は TurboWarp とほぼ同速で、支配的なのはブロック解釈オーバヘッド（10〜20×）。したがって Flash の最適化は「描画回数」ではなく「ブロック実行回数」の削減を主軸にし、その効果測定にこのベンチと、エンジン側テレメトリ（FRAME_MS / RASTER_MS / SPHERE_MS）を併用する。

## 計測手順（runner の使い方）

```bash
# 1. 環境セットアップ（benchmarks/ を基点に vendor/ へ scaffolding を取得）
bash benchmarks/scripts/setup.sh

# 2. ベンチを実行し、変数とスクリーンショットを取得
#    引数: <sb3> <mode> [screenshot.png]
#    mode: vanilla（公式インタプリタ, 30fps）/ turbowarp（コンパイラ, 60fps）/ turbowarp_hq（高解像度ペン）
python3 benchmarks/runner.py benchmarks/bench_pen_vm.sb3 turbowarp benchmarks/out/bench_diag_tw.png
python3 benchmarks/runner.py benchmarks/bench_pen_vm.sb3 vanilla   benchmarks/out/bench_diag_vanilla.png
```

`runner.py` は自ファイルのあるディレクトリ（= `benchmarks/`）を基点に HTTP サーバを立てるため、sb3 は `benchmarks/` 配下のパスで渡すこと。Flash 本体の生成 sb3 の計測も、同じ手順で `dist/` の sb3 を `benchmarks/` 配下へコピーしてから測る（フェーズ1以降の運用）。

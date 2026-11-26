# python/ — 移植元の正（検証用フィクスチャ）

- `sb3_builder.py`: 研究レポ deshihito/scratch-ue5-pen-research の同名ファイルの**無改変コピー**。TS 移植（`src/builder/`）の正解として、構造一致比較の相手にだけ使う。ここにあるからといって本番経路が Python に依存するわけではない。
- `make_minimal.py`: この Python ビルダーで最小テストシーンを生成する。`tests/fixtures/make-minimal.ts` と呼び出し順まで含めて同一シーンになるよう対で保守すること（ブロック ID は構築順で採番されるため、順序がずれると比較が落ちる）。

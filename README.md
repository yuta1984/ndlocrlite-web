# NDLOCR-Lite Web

**ブラウザで動く日本語OCRツール**

本ツールは、国立国会図書館（NDL）が開発・公開している **[NDLOCR-Lite](https://github.com/ndl-lab/ndlocr-lite)**（NDL Lab）を元にして、WebブラウザのみでOCR処理が完結するよう移植・再実装したものです。OCRモデル（レイアウト認識 DEIMv2・文字認識 PARSeq・表構造認識 TableCenterNet）は NDLOCR-Lite v2.0.0 のものを使用しています。

**サイト**: https://ndlocr-liteweb.netlify.app/
**元リポジトリ**: https://github.com/ndl-lab/ndlocr-lite（国立国会図書館）

## 特徴

- **ブラウザ完結** — 画像・OCR結果を外部サーバーに送信しません。すべての処理がブラウザ内で完結します。
- **NDLOCR-Lite v2 準拠** — v2.0.0 のモデルと前処理・後処理（カスケード認識の段上げ、重複領域の抑制など）を移植し、本家 Python 版とほぼ同じ認識結果（テスト画像で文字F値 0.997）を得られます。
- **WebGPU による高速化** — レイアウト認識・表構造認識を WebGPU で実行します（非対応ブラウザでは WebAssembly マルチスレッドに自動で切り替え）。文字認識は複数の Web Worker で並列処理し、複数ページでは次ページのレイアウト認識を先読みします。
- **カスケード文字認識** — 行の文字数に応じて3種類の PARSeq モデルを使い分け、長い行は上位モデルで再認識します。
- **表構造の推定** — 表組を検出してセル構造を推定し、「整形表示」と HTML / Markdown 出力で表として表示します（既定で有効。設定でオフにできます）。
- **異体字の包摂**（設定で有効化） — 旧字体・異体字を新字体に変換して表示・出力します（例: 國→国）。
- **整形表示・多様な出力形式** — 段落ごとの行結合・見出し・表を整形して表示し、テキスト（行ごと / 段落ごと）・Markdown・HTML・JSON / XML（NDLOCR-Lite 互換）でダウンロードできます。
- **PDF・TIFF・HEIC 対応** — 複数ページのPDF / TIFF を一括処理できます。
- **バッチ処理** — 複数の画像ファイルやフォルダをまとめて処理できます。
- **結果のキャッシュ** — IndexedDB にモデルと処理結果（最新100件）を保存し、再利用できます。
- **領域選択** — マウスドラッグで任意の矩形領域を選択し、その範囲だけを認識できます。
- **日英対応** — 日本語・英語のUI切替ができます。

## 使い方

1. **https://ndlocr-liteweb.netlify.app/** をブラウザで開く
2. 左のサイドバーで「ファイルを追加」（またはフォルダ選択・クリップボード・サンプル）から画像を追加する。画面へのドラッグ＆ドロップや Ctrl+V でも追加できます
3. 「② 認識を開始」を押すと、未処理の画像を順に認識します（初回はONNXモデル計約157MBを自動ダウンロードし、IndexedDBにキャッシュ。表を含む画像では初回のみ表構造モデル約28MBを追加取得）
4. サイドバーの一覧で画像を選ぶと、中央に資料画像、右に認識テキストが表示されます（↑↓キーでも切り替え可）。画像とテキストの境界はドラッグで調整できます
5. 「行ごと / 整形表示」で表示を切り替え、形式を選んで「コピー」「ダウンロード」。サイドバー下部の「すべてダウンロード」で全画像の結果をまとめて保存

- 画像上をドラッグすると、その範囲だけを認識できます（未認識の画像でも可）
- 一覧の「⋯」から、画像ごとの再認識・削除ができます
- スマートフォンでは「画像 / テキスト」をタブで切り替え、☰ から画像一覧を開きます
- ⚙️ 設定画面では、異体字の包摂の有効化、表構造推定のオン・オフ、WebGPU の無効化、文字認識スレッド数の変更ができます

### 対応ファイル形式

| 形式      | 説明                                                   |
| --------- | ------------------------------------------------------ |
| JPEG/PNG  | 一般的な画像ファイル                                   |
| TIFF      | 複数ページ対応                                         |
| HEIC/HEIF | iPhone 等で撮影した画像                                |
| PDF       | 複数ページ対応（各ページを 2倍スケールでレンダリング） |

### 出力形式

| 形式                 | 内容                                                                       |
| -------------------- | -------------------------------------------------------------------------- |
| テキスト（行ごと）   | 認識した行を読み順に改行区切りで出力                                       |
| テキスト（段落ごと） | 同じ本文ブロックの行を1段落に結合（欧文の単語間にのみ空白を補う）         |
| Markdown             | 段落・見出し（タイトル行）・表（表構造推定が有効な場合）                   |
| HTML                 | Markdown と同じ構造の HTML 文書（表は `<table>`）                          |
| JSON / XML           | NDLOCR-Lite（Python 版）と同じ構造。行座標・信頼度・レイアウト種別を含む |

## 技術情報

### 使用モデル（NDLOCR-Lite v2.0.0）

| モデル         | ファイル                                          | サイズ | 用途                                      |
| -------------- | ------------------------------------------------- | ------ | ----------------------------------------- |
| DEIMv2         | `deim-s-1024x1024-261124.onnx`                    | 40MB   | レイアウト認識（入力 800×800）            |
| PARSeq-30      | `parseq-ndl-24x256-30-tiny-499epoch-261124.onnx`  | 37MB   | 文字認識（≤30文字行、入力 24×256）        |
| PARSeq-50      | `parseq-ndl-24x384-50-tiny-278epoch-261124.onnx`  | 38MB   | 文字認識（≤50文字行、入力 24×384）        |
| PARSeq-100     | `parseq-ndl-24x768-100-tiny-153epoch-261124.onnx` | 43MB   | 文字認識（≤100文字行、入力 24×768）       |
| TableCenterNet | `tablecenternet_s_800_v3.onnx`                    | 28MB   | 表構造認識（表構造推定を有効にした場合のみ） |

モデルの配布元は `https://lab.ndl.go.jp/dataset/ndlocr-lite/onnx/v2/` ですが、CORS に対応していないため、本ツールは現在、本家リポジトリ `2.0.0` タグの GitHub raw（`https://raw.githubusercontent.com/ndl-lab/ndlocr-lite/2.0.0/src/model`）から取得しています（`.env` の `VITE_MODEL_BASE_URL` で変更可。Cloudflare R2 へ移行予定）。ダウンロードしたモデルは本家公表の SHA-256 と照合してからキャッシュします。

### 技術スタック

| 要素             | 技術                                                                                |
| ---------------- | ----------------------------------------------------------------------------------- |
| フレームワーク   | Vite + React 19 + TypeScript                                                        |
| OCRランタイム    | onnxruntime-web 1.31（レイアウト・表: WebGPU / WASM、文字認識: WASM）               |
| PDF処理          | pdfjs-dist                                                                          |
| OCR処理          | Web Worker（レイアウト認識用 1 + 文字認識用プール）                                 |
| モデルキャッシュ | IndexedDB                                                                           |
| テスト           | Vitest（単体テスト + 本家 Python 版の出力と比較する統合テスト）                     |
| デプロイ         | Netlify（COOP/COEP ヘッダー対応）                                                   |

### OCR処理フロー

```
入力ファイル（JPG/PNG/TIFF/HEIC/PDF）
  ↓ imageLoader / pdfLoader → ImageData
  ↓ ocr.worker（WebGPU、非対応なら WASM マルチスレッド）
  1. DEIMv2 レイアウト認識
     → テキスト行の矩形 + 文字数カテゴリ、本文ブロック、表領域
     （複数ページでは、前ページの文字認識中に次ページを先読み）
  ↓ recognition.worker × N（WASM、並列）
  2. カスケード文字認識（PARSeq × 3モデル）
     → カテゴリ3 → PARSeq-30（結果が25文字以上なら PARSeq-50 で再認識）
     → カテゴリ2 → PARSeq-50（結果が45文字以上なら PARSeq-100 で再認識）
     → その他   → PARSeq-100（98文字以上の横長行は左右に分割して再認識）
  3. 読み順ソート（XY-Cut、縦書き右→左）
  ↓ ocr.worker（表構造推定を有効にした場合）
  4. TableCenterNet 表構造認識 → セルに行テキストを割り当て
  ↓ メインスレッド
  結果表示（行ごと / 整形表示）+ IndexedDB保存
```

性能の目安（Apple M系 Mac / Chrome、本文25行の画像）: 1ページ約2秒、4ページ連続で約8.6秒（v1 系の旧実装では1ページ約4.6秒）。

## ローカル開発

```bash
# 依存関係インストール
npm install

# モデルをローカルに配置（初回のみ）
mkdir -p public/models/v2
for f in deim-s-1024x1024-261124.onnx parseq-ndl-24x256-30-tiny-499epoch-261124.onnx \
         parseq-ndl-24x384-50-tiny-278epoch-261124.onnx parseq-ndl-24x768-100-tiny-153epoch-261124.onnx \
         tablecenternet_s_800_v3.onnx; do
  curl -L -o public/models/v2/$f https://lab.ndl.go.jp/dataset/ndlocr-lite/onnx/v2/$f
done
echo 'VITE_MODEL_BASE_URL=/models/v2' > .env.local

# 開発サーバー起動
npm run dev

# テスト
npm test                   # 単体テスト
npm run test:integration   # 統合テスト（public/models/v2 のモデルを使用。本家 v2 の出力と比較）

# ビルド
npm run build
```

> **Note**: COOP/COEP ヘッダーが必要なため、`npm run dev` で起動した開発サーバーで動作確認してください。単純なファイル開き（`file://`）では動作しません。本番用の R2 は localhost からの CORS を許可していないため、開発時は上記のようにモデルをローカル配信します。
>
> URL に `?workers=0` を付けるとモバイルと同じ単一 Worker モード、`?workers=N` で文字認識 Worker 数を指定して動作確認できます。

## 注意事項

- 初回起動時に約 **157MB** のONNXモデルをダウンロードします（2回目以降はキャッシュから読み込み）
- 処理時間はハードウェア性能に依存します。WebGPU 対応ブラウザ（Chrome / Edge / Safari 26 以降など）で高速に動作します
- 対応ブラウザ: WebAssembly・IndexedDB・Web Worker に対応した最新ブラウザ（Chrome/Firefox/Safari/Edge 推奨）

## 帰属・クレジット

本ツールは **[NDLOCR-Lite](https://github.com/ndl-lab/ndlocr-lite)**（国立国会図書館 NDL Lab）の派生物です。レイアウト認識モデル（DEIMv2）・文字認識モデル（PARSeq）・表構造認識モデル（TableCenterNet）・文字セット・異体字対応表・推論アルゴリズムは NDLOCR-Lite に帰属します。

レイアウト認識モデルのバックボーンには DINOv3 を蒸留した ViT-Tiny モデルが使われているため、[DINOv3 ライセンス](https://github.com/facebookresearch/dinov3/blob/main/LICENSE.md)についても遵守が必要です。

- **NDLOCR-Lite**: [ndl-lab/ndlocr-lite](https://github.com/ndl-lab/ndlocr-lite)（国立国会図書館）
- DEIMv2: [ShihuaHuang95/DEIM](https://github.com/ShihuaHuang95/DEIM)
- PARSeq: [baudm/parseq](https://github.com/baudm/parseq)
- TableCenterNet: Anyi Xiao and Cihui Yang, arXiv:2504.17522
- 文字セット（NDLmoji.yaml）: 国立国会図書館
- 異体字対応表（character_inclusion_mapping.csv）: 国立国会図書館（[tugidigi-web](https://github.com/ndl-lab/tugidigi-web) jd_book.json）
- サンプル2（public/samples/digidepo_3048008_0025.jpg）・テスト用画像（tests/fixtures/images、kumonoito.png を除く）: NDLOCR-Lite リポジトリ同梱のサンプル画像（国立国会図書館デジタルコレクション）

## 作成者

橋本雄太（国立歴史民俗博物館 / 国立国会図書館 非常勤調査員）

- GitHub: [yuta1984/ndlocrlite-web](https://github.com/yuta1984/ndlocrlite-web)

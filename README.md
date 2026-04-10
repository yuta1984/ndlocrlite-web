# Web OCR

**ブラウザで動く多言語OCRツール**

[PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) の PP-OCRv5 モデル（テキスト検出 DB + 文字認識 SVTR）を ONNX Runtime Web で動作させ、Webブラウザのみで OCR 処理が完結するツールです。画像や OCR 結果は外部に送信されません。

## 特徴

- **ブラウザ完結** — 画像・OCR結果を外部サーバーに送信しません。すべての処理がブラウザ内で完結します。
- **多言語対応** — 中国語/日本語、英語、韓国語、ラテン文字の OCR に対応。設定画面から切り替え可能です。
- **4言語 UI** — 日本語・英語・中文・한국어のUI表示に対応しています。
- **PDF対応** — 複数ページのPDFを一括処理できます。
- **バッチ処理** — 複数の画像ファイルやフォルダをまとめて処理できます。
- **結果のキャッシュ** — IndexedDB にモデルと処理結果（最新100件）を保存し、再利用できます。
- **領域選択** — マウスドラッグで任意の矩形領域を選択し、テキストを確認できます。
- **クリップボード貼り付け** — Ctrl+V で画像を直接読み込めます。

## 使い方

1. ブラウザでサイトを開く
2. 初回起動時に ONNX モデルを自動ダウンロード・IndexedDB にキャッシュ
3. 画像（JPG/PNG/TIFF/HEIC）またはPDFをドラッグ&ドロップするか、クリックして選択
4. OCR処理が完了するとテキストが表示される
5. 「コピー」「ダウンロード」ボタンでテキストを出力

## 技術情報

### 使用モデル（PaddleOCR PP-OCRv5）

| モデル | 用途 | 配信元 |
|--------|------|--------|
| DB テキスト検出 | テキスト行の矩形検出 | HuggingFace (monkt/paddleocr-onnx) |
| SVTR 文字認識（中国語/日本語） | CJK 文字認識 | HuggingFace (monkt/paddleocr-onnx) |
| SVTR 文字認識（英語） | 英語文字認識 | HuggingFace (monkt/paddleocr-onnx) |
| SVTR 文字認識（韓国語） | 韓国語文字認識 | HuggingFace (monkt/paddleocr-onnx) |

### 技術スタック

| 要素 | 技術 |
|------|------|
| フレームワーク | Vite + React 19 + TypeScript |
| OCRランタイム | onnxruntime-web（WASM CPU バックエンド） |
| PDF処理 | pdfjs-dist |
| OCR処理 | Web Worker（UIをブロックしない非同期処理） |
| モデルキャッシュ | IndexedDB |
| デプロイ | Netlify（COOP/COEP ヘッダー対応） |

### OCR処理フロー

```
入力ファイル（JPG/PNG/TIFF/HEIC/PDF）
  ↓ imageLoader / pdfLoader → ImageData
  ↓ Web Worker
  1. DB テキスト検出（limit_side_len=960, ImageNet正規化）
     → テキスト行の矩形領域を取得
  2. SVTR 文字認識（高さ48px固定, PaddleOCR正規化 mean=0.5/std=0.5）
     → CTC Greedy Decode → テキスト出力
  3. 読み順ソート（XY-Cut アルゴリズム）
  ↓ メインスレッド
  結果表示 + IndexedDB保存
```

## ローカル開発

```bash
# 依存関係インストール
npm install

# 開発サーバー起動
npm run dev

# ビルド
npm run build
```

> **Note**: COOP/COEP ヘッダーが必要なため、`npm run dev` で起動した開発サーバーで動作確認してください。

## 注意事項

- 初回起動時に ONNX モデルをダウンロードします（2回目以降はキャッシュから読み込み）
- 処理時間はハードウェア性能に依存します（CPU推論のため、1枚あたり数十秒かかる場合があります）
- 対応ブラウザ: WebAssembly・IndexedDB・Web Worker に対応した最新ブラウザ（Chrome/Firefox/Safari/Edge 推奨）

## クレジット

- **PaddleOCR**: [PaddlePaddle/PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR)（百度）
- **ONNX モデル配信**: [monkt/paddleocr-onnx](https://huggingface.co/monkt/paddleocr-onnx)（HuggingFace）

## 作成者

橋本雄太（国立歴史民俗博物館 / 国立国会図書館 非常勤調査員）

# API・型定義一覧

> 最終更新: 2026-04-10

## 概要

本プロジェクトは `src/types/` に4ファイルの型定義を持ち、OCR パイプラインの入出力・Worker メッセージプロトコル・IndexedDB スキーマを型安全に定義しています。TypeScript strict mode で運用されています。

## コア型定義

### OCR 基本型 (`types/ocr.ts`)

```mermaid
classDiagram
    class OCRLanguage {
        <<union>>
        "chinese" | "english" | "korean" | "latin"
    }

    class TextRegion {
        +number x
        +number y
        +number width
        +number height
        +number confidence
    }

    class TextBlock {
        +number x
        +number y
        +number width
        +number height
        +number confidence
        +string text
        +number readingOrder
    }

    class OCRResult {
        +string id
        +string fileName
        +TextBlock[] textBlocks
        +string fullText
        +number processingTimeMs
        +Date createdAt
        +PageBlock[]? pageBlocks
    }

    class LayoutDetectionResult {
        +TextRegion[] lines
        +TextRegion[] blocks
    }

    class BoundingBox {
        +number x
        +number y
        +number width
        +number height
    }

    TextRegion --|> BoundingBox : extends
    TextBlock --|> TextRegion : extends
    OCRResult *-- TextBlock : contains
```

### Worker メッセージプロトコル

```mermaid
graph LR
    subgraph "Main → OCR Worker"
        WIM["WorkerInMessage"]
        WIM_INIT["INITIALIZE<br/>{language}"]
        WIM_PROC["OCR_PROCESS<br/>{id, imageData,<br/>width, height}"]
        WIM_LAYOUT["LAYOUT_DETECT<br/>{id, imageData,<br/>width, height}"]
        WIM_TERM["TERMINATE"]
    end

    subgraph "OCR Worker → Main"
        WOM["WorkerOutMessage"]
        WOM_PROG["OCR_PROGRESS<br/>{stage, progress}"]
        WOM_COMP["OCR_COMPLETE<br/>{id, textBlocks,<br/>fullText}"]
        WOM_LAYOUT["LAYOUT_DONE<br/>{id, textRegions,<br/>croppedImages}"]
        WOM_ERR["OCR_ERROR<br/>{error}"]
    end

    subgraph "Main → Rec Worker"
        RIM["RecWorkerInMessage"]
        RIM_INIT["REC_INIT<br/>{language}"]
        RIM_PROC["REC_PROCESS<br/>{jobs[]}"]
        RIM_TERM["REC_TERMINATE"]
    end

    subgraph "Rec Worker → Main"
        ROM["RecWorkerOutMessage"]
        ROM_READY["REC_READY"]
        ROM_PROG["REC_PROGRESS<br/>{progress}"]
        ROM_COMP["REC_COMPLETE<br/>{results[]}"]
        ROM_ERR["REC_ERROR<br/>{error}"]
    end

    WIM --> WIM_INIT
    WIM --> WIM_PROC
    WIM --> WIM_LAYOUT
    WIM --> WIM_TERM

    WOM --> WOM_PROG
    WOM --> WOM_COMP
    WOM --> WOM_LAYOUT
    WOM --> WOM_ERR

    RIM --> RIM_INIT
    RIM --> RIM_PROC
    RIM --> RIM_TERM

    ROM --> ROM_READY
    ROM --> ROM_PROG
    ROM --> ROM_COMP
    ROM --> ROM_ERR
```

### IndexedDB スキーマ (`types/db.ts`)

| ストア | キー | インデックス | フィールド |
|--------|------|-------------|-----------|
| `models` | `name` | — | `name`, `data` (ArrayBuffer), `version` |
| `results` | `id` (UUID) | `by_createdAt` | `id`, `files[]`, `createdAt` |

`files[]` の各要素:
- `fileName`: ファイル名
- `imageDataUrl`: サムネイル (base64)
- `textBlocks`: TextBlock[]
- `fullText`: 結合テキスト

## 主要クラス

### LayoutDetector

レイアウト検出エンジン。PaddleOCR DB モデルを使用。

| メソッド | 入力 | 出力 |
|---------|------|------|
| `initialize(language)` | OCRLanguage | void |
| `detect(imageData, width, height)` | ImageData | LayoutDetectionResult |

前処理仕様:
- リサイズ: `limit_side_len(960)`, 32倍数パディング
- 正規化: ImageNet (mean=[0.485,0.456,0.406], std=[0.229,0.224,0.225])
- テンソル形状: `[1, 3, H, W]` (RGB, NCHW)

### TextRecognizer

文字認識エンジン。PaddleOCR SVTR + CTC デコード。

| メソッド | 入力 | 出力 |
|---------|------|------|
| `initialize(language)` | OCRLanguage | void |
| `recognize(imageData, width, height)` | ImageData (クロップ) | { text, confidence } |

前処理仕様:
- リサイズ: 高さ48px固定、幅8倍数
- 正規化: PaddleOCR (mean=[0.5,0.5,0.5], std=[0.5,0.5,0.5])
- テンソル形状: `[1, 3, 48, W]` (RGB, NCHW)

### ReadingOrderProcessor

読み順推定。XY-Cut 再帰分割アルゴリズム。

| メソッド | 入力 | 出力 |
|---------|------|------|
| `process(textBlocks)` | TextBlock[] | TextBlock[] (readingOrder 付与) |

## Hooks インターフェース

### useOCRWorker(language)

| 返り値 | 型 | 説明 |
|--------|-----|------|
| `isReady` | boolean | Worker 初期化完了 |
| `jobState` | object | 進捗情報 |
| `processImage(img)` | function | 画像 OCR 実行 |
| `processRegion(...)` | function | 領域選択 OCR |

### useFileProcessor()

| 返り値 | 型 | 説明 |
|--------|-----|------|
| `processedImages` | ProcessedImage[] | 変換済み画像リスト |
| `processFiles(files)` | function | ファイル変換実行 |

### useResultCache()

| 返り値 | 型 | 説明 |
|--------|-----|------|
| `runs` | DBRunEntry[] | 履歴一覧 |
| `saveRun(result)` | function | 結果保存 |

## 発見・懸念事項

- **ModelProgress 型**: `{det, rec}` の2モデル想定。言語別に複数 rec_* がある場合の進捗報告方法が不明確
- **Worker メッセージ ID**: `id` が optional のため、複数ジョブ同時投入時の帰属判定が複雑
- **Transferable 指定**: processRegion での `imageData.data.buffer` は明示的に transfer リストに含める必要あり
- **キャッシュ無効化**: `MODEL_VERSION` 更新で models ストアが全削除されるが、results ストアは保持される

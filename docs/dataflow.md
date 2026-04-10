# データフロー・処理パイプライン

> 最終更新: 2026-04-10

## 概要

ユーザーがアップロードした画像/PDF は、メインスレッドで ImageData に変換された後、Web Worker パイプラインで OCR 処理されます。デスクトップではレイアウト検出と文字認識を分離し、N本の認識Workerで並列処理します。モバイルでは単一Workerで逐次処理します。

## 全体フロー

```mermaid
graph TD
    A["📁 ファイルアップロード<br/>JPG/PNG/TIFF/HEIC/PDF"] --> B["useFileProcessor<br/>ImageData[] 変換"]
    B --> C["✅ OCR開始ボタン"]
    C --> D{"モバイル判定"}
    D -->|YES| E["OCR_PROCESS<br/>逐次認識<br/>(ocr.worker)"]
    D -->|NO| F["LAYOUT_DETECT<br/>DB検出モデル推論"]
    F --> G["DB後処理<br/>TextRegion[] +<br/>croppedImages[]"]
    G --> H["LAYOUT_DONE<br/>メインスレッド受信"]
    H --> I["Round-Robin 分割<br/>N個Worker へ配信"]
    I --> J["REC_PROCESS ×N<br/>並列認識"]
    J --> K["REC_COMPLETE<br/>結果集約"]
    E --> L["OCR_COMPLETE"]
    K --> L
    L --> M["ReadingOrderProcessor<br/>XY-Cut 読み順ソート"]
    M --> N["OCRResult 生成"]
    N --> O["IndexedDB saveRun<br/>履歴保存 (最大100件)"]
    O --> P["UI表示<br/>ResultPanel +<br/>ImageViewer"]
```

## Worker 通信シーケンス（デスクトップフロー）

```mermaid
sequenceDiagram
    participant Main as メインスレッド<br/>(React)
    participant OcrW as OCR Worker<br/>(ocr.worker.ts)
    participant RecW as Recognition<br/>Worker ×N

    Main->>OcrW: INITIALIZE { language }
    OcrW->>OcrW: det/rec モデルDL<br/>IndexedDB キャッシュ確認
    OcrW-->>Main: OCR_PROGRESS (initialized)

    Main->>Main: processFiles()<br/>ImageData[] 準備

    loop 各画像
        Main->>OcrW: LAYOUT_DETECT { id, imageData }
        OcrW->>OcrW: 前処理 → [1,3,H,W] テンソル
        OcrW->>OcrW: det 推論 → 確率マップ
        OcrW->>OcrW: DB後処理 → TextRegion[] + crop
        OcrW-->>Main: LAYOUT_DONE { textRegions, croppedImages }

        Main->>Main: Round-robin 分割

        par 並列認識
            Main->>RecW: REC_PROCESS { jobs[] }
            RecW->>RecW: 認識推論 + CTC decode
            RecW-->>Main: REC_COMPLETE { results[] }
        end

        Main->>Main: 結果集約 + XY-Cut
        Main->>Main: OCRResult 生成 → IndexedDB
    end
```

## OCR処理パイプライン（ステップ詳細）

```mermaid
graph LR
    S1["入力画像<br/>ImageData"]
    S2["検出前処理<br/>limit_side 960<br/>32倍数 pad<br/>ImageNet正規化<br/>→[1,3,H,W]"]
    S3["検出推論<br/>PaddleOCR DB<br/>→[1,1,H,W]<br/>確率マップ"]
    S4["DB後処理<br/>二値化(0.3)<br/>findContours<br/>box_thresh(0.6)<br/>unclip(1.5)<br/>→TextRegion[]"]
    S5["クロップ<br/>OffscreenCanvas<br/>→ImageData[]"]
    S6["認識前処理<br/>高さ48px<br/>PaddleOCR正規化<br/>→[1,3,48,W]"]
    S7["認識推論<br/>SVTR/CRNN<br/>→[1,seq,vocab]"]
    S8["CTC decode<br/>argmax→<br/>重複除去→<br/>blank除去→<br/>辞書MAP"]
    S9["読み順<br/>XY-Cut<br/>readingOrder"]
    S10["出力<br/>TextBlock[]<br/>+ fullText"]

    S1-->S2-->S3-->S4-->S5
    S5-->S6-->S7-->S8
    S8-->S9-->S10
```

## React Hook 連携

```mermaid
graph TD
    App["App.tsx<br/>state: sessionResults,<br/>ocrLanguage, isProcessing"]

    UFP["useFileProcessor<br/>processFiles → ProcessedImage[]"]
    UOCR["useOCRWorker<br/>processImage / processRegion<br/>jobState / progressUpdate"]
    URC["useResultCache<br/>saveRun / loadRuns<br/>IndexedDB 履歴"]
    UI18N["useI18n<br/>lang / t() translator"]

    App -->|"files"| UFP
    UFP -->|"ProcessedImage[]"| App
    App -->|"processImage"| UOCR
    UOCR -->|"progressUpdate"| App
    UOCR -->|"OCRResult"| App
    App -->|"saveRun"| URC
    URC -->|"runs[]"| App
    App -->|"setLanguage"| UI18N
    UI18N -->|"lang, t()"| App
```

## IndexedDB キャッシュ構造

```mermaid
graph LR
    subgraph IDB["IndexedDB: NDLOCRLiteDB v2"]
        Models["models ストア<br/>keyPath: name<br/><br/>det / rec_chinese /<br/>rec_english / rec_korean /<br/>rec_latin<br/><br/>{name, data, version}"]
        Results["results ストア<br/>keyPath: id (UUID)<br/>index: by_createdAt<br/><br/>DBRunEntry {<br/>  id, files[], createdAt<br/>}<br/><br/>最大100件"]
    end

    ML["model-loader.ts"] -->|"getModelFromCache<br/>saveModelToCache"| Models
    URC2["useResultCache"] -->|"saveRun<br/>getAllRuns"| Results
```

## 重要な技術的特性

| 特性 | 詳細 |
|------|------|
| **Transferable 転送** | croppedImageData の ArrayBuffer を Transferable でゼロコピー転送 |
| **動的テンソル形状** | 認識モデル入力幅が可変（高さ48px固定、幅8倍数） |
| **言語切替** | language 変更時に全 Worker を再初期化（コスト大） |
| **Round-Robin** | 認識バッチを N 個の Worker に均等分配 |

## 発見・懸念事項

- **正規化の違い**: 検出モデルは ImageNet 正規化、認識モデルは PaddleOCR 正規化（mean/std=0.5）。混同すると CJK 文字認識が全滅する
- **言語切替コスト**: ocrLanguage 変更時に OCR Worker + N 個 RecWorker が全て再初期化される
- **Round-Robin の最適性**: CPU コア数より少ない Worker 数で均等分割のため、最適化の余地あり
- **履歴上限**: 100件で自動削除 → 大規模セッションでは早期に古い結果が失われる

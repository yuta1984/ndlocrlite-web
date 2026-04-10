# 画面構成・UIフロー

> 最終更新: 2026-04-10

## 概要

NDLOCR-Lite Web は単一ページアプリケーション（SPA）で、App.tsx の状態に応じて Upload → Pending → Processing → Results の4画面を切り替えます。モーダルとして SettingsModal, HistoryPanel, RegionOCRDialog が重畳表示されます。レスポンシブデザインで Desktop/Tablet/Mobile に対応しています。

## 画面遷移図

```mermaid
stateDiagram-v2
    [*] --> Upload

    Upload --> Pending : ファイル選択 / ペースト
    Pending --> Processing : "開始" クリック
    Processing --> Results : OCR 完了
    Results --> Upload : "新規処理"
    Upload --> Upload : サンプル画像 / Ctrl+V

    state Results {
        [*] --> FileNavigation
        FileNavigation --> FileNavigation : ← / → ページ切替
        FileNavigation --> RegionOCR : ドラッグ領域選択
        RegionOCR --> FileNavigation : 閉じる
    }

    Results --> HistoryModal : 📋 クリック
    HistoryModal --> Results : 閉じる / 履歴選択

    Upload --> SettingsModal : ⚙ クリック
    Pending --> SettingsModal : ⚙ クリック
    Results --> SettingsModal : ⚙ クリック
    SettingsModal --> Upload : 閉じる
    SettingsModal --> Pending : 閉じる
    SettingsModal --> Results : 閉じる
```

## コンポーネントツリー

```mermaid
graph TD
    App["App.tsx"]

    App --> Header["Header<br/>言語セレクタ / ⚙設定 / 📋履歴"]
    App --> Main["Main (状態別表示)"]
    App --> Footer["Footer<br/>プライバシー説明 / クレジット"]

    Main --> Upload["Upload 画面"]
    Main --> Pending["Pending 画面"]
    Main --> Processing["Processing 画面"]
    Main --> ResultsView["Results 画面"]

    Upload --> FDZ["FileDropZone<br/>ドラッグ&ドロップ<br/>クリック選択"]
    Upload --> DP["DirectoryPicker<br/>フォルダ一括選択"]

    Pending --> IV1["ImageViewer<br/>プレビュー表示"]
    Pending --> PB1["ProgressBar<br/>ファイル読込進捗"]

    Processing --> PB2["ProgressBar<br/>モデルDL + OCR進捗"]

    ResultsView --> Sidebar["Sidebar<br/>ファイルサムネイル一覧"]
    ResultsView --> PageNav["PageNav<br/>← prev / select / next →"]
    ResultsView --> ResultMain["ResultMain"]

    ResultMain --> IV2["ImageViewer<br/>TextBlock<br/>オーバーレイ表示"]
    ResultMain --> RP["ResultPanel<br/>テキスト表示"]
    ResultMain --> RA["ResultActions<br/>コピー / ダウンロード"]

    App --> SM["SettingsModal<br/>言語 / OCR言語 /<br/>キャッシュクリア"]
    App --> HP["HistoryPanel<br/>過去100件表示"]
    App --> ROD["RegionOCRDialog<br/>領域選択OCR結果"]

    style Upload fill:#e3f2fd
    style Pending fill:#fff3e0
    style Processing fill:#fff9c4
    style ResultsView fill:#e8f5e9
```

## 画面詳細

### Upload 画面

```
┌──────────────────────────────────────┐
│ Header [言語▼] [⚙] [📋]            │
├──────────────────────────────────────┤
│                                      │
│    ┌─────────────────────────┐       │
│    │   📁 ドラッグ&ドロップ   │       │
│    │   または クリック        │       │
│    │   Ctrl+V で貼り付け     │       │
│    └─────────────────────────┘       │
│                                      │
│    [📂 フォルダ選択]                  │
│    [🖼 サンプル画像を試す]            │
│                                      │
├──────────────────────────────────────┤
│ Footer                               │
└──────────────────────────────────────┘
```

対応形式: JPG, PNG, TIFF, HEIC, PDF（複数ページ）

### Results 画面 (Desktop)

```
┌──────────────────────────────────────────┐
│ Header [言語▼] [⚙] [📋]                │
├────────┬─────────────────────────────────┤
│ Side   │ ← Page 1/5 →                   │
│ bar    ├─────────────┬───────────────────┤
│        │             │ OCR結果テキスト    │
│ 📄 1  │   画像      │                   │
│ 📄 2  │   ビューア  │ [✓ファイル名含む] │
│ 📄 3  │   (TextBlock│ [✓改行無視]       │
│ 📄 4  │    overlay) │                   │
│ 📄 5  │             │ [📋コピー]        │
│        │             │ [💾DL(現在)]      │
│        │             │ [💾DL(全体)]      │
├────────┴─────────────┴───────────────────┤
│ Footer                                    │
└──────────────────────────────────────────┘
```

- ImageViewer: TextBlock 矩形をオーバーレイ表示、クリックで該当テキストのハイライト
- マウスドラッグ: 任意領域を選択 → RegionOCRDialog で即時OCR

### RegionOCRDialog (モーダル)

```
┌──────────────────────┐
│ 領域OCR結果            │
├──────────────────────┤
│ [選択領域のプレビュー] │
│                       │
│ ┌───────────────────┐ │
│ │ 認識テキスト       │ │
│ │ (textarea)        │ │
│ └───────────────────┘ │
│ [📋コピー] [✕閉じる] │
└──────────────────────┘
```

## レスポンシブレイアウト

```mermaid
graph LR
    subgraph Desktop["Desktop (≥900px)"]
        D_Grid["Grid: 160px | 1fr"]
        D_Side["Sidebar<br/>(サムネイル)"]
        D_Main["Main Content<br/>(画像 + テキスト 横並び)"]
    end

    subgraph Tablet["Tablet (768-900px)"]
        T_Grid["Grid: 1列"]
        T_Scroll["横スクロール<br/>サムネイル"]
        T_Main2["Main Content"]
    end

    subgraph Mobile["Mobile (<768px)"]
        M_Col["Flex: 縦1列"]
        M_Thumb["サムネイル横スクロール"]
        M_Toggle["画像/テキスト切替"]
    end
```

## i18n（多言語対応）

| 言語 | ファイル | localStorage キー |
|------|---------|------------------|
| 日本語 | `i18n/ja.ts` | `ndlocr-lite-lang` |
| English | `i18n/en.ts` | |
| 中文 | `i18n/zh.ts` | |
| 한국어 | `i18n/ko.ts` | |

実装方式:
- `createTranslator(lang)` で翻訳関数 `t()` を生成
- ネスト記法: `t("upload.dropzone")` → `obj.upload.dropzone`
- 各コンポーネントが `t()` を直接呼び出し
- 言語選択は localStorage に永続化

## 発見・懸念事項

- **モーダルの積層管理**: HistoryPanel, SettingsModal, RegionOCRDialog は overlay 表示だが、複数同時表示の制御が明示的でない
- **App.tsx の state 過多**: sessionResults, selectedResultIndex, showHistory, showSettings 等、多数の state が集中している
- **Pending vs Results での ImageViewer**: 同一コンポーネントだが props の使い分けが暗黙的
- **クリップボードペースト**: Upload 画面表示中のみ有効、処理中は自動無効化

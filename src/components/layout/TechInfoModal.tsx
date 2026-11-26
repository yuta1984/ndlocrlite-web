import { useEffect, useState } from 'react'

interface TechInfoModalProps {
  lang: 'ja' | 'en'
  onClose: () => void
  backend: 'webgpu' | 'wasm' | null
  recWorkerCount: number
}

const link = (href: string, text: string) => (
  <a href={href} target="_blank" rel="noopener noreferrer">{text}</a>
)

/** 「技術情報」: 実装の仕組みとパフォーマンス（計測値）、このブラウザでの実行状態 */
export function TechInfoModal({ lang, onClose, backend, recWorkerCount }: TechInfoModalProps) {
  const ja = lang === 'ja'
  const hasGpuApi = 'gpu' in navigator
  const [webgpu, setWebgpu] = useState<boolean | null>(hasGpuApi ? null : false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu
    if (!gpu) return
    gpu.requestAdapter().then((a) => setWebgpu(!!a)).catch(() => setWebgpu(false))
  }, [])

  const yesNo = (v: boolean | null) => (v === null ? '…' : v ? (ja ? 'あり' : 'Yes') : (ja ? 'なし' : 'No'))
  const backendLabel = backend === 'webgpu' ? 'WebGPU' : backend === 'wasm' ? 'WebAssembly (CPU)' : (ja ? '初期化中…' : 'Initializing…')

  return (
    <div className="panel-overlay" onClick={onClose}>
      <div className="panel tech-panel" role="dialog" aria-modal="true" aria-labelledby="tech-title" onClick={(e) => e.stopPropagation()}>
        <div className="panel-header">
          <h2 id="tech-title">{ja ? '技術情報' : 'Technical Information'}</h2>
          <button className="btn-close" onClick={onClose} aria-label={ja ? '閉じる' : 'Close'}>✕</button>
        </div>
        <div className="panel-body tech-body">
          {ja ? <TechJa /> : <TechEn />}

          <section>
            <h3>{ja ? 'このブラウザでの実行状態' : 'Runtime in this browser'}</h3>
            <table className="tech-table">
              <tbody>
                <tr><th>{ja ? 'レイアウト・表構造認識' : 'Layout / table recognition'}</th><td>{backendLabel}</td></tr>
                <tr><th>{ja ? '文字認識スレッド数' : 'Recognition threads'}</th><td>{recWorkerCount === 0 ? (ja ? '1（省メモリモード）' : '1 (low-memory mode)') : recWorkerCount}</td></tr>
                <tr><th>{ja ? 'WebGPU 対応' : 'WebGPU available'}</th><td>{yesNo(webgpu)}</td></tr>
                <tr><th>{ja ? 'マルチスレッド（SharedArrayBuffer）' : 'Multithreading (SharedArrayBuffer)'}</th><td>{yesNo(self.crossOriginIsolated)}</td></tr>
                <tr><th>{ja ? 'CPU 論理コア数' : 'Logical CPU cores'}</th><td>{navigator.hardwareConcurrency ?? '—'}</td></tr>
              </tbody>
            </table>
          </section>
        </div>
      </div>
    </div>
  )
}

function TechJa() {
  return (
    <>
      <section>
        <h3>概要</h3>
        <p>
          国立国会図書館の {link('https://github.com/ndl-lab/ndlocr-lite', 'NDLOCR-Lite')} v2.0.0（Python）の推論処理を TypeScript で再実装し、
          {link('https://onnxruntime.ai/docs/tutorials/web/', 'ONNX Runtime Web')} でブラウザ上で実行しています。
          OCR 用のサーバーはなく、画像の読み込みから認識・出力まですべて利用者のブラウザ内で処理します。
          前処理・後処理は本家と同じ計算になるよう移植しており、テスト画像6枚での本家 Python 版との文字一致率（読み順を問わない文字 F 値）は 0.997 です。
        </p>
      </section>

      <section>
        <h3>処理の流れ</h3>
        <ol className="tech-steps">
          <li><strong>画像の読み込み</strong> — JPEG/PNG はブラウザで、PDF は pdf.js（2倍の解像度）、TIFF は UTIF、HEIC は heic2any でデコードします。</li>
          <li><strong>レイアウト認識（DEIMv2）</strong> — 画像を正方形にパディングして 800×800 に縮小（Pillow の bicubic と同じ計算）し、テキスト行・本文ブロック・表領域と、行ごとの文字数カテゴリを推定します。</li>
          <li><strong>文字認識（PARSeq ×3 のカスケード）</strong> — 文字数カテゴリに応じて 30字 / 50字 / 100字用のモデルを使い分けます。結果が 25字・45字以上なら上位モデルで再認識し、98字以上の横長の行は左右に分割して認識します。縦長の行（高さ＞幅×0.8）は90度回転して入力します。</li>
          <li><strong>読み順の整序</strong> — 本文ブロックと XY-Cut 法で読み順を決めます（縦書きは右から左）。</li>
          <li><strong>表構造認識（TableCenterNet）</strong> — 表領域があれば、セルの位置と結合を推定し、認識済みの行テキストをセルに割り当てて HTML / Markdown の表にします。</li>
          <li><strong>後処理と出力</strong> — 句読点前後の空白除去、異体字の包摂（設定で有効化）、本文ブロック単位の段落結合を行い、テキスト・Markdown・HTML・JSON/XML（本家互換）で出力します。</li>
        </ol>
      </section>

      <section>
        <h3>実行構成</h3>
        <table className="tech-table">
          <thead><tr><th>実行場所</th><th>担当</th><th>ランタイム</th></tr></thead>
          <tbody>
            <tr><td>メインスレッド</td><td>画面表示、認識ジョブの分配、読み順・出力の組み立て</td><td>—</td></tr>
            <tr><td>レイアウト用 Worker ×1</td><td>レイアウト認識・表構造認識</td><td>WebGPU（非対応時は WebAssembly マルチスレッド）</td></tr>
            <tr><td>文字認識 Worker ×N</td><td>行画像の文字認識（ジョブキューで分配）</td><td>WebAssembly（各1スレッド）</td></tr>
          </tbody>
        </table>
        <ul>
          <li>文字認識 Worker の数は「CPU コア数 − 2」を 2〜4 の範囲に収めた値です（設定で変更可）。1 Worker あたり3モデル分のメモリ（約300MB）を使うため上限を設けています。スマートフォンでは Worker を増やさず、1つの Worker で 100字用モデルのみを使います。</li>
          <li>複数ページを処理するときは、前のページを文字認識している間に、空いているレイアウト用 Worker で次のページのレイアウト認識を先読みします。</li>
          <li>文字認識に WebGPU を使わないのは、PARSeq が1行ずつ（バッチサイズ1）処理する構造で、自己回帰の文字推定が小さな演算の繰り返しとして展開されているためです。GPU では演算ごとの起動コストが勝り、WebAssembly より 2〜2.5 倍遅くなりました。</li>
        </ul>
      </section>

      <section>
        <h3>モデルとキャッシュ</h3>
        <ul>
          <li>NDLOCR-Lite v2.0.0 の ONNX モデル5種（レイアウト 40MB、文字認識 37MB・38MB・43MB、表構造 28MB）を使用します。表構造モデルは表を含む画像を初めて処理するときだけ取得します。</li>
          <li>取得したモデルは本家が公表している SHA-256 と照合したうえで IndexedDB に保存し、2回目以降はダウンロードせずに起動します。</li>
          <li>処理結果は最新100件まで IndexedDB に保存され、「処理履歴」から呼び出せます。</li>
        </ul>
      </section>

      <section>
        <h3>パフォーマンス</h3>
        <p className="tech-note">計測環境: Apple M4（10コア）/ Chrome / 2026年11月。端末の負荷や回線によって大きく変わります。</p>
        <table className="tech-table">
          <thead><tr><th>モデル（1回の推論）</th><th>WebAssembly 1スレッド</th><th>WebAssembly 4スレッド</th><th>WebGPU</th></tr></thead>
          <tbody>
            <tr><td>レイアウト認識 DEIMv2（800×800）</td><td>2,469 ms</td><td>1,087 ms</td><td><strong>267 ms</strong></td></tr>
            <tr><td>文字認識 PARSeq 30字用（1行）</td><td><strong>87 ms</strong></td><td>48 ms</td><td>221 ms</td></tr>
            <tr><td>文字認識 PARSeq 100字用（1行）</td><td><strong>261 ms</strong></td><td>129 ms</td><td>497 ms</td></tr>
            <tr><td>表構造認識 TableCenterNet（800×800）</td><td>1,696 ms</td><td>—</td><td><strong>498 ms</strong></td></tr>
          </tbody>
        </table>
        <p className="tech-note">太字は本アプリで採用している実行方式です（文字認識は 1スレッドの Worker を複数並列に動かします）。</p>
        <table className="tech-table">
          <thead><tr><th>処理全体</th><th>処理時間</th></tr></thead>
          <tbody>
            <tr><td>本文25行のページ（サンプル1）</td><td>約2.0秒（改修前の実装では約4.6秒）</td></tr>
            <tr><td>同じページ4枚の連続処理</td><td>約8.6秒（1枚あたり約2.2秒）</td></tr>
            <tr><td>138行＋表1つのページ（サンプル2）</td><td>約4.6秒（表構造認識を含めて約6秒）</td></tr>
            <tr><td>スマートフォン相当の省メモリモード（25行）</td><td>約3.5秒（改修前は約12.5秒）</td></tr>
            <tr><td>初回のモデル取得（約157MB）</td><td>約20秒（約90Mbps の回線）</td></tr>
            <tr><td>2回目以降の起動（キャッシュから）</td><td>約2〜3秒</td></tr>
          </tbody>
        </table>
      </section>

      <section>
        <h3>主な使用技術</h3>
        <p>
          React 19 / TypeScript / Vite、ONNX Runtime Web、{link('https://openseadragon.github.io/', 'OpenSeadragon')}（画像ビューア）、pdf.js。
          テストは Vitest で、本家 Python 版の出力と比較する統合テストを含みます。
          ソースコードは {link('https://github.com/yuta1984/ndlocrlite-web', 'GitHub')} で公開しています。
        </p>
      </section>
    </>
  )
}

function TechEn() {
  return (
    <>
      <section>
        <h3>Overview</h3>
        <p>
          The inference pipeline of {link('https://github.com/ndl-lab/ndlocr-lite', 'NDLOCR-Lite')} v2.0.0 (Python, National Diet Library) is
          reimplemented in TypeScript and runs in the browser with {link('https://onnxruntime.ai/docs/tutorials/web/', 'ONNX Runtime Web')}.
          There is no OCR server: loading, recognition and export all happen in your browser. Pre- and post-processing are ported to match
          the original; on six test images the output matches the Python version with a character F-score of 0.997 (order-independent).
        </p>
      </section>

      <section>
        <h3>Pipeline</h3>
        <ol className="tech-steps">
          <li><strong>Image loading</strong> — JPEG/PNG by the browser, PDF by pdf.js (2× scale), TIFF by UTIF, HEIC by heic2any.</li>
          <li><strong>Layout detection (DEIMv2)</strong> — the image is padded to a square and resized to 800×800 (same math as Pillow bicubic) to detect text lines, text blocks, tables and a per-line character-count category.</li>
          <li><strong>Text recognition (cascade of 3 PARSeq models)</strong> — the 30/50/100-character model is chosen by category; results of 25+/45+ characters are re-read by the next model, and horizontal lines of 98+ characters are split in half. Vertical lines (height &gt; width × 0.8) are rotated 90°.</li>
          <li><strong>Reading order</strong> — text blocks and the XY-Cut algorithm (right-to-left for vertical text).</li>
          <li><strong>Table structure (TableCenterNet)</strong> — cell positions and spans are estimated and recognized lines are assigned to cells to build HTML/Markdown tables.</li>
          <li><strong>Post-processing &amp; export</strong> — spacing around Japanese punctuation, optional variant-kanji normalization, paragraph joining; export to text, Markdown, HTML and NDLOCR-Lite compatible JSON/XML.</li>
        </ol>
      </section>

      <section>
        <h3>Execution model</h3>
        <table className="tech-table">
          <thead><tr><th>Where</th><th>What</th><th>Runtime</th></tr></thead>
          <tbody>
            <tr><td>Main thread</td><td>UI, job dispatch, reading order and export</td><td>—</td></tr>
            <tr><td>Layout worker ×1</td><td>Layout and table recognition</td><td>WebGPU (multithreaded WebAssembly as fallback)</td></tr>
            <tr><td>Recognition workers ×N</td><td>Line recognition via a job queue</td><td>WebAssembly (1 thread each)</td></tr>
          </tbody>
        </table>
        <ul>
          <li>N is "CPU cores − 2" clamped to 2–4 (configurable). Each worker holds three models (~300 MB). On phones a single worker uses only the 100-character model.</li>
          <li>For multi-page input, layout detection of the next page runs while the current page is being recognized.</li>
          <li>Text recognition stays on WebAssembly: PARSeq runs with batch size 1 and its autoregressive decoding is unrolled into many small operations, so WebGPU was 2–2.5× slower.</li>
        </ul>
      </section>

      <section>
        <h3>Models and caching</h3>
        <ul>
          <li>Five NDLOCR-Lite v2.0.0 ONNX models (layout 40 MB; recognition 37/38/43 MB; table 28 MB). The table model is fetched only when a table is first found.</li>
          <li>Downloaded models are verified against the published SHA-256 hashes and cached in IndexedDB.</li>
          <li>The latest 100 results are kept in IndexedDB and available from History.</li>
        </ul>
      </section>

      <section>
        <h3>Performance</h3>
        <p className="tech-note">Measured on Apple M4 (10 cores) / Chrome, November 2026. Results vary with device load and network.</p>
        <table className="tech-table">
          <thead><tr><th>Model (one inference)</th><th>WASM 1 thread</th><th>WASM 4 threads</th><th>WebGPU</th></tr></thead>
          <tbody>
            <tr><td>Layout DEIMv2 (800×800)</td><td>2,469 ms</td><td>1,087 ms</td><td><strong>267 ms</strong></td></tr>
            <tr><td>PARSeq 30-char (one line)</td><td><strong>87 ms</strong></td><td>48 ms</td><td>221 ms</td></tr>
            <tr><td>PARSeq 100-char (one line)</td><td><strong>261 ms</strong></td><td>129 ms</td><td>497 ms</td></tr>
            <tr><td>TableCenterNet (800×800)</td><td>1,696 ms</td><td>—</td><td><strong>498 ms</strong></td></tr>
          </tbody>
        </table>
        <p className="tech-note">Bold marks the configuration used by this app (recognition runs several single-threaded workers in parallel).</p>
        <table className="tech-table">
          <thead><tr><th>End to end</th><th>Time</th></tr></thead>
          <tbody>
            <tr><td>Page with 25 lines (Sample 1)</td><td>~2.0 s (previous implementation ~4.6 s)</td></tr>
            <tr><td>Four such pages in a row</td><td>~8.6 s (~2.2 s per page)</td></tr>
            <tr><td>Page with 138 lines and a table (Sample 2)</td><td>~4.6 s (~6 s including table structure)</td></tr>
            <tr><td>Low-memory (phone) mode, 25 lines</td><td>~3.5 s (previously ~12.5 s)</td></tr>
            <tr><td>First model download (~157 MB)</td><td>~20 s on ~90 Mbps</td></tr>
            <tr><td>Later startups (from cache)</td><td>~2–3 s</td></tr>
          </tbody>
        </table>
      </section>

      <section>
        <h3>Built with</h3>
        <p>
          React 19 / TypeScript / Vite, ONNX Runtime Web, {link('https://openseadragon.github.io/', 'OpenSeadragon')} (image viewer), pdf.js.
          Tests use Vitest, including integration tests against the original Python output.
          Source code is on {link('https://github.com/yuta1984/ndlocrlite-web', 'GitHub')}.
        </p>
      </section>
    </>
  )
}

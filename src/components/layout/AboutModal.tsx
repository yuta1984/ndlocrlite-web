import { useEffect } from 'react'

interface AboutModalProps {
  lang: 'ja' | 'en'
  onClose: () => void
  githubUrl?: string
}

/** 「このアプリについて」: プライバシー（外部送信なし）・出典・ライセンス・作成者 */
export function AboutModal({ lang, onClose, githubUrl = 'https://github.com/yuta1984/ndlocrlite-web' }: AboutModalProps) {
  const ja = lang === 'ja'

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const link = (href: string, text: string) => (
    <a href={href} target="_blank" rel="noopener noreferrer">{text}</a>
  )

  return (
    <div className="panel-overlay" onClick={onClose}>
      <div className="panel panel-small about-panel" role="dialog" aria-modal="true" aria-labelledby="about-title" onClick={(e) => e.stopPropagation()}>
        <div className="panel-header">
          <h2 id="about-title">{ja ? 'このアプリについて' : 'About'}</h2>
          <button className="btn-close" onClick={onClose} aria-label={ja ? '閉じる' : 'Close'}>✕</button>
        </div>
        <div className="panel-body about-body">
          <section className="about-privacy">
            <span className="privacy-icon" aria-hidden>🔒</span>
            {ja ? (
              <p>
                このシステムは {link('https://www.npmjs.com/package/onnxruntime-web', 'ONNX Web Runtime')} 技術を使用しており、
                Webブラウザで完結して動作します。<strong>選択した画像とOCR結果はあなたのPCの外部には送信されません。</strong>
              </p>
            ) : (
              <p>
                This system uses {link('https://www.npmjs.com/package/onnxruntime-web', 'ONNX Web Runtime')} and runs entirely in your browser.{' '}
                <strong>Selected images and OCR results are never sent to any external server.</strong>
              </p>
            )}
          </section>

          <section>
            <h3>{ja ? 'OCRエンジン' : 'OCR engine'}</h3>
            {ja ? (
              <p>
                本ツールは国立国会図書館（NDL Lab）が開発した {link('https://github.com/ndl-lab/ndlocr-lite', 'NDLOCR-Lite')} のWebブラウザ版です。
                OCRモデル（レイアウト認識・文字認識・表構造認識）は NDLOCR-Lite v2 のものを使用しています。
                レイアウト認識モデルのバックボーンにはDINOv3を蒸留したモデルが使われており、
                {link('https://github.com/facebookresearch/dinov3/blob/main/LICENSE.md', 'DINOv3ライセンス')}が適用されます。
              </p>
            ) : (
              <p>
                This tool is a web browser port of {link('https://github.com/ndl-lab/ndlocr-lite', 'NDLOCR-Lite')} developed by the
                National Diet Library of Japan (NDL Lab). OCR models (layout, text and table recognition) are from NDLOCR-Lite v2.
                The layout model uses a backbone distilled from DINOv3 and is subject to the{' '}
                {link('https://github.com/facebookresearch/dinov3/blob/main/LICENSE.md', 'DINOv3 License')}.
              </p>
            )}
          </section>

          <section>
            <h3>{ja ? '作成者' : 'Author'}</h3>
            <p>
              {ja ? (
                <>{link('https://x.com/yuta1984', '橋本雄太')}（国立歴史民俗博物館、国立国会図書館 非常勤調査員）</>
              ) : (
                <>{link('https://x.com/yuta1984', 'Yuta Hashimoto')} (National Museum of Japanese History / NDL)</>
              )}
            </p>
            <p>{link(githubUrl, ja ? 'GitHubリポジトリ ↗' : 'GitHub Repository ↗')}</p>
          </section>
        </div>
      </div>
    </div>
  )
}

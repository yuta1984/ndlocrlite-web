import type { Language } from '../../i18n'
import { createTranslator } from '../../i18n'

interface FooterProps {
  lang: Language
  githubUrl?: string
}

export function Footer({ lang, githubUrl = 'https://github.com/makoto-udemy/web-ocr' }: FooterProps) {
  const t = createTranslator(lang)

  return (
    <footer className="footer">
      <div className="footer-privacy">
        <span className="privacy-icon">{t('footer.privacyIcon')}</span>
        <span>
          {t('footer.privacyBefore')}
          <a href="https://www.npmjs.com/package/onnxruntime-web" target="_blank" rel="noopener noreferrer">
            {t('footer.onnxRuntime')}
          </a>
          {t('footer.privacyAfter')}
        </span>
      </div>
      <div className="footer-attribution">
        <span className="footer-attribution-text">
          {t('footer.attributionBefore')}
          <a href="https://github.com/PaddlePaddle/PaddleOCR" target="_blank" rel="noopener noreferrer">
            {t('footer.paddleOCR')}
          </a>
          {t('footer.attributionAfter')}
        </span>
      </div>
      <div className="footer-meta">
        <span className="footer-author">
          {t('footer.authorPrefix')}
          <a href="https://x.com/yuta1984" target="_blank" rel="noopener noreferrer">
            {t('footer.authorName')}
          </a>
          {t('footer.authorAffiliation')}
        </span>
        <a
          href={githubUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="footer-github"
        >
          {t('footer.githubLink')} ↗
        </a>
      </div>
    </footer>
  )
}

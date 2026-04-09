/**
 * テスト用 PDF / PNG フィクスチャ生成スクリプト
 *
 * 各言語で「こんにちは」と書いた画像を生成し、
 * PNG（テスト入力用）+ PDF（手動確認用）を出力する。
 *
 * Usage: node --import tsx tests/fixtures/generate-pdfs.ts
 */

import { createCanvas, GlobalFonts } from '@napi-rs/canvas'
import { PDFDocument } from 'pdf-lib'
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUTPUT_DIR = __dirname

// Windows フォントを登録（CJK対応）
const FONT_CONFIGS: Array<{ paths: string[]; family: string; label: string }> = [
  {
    paths: ['/mnt/c/Windows/Fonts/meiryo.ttc', 'C:\\Windows\\Fonts\\meiryo.ttc'],
    family: 'CJKFont',
    label: 'Meiryo (Japanese/Chinese)',
  },
  {
    paths: ['/mnt/c/Windows/Fonts/malgun.ttf', 'C:\\Windows\\Fonts\\malgun.ttf'],
    family: 'KoreanFont',
    label: 'Malgun Gothic (Korean)',
  },
]

const registeredFonts = new Set<string>()
for (const cfg of FONT_CONFIGS) {
  for (const fp of cfg.paths) {
    try {
      if (existsSync(fp)) {
        GlobalFonts.registerFromPath(fp, cfg.family)
        registeredFonts.add(cfg.family)
        console.log(`Font registered: ${fp} as ${cfg.family}`)
        break
      }
    } catch { /* skip */ }
  }
}

function getFontFamily(language: string): string {
  if (language === 'Korean' && registeredFonts.has('KoreanFont')) return 'KoreanFont'
  if (registeredFonts.has('CJKFont')) return 'CJKFont'
  return 'sans-serif'
}

interface TestCase {
  id: string
  text: string
  language: string
}

const TEST_CASES: TestCase[] = [
  { id: 'japanese', text: 'こんにちは', language: 'Japanese' },
  { id: 'korean', text: '안녕하세요', language: 'Korean' },
  { id: 'chinese', text: '你好', language: 'Chinese' },
  { id: 'english', text: 'Hello', language: 'English' },
  { id: 'latin', text: 'Salve', language: 'Latin' },
]

const CANVAS_WIDTH = 400
const CANVAS_HEIGHT = 120

function renderTextToImage(text: string, language: string): Buffer {
  const canvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT)
  const ctx = canvas.getContext('2d')

  // 白背景
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)

  // 黒テキスト
  ctx.fillStyle = '#000000'
  const fontFamily = getFontFamily(language)
  ctx.font = `48px "${fontFamily}"`
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'center'
  ctx.fillText(text, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2)

  return canvas.toBuffer('image/png')
}

async function createPdf(pngBuffers: Array<{ id: string; text: string; png: Buffer }>): Promise<Uint8Array> {
  const doc = await PDFDocument.create()

  for (const { png } of pngBuffers) {
    const image = await doc.embedPng(png)
    const page = doc.addPage([CANVAS_WIDTH, CANVAS_HEIGHT])
    page.drawImage(image, {
      x: 0,
      y: 0,
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
    })
  }

  return doc.save()
}

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true })

  const allPngs: Array<{ id: string; text: string; png: Buffer }> = []

  for (const tc of TEST_CASES) {
    const png = renderTextToImage(tc.text, tc.language)
    const pngPath = join(OUTPUT_DIR, `hello-${tc.id}.png`)
    writeFileSync(pngPath, png)
    console.log(`✓ ${pngPath} (${tc.language}: "${tc.text}")`)
    allPngs.push({ id: tc.id, text: tc.text, png })

    // 個別PDFも生成
    const pdfBytes = await createPdf([{ id: tc.id, text: tc.text, png }])
    const pdfPath = join(OUTPUT_DIR, `hello-${tc.id}.pdf`)
    writeFileSync(pdfPath, pdfBytes)
    console.log(`✓ ${pdfPath}`)
  }

  // 全言語を1つのPDFにまとめたものも生成
  const combinedPdf = await createPdf(allPngs)
  const combinedPath = join(OUTPUT_DIR, 'hello-all-languages.pdf')
  writeFileSync(combinedPath, combinedPdf)
  console.log(`✓ ${combinedPath} (all languages combined)`)

  // テストで参照するマニフェスト
  const manifest = TEST_CASES.map(tc => ({
    id: tc.id,
    text: tc.text,
    language: tc.language,
    pngFile: `hello-${tc.id}.png`,
    pdfFile: `hello-${tc.id}.pdf`,
  }))
  writeFileSync(join(OUTPUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2))
  console.log(`✓ manifest.json`)
}

main().catch(console.error)

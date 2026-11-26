import { describe, it, expect } from 'vitest'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {
  getCenterAffine, warpAffineLinearBGR, rgbaToGray, adaptiveThresholdMeanInv, morphOpenRect,
  pointPolygonTest, convexIntersectionArea, contourArea, roundHalfEven, type Point,
} from '../../src/worker/table/cv-ops'
import { FIXTURES, loadImage } from '../helpers'

const DIR = path.join(FIXTURES, 'upstream-v2-table')
const md5 = (a: Uint8Array) => crypto.createHash('md5').update(a).digest('hex')

describe('table cv-ops（opencv-python とのビット一致）', () => {
  const ref = JSON.parse(fs.readFileSync(path.join(DIR, 'digidepo_3048008_0025.json'), 'utf-8'))
  const t = ref.tables[0]
  const crop = loadImage(path.join(DIR, t.crop_png))

  it('getCenterAffine は get_affine_transform と同じ行列', () => {
    const m = getCenterAffine([333, 197], 666, 800, 800)
    expect(m[0]).toBeCloseTo(1.2012012012, 9)
    expect(m[5]).toBeCloseTo(163.36336336, 6)
    const inv = getCenterAffine([333, 197], 666, 200, 200, true)
    expect(inv.map((v) => +v.toFixed(9))).toEqual([3.33, -0, 0, 0, 3.33, -136].map((v) => +v.toFixed(9)))
  })

  it('warpAffine(INTER_LINEAR) が cv2 と一致', () => {
    const m = getCenterAffine([crop.width / 2, crop.height / 2], Math.max(crop.width, crop.height), 800, 800)
    expect(md5(warpAffineLinearBGR(crop, m, 800, 800))).toBe(t.checksums.warped_bgr)
  })

  it('RGB2GRAY / adaptiveThreshold / morphologyEx(OPEN) が cv2 と一致', () => {
    const g = rgbaToGray(crop)
    expect(md5(g.data)).toBe(t.checksums.gray)
    const b = adaptiveThresholdMeanInv(g, 31, 10)
    expect(md5(b.data)).toBe(t.checksums.binary)
    expect(md5(morphOpenRect(b, 1, 16).data)).toBe(t.checksums.open_v16)
    expect(md5(morphOpenRect(b, 21, 1).data)).toBe(t.checksums.open_h21)
  })

  it('pointPolygonTest: 内部 / 境界 / 外部', () => {
    const sq: Point[] = [[0, 0], [10, 0], [10, 10], [0, 10]]
    expect(pointPolygonTest(sq, 5, 5)).toBe(1)
    expect(pointPolygonTest(sq, 10, 5)).toBe(0)
    expect(pointPolygonTest(sq, 0, 0)).toBe(0)
    expect(pointPolygonTest(sq, 11, 5)).toBe(-1)
  })

  it('convexIntersectionArea / contourArea', () => {
    const a: Point[] = [[0, 0], [10, 0], [10, 10], [0, 10]]
    const b: Point[] = [[5, 5], [15, 5], [15, 15], [5, 15]]
    expect(convexIntersectionArea(a, b)).toBeCloseTo(25)
    expect(convexIntersectionArea(a, [...b].reverse())).toBeCloseTo(25)
    expect(convexIntersectionArea(a, [[2, 2], [4, 2], [4, 4], [2, 4]])).toBeCloseTo(4)
    expect(convexIntersectionArea(a, [[20, 20], [30, 20], [30, 30]])).toBe(0)
    expect(Math.abs(contourArea(a))).toBe(100)
  })

  it('roundHalfEven は Python round と同じ', () => {
    expect([0.5, 1.5, 2.5, -0.5, -1.5, 2.4, 2.6].map(roundHalfEven)).toEqual([0, 2, 2, -0, -2, 2, 3])
  })
})

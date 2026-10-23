import { PixelImage } from './canvas'
import { type Anchor, buildOfficeFrames, type OfficeFrame, SIGN, TILE } from './sprites/office'

/*
 * 사무실 시트 조립: 크기가 다른 프레임을 선반(shelf) 방식으로 한 장에 배치 + PixiJS 아틀라스.
 * 순서·위치는 프레임 목록 순서로만 정해진다(결정적). 프레임 사이 2px 빈칸(확대·필터 번짐 방지).
 * 출력: apps/web/public/assets/office.png + office.json
 */

export const OFFICE_SHEET_WIDTH = 256
const GAP = 2

export interface OfficeAtlasFrame {
  frame: { x: number; y: number; w: number; h: number }
  rotated: false
  trimmed: false
  spriteSourceSize: { x: number; y: number; w: number; h: number }
  sourceSize: { w: number; h: number }
  /** 바닥 접점 등 기준점(프레임 크기 비율). PixiJS 가 texture.defaultAnchor 로 쓴다 */
  anchor: Anchor
}

export interface OfficeAtlas {
  frames: Record<string, OfficeAtlasFrame>
  animations: Record<string, string[]>
  meta: {
    app: string
    version: string
    image: string
    format: 'RGBA8888'
    size: { w: number; h: number }
    scale: 1
    tile: number
    /** 팀 간판 3조각 규격(글자 영역) — 요약 문서 참고 */
    sign: typeof SIGN
    notes: Record<string, string>
  }
}

export function packOffice(
  frames: OfficeFrame[] = buildOfficeFrames(),
  imageName = 'office.png',
): { image: PixelImage; atlas: OfficeAtlas } {
  const pos: { x: number; y: number }[] = []
  let x = 0
  let y = 0
  let rowH = 0
  for (const f of frames) {
    if (x > 0 && x + f.image.width > OFFICE_SHEET_WIDTH) {
      x = 0
      y += rowH + GAP
      rowH = 0
    }
    pos.push({ x, y })
    x += f.image.width + GAP
    rowH = Math.max(rowH, f.image.height)
  }
  const image = new PixelImage(OFFICE_SHEET_WIDTH, y + rowH)
  const out: Record<string, OfficeAtlasFrame> = {}
  const notes: Record<string, string> = {}
  frames.forEach((f, i) => {
    const p = pos[i] as { x: number; y: number }
    const { width: w, height: h } = f.image
    image.blit(f.image, p.x, p.y)
    out[f.name] = {
      frame: { x: p.x, y: p.y, w, h },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w, h },
      sourceSize: { w, h },
      anchor: f.anchor,
    }
    notes[f.name] = f.note
  })
  return {
    image,
    atlas: {
      frames: out,
      animations: {},
      meta: {
        app: '@claude-office/assets (generated — do not edit by hand)',
        version: '1',
        image: imageName,
        format: 'RGBA8888',
        size: { w: image.width, h: image.height },
        scale: 1,
        tile: TILE,
        sign: SIGN,
        notes,
      },
    },
  }
}

import type { PixelImage } from './canvas'
import { type OfficeAtlas, packOffice } from './officeSheet'
import {
  buildDecorFrames,
  buildDecorItems,
  type DecorItem,
  type DecorPlace,
  decorAnimations,
  decorKey,
  PLACE_ANCHOR,
  SEASONS,
  type Season,
} from './sprites/decor'
import { TILE } from './sprites/draw'

/*
 * 계절 장식 시트 → apps/web/public/assets/decor.png + decor.json
 * 배치는 office 시트와 같은 선반 방식(packOffice: 폭 256, 프레임 사이 2px)을 그대로 쓰고 meta 만 바꾼다.
 *   frames:     deco_{season}_{item}_{n} (anchor 는 frames[].anchor = place 별 기준점)
 *   animations: deco_{season}_{item} (2프레임 이상인 것만)
 *   meta.place: 장식 키 → floor | hang | corner,  meta.placeAnchor: place → anchor
 *   meta.seasons: 계절 → 장식 키 목록,  meta.frameMs: 애니메이션 키 → 한 프레임 ms
 */

export interface DecorAtlas {
  frames: OfficeAtlas['frames']
  animations: Record<string, string[]>
  meta: Omit<OfficeAtlas['meta'], 'sign' | 'notes'> & {
    seasons: Record<Season, string[]>
    place: Record<string, DecorPlace>
    placeAnchor: typeof PLACE_ANCHOR
    frameMs: Record<string, number>
    notes: Record<string, string>
  }
}

export function packDecor(items: DecorItem[] = buildDecorItems()): {
  image: PixelImage
  atlas: DecorAtlas
} {
  const packed = packOffice(buildDecorFrames(items), 'decor.png', decorAnimations(items))
  const { sign: _sign, notes: _notes, ...meta } = packed.atlas.meta
  return {
    image: packed.image,
    atlas: {
      frames: packed.atlas.frames,
      animations: packed.atlas.animations,
      meta: {
        ...meta,
        tile: TILE,
        seasons: Object.fromEntries(
          SEASONS.map((s) => [s, items.filter((d) => d.season === s).map(decorKey)]),
        ) as Record<Season, string[]>,
        place: Object.fromEntries(items.map((d) => [decorKey(d), d.place])),
        placeAnchor: PLACE_ANCHOR,
        frameMs: Object.fromEntries(
          items
            .filter((d) => d.frameMs !== undefined)
            .map((d) => [decorKey(d), d.frameMs as number]),
        ),
        notes: Object.fromEntries(items.map((d) => [decorKey(d), d.note])),
      },
    },
  }
}

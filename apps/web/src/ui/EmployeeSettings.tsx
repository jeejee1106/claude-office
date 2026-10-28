import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  accessoryOf,
  baseName,
  type EmployeeSettings,
  getEmployeeSettings,
  knownAgentTypes,
  NAME_MAX,
  resetEmployeeSettings,
  seenAgentTypes,
  subscribeEmployeeSettings,
  toTeamConfig,
  updateBoss,
  updateType,
  variantOf,
} from '../employeeSettings'
import { accessoryName, type Lang, t, teamName } from '../i18n'
import {
  ACCESSORIES,
  ACCESSORY_ATLAS_URL,
  ACCESSORY_KINDS,
  type Accessory,
  type AccessoryKind,
  accessoryFrameName,
} from '../scene/accessory'
import { CHARACTER_ATLAS_URL } from '../scene/render/characterSheet'
import { VARIANT_COLORS } from '../scene/render/PlaceholderRenderer'
import { TEAM_IDS, type TeamId, teamOf } from '../scene/teams'
import { VARIANT_COUNT } from '../scene/variant'
import { useLang } from './LangToggle'
import { useStoreSelector } from './useStore'

/** 직원 설정 구독(바뀌면 다시 그림) */
export function useEmployees(): EmployeeSettings {
  return useSyncExternalStore(subscribeEmployeeSettings, getEmployeeSettings)
}

// ---------------------------------------------------------------------------
// 미리보기: 캐릭터 아틀라스의 char_{v}_idle_stand_down_0 (실패하면 색 칩)
//   + 소품 시트의 acc_{kind}_idle_stand_down_0 을 같은 자리에 겹침(없으면 소품 없이)
// ---------------------------------------------------------------------------

interface Rect {
  x: number
  y: number
  w: number
  h: number
}
/** 시트 안 자리 + 원래 프레임 안 위치(잘라낸 프레임이면 spriteSourceSize 의 x·y) */
interface PreviewFrame extends Rect {
  ox: number
  oy: number
}
interface PreviewSheet {
  image: string
  size: { w: number; h: number }
  frames: Map<string, PreviewFrame>
}
interface PreviewAtlas {
  chars: PreviewSheet | null
  acc: PreviewSheet | null
}

const PREVIEW_SCALE = 2
const PREVIEW_POSE = 'idle_stand_down_0'
const charPreviewName = (v: number) => `char_${v}_${PREVIEW_POSE}`
const accPreviewName = (k: AccessoryKind) => accessoryFrameName(charPreviewName(0), k) ?? ''
const sheetPromises = new Map<string, Promise<PreviewSheet | null>>()

function isRect(x: unknown): x is Rect {
  if (typeof x !== 'object' || x === null) return false
  const r = x as Record<string, unknown>
  return ['x', 'y', 'w', 'h'].every((k) => typeof r[k] === 'number')
}

/** 아틀라스 JSON 에서 미리보기에 쓸 프레임만 읽는다. 없거나 형식이 틀리면 null */
function loadPreviewSheet(
  atlasUrl: string,
  names: readonly string[],
  what: string,
): Promise<PreviewSheet | null> {
  const cached = sheetPromises.get(atlasUrl)
  if (cached !== undefined) return cached
  const base = import.meta.env.BASE_URL
  const p = fetch(`${base}${atlasUrl}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((json: unknown): PreviewSheet | null => {
      if (typeof json !== 'object' || json === null) return null
      const { frames, meta } = json as { frames?: Record<string, unknown>; meta?: unknown }
      const m = meta as { image?: unknown; size?: unknown } | undefined
      const size = m?.size as { w?: unknown; h?: unknown } | undefined
      if (
        frames === undefined ||
        typeof m?.image !== 'string' ||
        typeof size?.w !== 'number' ||
        typeof size.h !== 'number'
      )
        return null
      const out = new Map<string, PreviewFrame>()
      for (const n of names) {
        if (!Object.hasOwn(frames, n)) continue
        const fr = frames[n] as { frame?: unknown; spriteSourceSize?: unknown } | undefined
        if (!isRect(fr?.frame)) continue
        const src = isRect(fr.spriteSourceSize) ? fr.spriteSourceSize : { x: 0, y: 0 }
        out.set(n, { ...fr.frame, ox: src.x, oy: src.y })
      }
      const dir = atlasUrl.slice(0, atlasUrl.lastIndexOf('/') + 1)
      return { image: `${base}${dir}${m.image}`, size: { w: size.w, h: size.h }, frames: out }
    })
    .catch((err: unknown) => {
      console.warn(`[claude-office] 직원 설정 미리보기용 ${what}을 못 읽음`, err)
      return null
    })
  sheetPromises.set(atlasUrl, p)
  return p
}

function loadPreviewAtlas(): Promise<PreviewAtlas> {
  const chars = loadPreviewSheet(
    CHARACTER_ATLAS_URL,
    Array.from({ length: VARIANT_COUNT }, (_, v) => charPreviewName(v)),
    '캐릭터 아틀라스(색 칩으로 대신)',
  )
  const acc = loadPreviewSheet(
    ACCESSORY_ATLAS_URL,
    ACCESSORY_KINDS.map(accPreviewName),
    '소품 시트(소품 없이 보임)',
  )
  return Promise.all([chars, acc]).then(([c, a]) => ({ chars: c, acc: a }))
}

function usePreviewAtlas(): PreviewAtlas {
  const [atlas, setAtlas] = useState<PreviewAtlas>({ chars: null, acc: null })
  useEffect(() => {
    let live = true
    void loadPreviewAtlas().then((a) => {
      if (live) setAtlas(a)
    })
    return () => {
      live = false
    }
  }, [])
  return atlas
}

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`

function sheetStyle(sheet: PreviewSheet, f: PreviewFrame) {
  const s = PREVIEW_SCALE
  return {
    width: f.w * s,
    height: f.h * s,
    backgroundImage: `url(${sheet.image})`,
    backgroundSize: `${sheet.size.w * s}px ${sheet.size.h * s}px`,
    backgroundPosition: `${-f.x * s}px ${-f.y * s}px`,
  }
}

function VariantPreview(props: { variant: number; accessory: Accessory; atlas: PreviewAtlas }) {
  const { variant, accessory, atlas } = props
  const sheet = atlas.chars
  const f = sheet?.frames.get(charPreviewName(variant))
  if (sheet === null || f === undefined) {
    const [shirt, hair] = VARIANT_COLORS[variant] ?? [0, 0]
    return (
      <span className="emp-chip">
        <span style={{ background: hex(hair) }} />
        <span style={{ background: hex(shirt) }} />
      </span>
    )
  }
  const acc = atlas.acc
  const af = accessory === 'none' ? undefined : acc?.frames.get(accPreviewName(accessory))
  const s = PREVIEW_SCALE
  return (
    <span className="emp-sprite" style={sheetStyle(sheet, f)}>
      {acc !== null && af !== undefined && (
        <span
          className="emp-acc"
          style={{ ...sheetStyle(acc, af), left: (af.ox - f.ox) * s, top: (af.oy - f.oy) * s }}
        />
      )}
    </span>
  )
}

// ---------------------------------------------------------------------------
// 행
// ---------------------------------------------------------------------------

/** 이름 입력: 입력 중에는 초안만 바꾸고, 칸을 벗어나거나 Enter 일 때 저장(공백 포함 이름을 칠 수 있게) */
function NameInput(props: {
  value: string | undefined
  placeholder: string
  label: string
  onCommit: (name: string | undefined) => void
}) {
  const { value, placeholder, label, onCommit } = props
  const [draft, setDraft] = useState(value ?? '')
  useEffect(() => setDraft(value ?? ''), [value])
  const commit = () => {
    const v = draft.trim()
    if (v !== (value ?? '')) onCommit(v === '' ? undefined : v)
  }
  return (
    <input
      type="text"
      className="emp-name"
      aria-label={label}
      value={draft}
      maxLength={NAME_MAX}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
      }}
    />
  )
}

function VariantPicker(props: {
  value: number
  accessory: Accessory
  atlas: PreviewAtlas
  lang: Lang
  onPick: (v: number) => void
}) {
  const { value, accessory, atlas, lang, onPick } = props
  return (
    <fieldset className="emp-variants" aria-label={t('empLook', lang)}>
      {Array.from({ length: VARIANT_COUNT }, (_, v) => (
        <button
          // biome-ignore lint/suspicious/noArrayIndexKey: 변형 번호 자체가 키
          key={v}
          type="button"
          className={v === value ? 'emp-variant selected' : 'emp-variant'}
          aria-pressed={v === value}
          title={t('empLookN', lang).replace('{n}', String(v + 1))}
          onClick={() => onPick(v)}
        >
          <VariantPreview variant={v} accessory={accessory} atlas={atlas} />
        </button>
      ))}
    </fieldset>
  )
}

/** 소품 고르기: 지금 고른 색의 캐릭터가 소품을 쓴 모습을 하나씩 보여 주고 눌러서 고른다.
 *  시트를 못 읽으면 그림 대신 소품 이름을 보여 준다 */
function AccessoryPicker(props: {
  value: Accessory
  variant: number
  atlas: PreviewAtlas
  lang: Lang
  label: string
  onPick: (a: Accessory) => void
}) {
  const { value, variant, atlas, lang, label, onPick } = props
  const pictures = atlas.chars !== null && atlas.acc !== null
  return (
    <fieldset className="emp-variants" aria-label={label}>
      {ACCESSORIES.map((a) => (
        <button
          key={a}
          type="button"
          className={a === value ? 'emp-variant selected' : 'emp-variant'}
          aria-pressed={a === value}
          title={accessoryName(a, lang)}
          onClick={() => onPick(a)}
        >
          {pictures ? (
            <VariantPreview variant={variant} accessory={a} atlas={atlas} />
          ) : (
            <span className="emp-acc-name">{accessoryName(a, lang)}</span>
          )}
        </button>
      ))}
    </fieldset>
  )
}

function Row(props: {
  kind: string
  agentType: string | null
  settings: EmployeeSettings
  atlas: PreviewAtlas
  lang: Lang
}) {
  const { kind, agentType, settings, atlas, lang } = props
  const isBoss = agentType === null
  const own = isBoss ? settings.boss : (settings.types[agentType] ?? {})
  const id = isBoss ? 'main' : `sub:${agentType}`
  const type = agentType ?? undefined
  const defaultName = baseName(id, type, { ...settings, boss: {}, types: {} })
  const variant = variantOf(id, type, settings)
  const accessory = accessoryOf(id, type, settings)
  const team: TeamId | null = isBoss ? null : teamOf(agentType, toTeamConfig(settings))
  const patch = (p: Record<string, unknown>) =>
    agentType === null ? updateBoss(p) : updateType(agentType, p)

  return (
    <tr>
      <th scope="row" className="emp-kind">
        {kind}
      </th>
      <td>
        <NameInput
          value={own.name}
          placeholder={defaultName}
          label={`${kind} ${t('empName', lang)}`}
          onCommit={(name) => patch({ name })}
        />
      </td>
      <td>
        {team === null ? (
          <span className="muted">{t('empNoTeam', lang)}</span>
        ) : (
          <select
            aria-label={`${kind} ${t('empTeam', lang)}`}
            value={team}
            onChange={(e) => patch({ team: e.target.value })}
          >
            {TEAM_IDS.map((tm) => (
              <option key={tm} value={tm}>
                {teamName(tm, lang)}
              </option>
            ))}
          </select>
        )}
      </td>
      <td>
        <VariantPicker
          value={variant}
          accessory={accessory}
          atlas={atlas}
          lang={lang}
          onPick={(v) => patch({ variant: v })}
        />
      </td>
      <td>
        <AccessoryPicker
          value={accessory}
          variant={variant}
          atlas={atlas}
          lang={lang}
          label={`${kind} ${t('empAccessory', lang)}`}
          onPick={(a) => patch({ accessory: a === 'none' ? undefined : a })}
        />
      </td>
    </tr>
  )
}

// ---------------------------------------------------------------------------
// 창
// ---------------------------------------------------------------------------

/** 저장하지 않은 이름 초안을 저장(onBlur)한 뒤 닫는다 */
function blurActive() {
  const el = document.activeElement
  if (el instanceof HTMLElement) el.blur()
}

function EmployeeDialog({ onClose }: { onClose: () => void }) {
  const lang = useLang()
  const settings = useEmployees()
  const office = useStoreSelector((s) => s.office)
  const atlas = usePreviewAtlas()
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const d = ref.current
    if (d !== null && !d.open) d.showModal()
  }, [])

  const close = () => {
    blurActive()
    onClose()
  }
  const types = knownAgentTypes(settings, seenAgentTypes(office.sessions))

  return (
    <dialog
      ref={ref}
      className="emp-dialog"
      aria-labelledby="emp-title"
      onCancel={(e) => {
        e.preventDefault()
        close()
      }}
    >
      <h2 id="emp-title">{t('empTitle', lang)}</h2>
      <p className="muted">{t('empHint', lang)}</p>
      <div className="emp-table-wrap">
        <table className="emp-table">
          <thead>
            <tr>
              <th scope="col">{t('empKind', lang)}</th>
              <th scope="col">{t('empName', lang)}</th>
              <th scope="col">{t('empTeam', lang)}</th>
              <th scope="col">{t('empLook', lang)}</th>
              <th scope="col">{t('empAccessory', lang)}</th>
            </tr>
          </thead>
          <tbody>
            <Row
              kind={t('empBoss', lang)}
              agentType={null}
              settings={settings}
              atlas={atlas}
              lang={lang}
            />
            {types.map((ty) => (
              <Row
                key={ty}
                kind={ty}
                agentType={ty}
                settings={settings}
                atlas={atlas}
                lang={lang}
              />
            ))}
          </tbody>
        </table>
      </div>
      <div className="emp-actions">
        <button type="button" className="emp-btn" onClick={() => resetEmployeeSettings()}>
          {t('empReset', lang)}
        </button>
        <button type="button" className="emp-btn primary" onClick={close}>
          {t('empClose', lang)}
        </button>
      </div>
    </dialog>
  )
}

/** 상단 바의 "직원 설정" 버튼 + 창 (기획서 4절) */
export function EmployeeSettingsButton() {
  const lang = useLang()
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="emp-open" onClick={() => setOpen(true)}>
        {t('empButton', lang)}
      </button>
      {open && <EmployeeDialog onClose={() => setOpen(false)} />}
    </>
  )
}

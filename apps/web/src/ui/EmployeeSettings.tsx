import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
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
import { type Lang, t, teamName } from '../i18n'
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
// ---------------------------------------------------------------------------

interface Rect {
  x: number
  y: number
  w: number
  h: number
}
interface PreviewAtlas {
  image: string
  size: { w: number; h: number }
  frames: Map<number, Rect>
}

const PREVIEW_SCALE = 2
let atlasPromise: Promise<PreviewAtlas | null> | null = null

function isRect(x: unknown): x is Rect {
  if (typeof x !== 'object' || x === null) return false
  const r = x as Record<string, unknown>
  return ['x', 'y', 'w', 'h'].every((k) => typeof r[k] === 'number')
}

function loadPreviewAtlas(): Promise<PreviewAtlas | null> {
  if (atlasPromise !== null) return atlasPromise
  const base = import.meta.env.BASE_URL
  const url = `${base}${CHARACTER_ATLAS_URL}`
  atlasPromise = fetch(url)
    .then((r) => (r.ok ? r.json() : null))
    .then((json: unknown): PreviewAtlas | null => {
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
      const out = new Map<number, Rect>()
      for (let v = 0; v < VARIANT_COUNT; v++) {
        const f = (frames[`char_${v}_idle_stand_down_0`] as { frame?: unknown } | undefined)?.frame
        if (isRect(f)) out.set(v, f)
      }
      const dir = CHARACTER_ATLAS_URL.slice(0, CHARACTER_ATLAS_URL.lastIndexOf('/') + 1)
      return { image: `${base}${dir}${m.image}`, size: { w: size.w, h: size.h }, frames: out }
    })
    .catch((err: unknown) => {
      console.warn(
        '[claude-office] 직원 설정 미리보기용 캐릭터 아틀라스를 못 읽음 — 색 칩으로',
        err,
      )
      return null
    })
  return atlasPromise
}

function usePreviewAtlas(): PreviewAtlas | null {
  const [atlas, setAtlas] = useState<PreviewAtlas | null>(null)
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

function VariantPreview({ variant, atlas }: { variant: number; atlas: PreviewAtlas | null }) {
  const f = atlas?.frames.get(variant)
  if (atlas === null || f === undefined) {
    const [shirt, hair] = VARIANT_COLORS[variant] ?? [0, 0]
    return (
      <span className="emp-chip">
        <span style={{ background: hex(hair) }} />
        <span style={{ background: hex(shirt) }} />
      </span>
    )
  }
  const s = PREVIEW_SCALE
  return (
    <span
      className="emp-sprite"
      style={{
        width: f.w * s,
        height: f.h * s,
        backgroundImage: `url(${atlas.image})`,
        backgroundSize: `${atlas.size.w * s}px ${atlas.size.h * s}px`,
        backgroundPosition: `${-f.x * s}px ${-f.y * s}px`,
      }}
    />
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
  atlas: PreviewAtlas | null
  lang: Lang
  onPick: (v: number) => void
}) {
  const { value, atlas, lang, onPick } = props
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
          <VariantPreview variant={v} atlas={atlas} />
        </button>
      ))}
    </fieldset>
  )
}

function Row(props: {
  kind: string
  agentType: string | null
  settings: EmployeeSettings
  atlas: PreviewAtlas | null
  lang: Lang
}) {
  const { kind, agentType, settings, atlas, lang } = props
  const isBoss = agentType === null
  const own = isBoss ? settings.boss : (settings.types[agentType] ?? {})
  const id = isBoss ? 'main' : `sub:${agentType}`
  const type = agentType ?? undefined
  const defaultName = baseName(id, type, { ...settings, boss: {}, types: {} })
  const variant = variantOf(id, type, settings)
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
          atlas={atlas}
          lang={lang}
          onPick={(v) => patch({ variant: v })}
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

import { useEditor } from '../model/store'
import { ASPECTS, defaultAdjust, type Aspect, type AudioItem, type Clip, type TextItem } from '../model/types'
import { FONTS, loadFont } from '../lib/fonts'
import { getPlayer } from '../engine/player'
import { Sheet, Slider } from './common'
import { useState } from 'react'
import { Check, AlignCenter, AlignLeft, AlignRight } from 'lucide-react'
import CaptionsPanel from './CaptionsPanel'

export type PanelId = 'speed' | 'volume' | 'adjust' | 'text' | 'aspect' | 'bg' | 'audio' | 'captions'

const COLORS = ['#ffffff', '#000000', '#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#19d3c5', '#007aff', '#af52de', '#ff2d55', '#8e8e93']

function useClip(): [Clip | undefined, (fn: (c: Clip) => void) => void] {
  const sel = useEditor((s) => s.selection)
  const clip = useEditor((s) => (sel?.type === 'clip' ? s.project?.clips.find((c) => c.id === sel.id) : undefined))
  const update = (fn: (c: Clip) => void) =>
    useEditor.getState().mutate((p) => {
      const c = p.clips.find((x) => x.id === clip?.id)
      if (c) fn(c)
    })
  return [clip, update]
}

const cp = () => useEditor.getState().checkpoint()

export default function Panels({ id, onClose }: { id: PanelId; onClose: () => void }) {
  switch (id) {
    case 'speed':
      return <SpeedPanel onClose={onClose} />
    case 'volume':
      return <VolumePanel onClose={onClose} />
    case 'adjust':
      return <AdjustPanel onClose={onClose} />
    case 'text':
      return <TextPanel onClose={onClose} />
    case 'aspect':
      return <AspectPanel onClose={onClose} />
    case 'bg':
      return <BgPanel onClose={onClose} />
    case 'audio':
      return <AudioPanel onClose={onClose} />
    case 'captions':
      return <CaptionsPanel onClose={onClose} />
  }
}

function SpeedPanel({ onClose }: { onClose: () => void }) {
  const [clip, update] = useClip()
  if (!clip) return <Sheet inline title="Tốc độ" onClose={onClose}>Chọn một clip trước.</Sheet>
  const v = Math.log10(clip.speed)
  return (
    <Sheet inline title="Tốc độ" onClose={onClose}>
      <Slider
        label="Tốc độ"
        min={-1}
        max={1}
        step={0.01}
        value={v}
        format={() => `${clip.speed.toFixed(2)}x`}
        onStart={cp}
        onChange={(x) => update((c) => (c.speed = Math.round(Math.pow(10, x) * 100) / 100))}
      />
      <div className="chips">
        {[0.25, 0.5, 1, 1.5, 2, 3, 5].map((sp) => (
          <button
            key={sp}
            className={'chip' + (clip.speed === sp ? ' on' : '')}
            onClick={() => {
              cp()
              update((c) => (c.speed = sp))
            }}
          >
            {sp}x
          </button>
        ))}
      </div>
    </Sheet>
  )
}

function VolumePanel({ onClose }: { onClose: () => void }) {
  const [clip, update] = useClip()
  if (!clip) return <Sheet inline title="Âm lượng" onClose={onClose}>Chọn một clip trước.</Sheet>
  return (
    <Sheet inline title="Âm lượng clip" onClose={onClose}>
      <Slider
        label="Âm lượng"
        min={0}
        max={2}
        value={clip.volume}
        format={(v) => `${Math.round(v * 100)}%`}
        onStart={cp}
        onChange={(x) => update((c) => (c.volume = x))}
      />
      <div className="chips">
        <button
          className={'chip' + (clip.volume === 0 ? ' on' : '')}
          onClick={() => {
            cp()
            update((c) => (c.volume = c.volume === 0 ? 1 : 0))
          }}
        >
          Tắt tiếng
        </button>
        <button
          className="chip"
          onClick={() => {
            cp()
            useEditor.getState().mutate((p) => p.clips.forEach((c) => (c.volume = clip.volume)))
          }}
        >
          Áp dụng cho tất cả
        </button>
      </div>
    </Sheet>
  )
}

function AdjustPanel({ onClose }: { onClose: () => void }) {
  const [clip, update] = useClip()
  if (!clip) return <Sheet inline title="Điều chỉnh" onClose={onClose}>Chọn một clip trước.</Sheet>
  const pct = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}`
  return (
    <Sheet
      inline
      title="Điều chỉnh"
      onClose={onClose}
      right={
        <button
          className="btn small"
          onClick={() => {
            cp()
            update((c) => (c.adjust = defaultAdjust()))
          }}
        >
          Đặt lại
        </button>
      }
    >
      <Slider label="Độ sáng" min={-1} max={1} value={clip.adjust.brightness} format={pct} onStart={cp} onChange={(x) => update((c) => (c.adjust.brightness = x))} />
      <Slider label="Tương phản" min={-1} max={1} value={clip.adjust.contrast} format={pct} onStart={cp} onChange={(x) => update((c) => (c.adjust.contrast = x))} />
      <Slider label="Bão hoà" min={-1} max={1} value={clip.adjust.saturation} format={pct} onStart={cp} onChange={(x) => update((c) => (c.adjust.saturation = x))} />
      <div className="chips">
        <button
          className="chip"
          onClick={() => {
            cp()
            useEditor.getState().mutate((p) => p.clips.forEach((c) => (c.adjust = { ...clip.adjust })))
          }}
        >
          Áp dụng cho tất cả
        </button>
      </div>
    </Sheet>
  )
}

function TextPanel({ onClose }: { onClose: () => void }) {
  const sel = useEditor((s) => s.selection)
  const item = useEditor((s) => (sel?.type === 'text' ? s.project?.texts.find((t) => t.id === sel.id) : undefined))
  const [tab, setTab] = useState<'font' | 'style' | 'anim'>('font')
  if (!item) return <Sheet inline title="Văn bản" onClose={onClose}>Chọn một đoạn chữ trước.</Sheet>
  const update = (fn: (t: TextItem) => void) =>
    useEditor.getState().mutate((p) => {
      const t = p.texts.find((x) => x.id === item.id)
      if (t) fn(t)
    })
  const set = (fn: (t: TextItem) => void) => {
    cp()
    update(fn)
  }
  return (
    <Sheet
      inline
      title="Văn bản"
      onClose={onClose}
      right={
        <button className="icon-btn" onClick={onClose} aria-label="Xong">
          <Check size={22} />
        </button>
      }
    >
      <textarea
        className="text-input"
        value={item.text}
        autoFocus={item.text === 'Nhập chữ'}
        onFocus={(e) => {
          cp()
          if (item.text === 'Nhập chữ') e.currentTarget.select()
        }}
        onChange={(e) => update((t) => (t.text = e.target.value))}
        rows={2}
      />
      <div className="tabs">
        <button className={'tab' + (tab === 'font' ? ' on' : '')} onClick={() => setTab('font')}>
          Phông
        </button>
        <button className={'tab' + (tab === 'style' ? ' on' : '')} onClick={() => setTab('style')}>
          Kiểu
        </button>
        <button className={'tab' + (tab === 'anim' ? ' on' : '')} onClick={() => setTab('anim')}>
          Hiệu ứng
        </button>
      </div>
      {tab === 'font' && (
        <div className="font-grid">
          {FONTS.map((f) => (
            <button
              key={f.family}
              className={'font-opt' + (item.font === f.family ? ' on' : '')}
              style={{ fontFamily: `"${f.family}"`, fontWeight: f.weight }}
              onClick={async () => {
                await loadFont(f.family)
                set((t) => (t.font = f.family))
                getPlayer().invalidate()
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}
      {tab === 'style' && (
        <>
          <Slider label="Cỡ chữ" min={0.015} max={0.2} step={0.001} value={item.size} format={(v) => String(Math.round(v * 1000))} onStart={cp} onChange={(x) => update((t) => (t.size = x))} />
          <div className="label">Màu chữ</div>
          <div className="chips">
            {COLORS.map((c) => (
              <button key={c} className={'swatch' + (item.color === c ? ' on' : '')} style={{ background: c }} onClick={() => set((t) => (t.color = c))} aria-label={c} />
            ))}
          </div>
          <div className="label">Viền</div>
          <div className="chips">
            <button className={'chip' + (!item.stroke ? ' on' : '')} onClick={() => set((t) => (t.stroke = null))}>
              Không
            </button>
            {COLORS.map((c) => (
              <button key={c} className={'swatch' + (item.stroke === c ? ' on' : '')} style={{ background: c }} onClick={() => set((t) => (t.stroke = c))} aria-label={c} />
            ))}
          </div>
          <div className="label">Nền chữ</div>
          <div className="chips">
            <button className={'chip' + (!item.bg ? ' on' : '')} onClick={() => set((t) => (t.bg = null))}>
              Không
            </button>
            {COLORS.map((c) => (
              <button key={c} className={'swatch' + (item.bg === c + 'cc' ? ' on' : '')} style={{ background: c }} onClick={() => set((t) => (t.bg = c + 'cc'))} aria-label={c} />
            ))}
          </div>
          <div className="chips">
            {(['left', 'center', 'right'] as const).map((a) => (
              <button key={a} className={'chip' + (item.align === a ? ' on' : '')} onClick={() => set((t) => (t.align = a))} aria-label={a}>
                {a === 'left' ? <AlignLeft size={16} /> : a === 'center' ? <AlignCenter size={16} /> : <AlignRight size={16} />}
              </button>
            ))}
            <button className={'chip' + (item.bold ? ' on' : '')} onClick={() => set((t) => (t.bold = !t.bold))}>
              <b>B</b>
            </button>
          </div>
        </>
      )}
      {tab === 'anim' && (
        <div className="chips">
          {(
            [
              ['none', 'Không'],
              ['fade', 'Mờ dần'],
              ['pop', 'Bật lên'],
              ['slide', 'Trượt lên'],
            ] as const
          ).map(([k, l]) => (
            <button key={k} className={'chip' + (item.anim === k ? ' on' : '')} onClick={() => set((t) => (t.anim = k))}>
              {l}
            </button>
          ))}
        </div>
      )}
    </Sheet>
  )
}

function AspectPanel({ onClose }: { onClose: () => void }) {
  const aspect = useEditor((s) => s.project!.aspect)
  const labels: Record<Aspect, string> = { '9:16': 'TikTok, Reels', '1:1': 'Vuông', '4:5': 'Instagram', '16:9': 'YouTube', '3:4': 'Dọc' }
  return (
    <Sheet inline title="Tỉ lệ khung hình" onClose={onClose}>
      <div className="aspect-grid">
        {(Object.keys(ASPECTS) as Aspect[]).map((a) => {
          const r = ASPECTS[a]
          return (
            <button
              key={a}
              className={'aspect-opt' + (a === aspect ? ' on' : '')}
              onClick={() => useEditor.getState().edit((p) => void (p.aspect = a))}
            >
              <span className="aspect-box" style={{ width: r < 1 ? 28 * r : 28, height: r < 1 ? 28 : 28 / r }} />
              <b>{a}</b>
              <small>{labels[a]}</small>
            </button>
          )
        })}
      </div>
    </Sheet>
  )
}

function BgPanel({ onClose }: { onClose: () => void }) {
  const bg = useEditor((s) => s.project!.bg)
  return (
    <Sheet inline title="Nền" onClose={onClose}>
      <div className="chips">
        <button className={'chip' + (bg.type === 'blur' ? ' on' : '')} onClick={() => useEditor.getState().edit((p) => void (p.bg.type = 'blur'))}>
          Làm mờ
        </button>
        <button className={'chip' + (bg.type === 'color' ? ' on' : '')} onClick={() => useEditor.getState().edit((p) => void (p.bg.type = 'color'))}>
          Màu
        </button>
      </div>
      <div className="chips">
        {COLORS.map((c) => (
          <button
            key={c}
            className={'swatch' + (bg.type === 'color' && bg.color === c ? ' on' : '')}
            style={{ background: c }}
            onClick={() => useEditor.getState().edit((p) => void (p.bg = { type: 'color', color: c }))}
            aria-label={c}
          />
        ))}
      </div>
    </Sheet>
  )
}

function AudioPanel({ onClose }: { onClose: () => void }) {
  const sel = useEditor((s) => s.selection)
  const item = useEditor((s) => (sel?.type === 'audio' ? s.project?.audios.find((a) => a.id === sel.id) : undefined))
  if (!item) return <Sheet inline title="Âm thanh" onClose={onClose}>Chọn một đoạn nhạc trước.</Sheet>
  const update = (fn: (a: AudioItem) => void) =>
    useEditor.getState().mutate((p) => {
      const a = p.audios.find((x) => x.id === item.id)
      if (a) fn(a)
    })
  const len = item.srcOut - item.srcIn
  return (
    <Sheet inline title={item.name} onClose={onClose}>
      <Slider label="Âm lượng" min={0} max={2} value={item.volume} format={(v) => `${Math.round(v * 100)}%`} onStart={cp} onChange={(x) => update((a) => (a.volume = x))} />
      <Slider label="Hiện dần" min={0} max={Math.min(10, len / 2)} step={0.1} value={item.fadeIn} format={(v) => `${v.toFixed(1)}s`} onStart={cp} onChange={(x) => update((a) => (a.fadeIn = x))} />
      <Slider label="Tắt dần" min={0} max={Math.min(10, len / 2)} step={0.1} value={item.fadeOut} format={(v) => `${v.toFixed(1)}s`} onStart={cp} onChange={(x) => update((a) => (a.fadeOut = x))} />
    </Sheet>
  )
}

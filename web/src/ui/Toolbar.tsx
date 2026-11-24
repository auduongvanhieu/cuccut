import type { ReactNode } from 'react'
import { nanoid } from 'nanoid'
import {
  ChevronDown,
  Copy,
  Crop,
  FlipHorizontal2,
  Gauge,
  Music,
  Palette,
  PlusSquare,
  RotateCw,
  Scissors,
  SlidersHorizontal,
  Subtitles,
  Trash2,
  Type,
  Volume2,
  Square,
  Pencil,
} from 'lucide-react'
import { makeAudio, makeClip, makeText, splitAudioAt, splitClipAt, splitTextAt, useEditor } from '../model/store'
import { getMetaSync, importFile } from '../lib/media'
import { ASPECTS, type Aspect, type Clip } from '../model/types'
import { loadFont } from '../lib/fonts'
import { ACCEPT_VISUAL, importInto } from './Home'
import { pickFiles, toast } from './common'
import type { PanelId } from './Panels'

function Tool({ icon, label, onClick, danger }: { icon: ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button className={'tool' + (danger ? ' danger' : '')} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  )
}

export async function addMusic() {
  const files = await pickFiles('audio/*,video/*', false)
  if (!files[0]) return
  try {
    const meta = await importFile(files[0])
    if (!meta.hasAudio || !meta.duration) return toast('File không có âm thanh')
    const s = useEditor.getState()
    s.edit((p) => {
      p.audios.push(makeAudio(meta, s.time))
    })
  } catch (e) {
    toast((e as Error).message)
  }
}

export default function Toolbar({ open }: { open: (p: PanelId) => void }) {
  const sel = useEditor((s) => s.selection)
  const s = useEditor.getState
  const sz = 22

  if (sel?.type === 'clip') {
    const id = sel.id
    return (
      <div className="toolbar">
        <button className="tool back" onClick={() => s().select(null)} aria-label="Bỏ chọn">
          <ChevronDown size={22} />
        </button>
        <Tool
          icon={<Scissors size={sz} />}
          label="Tách"
          onClick={() => {
            let ok = false
            s().edit((p) => {
              ok = !!splitClipAt(p, s().time)
            })
            if (!ok) toast('Đưa vạch trắng vào giữa clip để tách')
          }}
        />
        <Tool icon={<Gauge size={sz} />} label="Tốc độ" onClick={() => open('speed')} />
        <Tool icon={<Volume2 size={sz} />} label="Âm lượng" onClick={() => open('volume')} />
        <Tool icon={<SlidersHorizontal size={sz} />} label="Điều chỉnh" onClick={() => open('adjust')} />
        <Tool
          icon={<RotateCw size={sz} />}
          label="Xoay"
          onClick={() =>
            s().edit((p) => {
              const c = p.clips.find((x) => x.id === id)
              if (c) c.rotation = ((c.rotation + 90) % 360) as 0 | 90 | 180 | 270
            })
          }
        />
        <Tool
          icon={<FlipHorizontal2 size={sz} />}
          label="Lật"
          onClick={() =>
            s().edit((p) => {
              const c = p.clips.find((x) => x.id === id)
              if (c) c.flipH = !c.flipH
            })
          }
        />
        <Tool
          icon={<Crop size={sz} />}
          label="Vừa khung"
          onClick={() =>
            s().edit((p) => {
              const c = p.clips.find((x) => x.id === id)
              if (!c) return
              const filled = c.scale > 1.001
              c.x = 0
              c.y = 0
              c.scale = filled ? 1 : coverScale(p.aspect, c)
            })
          }
        />
        <Tool
          icon={<Copy size={sz} />}
          label="Nhân bản"
          onClick={() =>
            s().edit((p) => {
              const i = p.clips.findIndex((x) => x.id === id)
              if (i >= 0) p.clips.splice(i + 1, 0, { ...JSON.parse(JSON.stringify(p.clips[i])), id: nanoid(10) })
            })
          }
        />
        <Tool
          icon={<Trash2 size={sz} />}
          label="Xoá"
          danger
          onClick={() => {
            s().edit((p) => {
              p.clips = p.clips.filter((x) => x.id !== id)
            })
            s().select(null)
          }}
        />
      </div>
    )
  }

  if (sel?.type === 'text') {
    const id = sel.id
    return (
      <div className="toolbar">
        <button className="tool back" onClick={() => s().select(null)} aria-label="Bỏ chọn">
          <ChevronDown size={22} />
        </button>
        <Tool icon={<Pencil size={sz} />} label="Sửa" onClick={() => open('text')} />
        <Tool
          icon={<Scissors size={sz} />}
          label="Tách"
          onClick={() => {
            let ok = false
            s().edit((p) => {
              ok = !!splitTextAt(p, id, s().time)
            })
            if (!ok) toast('Đưa vạch trắng vào giữa đoạn chữ để tách')
          }}
        />
        <Tool
          icon={<Copy size={sz} />}
          label="Nhân bản"
          onClick={() =>
            s().edit((p) => {
              const t = p.texts.find((x) => x.id === id)
              if (t) p.texts.push({ ...t, id: nanoid(10), start: t.start + t.duration })
            })
          }
        />
        <Tool
          icon={<Trash2 size={sz} />}
          label="Xoá"
          danger
          onClick={() => {
            s().edit((p) => {
              p.texts = p.texts.filter((x) => x.id !== id)
            })
            s().select(null)
          }}
        />
      </div>
    )
  }

  if (sel?.type === 'audio') {
    const id = sel.id
    return (
      <div className="toolbar">
        <button className="tool back" onClick={() => s().select(null)} aria-label="Bỏ chọn">
          <ChevronDown size={22} />
        </button>
        <Tool icon={<Volume2 size={sz} />} label="Âm lượng" onClick={() => open('audio')} />
        <Tool
          icon={<Scissors size={sz} />}
          label="Tách"
          onClick={() => {
            let ok = false
            s().edit((p) => {
              ok = !!splitAudioAt(p, id, s().time)
            })
            if (!ok) toast('Đưa vạch trắng vào giữa đoạn nhạc để tách')
          }}
        />
        <Tool
          icon={<Trash2 size={sz} />}
          label="Xoá"
          danger
          onClick={() => {
            s().edit((p) => {
              p.audios = p.audios.filter((x) => x.id !== id)
            })
            s().select(null)
          }}
        />
      </div>
    )
  }

  return (
    <div className="toolbar">
      <Tool
        icon={<PlusSquare size={sz} />}
        label="Thêm"
        onClick={async () => {
          const files = await pickFiles(ACCEPT_VISUAL)
          const metas = (await importInto(files)).filter((m) => m.kind !== 'audio')
          if (metas.length) s().edit((p) => void p.clips.push(...metas.map(makeClip)))
        }}
      />
      <Tool icon={<Music size={sz} />} label="Âm thanh" onClick={() => void addMusic()} />
      <Tool
        icon={<Type size={sz} />}
        label="Văn bản"
        onClick={() => {
          const t = makeText(s().time)
          void loadFont(t.font)
          s().edit((p) => void p.texts.push(t))
          s().select({ type: 'text', id: t.id })
          open('text')
        }}
      />
      <Tool icon={<Subtitles size={sz} />} label="Phụ đề" onClick={() => open('captions')} />
      <Tool icon={<Square size={sz} />} label="Tỉ lệ" onClick={() => open('aspect')} />
      <Tool icon={<Palette size={sz} />} label="Nền" onClick={() => open('bg')} />
    </div>
  )
}

/** Scale that makes the clip cover the whole canvas. */
function coverScale(aspect: Aspect, c: Clip) {
  const m = getMetaSync(c.mediaId)
  if (!m?.width) return 1
  const rotated = c.rotation === 90 || c.rotation === 270
  const r = rotated ? m.height / m.width : m.width / m.height
  const R = ASPECTS[aspect]
  return Math.max(r / R, R / r)
}

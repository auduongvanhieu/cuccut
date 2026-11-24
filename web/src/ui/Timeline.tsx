import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Plus, Music, Type } from 'lucide-react'
import { makeClip, useEditor } from '../model/store'
import { clipDuration, clipStarts, projectDuration, type AudioItem, type Clip, type TextItem } from '../model/types'
import { getMetaSync, getPeaks, getThumbs, type Thumb } from '../lib/media'
import { ACCEPT_VISUAL, importInto } from './Home'
import { pickFiles } from './common'

const RULER = 22
const MAIN = 56
const ROW = 30
const GAP = 6
const SNAP_PX = 10

const vibrate = () => {
  try {
    navigator.vibrate?.(8)
  } catch {
    /* ignore */
  }
}

/** Generic pointer drag with capture. dx is in pixels from the start. */
function startDrag(
  e: React.PointerEvent,
  onMove: (dx: number, ev: PointerEvent) => void,
  onEnd?: (moved: boolean) => void,
) {
  e.stopPropagation()
  const el = e.currentTarget as HTMLElement
  el.setPointerCapture(e.pointerId)
  const x0 = e.clientX
  let moved = false
  const move = (ev: PointerEvent) => {
    if (ev.pointerId !== e.pointerId) return
    const dx = ev.clientX - x0
    if (!moved && Math.abs(dx) < 3) return
    if (!moved) useEditor.getState().checkpoint()
    moved = true
    onMove(dx, ev)
  }
  const up = (ev: PointerEvent) => {
    if (ev.pointerId !== e.pointerId) return
    el.removeEventListener('pointermove', move)
    el.removeEventListener('pointerup', up)
    el.removeEventListener('pointercancel', up)
    onEnd?.(moved)
  }
  el.addEventListener('pointermove', move)
  el.addEventListener('pointerup', up)
  el.addEventListener('pointercancel', up)
}

/** Snap a timeline time to nearby edges / playhead. */
function snap(t: number, pps: number, extra: number[] = []) {
  const s = useEditor.getState()
  const p = s.project!
  const cands = [0, s.time, ...extra]
  let acc = 0
  for (const c of p.clips) {
    acc += clipDuration(c)
    cands.push(acc)
  }
  for (const x of p.texts) cands.push(x.start, x.start + x.duration)
  for (const a of p.audios) cands.push(a.start, a.start + a.srcOut - a.srcIn)
  let best = t
  let bd = SNAP_PX / pps
  for (const c of cands) {
    const d = Math.abs(c - t)
    if (d < bd) {
      bd = d
      best = c
    }
  }
  if (best !== t) vibrate()
  return best
}

export default function Timeline() {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [vw, setVw] = useState(360)
  const project = useEditor((s) => s.project)!
  const pps = useEditor((s) => s.pxPerSec)
  const selection = useEditor((s) => s.selection)
  const dur = projectDuration(project)
  const half = vw / 2
  const [reorder, setReorder] = useState<{ id: string; x: number; target: number } | null>(null)
  const reorderRef = useRef(reorder)
  reorderRef.current = reorder

  useLayoutEffect(() => {
    const el = scrollRef.current!
    const ro = new ResizeObserver(() => setVw(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Time -> scroll (playback, zoom, programmatic seeks)
  useEffect(() => {
    const el = scrollRef.current!
    const apply = () => {
      const s = useEditor.getState()
      const target = s.time * s.pxPerSec
      if (Math.abs(el.scrollLeft - target) > 0.5) el.scrollLeft = target
    }
    apply()
    return useEditor.subscribe((s, prev) => {
      if (s.time !== prev.time || s.pxPerSec !== prev.pxPerSec) apply()
    })
  }, [])

  // Scroll -> time (user scrubbing)
  const onScroll = () => {
    const el = scrollRef.current!
    const s = useEditor.getState()
    const t = el.scrollLeft / s.pxPerSec
    if (Math.abs(t - s.time) * s.pxPerSec > 0.75) s.setTime(t)
  }

  // Pinch zoom + blocking native scroll during reorder
  useEffect(() => {
    const el = scrollRef.current!
    let startDist = 0
    let startPps = 0
    const onTouchStart = (e: TouchEvent) => {
      const s = useEditor.getState()
      if (s.playing) s.setPlaying(false)
      if (e.touches.length === 2) {
        startDist = Math.abs(e.touches[0].clientX - e.touches[1].clientX)
        startPps = s.pxPerSec
      }
    }
    const onTouchMove = (e: TouchEvent) => {
      if (reorderRef.current) {
        e.preventDefault()
        return
      }
      if (e.touches.length === 2 && startDist > 10) {
        e.preventDefault()
        const d = Math.abs(e.touches[0].clientX - e.touches[1].clientX)
        useEditor.getState().setZoom(startPps * (d / startDist))
      }
    }
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault()
        const s = useEditor.getState()
        s.setZoom(s.pxPerSec * Math.exp(-e.deltaY / 200))
      }
    }
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('mousedown', () => useEditor.getState().setPlaying(false))
    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('wheel', onWheel)
    }
  }, [])

  const addMedia = async () => {
    const files = await pickFiles(ACCEPT_VISUAL)
    if (!files.length) return
    const metas = (await importInto(files)).filter((m) => m.kind !== 'audio')
    if (!metas.length) return
    useEditor.getState().edit((p) => {
      p.clips.push(...metas.map(makeClip))
    })
  }

  const starts = clipStarts(project)
  const contentW = dur * pps + vw
  const rows = [
    { key: 'texts', show: project.texts.some((t) => !t.isCaption) },
    { key: 'captions', show: project.texts.some((t) => t.isCaption) },
    { key: 'audio', show: project.audios.length > 0 },
  ].filter((r) => r.show)

  // Ruler ticks
  const step = pps >= 120 ? 0.5 : pps >= 40 ? 1 : pps >= 15 ? 5 : 10
  const ticks: number[] = []
  for (let t = 0; t <= dur + step; t += step) ticks.push(t)

  return (
    <div className="timeline">
      <div
        className="tl-scroll"
        ref={scrollRef}
        onScroll={onScroll}
        onClick={(e) => {
          if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('tl-content'))
            useEditor.getState().select(null)
        }}
      >
        <div className="tl-content" style={{ width: contentW }}>
          <div className="tl-ruler" style={{ height: RULER }}>
            {ticks.map((t) => (
              <span key={t} style={{ left: half + t * pps }}>
                {Number.isInteger(t) ? (t >= 60 ? `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}` : `${t}s`) : '·'}
              </span>
            ))}
          </div>

          <div className="tl-row main" style={{ top: RULER + GAP, height: MAIN }}>
            {project.clips.map((c, i) => (
              <ClipBlock
                key={c.id}
                clip={c}
                index={i}
                left={half + starts[i] * pps}
                pps={pps}
                selected={selection?.type === 'clip' && selection.id === c.id}
                dimmed={!!reorder && reorder.id !== c.id}
                onReorderStart={(x) => setReorder({ id: c.id, x, target: i })}
                onReorderMove={(x) => {
                  const contentX = x - half
                  let target = project.clips.length - 1
                  for (let k = 0; k < project.clips.length; k++) {
                    if (contentX < (starts[k] + clipDuration(project.clips[k]) / 2) * pps) {
                      target = k
                      break
                    }
                  }
                  setReorder({ id: c.id, x, target })
                }}
                onReorderEnd={() => {
                  const r = reorderRef.current
                  setReorder(null)
                  if (!r) return
                  const from = project.clips.findIndex((x) => x.id === r.id)
                  if (from !== r.target)
                    useEditor.getState().edit((p) => {
                      const [m] = p.clips.splice(from, 1)
                      p.clips.splice(r.target, 0, m)
                    })
                }}
              />
            ))}
            {reorder && (
              <div
                className="tl-insert"
                style={{
                  left:
                    half +
                    (reorder.target <= project.clips.findIndex((x) => x.id === reorder.id)
                      ? starts[reorder.target]
                      : starts[reorder.target] + clipDuration(project.clips[reorder.target])) *
                      pps,
                }}
              />
            )}
            <button className="tl-add" style={{ left: half + dur * pps + 8 }} onClick={() => void addMedia()} aria-label="Thêm media">
              <Plus size={22} />
            </button>
          </div>

          {rows.map((row, ri) => (
            <div key={row.key} className="tl-row" style={{ top: RULER + GAP + MAIN + GAP + ri * (ROW + GAP), height: ROW }}>
              {row.key === 'audio'
                ? project.audios.map((a) => (
                    <AudioBlock key={a.id} item={a} half={half} pps={pps} selected={selection?.type === 'audio' && selection.id === a.id} />
                  ))
                : project.texts
                    .filter((t) => !!t.isCaption === (row.key === 'captions'))
                    .map((t) => (
                      <TextBlock key={t.id} item={t} half={half} pps={pps} selected={selection?.type === 'text' && selection.id === t.id} />
                    ))}
            </div>
          ))}
          <div style={{ height: RULER + GAP + MAIN + GAP + rows.length * (ROW + GAP) + 8 }} />
        </div>
      </div>
      <div className="tl-playhead" />
      {project.clips.length === 0 && (
        <button className="tl-empty btn" onClick={() => void addMedia()}>
          <Plus size={18} /> Thêm video / ảnh
        </button>
      )}
    </div>
  )
}

// ---------------- Main-track clip ----------------
const ClipBlock = memo(function ClipBlock({
  clip,
  index,
  left,
  pps,
  selected,
  dimmed,
  onReorderStart,
  onReorderMove,
  onReorderEnd,
}: {
  clip: Clip
  index: number
  left: number
  pps: number
  selected: boolean
  dimmed: boolean
  onReorderStart: (x: number) => void
  onReorderMove: (x: number) => void
  onReorderEnd: () => void
}) {
  const [thumbs, setThumbs] = useState<Thumb[]>([])
  useEffect(() => {
    let alive = true
    void getThumbs(clip.mediaId).then((t) => alive && setThumbs(t))
    return () => {
      alive = false
    }
  }, [clip.mediaId])
  const width = clipDuration(clip) * pps
  const meta = getMetaSync(clip.mediaId)
  const tileW = Math.max(28, Math.min(100, MAIN * (meta?.width && meta.height ? meta.width / meta.height : 1)))
  const tiles = Math.max(1, Math.ceil(width / tileW))
  const thumbAt = (tile: number) => {
    if (!thumbs.length) return null
    if (clip.kind === 'image') return thumbs[0].url
    const st = clip.srcIn + ((tile * tileW) / pps) * clip.speed
    let best = thumbs[0]
    for (const th of thumbs) if (Math.abs(th.t - st) < Math.abs(best.t - st)) best = th
    return best.url
  }

  // Long-press to reorder
  const lp = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number; active: boolean; id: number } | null>(null)
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const scroller = (e.currentTarget as HTMLElement).closest('.tl-scroll') as HTMLElement
    const toContent = (cx: number) => cx - scroller.getBoundingClientRect().left + scroller.scrollLeft
    const st = { x: e.clientX, y: e.clientY, active: false, id: e.pointerId, timer: 0 as unknown as ReturnType<typeof setTimeout> }
    const target = e.currentTarget as HTMLElement
    st.timer = setTimeout(() => {
      st.active = true
      try {
        target.setPointerCapture(st.id)
      } catch {
        /* ignore */
      }
      vibrate()
      onReorderStart(toContent(st.x))
    }, 380)
    lp.current = st
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== st.id) return
      if (!st.active) {
        if (Math.hypot(ev.clientX - st.x, ev.clientY - st.y) > 8) cleanup()
        return
      }
      onReorderMove(toContent(ev.clientX))
    }
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== st.id) return
      const wasActive = st.active
      cleanup()
      if (wasActive) onReorderEnd()
    }
    const cleanup = () => {
      clearTimeout(st.timer)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      lp.current = null
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  const trim = (side: 'l' | 'r') => (e: React.PointerEvent) => {
    const s = useEditor.getState()
    const orig = s.project!.clips.find((c) => c.id === clip.id)!
    const maxSrc = meta?.kind === 'video' ? meta.duration : 600
    const starts = clipStarts(s.project!)
    const start = starts[index]
    startDrag(e, (dx) => {
      const dt = dx / pps
      useEditor.getState().mutate((p) => {
        const c = p.clips.find((x) => x.id === clip.id)
        if (!c) return
        const minLen = 0.1 * orig.speed
        if (side === 'r') {
          const endT = snap(start + (orig.srcOut - orig.srcIn) / orig.speed + dt, pps)
          c.srcOut = Math.min(maxSrc, Math.max(orig.srcIn + minLen, orig.srcIn + (endT - start) * orig.speed))
        } else if (orig.kind === 'image') {
          c.srcOut = Math.max(minLen, orig.srcOut - dt * orig.speed)
        } else {
          c.srcIn = Math.min(orig.srcOut - minLen, Math.max(0, orig.srcIn + dt * orig.speed))
        }
      })
    })
  }

  return (
    <div
      className={'tl-clip' + (selected ? ' sel' : '') + (dimmed ? ' dim' : '')}
      style={{ left, width: Math.max(2, width) }}
      onPointerDown={onPointerDown}
      onClick={(e) => {
        e.stopPropagation()
        const s = useEditor.getState()
        s.select(selected ? null : { type: 'clip', id: clip.id })
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="tl-tiles">
        {Array.from({ length: Math.min(tiles, 400) }, (_, i) => {
          const url = thumbAt(i)
          return <div key={i} className="tl-tile" style={{ width: tileW, backgroundImage: url ? `url(${url})` : undefined }} />
        })}
      </div>
      {clip.speed !== 1 && <span className="tl-badge">{clip.speed.toFixed(clip.speed < 1 ? 2 : 1)}x</span>}
      {selected && (
        <>
          <div className="tl-handle l" onPointerDown={trim('l')} />
          <div className="tl-handle r" onPointerDown={trim('r')} />
          <span className="tl-dur">{clipDuration(clip).toFixed(1)}s</span>
        </>
      )}
    </div>
  )
})

// ---------------- Text item ----------------
function TextBlock({ item, half, pps, selected }: { item: TextItem; half: number; pps: number; selected: boolean }) {
  const move = (e: React.PointerEvent) => {
    if (!selected) return
    const o = { ...item }
    startDrag(e, (dx) => {
      useEditor.getState().mutate((p) => {
        const t = p.texts.find((x) => x.id === item.id)
        if (!t) return
        let s = Math.max(0, o.start + dx / pps)
        const sEnd = snap(s + o.duration, pps)
        const sStart = snap(s, pps)
        if (sStart !== s) s = sStart
        else if (sEnd !== s + o.duration) s = sEnd - o.duration
        t.start = Math.max(0, s)
      })
    })
  }
  const trim = (side: 'l' | 'r') => (e: React.PointerEvent) => {
    const o = { ...item }
    startDrag(e, (dx) => {
      useEditor.getState().mutate((p) => {
        const t = p.texts.find((x) => x.id === item.id)
        if (!t) return
        if (side === 'r') t.duration = Math.max(0.2, snap(o.start + o.duration + dx / pps, pps) - o.start)
        else {
          const ns = Math.min(o.start + o.duration - 0.2, Math.max(0, snap(o.start + dx / pps, pps)))
          t.start = ns
          t.duration = o.start + o.duration - ns
        }
      })
    })
  }
  return (
    <div
      className={'tl-item text' + (item.isCaption ? ' caption' : '') + (selected ? ' sel' : '')}
      style={{ left: half + item.start * pps, width: Math.max(4, item.duration * pps) }}
      onClick={(e) => {
        e.stopPropagation()
        useEditor.getState().select(selected ? null : { type: 'text', id: item.id })
      }}
      onPointerDown={move}
    >
      <Type size={12} />
      <span>{item.text}</span>
      {selected && (
        <>
          <div className="tl-handle l" onPointerDown={trim('l')} />
          <div className="tl-handle r" onPointerDown={trim('r')} />
        </>
      )}
    </div>
  )
}

// ---------------- Audio item ----------------
function AudioBlock({ item, half, pps, selected }: { item: AudioItem; half: number; pps: number; selected: boolean }) {
  const [peaks, setPeaks] = useState<Float32Array | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let alive = true
    void getPeaks(item.mediaId).then((p) => alive && setPeaks(p))
    return () => {
      alive = false
    }
  }, [item.mediaId])
  const len = item.srcOut - item.srcIn
  const width = Math.max(4, len * pps)
  useEffect(() => {
    const c = canvasRef.current
    if (!c || !peaks) return
    const w = Math.min(4000, Math.ceil(width))
    c.width = w
    c.height = ROW
    const ctx = c.getContext('2d')!
    ctx.clearRect(0, 0, w, ROW)
    ctx.fillStyle = '#ffffff88'
    for (let x = 0; x < w; x += 2) {
      const t = item.srcIn + (x / w) * len
      const v = peaks[Math.floor(t * 50)] ?? 0
      const h = Math.max(1, v * (ROW - 6) * item.volume)
      ctx.fillRect(x, (ROW - h) / 2, 1, h)
    }
  }, [peaks, width, item.srcIn, len, item.volume])

  const move = (e: React.PointerEvent) => {
    if (!selected) return
    const o = { ...item }
    startDrag(e, (dx) => {
      useEditor.getState().mutate((p) => {
        const a = p.audios.find((x) => x.id === item.id)
        if (a) a.start = Math.max(0, snap(o.start + dx / pps, pps))
      })
    })
  }
  const trim = (side: 'l' | 'r') => (e: React.PointerEvent) => {
    const o = { ...item }
    const max = getMetaSync(item.mediaId)?.duration ?? o.srcOut
    startDrag(e, (dx) => {
      useEditor.getState().mutate((p) => {
        const a = p.audios.find((x) => x.id === item.id)
        if (!a) return
        if (side === 'r') {
          const end = snap(o.start + (o.srcOut - o.srcIn) + dx / pps, pps)
          a.srcOut = Math.min(max, Math.max(o.srcIn + 0.2, o.srcIn + end - o.start))
        } else {
          const d = Math.max(-o.srcIn, Math.min(o.srcOut - o.srcIn - 0.2, dx / pps))
          a.srcIn = o.srcIn + d
          a.start = Math.max(0, o.start + d)
        }
      })
    })
  }
  return (
    <div
      className={'tl-item audio' + (selected ? ' sel' : '')}
      style={{ left: half + item.start * pps, width }}
      onClick={(e) => {
        e.stopPropagation()
        useEditor.getState().select(selected ? null : { type: 'audio', id: item.id })
      }}
      onPointerDown={move}
    >
      <canvas ref={canvasRef} className="tl-wave" style={{ width: Math.min(4000, width), height: ROW }} />
      <Music size={12} />
      <span>{item.name}</span>
      {selected && (
        <>
          <div className="tl-handle l" onPointerDown={trim('l')} />
          <div className="tl-handle r" onPointerDown={trim('r')} />
        </>
      )}
    </div>
  )
}


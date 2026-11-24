import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useEditor } from '../model/store'
import { ASPECTS, clipAt, type Project } from '../model/types'
import { getPlayer } from '../engine/player'
import { canvasSize, clipRect, measureText } from '../engine/compose'
import { getMetaSync } from '../lib/media'

// Preview canvas + direct manipulation: drag to move, pinch to scale
// the selected text or the current clip. Double-tap a text to edit it.

interface Box {
  x: number
  y: number
  w: number
  h: number
}

const measureCtx = document.createElement('canvas').getContext('2d')!

function textBoxes(p: Project, t: number, W: number, H: number) {
  return p.texts
    .filter((x) => t >= x.start && t < x.start + x.duration)
    .map((x) => {
      const m = measureText(measureCtx, W, H, x)
      const pad = m.px * 0.3
      return { id: x.id, box: { x: m.cx - m.w / 2 - pad, y: m.cy - m.h / 2 - pad, w: m.w + pad * 2, h: m.h + pad * 2 } }
    })
}

function clipBox(p: Project, t: number, W: number, H: number): { id: string; box: Box } | null {
  const at = clipAt(p, t)
  if (!at) return null
  const meta = getMetaSync(at.clip.mediaId)
  if (!meta?.width) return null
  const r = clipRect(at.clip, meta.width, meta.height, W, H)
  return { id: at.clip.id, box: { x: r.cx - r.bw / 2, y: r.cy - r.bh / 2, w: r.bw, h: r.bh } }
}

export default function Preview({ onEditText }: { onEditText: () => void }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const project = useEditor((s) => s.project)!
  const selection = useEditor((s) => s.selection)
  const time = useEditor((s) => s.time)
  const aspect = ASPECTS[project.aspect]

  useLayoutEffect(() => {
    const el = wrapRef.current!
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect()
      const pad = 12
      const aw = r.width - pad * 2
      const ah = r.height - pad * 2
      const w = Math.min(aw, ah * aspect)
      setSize({ w: Math.floor(w), h: Math.floor(w / aspect) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [aspect])

  useEffect(() => {
    if (!size.w) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const short = Math.min(size.w, size.h) * dpr
    getPlayer().attach(canvasRef.current, Math.min(720, Math.round(short)))
  }, [size])

  useEffect(() => {
    document.fonts?.addEventListener?.('loadingdone', () => getPlayer().invalidate())
  }, [])

  // ----- Gestures -----
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<{
    kind: 'text' | 'clip'
    id: string
    startX: number
    startY: number
    origX: number
    origY: number
    origScale: number
    startDist: number
    moved: boolean
  } | null>(null)
  const lastTap = useRef({ t: 0, id: '' })

  const toNorm = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect()
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }
  }

  const onDown = (e: React.PointerEvent) => {
    const s = useEditor.getState()
    const p = s.project!
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2 && gesture.current) {
      const [a, b] = [...pointers.current.values()]
      gesture.current.startDist = Math.hypot(a.x - b.x, a.y - b.y)
      const g = gesture.current
      if (g.kind === 'text') g.origScale = p.texts.find((x) => x.id === g.id)?.size ?? 0.05
      else g.origScale = p.clips.find((x) => x.id === g.id)?.scale ?? 1
      return
    }
    if (pointers.current.size > 1) return
    if (s.playing) s.setPlaying(false)
    const n = toNorm(e)
    const { w: W, h: H } = canvasSize(p, 1000)
    const px = n.x * W
    const py = n.y * H
    const hitText = textBoxes(p, s.time, W, H)
      .reverse()
      .find(({ box }) => px >= box.x && px <= box.x + box.w && py >= box.y && py <= box.y + box.h)
    if (hitText) {
      const tx = p.texts.find((x) => x.id === hitText.id)!
      const now = performance.now()
      if (lastTap.current.id === tx.id && now - lastTap.current.t < 350) {
        s.select({ type: 'text', id: tx.id })
        onEditText()
        return
      }
      lastTap.current = { t: now, id: tx.id }
      s.select({ type: 'text', id: tx.id })
      gesture.current = { kind: 'text', id: tx.id, startX: n.x, startY: n.y, origX: tx.x, origY: tx.y, origScale: tx.size, startDist: 0, moved: false }
      return
    }
    const cb = clipBox(p, s.time, W, H)
    if (cb) {
      const c = p.clips.find((x) => x.id === cb.id)!
      s.select({ type: 'clip', id: c.id })
      gesture.current = { kind: 'clip', id: c.id, startX: n.x, startY: n.y, origX: c.x, origY: c.y, origScale: c.scale, startDist: 0, moved: false }
    } else s.select(null)
  }

  const onMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const g = gesture.current
    if (!g) return
    const s = useEditor.getState()
    if (!g.moved) {
      s.checkpoint()
      g.moved = true
    }
    if (pointers.current.size >= 2 && g.startDist > 0) {
      const [a, b] = [...pointers.current.values()]
      const k = Math.hypot(a.x - b.x, a.y - b.y) / g.startDist
      s.mutate((p) => {
        if (g.kind === 'text') {
          const t = p.texts.find((x) => x.id === g.id)
          if (t) t.size = Math.max(0.01, Math.min(0.4, g.origScale * k))
        } else {
          const c = p.clips.find((x) => x.id === g.id)
          if (c) c.scale = Math.max(0.1, Math.min(8, g.origScale * k))
        }
      })
      return
    }
    const n = toNorm(e)
    let dx = n.x - g.startX
    let dy = n.y - g.startY
    s.mutate((p) => {
      if (g.kind === 'text') {
        const t = p.texts.find((x) => x.id === g.id)
        if (!t) return
        let nx = g.origX + dx
        let ny = g.origY + dy
        // Snap to center lines.
        if (Math.abs(nx - 0.5) < 0.02) nx = 0.5
        if (Math.abs(ny - 0.5) < 0.02) ny = 0.5
        t.x = Math.max(0, Math.min(1, nx))
        t.y = Math.max(0, Math.min(1, ny))
      } else {
        const c = p.clips.find((x) => x.id === g.id)
        if (!c) return
        if (Math.abs(g.origX + dx) < 0.02) dx = -g.origX
        if (Math.abs(g.origY + dy) < 0.02) dy = -g.origY
        c.x = g.origX + dx
        c.y = g.origY + dy
      }
    })
  }

  const onUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size === 0) gesture.current = null
    else if (gesture.current) gesture.current.startDist = 0
  }

  // Selection outline
  let outline: Box | null = null
  if (selection && size.w) {
    const W = size.w
    const H = size.h
    if (selection.type === 'text') outline = textBoxes(project, time, W, H).find((b) => b.id === selection.id)?.box ?? null
    else if (selection.type === 'clip') {
      const cb = clipBox(project, time, W, H)
      if (cb && cb.id === selection.id) outline = cb.box
    }
  }
  const canvasStyle = { width: size.w, height: size.h }

  return (
    <div className="ed-preview" ref={wrapRef}>
      <div className="ed-stage" style={canvasStyle}>
        <canvas
          ref={canvasRef}
          style={canvasStyle}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        />
        {outline && (
          <div
            className={'sel-outline ' + selection!.type}
            style={{ left: outline.x, top: outline.y, width: outline.w, height: outline.h }}
          />
        )}
      </div>
    </div>
  )
}

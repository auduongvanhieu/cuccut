import { useEditor } from '../model/store'
import { clipAt, clipDuration, clipStarts, projectDuration, type Project } from '../model/types'
import { getImage, getUrl } from '../lib/media'
import { canvasSize, drawFrame, type SourceFrame } from './compose'

// Preview engine: hardware-decoded <video>/<audio> elements, routed through Web Audio
// for volume control (iOS ignores element.volume), drawn onto a canvas each frame.

interface MediaEl {
  el: HTMLVideoElement | HTMLAudioElement
  gain?: GainNode
  ready: boolean
}

export class Player {
  private canvas: HTMLCanvasElement | null = null
  private ctx: CanvasRenderingContext2D | null = null
  private host: HTMLDivElement
  private els = new Map<string, MediaEl>() // key: mediaId (video) or 'a:'+mediaId (audio)
  private images = new Map<string, ImageBitmap>()
  private actx: AudioContext | null = null
  private raf = 0
  private dirty = true
  private wallStart = 0
  private tStart = 0
  private unsub: () => void
  private lastProject: Project | null = null
  private shortSide = 540

  constructor() {
    this.host = document.createElement('div')
    this.host.style.cssText =
      'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none;overflow:hidden;z-index:-1'
    document.body.appendChild(this.host)
    this.unsub = useEditor.subscribe((s, prev) => {
      if (s.project !== prev.project || s.time !== prev.time || s.selection !== prev.selection) this.dirty = true
      if (s.playing !== prev.playing) {
        if (s.playing) this.startPlayback()
        else this.stopPlayback()
      }
      if (s.project !== this.lastProject) {
        this.lastProject = s.project
        if (s.project) void this.prepare(s.project)
      }
    })
    const p = useEditor.getState().project
    if (p) {
      this.lastProject = p
      void this.prepare(p)
    }
    this.loop = this.loop.bind(this)
    this.raf = requestAnimationFrame(this.loop)
  }

  attach(canvas: HTMLCanvasElement | null, shortSide: number) {
    this.canvas = canvas
    this.ctx = canvas?.getContext('2d') ?? null
    this.shortSide = shortSide
    this.dirty = true
  }

  destroy() {
    cancelAnimationFrame(this.raf)
    this.unsub()
    for (const m of this.els.values()) {
      m.el.pause()
      m.el.removeAttribute('src')
      m.el.load()
    }
    this.els.clear()
    this.host.remove()
    void this.actx?.close()
  }

  /** Must be called from a user gesture (tap on play) for iOS audio. */
  unlockAudio() {
    if (!this.actx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      this.actx = new AC()
      for (const m of this.els.values()) this.connect(m)
    }
    void this.actx.resume()
  }

  private connect(m: MediaEl) {
    if (!this.actx || m.gain) return
    try {
      const src = this.actx.createMediaElementSource(m.el)
      m.gain = this.actx.createGain()
      src.connect(m.gain).connect(this.actx.destination)
    } catch (e) {
      console.warn(e)
    }
  }

  private async prepare(p: Project) {
    const vids = new Set(p.clips.filter((c) => c.kind === 'video').map((c) => c.mediaId))
    const auds = new Set(p.audios.map((a) => a.mediaId))
    for (const id of vids) if (!this.els.has(id)) await this.makeEl(id, 'video', id)
    for (const id of auds) if (!this.els.has('a:' + id)) await this.makeEl('a:' + id, 'audio', id)
    for (const c of p.clips)
      if (c.kind === 'image' && !this.images.has(c.mediaId)) {
        this.images.set(c.mediaId, await getImage(c.mediaId))
        this.dirty = true
      }
  }

  private async makeEl(key: string, kind: 'video' | 'audio', mediaId: string) {
    const el = document.createElement(kind)
    const m: MediaEl = { el, ready: false }
    this.els.set(key, m)
    el.preload = 'auto'
    el.crossOrigin = 'anonymous'
    if (el instanceof HTMLVideoElement) {
      el.playsInline = true
      el.setAttribute('playsinline', '')
      el.setAttribute('webkit-playsinline', '')
      el.width = 2
      el.height = 2
    }
    el.addEventListener('loadeddata', () => {
      m.ready = true
      this.dirty = true
    })
    el.addEventListener('seeked', () => (this.dirty = true))
    el.src = await getUrl(mediaId)
    this.host.appendChild(el)
    this.connect(m)
  }

  private startPlayback() {
    const s = useEditor.getState()
    if (!s.project) return
    if (s.time >= projectDuration(s.project) - 0.05) useEditor.getState().setTime(0)
    this.tStart = useEditor.getState().time
    this.wallStart = performance.now()
  }

  private stopPlayback() {
    for (const m of this.els.values()) m.el.pause()
    this.dirty = true
  }

  private loop(now: number) {
    this.raf = requestAnimationFrame(this.loop)
    const s = useEditor.getState()
    const p = s.project
    if (!p) return
    let t = s.time
    if (s.playing) {
      t = this.tStart + (now - this.wallStart) / 1000
      const dur = projectDuration(p)
      if (t >= dur) {
        t = dur
        useEditor.setState({ playing: false, time: dur })
      } else useEditor.setState({ time: t })
      this.dirty = true
    }
    this.sync(p, t, s.playing)
    if (this.dirty) this.draw(p, t)
  }

  private sync(p: Project, t: number, playing: boolean) {
    const at = clipAt(p, t)
    const activeKeys = new Set<string>()
    if (at && at.clip.kind === 'video') {
      const m = this.els.get(at.clip.mediaId)
      if (m) {
        activeKeys.add(at.clip.mediaId)
        const el = m.el
        if (m.gain) m.gain.gain.value = at.clip.volume
        if (playing) {
          if (el.playbackRate !== at.clip.speed) el.playbackRate = at.clip.speed
          if (Math.abs(el.currentTime - at.srcTime) > 0.25) el.currentTime = at.srcTime
          if (el.paused) void el.play().catch(() => {})
        } else if (Math.abs(el.currentTime - at.srcTime) > 0.02 && !el.seeking) {
          el.currentTime = at.srcTime
        }
      }
      // Preload the next clip's first frame shortly before the cut.
      const starts = clipStarts(p)
      const next = p.clips[at.index + 1]
      if (next && next.kind === 'video' && next.mediaId !== at.clip.mediaId) {
        const end = starts[at.index] + clipDuration(at.clip)
        const nm = this.els.get(next.mediaId)
        if (nm && end - t < 1 && Math.abs(nm.el.currentTime - next.srcIn) > 0.05 && !nm.el.seeking) {
          nm.el.currentTime = next.srcIn
        }
        if (nm) activeKeys.add(next.mediaId)
      }
    }
    for (const a of p.audios) {
      const key = 'a:' + a.mediaId
      const m = this.els.get(key)
      if (!m) continue
      const local = t - a.start
      const len = a.srcOut - a.srcIn
      if (local < 0 || local >= len) continue
      activeKeys.add(key)
      if (m.gain) {
        let g = a.volume
        if (a.fadeIn > 0) g *= Math.min(1, local / a.fadeIn)
        if (a.fadeOut > 0) g *= Math.min(1, (len - local) / a.fadeOut)
        m.gain.gain.value = g
      }
      const src = a.srcIn + local
      if (playing) {
        if (Math.abs(m.el.currentTime - src) > 0.25) m.el.currentTime = src
        if (m.el.paused) void m.el.play().catch(() => {})
      }
    }
    for (const [key, m] of this.els) {
      const isActive = activeKeys.has(key)
      if (!playing || !isActive) {
        if (!m.el.paused) m.el.pause()
      }
      // Pause preloaded-but-not-current next clip during playback
      if (playing && isActive && at && key !== at.clip.mediaId && !key.startsWith('a:') && !m.el.paused) m.el.pause()
    }
  }

  private currentFrame(p: Project, t: number): SourceFrame | null {
    const at = clipAt(p, t)
    if (!at) return null
    if (at.clip.kind === 'image') {
      const img = this.images.get(at.clip.mediaId)
      return img ? { img, w: img.width, h: img.height } : null
    }
    const m = this.els.get(at.clip.mediaId)
    const v = m?.el as HTMLVideoElement | undefined
    if (!v || v.readyState < 2 || !v.videoWidth) return null
    return { img: v, w: v.videoWidth, h: v.videoHeight }
  }

  private draw(p: Project, t: number) {
    const c = this.canvas
    const ctx = this.ctx
    if (!c || !ctx) return
    const { w, h } = canvasSize(p, this.shortSide)
    if (c.width !== w || c.height !== h) {
      c.width = w
      c.height = h
    }
    const frame = this.currentFrame(p, t)
    const st = useEditor.getState()
    const sel = st.selection
    drawFrame(ctx, w, h, p, t, frame, { staticTextId: !st.playing && sel?.type === 'text' ? sel.id : undefined })
    // Keep redrawing while a video frame is still loading.
    const at = clipAt(p, t)
    this.dirty = !!at && !frame
  }

  /** Force a redraw (e.g. after fonts load). */
  invalidate() {
    this.dirty = true
  }
}

let instance: Player | null = null
export const getPlayer = () => (instance ??= new Player())
export function destroyPlayer() {
  instance?.destroy()
  instance = null
}

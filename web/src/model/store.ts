import { create } from 'zustand'
import { produce } from 'immer'
import { nanoid } from 'nanoid'
import {
  SCHEMA_VERSION,
  clipDuration,
  clipStarts,
  defaultAdjust,
  projectDuration,
  type AudioItem,
  type Clip,
  type MediaMeta,
  type Project,
  type Selection,
  type TextItem,
} from './types'
import { saveProject } from '../storage/db'

const HISTORY_LIMIT = 100

export interface EditorState {
  project: Project | null
  selection: Selection
  time: number
  playing: boolean
  pxPerSec: number
  past: Project[]
  future: Project[]
  dirty: boolean

  open(p: Project): void
  close(): void
  /** Push current project onto the undo stack (call once before a drag gesture). */
  checkpoint(): void
  /** Mutate without recording history (use during drags, after checkpoint()). */
  mutate(fn: (p: Project) => void): void
  /** checkpoint() + mutate(). */
  edit(fn: (p: Project) => void): void
  undo(): void
  redo(): void
  select(s: Selection): void
  setTime(t: number): void
  setPlaying(b: boolean): void
  setZoom(px: number): void
}

export const newProject = (name: string): Project => ({
  v: SCHEMA_VERSION,
  id: nanoid(10),
  name,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  aspect: '9:16',
  bg: { type: 'blur', color: '#000000' },
  clips: [],
  texts: [],
  audios: [],
})

export const useEditor = create<EditorState>((set, get) => ({
  project: null,
  selection: null,
  time: 0,
  playing: false,
  pxPerSec: 60,
  past: [],
  future: [],
  dirty: false,

  open: (p) => set({ project: p, selection: null, time: 0, playing: false, past: [], future: [], dirty: false }),
  close: () => set({ project: null, selection: null, playing: false, past: [], future: [] }),

  checkpoint: () => {
    const { project, past } = get()
    if (!project) return
    set({ past: [...past.slice(-HISTORY_LIMIT + 1), project], future: [] })
  },
  mutate: (fn) => {
    const { project } = get()
    if (!project) return
    const next = produce(project, (d) => {
      fn(d)
      d.updatedAt = Date.now()
    })
    const dur = projectDuration(next)
    set({ project: next, dirty: true, time: Math.min(get().time, dur) })
    scheduleSave()
  },
  edit: (fn) => {
    get().checkpoint()
    get().mutate(fn)
  },
  undo: () => {
    const { past, project, future } = get()
    if (!past.length || !project) return
    const prev = past[past.length - 1]
    set({ project: prev, past: past.slice(0, -1), future: [project, ...future], selection: null })
    scheduleSave()
  },
  redo: () => {
    const { past, project, future } = get()
    if (!future.length || !project) return
    set({ project: future[0], past: [...past, project], future: future.slice(1), selection: null })
    scheduleSave()
  },
  select: (s) => set({ selection: s }),
  setTime: (t) => {
    const p = get().project
    const d = p ? projectDuration(p) : 0
    set({ time: Math.max(0, Math.min(t, d)) })
  },
  setPlaying: (b) => set({ playing: b }),
  setZoom: (px) => set({ pxPerSec: Math.max(8, Math.min(600, px)) }),
}))

let saveTimer: ReturnType<typeof setTimeout> | undefined
function scheduleSave() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(flushSave, 600)
}
export async function flushSave() {
  clearTimeout(saveTimer)
  const p = useEditor.getState().project
  if (p) {
    await saveProject(p)
    useEditor.setState({ dirty: false })
  }
}
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => void flushSave())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushSave()
  })
}

// ---------- Domain helpers (pure, operate on a draft) ----------

export function makeClip(meta: MediaMeta): Clip {
  return {
    id: nanoid(10),
    mediaId: meta.id,
    kind: meta.kind === 'image' ? 'image' : 'video',
    srcIn: 0,
    srcOut: meta.kind === 'image' ? 3 : meta.duration,
    speed: 1,
    volume: 1,
    rotation: 0,
    flipH: false,
    scale: 1,
    x: 0,
    y: 0,
    adjust: defaultAdjust(),
  }
}

export function makeText(start: number, text = 'Nhập chữ'): TextItem {
  return {
    id: nanoid(10),
    text,
    start,
    duration: 3,
    x: 0.5,
    y: 0.5,
    size: 0.05,
    color: '#ffffff',
    stroke: '#000000',
    bg: null,
    font: 'Be Vietnam Pro',
    bold: true,
    align: 'center',
    anim: 'pop',
  }
}

export function makeAudio(meta: MediaMeta, start: number): AudioItem {
  return {
    id: nanoid(10),
    mediaId: meta.id,
    name: meta.name.replace(/\.[^.]+$/, ''),
    start,
    srcIn: 0,
    srcOut: meta.duration,
    volume: 1,
    fadeIn: 0,
    fadeOut: 0,
  }
}

/** Split the main-track clip under time t. Returns the id of the right half. */
export function splitClipAt(p: Project, t: number): string | null {
  const starts = clipStarts(p)
  for (let i = 0; i < p.clips.length; i++) {
    const c = p.clips[i]
    const s = starts[i]
    const d = clipDuration(c)
    if (t > s + 0.05 && t < s + d - 0.05) {
      const cut = c.srcIn + (t - s) * c.speed
      const right: Clip = { ...JSON.parse(JSON.stringify(c)), id: nanoid(10), srcIn: cut }
      if (c.kind === 'image') {
        right.srcIn = 0
        right.srcOut = (s + d - t) * c.speed
        c.srcOut = (t - s) * c.speed
      } else {
        c.srcOut = cut
      }
      p.clips.splice(i + 1, 0, right)
      return right.id
    }
  }
  return null
}

export function splitAudioAt(p: Project, id: string, t: number): string | null {
  const i = p.audios.findIndex((a) => a.id === id)
  if (i < 0) return null
  const a = p.audios[i]
  const len = a.srcOut - a.srcIn
  if (t <= a.start + 0.05 || t >= a.start + len - 0.05) return null
  const cut = a.srcIn + (t - a.start)
  const right: AudioItem = { ...a, id: nanoid(10), srcIn: cut, start: t, fadeIn: 0 }
  a.srcOut = cut
  a.fadeOut = 0
  p.audios.splice(i + 1, 0, right)
  return right.id
}

export function splitTextAt(p: Project, id: string, t: number): string | null {
  const i = p.texts.findIndex((x) => x.id === id)
  if (i < 0) return null
  const x = p.texts[i]
  if (t <= x.start + 0.05 || t >= x.start + x.duration - 0.05) return null
  const right: TextItem = { ...x, id: nanoid(10), start: t, duration: x.start + x.duration - t }
  x.duration = t - x.start
  p.texts.splice(i + 1, 0, right)
  return right.id
}

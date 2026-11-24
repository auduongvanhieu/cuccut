// Project JSON: the single source of truth for preview and export.
// All times are in seconds. Positions are normalized to the canvas (0..1).

export const SCHEMA_VERSION = 1

export type Aspect = '9:16' | '1:1' | '4:5' | '16:9' | '3:4'

export const ASPECTS: Record<Aspect, number> = {
  '9:16': 9 / 16,
  '1:1': 1,
  '4:5': 4 / 5,
  '16:9': 16 / 9,
  '3:4': 3 / 4,
}

export type MediaKind = 'video' | 'image' | 'audio'

export interface MediaMeta {
  id: string
  name: string
  kind: MediaKind
  mime: string
  size: number
  duration: number // 0 for images
  width: number
  height: number
  hasAudio: boolean
}

export interface Adjust {
  brightness: number // -1..1
  contrast: number // -1..1
  saturation: number // -1..1
}

export interface Clip {
  id: string
  mediaId: string
  kind: 'video' | 'image'
  srcIn: number // source start (images: 0)
  srcOut: number // source end (images: display duration)
  speed: number
  volume: number // 0..2
  rotation: 0 | 90 | 180 | 270
  flipH: boolean
  scale: number // 1 = fit (contain)
  x: number // offset, fraction of canvas width
  y: number // offset, fraction of canvas height
  adjust: Adjust
}

export interface TextItem {
  id: string
  text: string
  start: number
  duration: number
  x: number // center, 0..1
  y: number // center, 0..1
  size: number // font size as fraction of canvas height
  color: string
  stroke: string | null
  bg: string | null
  font: string
  bold: boolean
  align: 'left' | 'center' | 'right'
  anim: 'none' | 'fade' | 'pop' | 'slide'
  isCaption?: boolean
}

export interface AudioItem {
  id: string
  mediaId: string
  name: string
  start: number // timeline start
  srcIn: number
  srcOut: number
  volume: number
  fadeIn: number
  fadeOut: number
}

export interface Background {
  type: 'color' | 'blur'
  color: string
}

export interface Project {
  v: number
  id: string
  name: string
  createdAt: number
  updatedAt: number
  aspect: Aspect
  bg: Background
  clips: Clip[]
  texts: TextItem[]
  audios: AudioItem[]
  thumb?: string // small data URL for the home screen
}

export type Selection =
  | { type: 'clip'; id: string }
  | { type: 'text'; id: string }
  | { type: 'audio'; id: string }
  | null

export const clipDuration = (c: Clip) => (c.srcOut - c.srcIn) / c.speed

export const projectDuration = (p: Project) => {
  let d = p.clips.reduce((s, c) => s + clipDuration(c), 0)
  for (const t of p.texts) d = Math.max(d, t.start + t.duration)
  for (const a of p.audios) d = Math.max(d, a.start + (a.srcOut - a.srcIn))
  return d
}

/** Length of the video track only (export length when clips exist). */
export const videoDuration = (p: Project) => p.clips.reduce((s, c) => s + clipDuration(c), 0)

export interface ClipAt {
  clip: Clip
  index: number
  start: number // timeline start
  local: number // seconds into the clip (timeline time)
  srcTime: number // seconds in the source media
}

export function clipAt(p: Project, t: number): ClipAt | null {
  let start = 0
  for (let i = 0; i < p.clips.length; i++) {
    const c = p.clips[i]
    const d = clipDuration(c)
    if (t < start + d || i === p.clips.length - 1) {
      const local = Math.min(Math.max(0, t - start), d)
      if (t > start + d + 1e-6) return null
      return { clip: c, index: i, start, local, srcTime: c.srcIn + local * c.speed }
    }
    start += d
  }
  return null
}

export function clipStarts(p: Project): number[] {
  const out: number[] = []
  let s = 0
  for (const c of p.clips) {
    out.push(s)
    s += clipDuration(c)
  }
  return out
}

export const defaultAdjust = (): Adjust => ({ brightness: 0, contrast: 0, saturation: 0 })

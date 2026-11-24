import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny'
import { nanoid } from 'nanoid'
import type { MediaKind, MediaMeta } from '../model/types'
import { getMediaBlob, getMediaMeta, putMedia } from '../storage/db'

// Runtime cache: media meta, object URLs, decoded images, thumbnails, waveform peaks.
const metaCache = new Map<string, MediaMeta>()
const urlCache = new Map<string, string>()
const imageCache = new Map<string, Promise<ImageBitmap>>()
const thumbCache = new Map<string, Promise<Thumb[]>>()
const peaksCache = new Map<string, Promise<Float32Array>>()

export interface Thumb {
  t: number
  url: string
}

function kindOf(file: File): MediaKind | null {
  if (file.type.startsWith('video/')) return 'video'
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('audio/')) return 'audio'
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (['mp4', 'mov', 'm4v', 'webm', 'mkv', '3gp'].includes(ext)) return 'video'
  if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'avif'].includes(ext)) return 'image'
  if (['mp3', 'm4a', 'aac', 'wav', 'ogg', 'opus', 'flac'].includes(ext)) return 'audio'
  return null
}

async function probeWithElement(url: string, kind: 'video' | 'audio') {
  return new Promise<{ duration: number; width: number; height: number }>((resolve, reject) => {
    const el = document.createElement(kind)
    el.preload = 'metadata'
    el.muted = true
    el.onloadedmetadata = () => {
      const v = el as HTMLVideoElement
      resolve({ duration: el.duration, width: v.videoWidth || 0, height: v.videoHeight || 0 })
    }
    el.onerror = () => reject(new Error('Không đọc được file'))
    el.src = url
  })
}

export async function importFile(file: File): Promise<MediaMeta> {
  const kind = kindOf(file)
  if (!kind) throw new Error(`Không hỗ trợ định dạng: ${file.name}`)
  const id = nanoid(12)
  const meta: MediaMeta = {
    id,
    name: file.name,
    kind,
    mime: file.type,
    size: file.size,
    duration: 0,
    width: 0,
    height: 0,
    hasAudio: kind !== 'image',
  }
  if (kind === 'image') {
    const bmp = await createImageBitmap(file)
    meta.width = bmp.width
    meta.height = bmp.height
    imageCache.set(id, Promise.resolve(bmp))
  } else {
    let ok = false
    try {
      const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
      meta.duration = await input.computeDuration()
      const v = await input.getPrimaryVideoTrack()
      const a = await input.getPrimaryAudioTrack()
      if (v) {
        meta.width = v.displayWidth
        meta.height = v.displayHeight
      }
      meta.hasAudio = !!a
      if (kind === 'video' && !v) meta.kind = 'audio'
      ok = meta.duration > 0
    } catch {
      ok = false
    }
    if (!ok) {
      const url = URL.createObjectURL(file)
      const r = await probeWithElement(url, kind === 'audio' ? 'audio' : 'video')
      URL.revokeObjectURL(url)
      meta.duration = r.duration
      meta.width = r.width
      meta.height = r.height
    }
  }
  await putMedia(meta, file)
  metaCache.set(id, meta)
  return meta
}

export async function getMeta(id: string): Promise<MediaMeta | undefined> {
  if (metaCache.has(id)) return metaCache.get(id)
  const m = await getMediaMeta(id)
  if (m) metaCache.set(id, m)
  return m
}
export const getMetaSync = (id: string) => metaCache.get(id)

export async function getBlob(id: string): Promise<Blob> {
  const b = await getMediaBlob(id)
  if (!b) throw new Error('Thiếu file media, có thể đã bị xoá khỏi máy')
  return b
}

export async function getUrl(id: string): Promise<string> {
  const c = urlCache.get(id)
  if (c) return c
  const url = URL.createObjectURL(await getBlob(id))
  urlCache.set(id, url)
  return url
}

export function getImage(id: string): Promise<ImageBitmap> {
  let p = imageCache.get(id)
  if (!p) {
    p = getBlob(id).then((b) => createImageBitmap(b))
    imageCache.set(id, p)
  }
  return p
}

async function canvasToUrl(c: HTMLCanvasElement | OffscreenCanvas): Promise<string> {
  const blob =
    'convertToBlob' in c
      ? await c.convertToBlob({ type: 'image/jpeg', quality: 0.7 })
      : await new Promise<Blob>((res) => (c as HTMLCanvasElement).toBlob((b) => res(b!), 'image/jpeg', 0.7))
  return URL.createObjectURL(blob)
}

/** Thumbnails roughly every `step` seconds (step grows for long videos). */
export function getThumbs(id: string): Promise<Thumb[]> {
  let p = thumbCache.get(id)
  if (p) return p
  p = (async () => {
    const meta = await getMeta(id)
    if (!meta) return []
    if (meta.kind === 'image') {
      const bmp = await getImage(id)
      const h = 96
      const c = new OffscreenCanvas(Math.max(1, Math.round((bmp.width / bmp.height) * h)), h)
      c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
      return [{ t: 0, url: await canvasToUrl(c) }]
    }
    if (meta.kind !== 'video') return []
    const blob = await getBlob(id)
    const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS })
    const track = await input.getPrimaryVideoTrack()
    if (!track) return []
    const step = Math.max(1, meta.duration / 60)
    const times: number[] = []
    for (let t = 0; t < meta.duration; t += step) times.push(t)
    const sink = new CanvasSink(track, { height: 96, fit: 'contain', poolSize: 0 })
    const out: Thumb[] = []
    try {
      let i = 0
      for await (const wc of sink.canvasesAtTimestamps(times)) {
        if (wc) out.push({ t: times[i], url: await canvasToUrl(wc.canvas) })
        i++
      }
    } catch (e) {
      console.warn('thumbs failed', e)
    }
    return out
  })()
  thumbCache.set(id, p)
  return p
}

/** Peak amplitudes, 50 per second, for waveforms. */
export function getPeaks(id: string): Promise<Float32Array> {
  let p = peaksCache.get(id)
  if (p) return p
  p = (async () => {
    try {
      const buf = await (await getBlob(id)).arrayBuffer()
      const ctx = new OfflineAudioContext(1, 1, 44100)
      const audio = await ctx.decodeAudioData(buf)
      const perSec = 50
      const n = Math.ceil(audio.duration * perSec)
      const peaks = new Float32Array(n)
      const ch = audio.getChannelData(0)
      const block = Math.floor(audio.sampleRate / perSec)
      for (let i = 0; i < n; i++) {
        let m = 0
        const s = i * block
        for (let j = s; j < s + block && j < ch.length; j += 4) m = Math.max(m, Math.abs(ch[j]))
        peaks[i] = m
      }
      return peaks
    } catch {
      return new Float32Array(0)
    }
  })()
  peaksCache.set(id, p)
  return p
}

export async function preloadMeta(ids: string[]) {
  await Promise.all(ids.map(getMeta))
}

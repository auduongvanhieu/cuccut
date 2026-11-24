import {
  ALL_FORMATS,
  AudioBufferSink,
  AudioBufferSource,
  BlobSource,
  BufferTarget,
  CanvasSink,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
} from 'mediabunny'
import { clipDuration, clipStarts, projectDuration, type Project } from '../model/types'
import { getBlob, getImage } from '../lib/media'
import { canvasSize, drawFrame, type SourceFrame } from './compose'

export interface ExportOptions {
  shortSide: number // 480 | 720 | 1080
  fps: number
  onProgress?: (p: number, label: string) => void
  signal?: AbortSignal
}

export interface ExportResult {
  blob: Blob
  hasAudio: boolean
  codec: string
}

const SR = 48000

async function openInput(mediaId: string, cache: Map<string, Input>) {
  let i = cache.get(mediaId)
  if (!i) {
    i = new Input({ source: new BlobSource(await getBlob(mediaId)), formats: ALL_FORMATS })
    cache.set(mediaId, i)
  }
  return i
}

/** Mix every audible source into one stereo AudioBuffer covering the whole project. */
export async function mixAudio(p: Project, inputs: Map<string, Input>, signal?: AbortSignal): Promise<AudioBuffer | null> {
  const dur = projectDuration(p)
  const audible = p.clips.some((c) => c.kind === 'video' && c.volume > 0) || p.audios.some((a) => a.volume > 0)
  if (!audible || dur <= 0) return null
  const ctx = new OfflineAudioContext(2, Math.ceil(dur * SR), SR)
  let any = false
  const schedule = async (
    mediaId: string,
    srcIn: number,
    srcOut: number,
    at: number,
    speed: number,
    gainAt: (g: GainNode) => void,
  ) => {
    const input = await openInput(mediaId, inputs)
    const track = await input.getPrimaryAudioTrack()
    if (!track) return
    const gain = ctx.createGain()
    gainAt(gain)
    gain.connect(ctx.destination)
    const sink = new AudioBufferSink(track)
    for await (const wb of sink.buffers(srcIn, srcOut)) {
      if (signal?.aborted) throw new DOMException('Đã huỷ', 'AbortError')
      const src = ctx.createBufferSource()
      src.buffer = wb.buffer
      src.playbackRate.value = speed
      src.connect(gain)
      const offset = Math.max(0, srcIn - wb.timestamp)
      const when = at + (wb.timestamp + offset - srcIn) / speed
      const maxLen = Math.min(wb.duration - offset, srcOut - (wb.timestamp + offset))
      if (maxLen <= 0) continue
      src.start(Math.max(0, when), offset, maxLen)
      any = true
    }
  }
  const starts = clipStarts(p)
  for (let i = 0; i < p.clips.length; i++) {
    const c = p.clips[i]
    if (c.kind !== 'video' || c.volume <= 0) continue
    await schedule(c.mediaId, c.srcIn, c.srcOut, starts[i], c.speed, (g) => (g.gain.value = c.volume))
  }
  for (const a of p.audios) {
    if (a.volume <= 0) continue
    const len = a.srcOut - a.srcIn
    await schedule(a.mediaId, a.srcIn, a.srcOut, a.start, 1, (g) => {
      g.gain.setValueAtTime(a.fadeIn > 0 ? 0 : a.volume, a.start)
      if (a.fadeIn > 0) g.gain.linearRampToValueAtTime(a.volume, a.start + a.fadeIn)
      if (a.fadeOut > 0) {
        g.gain.setValueAtTime(a.volume, a.start + len - a.fadeOut)
        g.gain.linearRampToValueAtTime(0, a.start + len)
      }
    })
  }
  if (!any) return null
  return ctx.startRendering()
}

function sliceBuffer(buf: AudioBuffer, from: number, to: number): AudioBuffer {
  const s = Math.floor(from * buf.sampleRate)
  const e = Math.min(buf.length, Math.floor(to * buf.sampleRate))
  const out = new AudioBuffer({ length: Math.max(1, e - s), numberOfChannels: buf.numberOfChannels, sampleRate: buf.sampleRate })
  for (let ch = 0; ch < buf.numberOfChannels; ch++) out.copyToChannel(buf.getChannelData(ch).subarray(s, e), ch)
  return out
}

export async function exportVideo(p: Project, opts: ExportOptions): Promise<ExportResult> {
  const { fps, signal } = opts
  const progress = opts.onProgress ?? (() => {})
  const { w, h } = canvasSize(p, opts.shortSide)
  const total = projectDuration(p)
  if (total <= 0) throw new Error('Dự án đang trống')

  await document.fonts?.ready

  const vcodec = await getFirstEncodableVideoCodec(['avc', 'hevc', 'vp9', 'av1'], { width: w, height: h })
  if (!vcodec) throw new Error('Trình duyệt này không hỗ trợ mã hoá video. Hãy thử Chrome hoặc Safari mới nhất.')
  const acodec = await getFirstEncodableAudioCodec(['aac', 'opus'], { numberOfChannels: 2, sampleRate: SR })

  const inputs = new Map<string, Input>()
  progress(0, 'Đang trộn âm thanh…')
  const mix = acodec ? await mixAudio(p, inputs, signal) : null

  const canvas: OffscreenCanvas | HTMLCanvasElement =
    typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h })
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D

  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() })
  const videoSource = new CanvasSource(canvas, { codec: vcodec, bitrate: QUALITY_HIGH, keyFrameInterval: 2 })
  output.addVideoTrack(videoSource, { frameRate: fps })
  let audioSource: AudioBufferSource | null = null
  if (mix && acodec) {
    audioSource = new AudioBufferSource({ codec: acodec, bitrate: QUALITY_HIGH })
    output.addAudioTrack(audioSource)
  }
  await output.start()

  const onAbort = () => void output.cancel()
  signal?.addEventListener('abort', onAbort)

  let audioPushed = 0
  const pushAudioUntil = async (t: number) => {
    if (!audioSource || !mix) return
    while (audioPushed < Math.min(t, total)) {
      const next = Math.min(audioPushed + 1, total)
      await audioSource.add(sliceBuffer(mix, audioPushed, next))
      audioPushed = next
    }
  }

  const frameCount = Math.max(1, Math.round(total * fps))
  let frameIdx = 0
  const emit = async (frame: SourceFrame | null) => {
    const t = frameIdx / fps
    drawFrame(ctx, w, h, p, t, frame)
    await videoSource.add(t, 1 / fps)
    frameIdx++
    if (frameIdx % fps === 0) {
      await pushAudioUntil(frameIdx / fps + 1)
      progress(0.05 + 0.93 * (frameIdx / frameCount), `Đang xuất ${Math.round((frameIdx / frameCount) * 100)}%`)
    }
    if (signal?.aborted) throw new DOMException('Đã huỷ', 'AbortError')
  }

  try {
    const starts = clipStarts(p)
    for (let i = 0; i < p.clips.length; i++) {
      const c = p.clips[i]
      const end = starts[i] + clipDuration(c)
      const endFrame = Math.min(frameCount, Math.round(end * fps))
      if (c.kind === 'image') {
        const img = await getImage(c.mediaId)
        while (frameIdx < endFrame) await emit({ img, w: img.width, h: img.height })
        continue
      }
      const input = await openInput(c.mediaId, inputs)
      const track = await input.getPrimaryVideoTrack()
      if (!track) {
        while (frameIdx < endFrame) await emit(null)
        continue
      }
      const times: number[] = []
      for (let f = frameIdx; f < endFrame; f++) times.push(c.srcIn + (f / fps - starts[i]) * c.speed)
      const sink = new CanvasSink(track, { poolSize: 2 })
      let last: SourceFrame | null = null
      for await (const wc of sink.canvasesAtTimestamps(times)) {
        if (wc) last = { img: wc.canvas, w: wc.canvas.width, h: wc.canvas.height }
        await emit(last)
      }
    }
    // Tail with only texts/audio (no clips)
    while (frameIdx < frameCount) await emit(null)
    await pushAudioUntil(total)
    progress(0.99, 'Đang hoàn tất…')
    await output.finalize()
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
  const buf = (output.target as BufferTarget).buffer
  if (!buf) throw new Error('Xuất video thất bại')
  progress(1, 'Xong')
  return { blob: new Blob([buf], { type: 'video/mp4' }), hasAudio: !!audioSource, codec: vcodec }
}

/** Render a single frame as JPEG (thumbnails, photo export). */
export async function renderStill(p: Project, t: number, shortSide: number, type = 'image/jpeg', quality = 0.92): Promise<Blob> {
  const { w, h } = canvasSize(p, shortSide)
  const canvas = Object.assign(document.createElement('canvas'), { width: w, height: h })
  const ctx = canvas.getContext('2d')!
  let frame: SourceFrame | null = null
  const starts = clipStarts(p)
  const i = p.clips.findIndex((c, k) => t >= starts[k] && t < starts[k] + clipDuration(c))
  const idx = i >= 0 ? i : p.clips.length ? 0 : -1
  if (idx >= 0) {
    const c = p.clips[idx]
    if (c.kind === 'image') {
      const img = await getImage(c.mediaId)
      frame = { img, w: img.width, h: img.height }
    } else {
      const input = new Input({ source: new BlobSource(await getBlob(c.mediaId)), formats: ALL_FORMATS })
      const track = await input.getPrimaryVideoTrack()
      if (track) {
        const wc = await new CanvasSink(track).getCanvas(c.srcIn + Math.max(0, t - starts[idx]) * c.speed)
        if (wc) frame = { img: wc.canvas, w: wc.canvas.width, h: wc.canvas.height }
      }
    }
  }
  await document.fonts?.ready
  drawFrame(ctx, w, h, p, t, frame)
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), type, quality))
}

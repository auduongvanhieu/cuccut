import { nanoid } from 'nanoid'
import type { Input } from 'mediabunny'
import { mixAudio } from '../engine/export'
import type { Project, TextItem } from '../model/types'

const API = '/api/ai'
const CHUNK_SEC = 10 * 60 // 16 kHz mono WAV ≈ 19 MB per 10 min, under Groq's 25 MB limit

export interface Word {
  start: number
  end: number
  word: string
}
export interface Segment {
  start: number
  end: number
  text: string
}

export async function aiHealth(): Promise<{ stt: boolean; remainingMinutesToday: number } | null> {
  try {
    const r = await fetch(`${API}/health`, { cache: 'no-store' })
    return r.ok ? await r.json() : null
  } catch {
    return null
  }
}

/** Mix the video track's audio (not background music) to 16 kHz mono. */
async function speechAudio(p: Project): Promise<AudioBuffer | null> {
  const speechOnly: Project = { ...p, audios: [] }
  const mix = await mixAudio(speechOnly, new Map<string, Input>())
  if (!mix) return null
  const SR = 16000
  const off = new OfflineAudioContext(1, Math.ceil(mix.duration * SR), SR)
  const src = off.createBufferSource()
  src.buffer = mix
  src.connect(off.destination)
  src.start()
  return off.startRendering()
}

function encodeWav(buf: AudioBuffer, from: number, to: number): Blob {
  const sr = buf.sampleRate
  const data = buf.getChannelData(0).subarray(Math.floor(from * sr), Math.floor(to * sr))
  const out = new DataView(new ArrayBuffer(44 + data.length * 2))
  const str = (o: number, s: string) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)))
  str(0, 'RIFF')
  out.setUint32(4, 36 + data.length * 2, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  out.setUint32(16, 16, true)
  out.setUint16(20, 1, true) // PCM
  out.setUint16(22, 1, true) // mono
  out.setUint32(24, sr, true)
  out.setUint32(28, sr * 2, true)
  out.setUint16(32, 2, true)
  out.setUint16(34, 16, true)
  str(36, 'data')
  out.setUint32(40, data.length * 2, true)
  for (let i = 0; i < data.length; i++) {
    const v = Math.max(-1, Math.min(1, data[i]))
    out.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true)
  }
  return new Blob([out.buffer], { type: 'audio/wav' })
}

export async function transcribeProject(
  p: Project,
  lang: string,
  onProgress: (p: number, label: string) => void,
): Promise<{ words: Word[]; segments: Segment[] }> {
  onProgress(0.05, 'Đang tách âm thanh…')
  const audio = await speechAudio(p)
  if (!audio) throw new Error('Video không có âm thanh để tạo phụ đề')
  const words: Word[] = []
  const segments: Segment[] = []
  const n = Math.ceil(audio.duration / CHUNK_SEC)
  for (let i = 0; i < n; i++) {
    const from = i * CHUNK_SEC
    const to = Math.min(audio.duration, from + CHUNK_SEC)
    onProgress(0.15 + (0.8 * i) / n, n > 1 ? `Đang nhận dạng giọng nói (${i + 1}/${n})…` : 'Đang nhận dạng giọng nói…')
    const r = await fetch(`${API}/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'audio/wav', 'X-Language': lang, 'X-Audio-Duration': String(to - from) },
      body: encodeWav(audio, from, to),
    })
    const body = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(body.error || `Lỗi ${r.status}`)
    for (const w of body.words ?? []) words.push({ start: w.start + from, end: w.end + from, word: w.word })
    for (const s of body.segments ?? []) segments.push({ start: s.start + from, end: s.end + from, text: s.text })
  }
  onProgress(1, 'Xong')
  return { words, segments }
}

/** Group words into short caption lines (≤ maxChars, ≤ 3.5 s, break on punctuation/pauses). */
export function buildLines(words: Word[], segments: Segment[], maxChars = 32): Segment[] {
  if (!words.length) return segments.map((s) => ({ ...s, text: s.text.trim() })).filter((s) => s.text)
  const lines: Segment[] = []
  let cur: Word[] = []
  const flush = () => {
    if (!cur.length) return
    const text = cur
      .map((w) => w.word.trim())
      .join(' ')
      .replace(/\s+([,.!?…:;])/g, '$1')
      .trim()
    if (text) lines.push({ start: cur[0].start, end: cur[cur.length - 1].end, text })
    cur = []
  }
  for (const w of words) {
    const prev = cur[cur.length - 1]
    const len = cur.reduce((s, x) => s + x.word.trim().length + 1, 0) + w.word.trim().length
    if (prev && (w.start - prev.end > 0.6 || len > maxChars || w.end - cur[0].start > 3.5)) flush()
    cur.push(w)
    if (/[.!?…]$/.test(w.word.trim())) flush()
  }
  flush()
  // Close tiny gaps so captions don't flicker.
  for (let i = 0; i < lines.length - 1; i++) if (lines[i + 1].start - lines[i].end < 0.3) lines[i].end = lines[i + 1].start
  return lines
}

export type CaptionStyle = Pick<TextItem, 'font' | 'size' | 'color' | 'stroke' | 'bg' | 'bold' | 'y'>

export const CAPTION_STYLES: { id: string; label: string; style: CaptionStyle }[] = [
  { id: 'classic', label: 'Cổ điển', style: { font: 'Be Vietnam Pro', size: 0.042, color: '#ffffff', stroke: '#000000', bg: null, bold: true, y: 0.8 } },
  { id: 'box', label: 'Hộp đen', style: { font: 'Be Vietnam Pro', size: 0.038, color: '#ffffff', stroke: null, bg: '#000000aa', bold: true, y: 0.8 } },
  { id: 'yellow', label: 'Vàng', style: { font: 'Montserrat', size: 0.045, color: '#ffcc00', stroke: '#000000', bg: null, bold: true, y: 0.78 } },
  { id: 'bold', label: 'Nổi bật', style: { font: 'Bangers', size: 0.06, color: '#ffffff', stroke: '#000000', bg: null, bold: false, y: 0.72 } },
]

export function linesToTexts(lines: Segment[], style: CaptionStyle): TextItem[] {
  return lines.map((l) => ({
    id: nanoid(10),
    text: l.text,
    start: l.start,
    duration: Math.max(0.3, l.end - l.start),
    x: 0.5,
    align: 'center',
    anim: 'none',
    isCaption: true,
    ...style,
  }))
}

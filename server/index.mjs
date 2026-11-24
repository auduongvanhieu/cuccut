// CucCut AI proxy: forwards speech-to-text requests to Groq Whisper.
// No dependencies (Node >= 20). Hard monthly spend cap + per-IP daily limit.
//
// Env:
//   PORT=7820
//   GROQ_API_KEY=gsk_...
//   GROQ_MODEL=whisper-large-v3-turbo
//   PRICE_PER_HOUR=0.04          (USD per audio hour for the model)
//   MONTHLY_BUDGET_USD=30
//   PER_IP_DAILY_MINUTES=30
//   DATA_DIR=/var/lib/cuccut     (usage.json lives here)
//   ALLOWED_ORIGINS=https://cuccut.coffeesos.online,http://localhost:5190

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const env = (k, d) => process.env[k] ?? d
const PORT = Number(env('PORT', 7820))
const GROQ_API_KEY = env('GROQ_API_KEY', '')
const GROQ_MODEL = env('GROQ_MODEL', 'whisper-large-v3-turbo')
const GROQ_URL = env('GROQ_URL', 'https://api.groq.com/openai/v1/audio/transcriptions')
const PRICE_PER_HOUR = Number(env('PRICE_PER_HOUR', 0.04))
const MONTHLY_BUDGET = Number(env('MONTHLY_BUDGET_USD', 30))
const PER_IP_DAILY_MIN = Number(env('PER_IP_DAILY_MINUTES', 30))
const DATA_DIR = env('DATA_DIR', path.resolve('data'))
const ALLOWED = env('ALLOWED_ORIGINS', 'https://cuccut.coffeesos.online')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const MAX_BODY = 24 * 1024 * 1024 // Groq free-tier file limit is 25 MB
const MIN_BILLED_SEC = 10 // Groq bills at least 10 s per request

fs.mkdirSync(DATA_DIR, { recursive: true })
const USAGE_FILE = path.join(DATA_DIR, 'usage.json')

// ---------- usage accounting ----------
const monthKey = () => new Date().toISOString().slice(0, 7)
const dayKey = () => new Date().toISOString().slice(0, 10)
let usage = { month: monthKey(), seconds: 0, requests: 0, ip: {} }
try {
  usage = { ...usage, ...JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8')) }
} catch {
  /* first run */
}
function rollover() {
  if (usage.month !== monthKey()) usage = { month: monthKey(), seconds: 0, requests: 0, ip: {} }
  const today = dayKey()
  for (const k of Object.keys(usage.ip)) if (!k.endsWith(today)) delete usage.ip[k]
}
let saveTimer
function save() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => fs.writeFile(USAGE_FILE, JSON.stringify(usage), () => {}), 500)
}
const spent = () => (usage.seconds / 3600) * PRICE_PER_HOUR
const remainingMinutes = () => Math.max(0, ((MONTHLY_BUDGET - spent()) / PRICE_PER_HOUR) * 60)
const ipKey = (ip) => `${ip}|${dayKey()}`
const ipUsedMinutes = (ip) => (usage.ip[ipKey(ip)] ?? 0) / 60

// ---------- helpers ----------
function clientIp(req) {
  // nginx sets X-Real-IP (Cloudflare real IP is already resolved there)
  return String(req.headers['x-real-ip'] || req.socket.remoteAddress || '?')
}
function cors(req, res) {
  const o = req.headers.origin
  if (o && ALLOWED.includes(o)) {
    res.setHeader('Access-Control-Allow-Origin', o)
    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Audio-Duration, X-Language')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  }
}
function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > limit) {
        reject(Object.assign(new Error('File âm thanh quá lớn'), { status: 413 }))
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}
/** Duration of a 16-bit PCM WAV, or null. */
function wavDuration(buf) {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null
  let off = 12
  let byteRate = 0
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4)
    const len = buf.readUInt32LE(off + 4)
    if (id === 'fmt ') byteRate = buf.readUInt32LE(off + 16)
    if (id === 'data') return byteRate ? Math.min(len, buf.length - off - 8) / byteRate : null
    off += 8 + len + (len % 2)
  }
  return null
}

let inflight = 0
const MAX_INFLIGHT = 4

async function transcribe(req, res) {
  if (!GROQ_API_KEY) return json(res, 503, { error: 'Máy chủ chưa cấu hình dịch vụ phụ đề.' })
  rollover()
  const ip = clientIp(req)
  const ct = String(req.headers['content-type'] || '')
  if (!/^audio\/(wav|x-wav|ogg|webm|mp4|mpeg|flac)/.test(ct)) return json(res, 415, { error: 'Định dạng âm thanh không hỗ trợ' })
  const body = await readBody(req, MAX_BODY)
  // Trust the WAV header when possible; otherwise the client-declared duration.
  let dur = ct.includes('wav') ? wavDuration(body) : null
  if (dur == null) dur = Number(req.headers['x-audio-duration'] || 0)
  if (!(dur > 0) || dur > 3 * 3600) return json(res, 400, { error: 'Không xác định được độ dài âm thanh' })
  const billed = Math.max(MIN_BILLED_SEC, dur)
  if (billed / 60 > remainingMinutes())
    return json(res, 429, { error: 'Đã hết hạn mức phụ đề online của tháng này. Hãy thử lại tháng sau.', code: 'budget' })
  if (ipUsedMinutes(ip) + billed / 60 > PER_IP_DAILY_MIN)
    return json(res, 429, { error: `Mỗi ngày bạn được tạo phụ đề tối đa ${PER_IP_DAILY_MIN} phút âm thanh. Hãy thử lại vào ngày mai.`, code: 'ip' })
  if (inflight >= MAX_INFLIGHT) return json(res, 503, { error: 'Máy chủ đang bận, thử lại sau ít giây.' })

  const lang = String(req.headers['x-language'] || 'vi')
  const form = new FormData()
  const ext = ct.includes('wav') ? 'wav' : ct.includes('ogg') ? 'ogg' : ct.includes('webm') ? 'webm' : ct.includes('flac') ? 'flac' : ct.includes('mpeg') ? 'mp3' : 'm4a'
  form.append('file', new Blob([body], { type: ct }), `audio.${ext}`)
  form.append('model', GROQ_MODEL)
  form.append('response_format', 'verbose_json')
  form.append('timestamp_granularities[]', 'word')
  form.append('timestamp_granularities[]', 'segment')
  form.append('temperature', '0')
  if (lang && lang !== 'auto') form.append('language', lang)

  inflight++
  // Reserve before calling so parallel requests cannot overshoot the cap.
  usage.seconds += billed
  usage.requests++
  usage.ip[ipKey(ip)] = (usage.ip[ipKey(ip)] ?? 0) + billed
  save()
  try {
    const r = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
      body: form,
      signal: AbortSignal.timeout(120_000),
    })
    const text = await r.text()
    if (!r.ok) {
      // Refund on upstream failure.
      usage.seconds -= billed
      usage.ip[ipKey(ip)] -= billed
      save()
      console.error('groq error', r.status, text.slice(0, 500))
      return json(res, 502, { error: r.status === 429 ? 'Dịch vụ phụ đề đang quá tải, thử lại sau.' : 'Dịch vụ phụ đề gặp lỗi.' })
    }
    const data = JSON.parse(text)
    return json(res, 200, {
      language: data.language,
      duration: data.duration,
      segments: (data.segments ?? []).map((s) => ({ start: s.start, end: s.end, text: s.text })),
      words: (data.words ?? []).map((w) => ({ start: w.start, end: w.end, word: w.word })),
    })
  } catch (e) {
    usage.seconds -= billed
    usage.ip[ipKey(ip)] -= billed
    save()
    console.error('transcribe failed', e)
    return json(res, 502, { error: 'Không kết nối được dịch vụ phụ đề.' })
  } finally {
    inflight--
  }
}

const server = http.createServer(async (req, res) => {
  try {
    cors(req, res)
    if (req.method === 'OPTIONS') return res.writeHead(204).end()
    const url = new URL(req.url, 'http://x')
    if (req.method === 'GET' && url.pathname === '/api/ai/health') {
      rollover()
      return json(res, 200, {
        stt: !!GROQ_API_KEY && remainingMinutes() > 0,
        remainingMinutesToday: Math.max(0, PER_IP_DAILY_MIN - ipUsedMinutes(clientIp(req))),
        monthBudgetLeftPct: Math.round((1 - spent() / MONTHLY_BUDGET) * 100),
      })
    }
    if (req.method === 'GET' && url.pathname === '/api/ai/usage' && clientIp(req) === '127.0.0.1') {
      rollover()
      return json(res, 200, { ...usage, spentUsd: spent(), budgetUsd: MONTHLY_BUDGET, ip: Object.keys(usage.ip).length })
    }
    if (req.method === 'POST' && url.pathname === '/api/ai/transcribe') return await transcribe(req, res)
    json(res, 404, { error: 'not found' })
  } catch (e) {
    json(res, e.status || 500, { error: e.status ? e.message : 'Lỗi máy chủ' })
  }
})

server.listen(PORT, '127.0.0.1', () => console.log(`cuccut-ai listening on 127.0.0.1:${PORT}, model=${GROQ_MODEL}, budget=$${MONTHLY_BUDGET}/month, key=${GROQ_API_KEY ? 'set' : 'MISSING'}`))

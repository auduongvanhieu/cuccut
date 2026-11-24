import { ASPECTS, clipAt, type Clip, type Project, type TextItem } from '../model/types'

// Shared compositor: preview and export both draw frames with this code,
// so what you see is what you export.

export type FrameSource = CanvasImageSource & { width?: number; height?: number }

export interface SourceFrame {
  img: CanvasImageSource
  w: number
  h: number
}

export function canvasSize(p: Project, shortSide: number) {
  const r = ASPECTS[p.aspect]
  // Even dimensions are required by H.264 encoders.
  const even = (n: number) => Math.round(n / 2) * 2
  return r < 1 ? { w: even(shortSide), h: even(shortSide / r) } : { w: even(shortSide * r), h: even(shortSide) }
}

const filterSupported = (() => {
  try {
    const c = document.createElement('canvas').getContext('2d')!
    c.filter = 'brightness(1.1)'
    return c.filter === 'brightness(1.1)'
  } catch {
    return false
  }
})()

let blurCanvas: OffscreenCanvas | HTMLCanvasElement | null = null
function getBlurCanvas() {
  if (!blurCanvas) {
    blurCanvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(24, 24) : document.createElement('canvas')
    blurCanvas.width = 24
    blurCanvas.height = 24
  }
  return blurCanvas
}

function adjustFilter(c: Clip): string {
  const a = c.adjust
  if (!a.brightness && !a.contrast && !a.saturation) return 'none'
  return `brightness(${1 + a.brightness}) contrast(${1 + a.contrast}) saturate(${1 + a.saturation})`
}

/** Rectangle of the clip on the canvas (before rotation), centered at (cx, cy). */
export function clipRect(c: Clip, srcW: number, srcH: number, W: number, H: number) {
  const rotated = c.rotation === 90 || c.rotation === 270
  const sw = rotated ? srcH : srcW
  const sh = rotated ? srcW : srcH
  const fit = Math.min(W / sw, H / sh) * c.scale
  return {
    cx: W / 2 + c.x * W,
    cy: H / 2 + c.y * H,
    w: srcW * fit, // unrotated draw size
    h: srcH * fit,
    bw: sw * fit, // bounding box on canvas
    bh: sh * fit,
  }
}

export function drawFrame(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  W: number,
  H: number,
  p: Project,
  t: number,
  frame: SourceFrame | null,
  opts: { staticTextId?: string } = {},
) {
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = p.bg.color
  ctx.fillRect(0, 0, W, H)
  const at = clipAt(p, t)
  if (at && frame) {
    const c = at.clip
    if (p.bg.type === 'blur') {
      // Cheap, portable blur: downscale to a tiny canvas, then upscale with smoothing.
      const bc = getBlurCanvas()
      const bctx = bc.getContext('2d') as CanvasRenderingContext2D
      bctx.drawImage(frame.img, 0, 0, bc.width, bc.height)
      const cover = Math.max(W / frame.w, H / frame.h)
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.globalAlpha = 0.9
      ctx.drawImage(bc, (W - frame.w * cover) / 2, (H - frame.h * cover) / 2, frame.w * cover, frame.h * cover)
      ctx.globalAlpha = 1
      ctx.fillStyle = 'rgba(0,0,0,0.25)'
      ctx.fillRect(0, 0, W, H)
    }
    const r = clipRect(c, frame.w, frame.h, W, H)
    ctx.translate(r.cx, r.cy)
    ctx.rotate((c.rotation * Math.PI) / 180)
    if (c.flipH) ctx.scale(-1, 1)
    if (filterSupported) ctx.filter = adjustFilter(c)
    ctx.drawImage(frame.img, -r.w / 2, -r.h / 2, r.w, r.h)
    if (filterSupported) ctx.filter = 'none'
    ctx.setTransform(1, 0, 0, 1, 0, 0)
  }
  for (const tx of p.texts) {
    if (t >= tx.start && t < tx.start + tx.duration) drawText(ctx, W, H, tx, t - tx.start, tx.id === opts.staticTextId)
  }
  ctx.restore()
}

export function fontString(tx: TextItem, W: number, H: number) {
  const px = Math.max(6, tx.size * Math.sqrt(W * H) * 1.33)
  return { px, font: `${tx.bold ? 700 : 400} ${px}px "${tx.font}", "Be Vietnam Pro", system-ui, sans-serif` }
}

/** Measured box of a text item in canvas pixels (for hit testing and selection). */
export function measureText(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  W: number,
  H: number,
  tx: TextItem,
) {
  const { px, font } = fontString(tx, W, H)
  ctx.font = font
  const lines = wrapLines(ctx, tx.text, W * 0.9)
  const lh = px * 1.25
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width), px)
  const h = lines.length * lh
  return { lines, lh, w, h, px, cx: tx.x * W, cy: tx.y * H }
}

function wrapLines(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, text: string, maxW: number) {
  const out: string[] = []
  for (const para of text.split('\n')) {
    const words = para.split(' ')
    let line = ''
    for (const w of words) {
      const test = line ? line + ' ' + w : w
      if (ctx.measureText(test).width > maxW && line) {
        out.push(line)
        line = w
      } else line = test
    }
    out.push(line)
  }
  return out
}

function drawText(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  W: number,
  H: number,
  tx: TextItem,
  local: number,
  noAnim = false,
) {
  const m = measureText(ctx, W, H, tx)
  const inT = 0.35
  const k = noAnim ? 1 : Math.min(1, local / inT, (tx.duration - local) / inT)
  const ease = 1 - Math.pow(1 - Math.max(0, k), 3)
  let alpha = 1
  let scale = 1
  let dy = 0
  if (tx.anim === 'fade') alpha = ease
  else if (tx.anim === 'pop') {
    alpha = Math.min(1, ease * 1.5)
    scale = !noAnim && local < inT ? 0.6 + 0.4 * ease + Math.sin(ease * Math.PI) * 0.12 : 1
  } else if (tx.anim === 'slide') {
    alpha = ease
    dy = (1 - ease) * m.px
  }
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.translate(m.cx, m.cy + dy)
  ctx.scale(scale, scale)
  ctx.textBaseline = 'middle'
  ctx.textAlign = tx.align
  const ax = tx.align === 'left' ? -m.w / 2 : tx.align === 'right' ? m.w / 2 : 0
  const top = -m.h / 2 + m.lh / 2
  if (tx.bg) {
    const pad = m.px * 0.3
    ctx.fillStyle = tx.bg
    roundRect(ctx, -m.w / 2 - pad, -m.h / 2 - pad * 0.6, m.w + pad * 2, m.h + pad * 1.2, m.px * 0.25)
    ctx.fill()
  }
  m.lines.forEach((line, i) => {
    const y = top + i * m.lh
    if (tx.stroke) {
      ctx.lineJoin = 'round'
      ctx.lineWidth = Math.max(2, m.px * 0.14)
      ctx.strokeStyle = tx.stroke
      ctx.strokeText(line, ax, y)
    }
    ctx.fillStyle = tx.color
    ctx.fillText(line, ax, y)
  })
  ctx.restore()
}

function roundRect(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

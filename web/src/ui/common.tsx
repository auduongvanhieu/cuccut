import { useEffect, useState, type ReactNode } from 'react'
import { create } from 'zustand'
import { X } from 'lucide-react'

// ---------- Toast ----------
const useToast = create<{ msg: string | null; id: number }>(() => ({ msg: null, id: 0 }))
let toastTimer: ReturnType<typeof setTimeout> | undefined
export function toast(msg: string, ms = 2200) {
  clearTimeout(toastTimer)
  useToast.setState((s) => ({ msg, id: s.id + 1 }))
  toastTimer = setTimeout(() => useToast.setState({ msg: null }), ms)
}
export function ToastHost() {
  const msg = useToast((s) => s.msg)
  return msg ? (
    <div className="toast" role="status">
      {msg}
    </div>
  ) : null
}

// ---------- Sheet ----------
export function Sheet({
  title,
  onClose,
  children,
  inline,
  right,
}: {
  title?: ReactNode
  onClose: () => void
  children: ReactNode
  inline?: boolean
  right?: ReactNode
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const body = (
    <div className={'sheet' + (inline ? ' inline' : '')} role="dialog">
      {!inline && <div className="sheet-grip" />}
      <div className="sheet-head">
        <span>{title}</span>
        <div className="row" style={{ gap: 4 }}>
          {right}
          <button className="icon-btn" onClick={onClose} aria-label="Đóng">
            <X size={20} />
          </button>
        </div>
      </div>
      {children}
    </div>
  )
  if (inline) return body
  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      {body}
    </>
  )
}

// ---------- Slider ----------
export function Slider({
  label,
  value,
  min,
  max,
  step = 0.01,
  format,
  onStart,
  onChange,
  onEnd,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  format?: (v: number) => string
  onStart?: () => void
  onChange: (v: number) => void
  onEnd?: () => void
}) {
  return (
    <label className="slider-row">
      <span className="label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onPointerDown={onStart}
        onPointerUp={onEnd}
        onKeyDown={onStart}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
      <output>{format ? format(value) : value.toFixed(2)}</output>
    </label>
  )
}

export function fmtTime(t: number, withFrac = false) {
  if (!isFinite(t)) t = 0
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  const base = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return withFrac ? `${base}.${Math.floor((t % 1) * 10)}` : base
}

export function useObjectUrl(blob: Blob | null) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!blob) return setUrl(null)
    const u = URL.createObjectURL(blob)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [blob])
  return url
}

/** Hidden file input helper. */
export function pickFiles(accept: string, multiple = true): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.multiple = multiple
    input.style.display = 'none'
    document.body.appendChild(input)
    input.onchange = () => {
      resolve(Array.from(input.files ?? []))
      input.remove()
    }
    input.addEventListener('cancel', () => {
      resolve([])
      input.remove()
    })
    input.click()
  })
}

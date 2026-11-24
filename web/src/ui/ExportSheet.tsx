import { useEffect, useRef, useState } from 'react'
import { Download, Share2 } from 'lucide-react'
import { useEditor } from '../model/store'
import { canvasSize } from '../engine/compose'
import { exportVideo } from '../engine/export'
import { projectDuration } from '../model/types'
import { Sheet, toast, useObjectUrl } from './common'

const RES = [
  { s: 480, l: '480p' },
  { s: 720, l: '720p' },
  { s: 1080, l: '1080p' },
]

export default function ExportSheet({ onClose }: { onClose: () => void }) {
  const project = useEditor((s) => s.project)!
  const [res, setRes] = useState(1080)
  const [fps, setFps] = useState(30)
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [progress, setProgress] = useState({ p: 0, label: '' })
  const [result, setResult] = useState<Blob | null>(null)
  const [err, setErr] = useState('')
  const abort = useRef<AbortController | null>(null)
  const url = useObjectUrl(result)
  const startedAt = useRef(0)

  useEffect(() => {
    useEditor.getState().setPlaying(false)
    return () => abort.current?.abort()
  }, [])

  const run = async () => {
    setState('running')
    setErr('')
    abort.current = new AbortController()
    startedAt.current = performance.now()
    // Keep the screen awake during export where supported.
    let lock: WakeLockSentinel | null = null
    try {
      lock = await navigator.wakeLock?.request('screen')
    } catch {
      /* ignore */
    }
    try {
      const r = await exportVideo(project, {
        shortSide: res,
        fps,
        signal: abort.current.signal,
        onProgress: (p, label) => setProgress({ p, label }),
      })
      setResult(r.blob)
      setState('done')
      if (!r.hasAudio && (project.audios.length || project.clips.some((c) => c.kind === 'video')))
        toast('Trình duyệt không mã hoá được âm thanh, video xuất ra không có tiếng')
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        setState('idle')
      } else {
        console.error(e)
        setErr((e as Error).message || String(e))
        setState('error')
      }
    } finally {
      void lock?.release()
    }
  }

  const fileName = `${project.name.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'cuccut'}.mp4`
  const share = async () => {
    if (!result) return
    const file = new File([result], fileName, { type: 'video/mp4' })
    try {
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: project.name })
      else download()
    } catch (e) {
      if ((e as Error).name !== 'AbortError') download()
    }
  }
  const download = () => {
    if (!url) return
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    a.click()
  }

  const { w, h } = canvasSize(project, res)
  const dur = projectDuration(project)
  const estMB = ((dur * (res >= 1080 ? 8 : res >= 720 ? 5 : 2.5)) / 8) * (fps / 30) + dur * 0.016

  return (
    <Sheet title="Xuất video" onClose={() => (state === 'running' ? abort.current?.abort() : onClose())}>
      {state === 'idle' || state === 'error' ? (
        <>
          <div className="label">Độ phân giải</div>
          <div className="chips">
            {RES.map((r) => (
              <button key={r.s} className={'chip' + (res === r.s ? ' on' : '')} onClick={() => setRes(r.s)}>
                {r.l}
              </button>
            ))}
          </div>
          <div className="label">Số khung hình / giây</div>
          <div className="chips">
            {[24, 30, 60].map((f) => (
              <button key={f} className={'chip' + (fps === f ? ' on' : '')} onClick={() => setFps(f)}>
                {f} fps
              </button>
            ))}
          </div>
          <p className="label">
            {w}×{h} · khoảng {estMB.toFixed(0)} MB · video được xử lý ngay trên máy bạn, không tải lên đâu cả.
          </p>
          {err && <p style={{ color: 'var(--danger)' }}>Lỗi: {err}</p>}
          <button className="btn primary" style={{ width: '100%', marginTop: 8 }} onClick={() => void run()}>
            Xuất video
          </button>
        </>
      ) : state === 'running' ? (
        <div className="export-run">
          <p>{progress.label || 'Đang chuẩn bị…'}</p>
          <div className="progress">
            <div style={{ width: `${Math.round(progress.p * 100)}%` }} />
          </div>
          <p className="label">Giữ màn hình mở cho đến khi xong.</p>
          <button className="btn" style={{ width: '100%' }} onClick={() => abort.current?.abort()}>
            Huỷ
          </button>
        </div>
      ) : (
        <div className="export-done">
          {url && <video src={url} controls playsInline className="export-video" />}
          <p className="label">
            Xong trong {((performance.now() - startedAt.current) / 1000).toFixed(0)} giây · {((result?.size ?? 0) / 1e6).toFixed(1)} MB
          </p>
          <div className="row">
            <button className="btn primary" style={{ flex: 1 }} onClick={() => void share()}>
              <Share2 size={18} /> Lưu / Chia sẻ
            </button>
            <button className="btn" onClick={download} aria-label="Tải về">
              <Download size={18} />
            </button>
          </div>
        </div>
      )}
    </Sheet>
  )
}

import { useEffect, useState } from 'react'
import { ChevronLeft, Download, Pause, Play, Redo2, Undo2, Maximize2 } from 'lucide-react'
import { flushSave, useEditor } from '../model/store'
import { loadProject, saveProject } from '../storage/db'
import { preloadMeta } from '../lib/media'
import { destroyPlayer, getPlayer } from '../engine/player'
import { projectDuration, SCHEMA_VERSION } from '../model/types'
import { goHome } from '../App'
import { renderStill } from '../engine/export'
import Preview from './Preview'
import Timeline from './Timeline'
import Toolbar from './Toolbar'
import Panels, { type PanelId } from './Panels'
import ExportSheet from './ExportSheet'
import { fmtTime } from './common'
import { loadFont } from '../lib/fonts'
import './editor.css'

export default function Editor({ projectId }: { projectId: string }) {
  const project = useEditor((s) => s.project)
  const [error, setError] = useState<string | null>(null)
  const [panel, setPanel] = useState<PanelId | null>(null)
  const [exporting, setExporting] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)

  useEffect(() => {
    let alive = true
    const my = ++session
    ;(async () => {
      const p = await loadProject(projectId)
      if (!alive) return
      if (!p) return setError('Không tìm thấy dự án trên máy này.')
      if (p.v !== SCHEMA_VERSION) p.v = SCHEMA_VERSION
      await preloadMeta([...p.clips.map((c) => c.mediaId), ...p.audios.map((a) => a.mediaId)])
      await Promise.all(p.texts.map((t) => loadFont(t.font)))
      useEditor.getState().open(p)
      getPlayer()
    })()
    return () => {
      alive = false
      void (async () => {
        await flushSave()
        if (session !== my) return // remounted (StrictMode / quick reopen)
        const p = useEditor.getState().project
        // Refresh the home-screen thumbnail.
        if (p && p.clips.length) {
          try {
            const blob = await renderStill(p, Math.min(0.5, projectDuration(p) / 2), 240, 'image/jpeg', 0.7)
            const thumb = await new Promise<string>((res) => {
              const r = new FileReader()
              r.onload = () => res(r.result as string)
              r.readAsDataURL(blob)
            })
            await saveProject({ ...p, thumb })
          } catch {
            /* ignore */
          }
        }
        destroyPlayer()
        useEditor.getState().close()
      })()
    }
  }, [projectId])

  // Keyboard shortcuts for desktop use.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      const s = useEditor.getState()
      if (e.code === 'Space') {
        e.preventDefault()
        togglePlay()
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) s.redo()
        else s.undo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (error)
    return (
      <div className="editor-error">
        <p>{error}</p>
        <button className="btn" onClick={goHome}>
          Về trang chủ
        </button>
      </div>
    )
  if (!project) return <div className="editor-loading">Đang mở dự án…</div>

  return (
    <div className={'editor' + (fullscreen ? ' fullscreen' : '')}>
      <header className="ed-top">
        <button className="icon-btn" onClick={goHome} aria-label="Quay lại">
          <ChevronLeft size={26} />
        </button>
        <div className="ed-title">{project.name}</div>
        <button className="btn primary small" onClick={() => setExporting(true)} disabled={projectDuration(project) <= 0}>
          <Download size={16} /> Xuất
        </button>
      </header>

      <Preview onEditText={() => setPanel('text')} />

      <Controls fullscreen={fullscreen} onFullscreen={() => setFullscreen((f) => !f)} />

      {!fullscreen &&
        (panel ? (
          <Panels id={panel} onClose={() => setPanel(null)} />
        ) : (
          <>
            <Timeline />
            <Toolbar open={setPanel} />
          </>
        ))}

      {exporting && <ExportSheet onClose={() => setExporting(false)} />}
    </div>
  )
}

let session = 0

export function togglePlay() {
  const s = useEditor.getState()
  getPlayer().unlockAudio()
  s.setPlaying(!s.playing)
}

function Controls({ fullscreen, onFullscreen }: { fullscreen: boolean; onFullscreen: () => void }) {
  const playing = useEditor((s) => s.playing)
  const time = useEditor((s) => s.time)
  const dur = useEditor((s) => (s.project ? projectDuration(s.project) : 0))
  const canUndo = useEditor((s) => s.past.length > 0)
  const canRedo = useEditor((s) => s.future.length > 0)
  return (
    <div className="ed-controls">
      <div className="ed-time">
        <b>{fmtTime(time, true)}</b> / {fmtTime(dur)}
      </div>
      <button className="icon-btn play-btn" onClick={togglePlay} aria-label={playing ? 'Tạm dừng' : 'Phát'}>
        {playing ? <Pause size={26} fill="currentColor" /> : <Play size={26} fill="currentColor" />}
      </button>
      <div className="ed-ctl-right">
        <button className="icon-btn" disabled={!canUndo} onClick={() => useEditor.getState().undo()} aria-label="Hoàn tác">
          <Undo2 size={20} />
        </button>
        <button className="icon-btn" disabled={!canRedo} onClick={() => useEditor.getState().redo()} aria-label="Làm lại">
          <Redo2 size={20} />
        </button>
        <button className={'icon-btn' + (fullscreen ? ' on' : '')} onClick={onFullscreen} aria-label="Toàn màn hình">
          <Maximize2 size={18} />
        </button>
      </div>
    </div>
  )
}

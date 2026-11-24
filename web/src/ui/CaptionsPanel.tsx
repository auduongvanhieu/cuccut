import { useEffect, useState } from 'react'
import { useEditor } from '../model/store'
import { CAPTION_STYLES, aiHealth, buildLines, linesToTexts, transcribeProject } from '../lib/captions'
import { loadFont } from '../lib/fonts'
import { getPlayer } from '../engine/player'
import { Sheet, toast } from './common'

const LANGS = [
  ['vi', 'Tiếng Việt'],
  ['en', 'English'],
  ['auto', 'Tự nhận'],
] as const

export default function CaptionsPanel({ onClose }: { onClose: () => void }) {
  const project = useEditor((s) => s.project)!
  const [lang, setLang] = useState<string>('vi')
  const [styleId, setStyleId] = useState('classic')
  const [health, setHealth] = useState<{ stt: boolean; remainingMinutesToday: number } | null | undefined>(undefined)
  const [busy, setBusy] = useState<{ p: number; label: string } | null>(null)
  const existing = project.texts.filter((t) => t.isCaption).length

  useEffect(() => {
    void aiHealth().then(setHealth)
  }, [])

  const style = CAPTION_STYLES.find((s) => s.id === styleId)!.style

  const run = async () => {
    if (!project.clips.some((c) => c.kind === 'video' && c.volume > 0)) return toast('Chưa có video có tiếng trong dự án')
    setBusy({ p: 0, label: 'Đang chuẩn bị…' })
    try {
      await loadFont(style.font)
      const { words, segments } = await transcribeProject(project, lang, (p, label) => setBusy({ p, label }))
      const lines = buildLines(words, segments)
      if (!lines.length) {
        toast('Không nghe thấy lời nói nào')
        return
      }
      useEditor.getState().edit((p) => {
        p.texts = p.texts.filter((t) => !t.isCaption)
        p.texts.push(...linesToTexts(lines, style))
      })
      getPlayer().invalidate()
      toast(`Đã tạo ${lines.length} dòng phụ đề`)
      onClose()
    } catch (e) {
      toast((e as Error).message, 4000)
    } finally {
      setBusy(null)
    }
  }

  const applyStyle = async (id: string) => {
    setStyleId(id)
    if (!existing) return
    const st = CAPTION_STYLES.find((s) => s.id === id)!.style
    await loadFont(st.font)
    useEditor.getState().edit((p) => {
      for (const t of p.texts) if (t.isCaption) Object.assign(t, st)
    })
    getPlayer().invalidate()
  }

  return (
    <Sheet inline title="Phụ đề tự động" onClose={onClose}>
      {busy ? (
        <div className="export-run">
          <p>{busy.label}</p>
          <div className="progress">
            <div style={{ width: `${Math.round(busy.p * 100)}%` }} />
          </div>
        </div>
      ) : (
        <>
          <div className="label">Ngôn ngữ nói trong video</div>
          <div className="chips">
            {LANGS.map(([k, l]) => (
              <button key={k} className={'chip' + (lang === k ? ' on' : '')} onClick={() => setLang(k)}>
                {l}
              </button>
            ))}
          </div>
          <div className="label">Kiểu phụ đề</div>
          <div className="chips">
            {CAPTION_STYLES.map((s) => (
              <button key={s.id} className={'chip' + (styleId === s.id ? ' on' : '')} onClick={() => void applyStyle(s.id)}>
                {s.label}
              </button>
            ))}
          </div>
          {health === null || (health && !health.stt) ? (
            <p className="label" style={{ color: 'var(--danger)' }}>
              Dịch vụ phụ đề online đang tạm ngưng. Hãy thử lại sau.
            </p>
          ) : (
            <p className="label">
              Âm thanh của video được gửi tới máy chủ nhận dạng giọng nói, không lưu lại.
              {health ? ` Hôm nay bạn còn khoảng ${Math.floor(health.remainingMinutesToday)} phút.` : ''}
            </p>
          )}
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn primary" style={{ flex: 1 }} disabled={!health?.stt} onClick={() => void run()}>
              {existing ? 'Tạo lại phụ đề' : 'Tạo phụ đề'}
            </button>
            {existing > 0 && (
              <button
                className="btn danger"
                onClick={() => {
                  useEditor.getState().edit((p) => void (p.texts = p.texts.filter((t) => !t.isCaption)))
                  toast('Đã xoá phụ đề')
                }}
              >
                Xoá ({existing})
              </button>
            )}
          </div>
        </>
      )}
    </Sheet>
  )
}

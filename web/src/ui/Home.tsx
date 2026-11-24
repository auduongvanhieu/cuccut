import { useEffect, useState } from 'react'
import { nanoid } from 'nanoid'
import { Film, Image as ImageIcon, MoreVertical, Plus, Trash2, Copy, Pencil } from 'lucide-react'
import { deleteProjectRecord, garbageCollectMedia, listProjects, saveProject, storageEstimate } from '../storage/db'
import { importFile } from '../lib/media'
import { makeClip, newProject } from '../model/store'
import { projectDuration, type Project } from '../model/types'
import { openProject } from '../App'
import { Sheet, fmtTime, pickFiles, toast } from './common'
import './home.css'

export const ACCEPT_VISUAL = 'video/*,image/*'

export async function importInto(files: File[], onStep?: (i: number, n: number) => void) {
  const metas = []
  for (let i = 0; i < files.length; i++) {
    onStep?.(i + 1, files.length)
    try {
      metas.push(await importFile(files[i]))
    } catch (e) {
      toast((e as Error).message)
    }
  }
  return metas
}

export default function Home() {
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [menu, setMenu] = useState<Project | null>(null)
  const [usage, setUsage] = useState('')

  const refresh = async () => {
    setProjects(await listProjects())
    const e = await storageEstimate()
    if (e.quota) setUsage(`Đã dùng ${(e.used / 1e6).toFixed(0)} MB / ${(e.quota / 1e9).toFixed(1)} GB bộ nhớ trình duyệt`)
  }
  useEffect(() => {
    void refresh()
  }, [])

  const create = async (photo = false) => {
    const files = await pickFiles(photo ? 'image/*' : ACCEPT_VISUAL)
    if (!files.length) return
    const n = (projects?.length ?? 0) + 1
    const p = newProject(photo ? `Ảnh ${n}` : `Dự án ${n}`)
    const metas = await importInto(files, (i, total) => setBusy(`Đang nhập ${i}/${total}…`))
    setBusy(null)
    const visual = metas.filter((m) => m.kind !== 'audio')
    if (!visual.length) return
    p.clips = visual.map(makeClip)
    const first = visual[0]
    if (first.width && first.height) {
      const r = first.width / first.height
      p.aspect = r > 1.2 ? '16:9' : r > 0.9 ? '1:1' : r > 0.7 ? '3:4' : '9:16'
    }
    await saveProject(p)
    openProject(p.id)
  }

  const rename = async (p: Project) => {
    const name = prompt('Tên dự án', p.name)?.trim()
    setMenu(null)
    if (!name) return
    await saveProject({ ...p, name, updatedAt: Date.now() })
    void refresh()
  }
  const duplicate = async (p: Project) => {
    setMenu(null)
    await saveProject({ ...structuredClone(p), id: nanoid(10), name: p.name + ' (bản sao)', createdAt: Date.now(), updatedAt: Date.now() })
    void refresh()
  }
  const remove = async (p: Project) => {
    setMenu(null)
    if (!confirm(`Xoá "${p.name}"? Không thể hoàn tác.`)) return
    await deleteProjectRecord(p.id)
    await garbageCollectMedia()
    void refresh()
  }

  return (
    <div className="home">
      <header className="home-head">
        <div className="logo">
          <img className="logo-mark" src="/favicon.svg" alt="" /> CucCut
        </div>
      </header>

      <div className="home-actions">
        <button className="new-btn" onClick={() => void create(false)}>
          <span className="new-ic">
            <Plus size={28} />
          </span>
          <span>
            <b>Dự án mới</b>
            <small>Chọn video, ảnh từ máy</small>
          </span>
        </button>
        <div className="quick">
          <button onClick={() => void create(false)}>
            <Film size={22} />
            Dựng video
          </button>
          <button onClick={() => void create(true)}>
            <ImageIcon size={22} />
            Video từ ảnh
          </button>
        </div>
      </div>

      <section className="proj-section">
        <h2>Dự án của bạn</h2>
        {projects === null ? null : projects.length === 0 ? (
          <p className="empty">Chưa có dự án nào. Bấm "Dự án mới" để bắt đầu.</p>
        ) : (
          <div className="proj-grid">
            {projects.map((p) => (
              <div key={p.id} className="proj" onClick={() => openProject(p.id)}>
                <div className="proj-thumb">
                  {p.thumb ? <img src={p.thumb} alt="" /> : <Film size={28} />}
                  <span className="proj-dur">{fmtTime(projectDuration(p))}</span>
                </div>
                <div className="proj-meta">
                  <div>
                    <div className="proj-name">{p.name}</div>
                    <div className="proj-date">{new Date(p.updatedAt).toLocaleDateString('vi-VN')}</div>
                  </div>
                  <button
                    className="icon-btn"
                    aria-label="Tuỳ chọn"
                    onClick={(e) => {
                      e.stopPropagation()
                      setMenu(p)
                    }}
                  >
                    <MoreVertical size={18} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        {usage && <p className="usage">{usage}. Dự án chỉ lưu trên máy này.</p>}
      </section>

      {busy && <div className="busy">{busy}</div>}

      {menu && (
        <Sheet title={menu.name} onClose={() => setMenu(null)}>
          <div className="menu-list">
            <button onClick={() => void rename(menu)}>
              <Pencil size={18} /> Đổi tên
            </button>
            <button onClick={() => void duplicate(menu)}>
              <Copy size={18} /> Nhân bản
            </button>
            <button className="danger" onClick={() => void remove(menu)}>
              <Trash2 size={18} /> Xoá
            </button>
          </div>
        </Sheet>
      )}
    </div>
  )
}

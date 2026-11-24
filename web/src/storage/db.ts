import { createStore, get, set, del, keys, getMany } from 'idb-keyval'
import type { MediaMeta, Project } from '../model/types'

// Projects (small JSON) and media blobs live in separate IndexedDB stores.
const projectsStore = createStore('cuccut-projects', 'projects')
const mediaStore = createStore('cuccut-media', 'blobs')
const metaStore = createStore('cuccut-meta', 'meta')

export async function requestPersistence() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) {
      await navigator.storage.persist()
    }
  } catch {
    /* ignore */
  }
}

export const saveProject = (p: Project) => set(p.id, p, projectsStore)
export const loadProject = (id: string) => get<Project>(id, projectsStore)
export const deleteProjectRecord = (id: string) => del(id, projectsStore)

export async function listProjects(): Promise<Project[]> {
  const ids = (await keys(projectsStore)) as string[]
  const all = (await getMany<Project | undefined>(ids, projectsStore)).filter((x): x is Project => !!x)
  return all.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function putMedia(meta: MediaMeta, blob: Blob) {
  await set(meta.id, blob, mediaStore)
  await set(meta.id, meta, metaStore)
}
export const getMediaBlob = (id: string) => get<Blob>(id, mediaStore)
export const getMediaMeta = (id: string) => get<MediaMeta>(id, metaStore)

export async function deleteMedia(id: string) {
  await del(id, mediaStore)
  await del(id, metaStore)
}

/** Remove media not referenced by any project. */
export async function garbageCollectMedia() {
  const projects = await listProjects()
  const used = new Set<string>()
  for (const p of projects) {
    p.clips.forEach((c) => used.add(c.mediaId))
    p.audios.forEach((a) => used.add(a.mediaId))
  }
  const ids = (await keys(metaStore)) as string[]
  await Promise.all(ids.filter((id) => !used.has(id)).map(deleteMedia))
}

export async function storageEstimate() {
  try {
    const e = await navigator.storage.estimate()
    return { used: e.usage ?? 0, quota: e.quota ?? 0 }
  } catch {
    return { used: 0, quota: 0 }
  }
}

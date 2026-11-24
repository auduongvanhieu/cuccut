import { useEffect, useState } from 'react'
import Home from './ui/Home'
import Editor from './ui/Editor'
import { ToastHost } from './ui/common'
import { requestPersistence } from './storage/db'

// Hash routing keeps the phone's back button working: #/ (home), #/p/<id> (editor).
function parse() {
  const m = location.hash.match(/^#\/p\/([\w-]+)/)
  return m ? m[1] : null
}

export default function App() {
  const [projectId, setProjectId] = useState<string | null>(parse)
  useEffect(() => {
    const on = () => setProjectId(parse())
    window.addEventListener('hashchange', on)
    void requestPersistence()
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return (
    <div className="app">
      {projectId ? <Editor key={projectId} projectId={projectId} /> : <Home />}
      <ToastHost />
    </div>
  )
}

export const openProject = (id: string) => (location.hash = `#/p/${id}`)
export const goHome = () => {
  location.hash = '#/'
}

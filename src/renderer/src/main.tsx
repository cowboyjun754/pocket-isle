import { createRoot } from 'react-dom/client'
import { Island } from './Island'
import { Panel } from './Panel'
import './base.css'

// 防止文件拖到窗口空白处时，页面被导航成该文件
window.addEventListener('dragover', (e) => e.preventDefault())
window.addEventListener('drop', (e) => e.preventDefault())

const view = location.hash.replace('#', '') === 'panel' ? 'panel' : 'island'
document.documentElement.dataset.view = view

createRoot(document.getElementById('root')!).render(view === 'panel' ? <Panel /> : <Island />)

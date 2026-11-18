import { createRoot } from 'react-dom/client'
import { Island } from './Island'
import { Panel } from './Panel'
import './base.css'

// Prevent Chromium from navigating to a dropped file when dropped outside target areas
window.addEventListener('dragover', (e) => e.preventDefault())
window.addEventListener('drop', (e) => e.preventDefault())

const view = location.hash.replace('#', '') === 'panel' ? 'panel' : 'island'
document.documentElement.dataset.view = view

createRoot(document.getElementById('root')!).render(view === 'panel' ? <Panel /> : <Island />)

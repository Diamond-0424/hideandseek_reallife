import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { unlockAudio } from './lib/sound'

// 重新整理後自動接回房間時沒有經過首頁按鈕，任何一次點擊都解鎖音訊
for (const ev of ['pointerdown', 'touchend', 'click'])
  window.addEventListener(ev, unlockAudio, { capture: true, passive: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

import { useState } from 'react'
import { requestLocation } from '../hooks/device'
import { createRoom, joinRoom, saveRoom } from '../lib/room'
import { unlockAudio } from '../lib/sound'

const NAME_KEY = 'hs.name'

export function Home({ uid, onEnter }: { uid: string; onEnter: (code: string) => void }) {
  const [name, setName] = useState(() => localStorage.getItem(NAME_KEY) ?? '')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState<'create' | 'join' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function go(kind: 'create' | 'join') {
    const n = name.trim()
    if (!n) return setError('請先輸入暱稱')
    if (kind === 'join' && !/^\d{4}$/.test(code)) return setError('房間代碼是 4 位數字')
    setBusy(kind)
    setError(null)
    unlockAudio()
    try {
      await requestLocation()
      localStorage.setItem(NAME_KEY, n)
      const c = kind === 'create' ? await createRoom(uid, n) : (await joinRoom(uid, code, n), code)
      saveRoom(c)
      onEnter(c)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <main className="screen home">
      <div className="home-glow" aria-hidden />
      <section className="hero rise">
        <div className="logo" aria-hidden>
          <span>🙈</span>
        </div>
        <h1>現實躲貓貓</h1>
        <p className="muted">抽鬼、躲好、做任務——不然位置會曝光。</p>
      </section>

      <section className="card stack rise" style={{ animationDelay: '80ms' }}>
        <label className="field">
          <span>暱稱</span>
          <input value={name} maxLength={12} onChange={(e) => setName(e.target.value)} placeholder="大家怎麼叫你" />
        </label>
        <button className="btn primary lg" disabled={busy !== null} onClick={() => go('create')}>
          {busy === 'create' ? '建立中…' : '建立房間'}
        </button>
        <div className="divider">
          <span>或加入朋友的房間</span>
        </div>
        <div className="join">
          <input
            className="code-input"
            inputMode="numeric"
            maxLength={4}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            placeholder="0000"
            aria-label="房間代碼"
          />
          <button className="btn lg" disabled={busy !== null || code.length !== 4} onClick={() => go('join')}>
            {busy === 'join' ? '加入中…' : '加入'}
          </button>
        </div>
        {error && <p className="alert">{error}</p>}
      </section>

      <ul className="tips rise" style={{ animationDelay: '160ms' }}>
        <li>📍 需要允許定位</li>
        <li>🔆 遊戲中保持頁面開著，螢幕會常亮</li>
        <li>🎧 戴一邊耳機才聽得到任務提示</li>
      </ul>
    </main>
  )
}

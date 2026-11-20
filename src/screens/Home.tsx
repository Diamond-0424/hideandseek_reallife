import { useState } from 'react'
import { requestLocation } from '../hooks/device'
import { createRoom, joinRoom, saveRoom } from '../lib/room'
import { unlockAudio } from '../lib/sound'

const NAME_KEY = 'hs.name'

export function Home({ uid, onEnter }: { uid: string; onEnter: (code: string) => void }) {
  const [name, setName] = useState(() => localStorage.getItem(NAME_KEY) ?? '')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function go(kind: 'create' | 'join') {
    const n = name.trim()
    if (!n) return setError('請先輸入暱稱')
    if (kind === 'join' && !/^\d{4}$/.test(code)) return setError('房間代碼是 4 位數字')
    setBusy(true)
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
      setBusy(false)
    }
  }

  return (
    <main className="page home">
      <h1>現實躲貓貓</h1>
      <p className="muted">抽鬼、躲好、做任務，不然位置會曝光。</p>
      <label>
        暱稱
        <input value={name} maxLength={12} onChange={(e) => setName(e.target.value)} placeholder="你的名字" />
      </label>
      <button disabled={busy} onClick={() => go('create')}>
        建立房間
      </button>
      <div className="row">
        <input
          inputMode="numeric"
          maxLength={4}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          placeholder="房間代碼"
        />
        <button disabled={busy} onClick={() => go('join')}>
          加入
        </button>
      </div>
      {error && <p className="danger">{error}</p>}
      <p className="muted small">需要允許定位。遊戲中請保持這個頁面開著，螢幕會保持常亮，建議帶行動電源。</p>
    </main>
  )
}

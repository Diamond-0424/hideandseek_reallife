import { useEffect, useState } from 'react'
import { Splash } from './components/ui'
import { ensureSignedIn, firebaseConfigured } from './firebase'
import { syncClock } from './lib/clock'
import { savedRoom, saveRoom } from './lib/room'
import { Home } from './screens/Home'
import { RoomScreen } from './screens/RoomScreen'

export default function App() {
  const [uid, setUid] = useState<string | null>(null)
  const [code, setCode] = useState<string | null>(savedRoom)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!firebaseConfigured) return
    ensureSignedIn()
      .then(async (u) => {
        await syncClock(u.uid).catch((e) => console.warn('clock sync', e))
        setUid(u.uid)
      })
      .catch((e) => setError(`登入失敗：${e.message}`))
  }, [])

  if (!firebaseConfigured)
    return (
      <main className="screen">
        <h1>尚未設定 Firebase</h1>
        <p>請複製 <code>.env.example</code> 為 <code>.env.local</code> 並填入 Firebase 設定，詳見 README。</p>
      </main>
    )
  if (error)
    return (
      <main className="screen splash">
        <p className="alert">{error}</p>
      </main>
    )
  if (!uid) return <Splash text="連線中…" />
  if (!code) return <Home uid={uid} onEnter={setCode} />
  return (
    <RoomScreen
      key={code}
      code={code}
      uid={uid}
      onExit={() => {
        saveRoom(null)
        setCode(null)
      }}
    />
  )
}

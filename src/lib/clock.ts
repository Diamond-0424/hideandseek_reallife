import { doc, getDoc, serverTimestamp, setDoc, type Timestamp } from 'firebase/firestore'
import { db } from '../firebase'

/** 本機時鐘與伺服器時鐘的差（毫秒）。各手機時鐘可能差好幾秒，所有遊戲時間都用 nowMs()。 */
let offsetMs = 0

export function nowMs(): number {
  return Date.now() + offsetMs
}

export async function syncClock(uid: string): Promise<void> {
  const ref = doc(db, 'clock', uid)
  const before = Date.now()
  await setDoc(ref, { t: serverTimestamp() })
  const snap = await getDoc(ref)
  const after = Date.now()
  const server = (snap.data()?.t as Timestamp | undefined)?.toMillis()
  if (server) offsetMs = server - (before + after) / 2
}

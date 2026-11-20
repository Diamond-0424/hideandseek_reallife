import { initializeApp } from 'firebase/app'
import { getAuth, onAuthStateChanged, signInAnonymously, type User } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

export const firebaseConfigured = Boolean(config.apiKey && config.projectId)

export const app = initializeApp(firebaseConfigured ? config : { apiKey: 'unconfigured', projectId: 'unconfigured' })
export const auth = getAuth(app)
export const db = getFirestore(app)

/** 等待匿名登入完成（匿名帳號會保存在瀏覽器，重新整理不會換 uid） */
export function ensureSignedIn(): Promise<User> {
  return new Promise((resolve, reject) => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) {
        unsub()
        resolve(user)
      }
    })
    if (!auth.currentUser) signInAnonymously(auth).catch((e) => {
      unsub()
      reject(e)
    })
  })
}

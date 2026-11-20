let ctx: AudioContext | null = null

/** iOS 需要在使用者點擊時先解鎖音訊 */
export function unlockAudio() {
  try {
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
  } catch {
    /* 不支援就算了 */
  }
}

/** 短促的雙音提示，避免太大聲被鬼聽到 */
export function beep() {
  if (!ctx) return
  const t = ctx.currentTime
  for (const [i, freq] of [880, 1320].entries()) {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0.0001, t + i * 0.15)
    gain.gain.exponentialRampToValueAtTime(0.25, t + i * 0.15 + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.15 + 0.12)
    osc.connect(gain).connect(ctx.destination)
    osc.start(t + i * 0.15)
    osc.stop(t + i * 0.15 + 0.13)
  }
  navigator.vibrate?.(200) // Android 有效，iOS 會忽略
}

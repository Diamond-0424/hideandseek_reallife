import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import type { GeoFix } from '../hooks/device'
import { distance } from '../lib/geo'
import { Ring } from '../components/ui'
import { IconAlert, SHAPES, Shape, TaskIcon, type ShapeName } from '../components/icons'
import { GOTO_RADIUS_M, MOVE_DISTANCE_M, TASK_LABEL, seeded } from '../lib/rules'
import type { Task } from '../types'

interface Props {
  task: Task
  now: number
  fix: GeoFix | null
  onDone: () => void
}

export function TaskPanel({ task, now, fix, onDone }: Props) {
  const leftMs = Math.max(0, task.deadline - now)
  const left = Math.ceil(leftMs / 1000)
  const total = Math.max(1, task.deadline - task.issuedAt)
  const realWorld = task.type === 'goto' || task.type === 'move'
  return (
    <div className={`task-panel ${realWorld ? 'is-sheet' : 'is-full'}`}>
      <div className="task-head">
        <span className="task-icon">
          <TaskIcon type={task.type} size={26} />
        </span>
        <div className="task-title">
          <span className="eyebrow">新任務</span>
          <strong>{TASK_LABEL[task.type]}</strong>
        </div>
        <Ring value={leftMs / total} size={48} stroke={4} danger={left <= 20}>
          {left}
        </Ring>
      </div>
      <div className="task-body">
        {task.type === 'math' && <MathTask seed={task.seed} onDone={onDone} />}
        {task.type === 'reaction' && <ReactionTask seed={task.seed} onDone={onDone} />}
        {task.type === 'memory' && <MemoryTask seed={task.seed} onDone={onDone} />}
        {task.type === 'typing' && <TypingTask seed={task.seed} onDone={onDone} />}
        {realWorld && <PlaceTask task={task} fix={fix} onDone={onDone} />}
      </div>
      <p className="task-hint">
        <IconAlert size={14} /> 時間內沒完成，你的位置會洩漏給鬼
      </p>
    </div>
  )
}

// ── 數學題：連續答對 3 題 ──
function MathTask({ seed, onDone }: { seed: number; onDone: () => void }) {
  const questions = useMemo(() => {
    const r = seeded(seed)
    const int = (a: number, b: number) => a + Math.floor(r() * (b - a + 1))
    return Array.from({ length: 3 }, () => {
      const kind = int(0, 2)
      if (kind === 0) {
        const [a, b] = [int(12, 89), int(12, 89)]
        return { text: `${a} + ${b}`, answer: a + b }
      }
      if (kind === 1) {
        const [a, b] = [int(40, 99), int(11, 39)]
        return { text: `${a} − ${b}`, answer: a - b }
      }
      const [a, b] = [int(3, 12), int(3, 12)]
      return { text: `${a} × ${b}`, answer: a * b }
    })
  }, [seed])
  const [i, setI] = useState(0)
  const [value, setValue] = useState('')
  const [wrong, setWrong] = useState(false)
  const q = questions[i]
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (Number(value) === q.answer) {
      setWrong(false)
      setValue('')
      if (i + 1 === questions.length) onDone()
      else setI(i + 1)
    } else setWrong(true)
  }
  return (
    <form onSubmit={submit} className="task-game">
      <Pips total={3} done={i} />
      <p className={`question ${wrong ? 'shake' : ''}`} key={`${i}-${wrong}`}>
        {q.text} <span className="muted">=</span> ?
      </p>
      <input
        className="answer"
        inputMode="numeric"
        autoFocus
        value={value}
        onChange={(e) => {
          setValue(e.target.value)
          setWrong(false)
        }}
        placeholder="答案"
      />
      <button type="submit" className="btn primary lg block" disabled={!value}>
        送出
      </button>
      {wrong && <p className="alert">答錯了，再試一次</p>}
    </form>
  )
}

// ── 反應測試：變綠後 0.8 秒內點，成功 3 次 ──
function ReactionTask({ seed, onDone }: { seed: number; onDone: () => void }) {
  const rand = useMemo(() => seeded(seed), [seed])
  const [hits, setHits] = useState(0)
  const [state, setState] = useState<'wait' | 'go' | 'early' | 'slow'>('wait')
  const goAt = useRef(0)
  useEffect(() => {
    if (state !== 'wait') return
    const id = setTimeout(() => {
      goAt.current = performance.now()
      setState('go')
    }, 1000 + rand() * 2500)
    return () => clearTimeout(id)
  }, [state, hits, rand])
  const tap = () => {
    if (state === 'wait') return setState('early')
    if (state === 'early' || state === 'slow') return setState('wait')
    const ms = performance.now() - goAt.current
    if (ms > 800) return setState('slow')
    if (hits + 1 >= 3) return onDone()
    setHits(hits + 1)
    setState('wait')
  }
  const text = {
    wait: '等它變綠…',
    go: '點！',
    early: '太早了！點一下重來',
    slow: '太慢了！點一下重來',
  }[state]
  return (
    <button className={`reaction is-${state}`} onPointerDown={tap}>
      <span className="reaction-text">{text}</span>
      <Pips total={3} done={hits} />
    </button>
  )
}

// ── 記憶翻牌：4 對 ──
function MemoryTask({ seed, onDone }: { seed: number; onDone: () => void }) {
  const cards = useMemo(() => {
    const r = seeded(seed)
    const picks: ShapeName[] = [...SHAPES].sort(() => r() - 0.5).slice(0, 4)
    return [...picks, ...picks].sort(() => r() - 0.5)
  }, [seed])
  const [open, setOpen] = useState<number[]>([])
  const [matched, setMatched] = useState<Set<number>>(new Set())
  const flip = (i: number) => {
    if (open.length === 2 || open.includes(i) || matched.has(i)) return
    const next = [...open, i]
    setOpen(next)
    if (next.length === 2) {
      const [a, b] = next
      setTimeout(() => {
        if (cards[a] === cards[b]) {
          const m = new Set(matched).add(a).add(b)
          setMatched(m)
          if (m.size === cards.length) onDone()
        }
        setOpen([])
      }, 600)
    }
  }
  return (
    <div className="memory">
      {cards.map((c, i) => (
        <button
          key={i}
          onClick={() => flip(i)}
          className={`card-flip ${open.includes(i) || matched.has(i) ? 'is-up' : ''} ${matched.has(i) ? 'is-matched' : ''}`}
        >
          <span className="face back" />
          <span className="face front">
            <Shape name={c} size={34} />
          </span>
        </button>
      ))}
    </div>
  )
}

// ── 打字挑戰 ──
const PHRASES = [
  '鬼就在你身後',
  '安靜地躲好別出聲',
  '今天天氣真好適合躲貓貓',
  '我才不會被抓到',
  '校園裡到處都是秘密基地',
  '呼吸放輕腳步放慢',
  '三二一我要來抓你了',
  '躲在最明顯的地方最安全',
]
function TypingTask({ seed, onDone }: { seed: number; onDone: () => void }) {
  const phrase = useMemo(() => PHRASES[Math.floor(seeded(seed)() * PHRASES.length)], [seed])
  const [value, setValue] = useState('')
  const done = useRef(false)
  useEffect(() => {
    if (!done.current && value.replace(/\s/g, '') === phrase) {
      done.current = true
      onDone()
    }
  }, [value, phrase, onDone])
  return (
    <div className="task-game">
      <span className="eyebrow">請完整打出</span>
      <p className="phrase">{phrase}</p>
      <input className="answer" autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder="在這裡輸入" />
      <Progress value={[...value].filter((ch, i) => ch === [...phrase][i]).length / [...phrase].length} />
    </div>
  )
}

// ── 現實任務：走到指定點／移動 50 公尺 ──
function PlaceTask({ task, fix, onDone }: { task: Task; fix: GeoFix | null; onDone: () => void }) {
  const d = fix && task.point ? distance(fix, task.point) : null
  const reached =
    d !== null && (task.type === 'goto' ? d <= GOTO_RADIUS_M : d >= MOVE_DISTANCE_M)
  const done = useRef(false)
  useEffect(() => {
    if (reached && !done.current) {
      done.current = true
      onDone()
    }
  }, [reached, onDone])
  if (!task.point) return <p className="muted">任務資料有誤，請等下一個任務。</p>
  if (d === null) return <p className="muted">等待定位中…</p>
  return task.type === 'goto' ? (
    <div className="place">
      <p>
        走到地圖上的<b className="target">黃色目標</b>（{GOTO_RADIUS_M} 公尺內）
      </p>
      <p className="metric">
        還差 <b>{Math.max(0, Math.round(d - GOTO_RADIUS_M))}</b> 公尺
      </p>
    </div>
  ) : (
    <div className="place">
      <p>離開目前位置至少 {MOVE_DISTANCE_M} 公尺</p>
      <p className="metric">
        已移動 <b>{Math.round(d)}</b> / {MOVE_DISTANCE_M} 公尺
      </p>
      <Progress value={d / MOVE_DISTANCE_M} />
    </div>
  )
}

function Pips({ total, done }: { total: number; done: number }) {
  return (
    <span className="pips" aria-label={`${done} / ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <i key={i} className={i < done ? 'on' : ''} />
      ))}
    </span>
  )
}

function Progress({ value }: { value: number }) {
  return (
    <span className="progress">
      <i style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </span>
  )
}

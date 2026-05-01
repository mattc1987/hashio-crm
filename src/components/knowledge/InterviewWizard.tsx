// AI Interview wizard. Claude asks one question at a time, walking Matt
// through ~12 topics (company, ICP, value props, objections, voice, etc.).
//
// Each question comes from `aiNextInterviewQuestion` — the back-end AI
// adapts based on prior answers (asks follow-ups when answers are vague,
// moves on when they're rich). When done, the full Q/A transcript saves
// as a single `interview` row in the Knowledge bank.

import { useEffect, useRef, useState } from 'react'
import { Loader2, Sparkles, X, Check, ArrowRight, SkipForward } from 'lucide-react'
import { Button, Textarea, Badge } from '../ui'
import { invokeAction, api } from '../../lib/api'

interface QA {
  question: string
  answer: string
  topicLabel?: string
  topicIndex?: number
}

interface NextQ {
  question: string
  topicLabel?: string
  topicIndex?: number
  progress?: number
  done?: boolean
}

export function InterviewWizard({ onClose }: { onClose: () => void }) {
  const [history, setHistory] = useState<QA[]>([])
  const [current, setCurrent] = useState<NextQ | null>(null)
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const taRef = useRef<HTMLTextAreaElement>(null)

  // Fetch first question on mount
  useEffect(() => {
    void fetchNext([])
  }, [])

  // Auto-focus textarea on each new question
  useEffect(() => {
    if (current && !current.done) {
      setTimeout(() => taRef.current?.focus(), 50)
    }
  }, [current])

  async function fetchNext(hist: QA[]) {
    setLoading(true)
    setError(null)
    try {
      const res = await invokeAction('aiNextInterviewQuestion', {
        history: hist.map((qa) => ({ question: qa.question, answer: qa.answer })),
      })
      if (!res.ok) throw new Error(res.error || 'Failed to load next question')
      const d = (res as { data?: NextQ }).data
      setCurrent(d || { question: '', done: true })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  async function submitAnswer() {
    if (!draft.trim() || !current?.question) return
    const newHist: QA[] = [
      ...history,
      {
        question: current.question,
        answer: draft.trim(),
        topicLabel: current.topicLabel,
        topicIndex: current.topicIndex,
      },
    ]
    setHistory(newHist)
    setDraft('')
    await fetchNext(newHist)
  }

  function skipQuestion() {
    if (!current?.question) return
    const newHist: QA[] = [
      ...history,
      {
        question: current.question,
        answer: '(skipped)',
        topicLabel: current.topicLabel,
        topicIndex: current.topicIndex,
      },
    ]
    setHistory(newHist)
    setDraft('')
    void fetchNext(newHist)
  }

  async function saveTranscript() {
    setSaving(true)
    try {
      // Compose transcript as markdown
      const transcript = history
        .filter((qa) => qa.answer && qa.answer !== '(skipped)')
        .map((qa) => `## ${qa.topicLabel || 'Q'} — ${qa.question}\n${qa.answer}`)
        .join('\n\n')
      const now = new Date().toISOString()
      await api.knowledge.create({
        type: 'interview',
        title: `Founder interview — ${new Date().toLocaleDateString()}`,
        content: transcript,
        summary: '',
        tags: 'interview,founder',
        enabled: true,
        createdAt: now,
        updatedAt: now,
      })
      setSaved(true)
      setTimeout(onClose, 1200)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const done = current?.done === true
  const progress = current?.progress || Math.min(95, Math.round((history.length / 12) * 100))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />

      <div
        className="relative w-full max-w-[680px] max-h-[90vh] bg-[var(--surface)] rounded-[var(--radius-lg)] border border-[var(--border)] shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-[var(--border)] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-[var(--radius-md)] bg-[color:rgba(122,94,255,0.12)] text-[var(--color-brand-700)] dark:text-[var(--color-brand-300)] grid place-items-center">
              <Sparkles size={16} />
            </div>
            <div>
              <div className="font-display font-semibold text-[15px] text-body">Founder interview</div>
              <div className="text-[12px] text-muted">
                {done ? 'All done — review and save below.' : 'Claude is interviewing you so the AI BDR knows your company.'}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-[var(--radius-sm)] text-muted hover:text-body hover:surface-2"
          >
            <X size={16} />
          </button>
        </div>

        {/* Progress bar */}
        <div className="h-1 surface-2 relative overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 bg-[var(--color-brand-500)] transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Prior Q/A — collapsed list above current */}
          {history.length > 0 && (
            <div className="space-y-3">
              {history.map((qa, i) => (
                <div key={i} className="space-y-1.5">
                  <div className="flex items-center gap-2 text-[12px]">
                    {qa.topicLabel && <Badge tone="brand">{qa.topicLabel}</Badge>}
                    <span className="text-muted">{qa.question}</span>
                  </div>
                  <div className={`text-[13px] pl-3 border-l-2 ${qa.answer === '(skipped)' ? 'border-[var(--surface-3)] text-[var(--text-faint)] italic' : 'border-[var(--color-brand-300)] text-body'}`}>
                    {qa.answer}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Current question OR done state */}
          {error ? (
            <div className="p-4 rounded-[var(--radius-md)] bg-[color:rgba(239,76,76,0.08)] border border-[var(--color-danger)]/20 text-[13px] text-[var(--color-danger)]">
              {error}
            </div>
          ) : null}

          {loading ? (
            <div className="flex items-center gap-3 text-muted text-[13px] py-4">
              <Loader2 size={14} className="animate-spin" />
              {history.length === 0 ? 'Starting interview…' : 'Thinking about the next question…'}
            </div>
          ) : done ? (
            saved ? (
              <div className="flex flex-col items-center text-center py-8 gap-3">
                <div className="w-12 h-12 rounded-full bg-[color:rgba(48,179,107,0.12)] grid place-items-center text-[var(--color-success)]">
                  <Check size={20} />
                </div>
                <div className="font-display font-semibold text-[15px] text-body">Saved to Knowledge</div>
                <div className="text-muted text-[13px] max-w-xs">
                  Every AI feature now has this context.
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="p-4 rounded-[var(--radius-md)] bg-[color:rgba(48,179,107,0.06)] border border-[var(--color-success)]/20 text-[13px] text-body">
                  <strong>Interview complete.</strong> {history.filter((qa) => qa.answer !== '(skipped)').length} of {history.length} questions answered. Hit save to add this to your Knowledge bank.
                </div>
              </div>
            )
          ) : current?.question ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                {current.topicLabel && <Badge tone="brand">{current.topicLabel}</Badge>}
                <span className="text-[11px] text-[var(--text-faint)]">Question {history.length + 1}</span>
              </div>
              <div className="font-display text-[18px] text-body leading-snug">
                {current.question}
              </div>
              <Textarea
                ref={taRef}
                placeholder="Type your answer… or click Skip if it doesn't apply."
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    void submitAnswer()
                  }
                }}
                className="min-h-[120px]"
              />
              <div className="text-[11px] text-[var(--text-faint)]">
                Tip: be specific. "We help head growers reduce cost-per-pound" beats "we help cultivators be efficient." Press ⌘/Ctrl + Enter to submit.
              </div>
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[var(--border)] flex items-center justify-between gap-3">
          {done ? (
            saved ? (
              <div />
            ) : (
              <>
                <Button variant="ghost" onClick={onClose}>Discard</Button>
                <Button onClick={saveTranscript} disabled={saving || history.filter((qa) => qa.answer !== '(skipped)').length === 0}>
                  {saving ? <><Loader2 size={14} className="animate-spin" /> Saving…</> : <><Check size={14} /> Save to knowledge bank</>}
                </Button>
              </>
            )
          ) : (
            <>
              <Button variant="ghost" onClick={skipQuestion} disabled={loading || !current?.question}>
                <SkipForward size={14} /> Skip
              </Button>
              <Button onClick={submitAnswer} disabled={loading || !draft.trim() || !current?.question}>
                Next <ArrowRight size={14} />
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

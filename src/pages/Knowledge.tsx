// Knowledge bank — central company-context store. Three input modes:
//   • Interview — chat with Claude one question at a time, get structured Q/A
//   • Notes     — freeform "anything Claude should know" textarea
//   • Sources   — paste demo transcripts, battlecards, pricing docs, case studies
//
// Every enabled item is auto-injected into every AI system prompt by the
// Apps Script backend (see `withCompanyContext_` in Code.gs). The more Matt
// fills in here, the better Sequence Builder, Template Builder, AI BDR, and
// every other AI feature gets — without re-pasting context each time.

import { useMemo, useState } from 'react'
import {
  BookOpen, MessageCircle, FileText, FilePlus2, Sparkles,
  Trash2, Edit3, ToggleLeft, ToggleRight, Loader2, Check,
} from 'lucide-react'
import { useSheetData } from '../lib/sheet-context'
import { Card, Button, Input, Textarea, PageHeader, Empty, Badge, Select } from '../components/ui'
import { api, invokeAction } from '../lib/api'
import type { Knowledge, KnowledgeType } from '../lib/types'
import { date as fmtDate } from '../lib/format'
import { cn } from '../lib/cn'
import { InterviewWizard } from '../components/knowledge/InterviewWizard'

type Tab = 'all' | 'interview' | 'freeform' | 'source'

export function Knowledge() {
  const { state } = useSheetData()
  const knowledge: Knowledge[] = state.status === 'ready' ? state.data.knowledge : []
  const [tab, setTab] = useState<Tab>('all')
  const [editing, setEditing] = useState<Knowledge | null>(null)
  const [creating, setCreating] = useState<KnowledgeType | null>(null)
  const [interviewOpen, setInterviewOpen] = useState(false)

  const filtered = useMemo(() => {
    const sorted = [...knowledge].sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt))
    if (tab === 'all') return sorted
    return sorted.filter((k) => k.type === tab)
  }, [knowledge, tab])

  const enabledCount = knowledge.filter((k) => k.enabled).length
  const totalChars = knowledge.filter((k) => k.enabled).reduce((sum, k) => sum + (k.summary || k.content || '').length, 0)
  const tokenEstimate = Math.round(totalChars / 4) // rough — 4 chars/token

  return (
    <div className="space-y-6">
      <PageHeader
        title="Knowledge"
        subtitle="The single source of truth your AI features draw from. The more you fill in, the better every AI prompt gets."
      />

      {/* Stats bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile
          icon={<BookOpen size={16} />}
          label="Items in bank"
          value={String(knowledge.length)}
          hint={`${enabledCount} active in AI context`}
        />
        <StatTile
          icon={<Sparkles size={16} />}
          label="AI context size"
          value={`~${tokenEstimate.toLocaleString()} tokens`}
          hint={`${(totalChars / 1000).toFixed(1)}K characters`}
        />
        <StatTile
          icon={<MessageCircle size={16} />}
          label="Interview answers"
          value={String(knowledge.filter((k) => k.type === 'interview').length)}
        />
        <StatTile
          icon={<FileText size={16} />}
          label="Imported sources"
          value={String(knowledge.filter((k) => k.type === 'source').length)}
        />
      </div>

      {/* Quick-start cards (only when bank is empty or sparse) */}
      {knowledge.length < 3 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <QuickStartCard
            icon={<MessageCircle size={20} />}
            title="AI Interview"
            description="Claude asks you ~12 questions, one at a time. Best way to bootstrap from scratch — takes about 5 min."
            cta="Start interview"
            onClick={() => setInterviewOpen(true)}
            highlight
          />
          <QuickStartCard
            icon={<FilePlus2 size={20} />}
            title="Quick note"
            description="Just a textbox. Dump anything Claude should know — voice, ICP, deal-killers, jargon."
            cta="Add a note"
            onClick={() => setCreating('freeform')}
          />
          <QuickStartCard
            icon={<FileText size={20} />}
            title="Import a source"
            description="Paste a demo call transcript, pricing sheet, battlecard, or case study. Claude compresses it."
            cta="Add source"
            onClick={() => setCreating('source')}
          />
        </div>
      )}

      {/* Tabs + add buttons */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1 surface-2 rounded-[var(--radius-md)] p-1">
          {(['all', 'interview', 'freeform', 'source'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'px-3 py-1.5 rounded-[var(--radius-sm)] text-[13px] font-medium transition-colors',
                tab === t
                  ? 'bg-[var(--surface)] text-body shadow-sm'
                  : 'text-muted hover:text-body',
              )}
            >
              {t === 'all' ? 'All' : t === 'interview' ? 'Interview' : t === 'freeform' ? 'Notes' : 'Sources'}
              {t !== 'all' ? (
                <span className="ml-1.5 text-[var(--text-faint)]">
                  {knowledge.filter((k) => k.type === t).length}
                </span>
              ) : null}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => setInterviewOpen(true)}>
            <MessageCircle size={14} /> Interview
          </Button>
          <Button variant="secondary" onClick={() => setCreating('freeform')}>
            <FilePlus2 size={14} /> Add note
          </Button>
          <Button onClick={() => setCreating('source')}>
            <FileText size={14} /> Add source
          </Button>
        </div>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <Empty
          icon={<BookOpen size={24} />}
          title="Nothing here yet"
          description="Run the AI Interview, paste a quick note, or import a source — every AI feature in the app gets smarter the more you add here."
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((k) => (
            <KnowledgeRow key={k.id} item={k} onEdit={() => setEditing(k)} />
          ))}
        </div>
      )}

      {/* Editor drawer */}
      {(editing || creating) && (
        <Editor
          existing={editing}
          newType={creating}
          onClose={() => { setEditing(null); setCreating(null) }}
        />
      )}

      {/* Interview wizard */}
      {interviewOpen && (
        <InterviewWizard onClose={() => setInterviewOpen(false)} />
      )}
    </div>
  )
}

// ---------- Subcomponents ----------

function StatTile({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint?: string }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-muted text-[12px]">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-1 font-display font-semibold text-[20px] text-body">{value}</div>
      {hint ? <div className="text-[11px] text-[var(--text-faint)] mt-0.5">{hint}</div> : null}
    </Card>
  )
}

function QuickStartCard({
  icon, title, description, cta, onClick, highlight,
}: {
  icon: React.ReactNode
  title: string
  description: string
  cta: string
  onClick: () => void
  highlight?: boolean
}) {
  return (
    <Card
      className={cn(
        'p-5 flex flex-col gap-3',
        highlight && 'border-[color:var(--color-brand-300)] dark:border-[color:var(--color-brand-700)]',
      )}
    >
      <div className={cn(
        'w-9 h-9 rounded-[var(--radius-md)] grid place-items-center',
        highlight
          ? 'bg-[color:rgba(122,94,255,0.12)] text-[var(--color-brand-700)] dark:text-[var(--color-brand-300)]'
          : 'surface-2 text-muted',
      )}>
        {icon}
      </div>
      <div className="flex-1">
        <div className="font-display font-semibold text-[15px] text-body">{title}</div>
        <div className="text-[12px] text-muted mt-1 leading-relaxed">{description}</div>
      </div>
      <Button onClick={onClick} variant={highlight ? 'primary' : 'secondary'} className="w-fit">
        {cta}
      </Button>
    </Card>
  )
}

function KnowledgeRow({ item, onEdit }: { item: Knowledge; onEdit: () => void }) {
  const preview = (item.summary || item.content || '').slice(0, 220)

  const toggleEnabled = async (e: React.MouseEvent) => {
    e.stopPropagation()
    await api.knowledge.update({ id: item.id, enabled: !item.enabled })
  }

  const remove = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm(`Delete "${item.title}"?`)) return
    await api.knowledge.remove(item.id)
  }

  const TypeIcon = item.type === 'interview' ? MessageCircle : item.type === 'source' ? FileText : FilePlus2

  return (
    <Card
      className={cn(
        'p-4 cursor-pointer transition-colors hover:border-[color:var(--color-brand-300)]',
        !item.enabled && 'opacity-60',
      )}
      onClick={onEdit}
    >
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-[var(--radius-md)] surface-2 grid place-items-center text-muted shrink-0 mt-0.5">
          <TypeIcon size={14} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="font-display font-semibold text-[14px] text-body truncate">
              {item.title || <span className="text-muted italic">Untitled</span>}
            </div>
            <Badge tone={item.type === 'interview' ? 'brand' : item.type === 'source' ? 'info' : 'neutral'}>
              {item.type}
            </Badge>
            {item.summary ? (
              <Badge tone="success">summarized</Badge>
            ) : null}
            {!item.enabled ? (
              <Badge tone="neutral">disabled</Badge>
            ) : null}
          </div>
          {preview ? (
            <div className="text-[12px] text-muted mt-1.5 line-clamp-2 leading-relaxed">
              {preview}
              {(item.summary || item.content || '').length > 220 ? '…' : ''}
            </div>
          ) : null}
          <div className="text-[11px] text-[var(--text-faint)] mt-2">
            Updated {fmtDate(item.updatedAt || item.createdAt)}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={toggleEnabled}
            title={item.enabled ? 'Disable in AI context' : 'Enable in AI context'}
            className="p-1.5 rounded-[var(--radius-sm)] text-muted hover:text-body hover:surface-2"
          >
            {item.enabled ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
          </button>
          <button
            onClick={onEdit}
            title="Edit"
            className="p-1.5 rounded-[var(--radius-sm)] text-muted hover:text-body hover:surface-2"
          >
            <Edit3 size={14} />
          </button>
          <button
            onClick={remove}
            title="Delete"
            className="p-1.5 rounded-[var(--radius-sm)] text-muted hover:text-[var(--color-danger)] hover:surface-2"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </Card>
  )
}

// ---------- Editor / creator drawer ----------

function Editor({
  existing, newType, onClose,
}: {
  existing: Knowledge | null
  newType: KnowledgeType | null
  onClose: () => void
}) {
  const isNew = !existing
  const [title, setTitle] = useState(existing?.title || '')
  const [content, setContent] = useState(existing?.content || '')
  const [summary, setSummary] = useState(existing?.summary || '')
  const [tags, setTags] = useState(existing?.tags || '')
  const [type, setType] = useState<KnowledgeType>(existing?.type || newType || 'freeform')
  const [enabled, setEnabled] = useState(existing?.enabled ?? true)
  const [saving, setSaving] = useState(false)
  const [summarizing, setSummarizing] = useState(false)

  const isLong = content.length > 1500
  const showSummary = type === 'source' || isLong || !!summary

  const save = async () => {
    setSaving(true)
    try {
      const now = new Date().toISOString()
      if (isNew) {
        await api.knowledge.create({
          type, title: title.trim() || 'Untitled', content, summary, tags, enabled,
          createdAt: now, updatedAt: now,
        })
      } else {
        await api.knowledge.update({
          id: existing!.id, type, title: title.trim() || 'Untitled', content, summary, tags, enabled,
          updatedAt: now,
        })
      }
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const summarize = async () => {
    if (!content.trim()) return
    setSummarizing(true)
    try {
      const res = await invokeAction('aiSummarizeKnowledge', { title, content, kind: type === 'source' ? 'document' : 'other' })
      const d = (res as { data?: { summary?: string } }).data
      if (d?.summary) setSummary(d.summary)
    } finally {
      setSummarizing(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative w-full max-w-[640px] h-full bg-[var(--surface)] border-l border-[var(--border)] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 bg-[var(--surface)] border-b border-[var(--border)] px-5 py-3 flex items-center justify-between">
          <div>
            <div className="font-display font-semibold text-[15px] text-body">
              {isNew ? 'New knowledge item' : 'Edit knowledge'}
            </div>
            <div className="text-[12px] text-muted">
              Auto-injected into every AI prompt across the app.
            </div>
          </div>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-faint)] mb-1">Type</div>
              <Select value={type} onChange={(e) => setType(e.target.value as KnowledgeType)}>
                <option value="freeform">Note (freeform)</option>
                <option value="source">Source (transcript / doc)</option>
                <option value="interview">Interview answer</option>
              </Select>
            </label>
            <label className="block">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-faint)] mb-1">Tags</div>
              <Input
                placeholder="comma, separated, tags"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
              />
            </label>
          </div>

          <label className="block">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-faint)] mb-1">Title</div>
            <Input
              placeholder={
                type === 'source' ? 'e.g. Demo call — Acme Corp (Mar 12)' :
                type === 'interview' ? 'e.g. Founder interview — May 1' :
                'e.g. Voice & tone'
              }
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>

          <label className="block">
            <div className="flex items-center justify-between mb-1">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-faint)]">
                Content {content.length > 0 ? `· ${content.length.toLocaleString()} chars` : ''}
              </div>
              {type === 'source' && content.length > 500 ? (
                <Button variant="ghost" onClick={summarize} disabled={summarizing}>
                  {summarizing ? <><Loader2 size={12} className="animate-spin" /> Summarizing…</> : <><Sparkles size={12} /> Summarize</>}
                </Button>
              ) : null}
            </div>
            <Textarea
              placeholder={
                type === 'source' ? 'Paste the transcript / doc content here…' :
                type === 'interview' ? 'Question and answer pairs (the wizard fills this in for you).' :
                'Anything Claude should know — voice, ICP details, jargon, deal-killers, common objections…'
              }
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="min-h-[280px] font-mono text-[12px]"
            />
          </label>

          {showSummary ? (
            <label className="block">
              <div className="flex items-center justify-between mb-1">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-faint)]">
                  AI summary {summary ? `· ${summary.length.toLocaleString()} chars` : '· optional'}
                </div>
                {!summary && content.length > 500 ? (
                  <Button variant="ghost" onClick={summarize} disabled={summarizing}>
                    {summarizing ? <><Loader2 size={12} className="animate-spin" /> Summarizing…</> : <><Sparkles size={12} /> Generate summary</>}
                  </Button>
                ) : null}
              </div>
              <Textarea
                placeholder="A compressed version. When present, the summary (not the raw content) gets injected into AI prompts to save tokens."
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                className="min-h-[140px] text-[13px]"
              />
              <div className="text-[11px] text-[var(--text-faint)] mt-1">
                Tip: a good summary fits in 200–600 words and pulls out customer quotes, objections, pricing, and "wow moments."
              </div>
            </label>
          ) : null}

          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="mt-0.5"
            />
            <div>
              <div className="text-[13px] font-medium text-body">Active in AI context</div>
              <div className="text-[11px] text-muted">When unchecked, this item is excluded from the company-context block injected into AI prompts.</div>
            </div>
          </label>

          <div className="flex items-center gap-2 pt-2 border-t border-[var(--border)]">
            <Button onClick={save} disabled={saving || !content.trim()}>
              {saving ? <><Loader2 size={14} className="animate-spin" /> Saving…</> : <><Check size={14} /> {isNew ? 'Save' : 'Update'}</>}
            </Button>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
          </div>
        </div>
      </div>
    </div>
  )
}

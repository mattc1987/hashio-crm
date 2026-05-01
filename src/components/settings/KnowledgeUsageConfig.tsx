// Per-feature toggles for Knowledge bank injection. Each AI feature has
// its own switch — turn ON to inject your full company knowledge into
// that AI call (better quality, more cost), OR turn OFF to skip it
// (faster, cheaper, but more generic output).
//
// Defaults split features into two buckets:
//   • Deep generation — knowledge ON (Sequence Builder, Template Builder, etc.)
//   • Quick / mechanical — knowledge OFF (single drafts, enrichment, etc.)
//
// Storage: Apps Script Script Properties (KNOWLEDGE_FEATURES JSON).
// Read via getKnowledgeFeatureConfig, written via setKnowledgeFeatureConfig.

import { useEffect, useMemo, useState } from 'react'
import { BookOpen, Save, Loader2, RefreshCw } from 'lucide-react'
import { Card, CardHeader, Button, Badge } from '../ui'
import { invokeAction, hasWriteBackend } from '../../lib/api'
import { useSheetData } from '../../lib/sheet-context'
import { cn } from '../../lib/cn'

interface FeatureMeta {
  key: string
  label: string
  description: string
  group: 'deep' | 'quick'
  /** Rough estimate of how often this fires for a typical user. Used to
   *  display "calls/day" so cost projections feel concrete. */
  callsPerDay: number
}

const FEATURES: FeatureMeta[] = [
  // Deep generation
  { key: 'aiBuildSequence',         label: 'Sequence Builder',           description: 'Multi-touch outreach campaigns. Voice + objections + ICP critical here.', group: 'deep',  callsPerDay: 0.5 },
  { key: 'aiBuildEmailTemplate',    label: 'Email Template Builder',     description: 'New email templates from goal + audience. Knowledge boosts copy quality.', group: 'deep',  callsPerDay: 1 },
  { key: 'aiSuggestTargets',        label: 'Lead-target suggestions',    description: 'Lookalike account / role suggestions. Needs your ICP to be useful.',       group: 'deep',  callsPerDay: 0.3 },
  { key: 'aiStrategistProposals',   label: 'Strategist proposals',       description: 'Free-form "moves the rules might miss" on the AI BDR page.',               group: 'deep',  callsPerDay: 0.5 },
  { key: 'aiDashboardBriefing',     label: 'Dashboard briefing & digest',description: 'The morning briefing card + the 8am cron digest email.',                   group: 'deep',  callsPerDay: 1.2 },
  { key: 'aiNextInterviewQuestion', label: 'Knowledge interview',        description: 'Interview wizard knows what topics are already covered.',                   group: 'deep',  callsPerDay: 0.05 },
  { key: 'aiSummarizeKnowledge',    label: 'Source summarizer',          description: 'Compresses pasted transcripts/docs. Context = on-topic summaries.',         group: 'deep',  callsPerDay: 0.05 },

  // Quick / mechanical
  { key: 'draftMessage',            label: 'Single email/SMS drafts',    description: 'The "AI write" button on individual messages. Highest volume.',            group: 'quick', callsPerDay: 5 },
  { key: 'narrativeReason',         label: '"Why this proposal" tooltips', description: 'Explanatory blurb on a single proposal card.',                           group: 'quick', callsPerDay: 3 },
  { key: 'aiSuggestNextMove',       label: 'AI BDR — single contact next move', description: 'The popup recommendation when you open the BDR drawer on a contact.', group: 'quick', callsPerDay: 4 },
  { key: 'aiEnrichLead',            label: 'Lead enrichment',            description: 'Infer industry / size / role from a single lead. Mostly mechanical.',      group: 'quick', callsPerDay: 1 },
  { key: 'aiEnrichContact',         label: 'Contact enrichment (single)', description: 'Infer role / department from a contact\'s title. Mechanical inference.',  group: 'quick', callsPerDay: 0.5 },
  { key: 'aiEnrichContactsBulk',    label: 'Contact enrichment (bulk)',  description: 'Same, but batched. Used during quality scans.',                            group: 'quick', callsPerDay: 0.3 },
]

export function KnowledgeUsageConfig() {
  const { state } = useSheetData()
  const [config, setConfig] = useState<Record<string, boolean> | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [dirty, setDirty] = useState(false)

  const refresh = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await invokeAction('getKnowledgeFeatureConfig', {})
      if (!res.ok) throw new Error(res.error || 'Failed to load')
      setConfig((res as { data?: Record<string, boolean> }).data || {})
      setDirty(false)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void refresh() }, [])

  const knowledge = state.status === 'ready' ? state.data.knowledge : []
  const enabledKnowledge = knowledge.filter((k) => k.enabled)
  const totalChars = enabledKnowledge.reduce((sum, k) => sum + (k.summary || k.content || '').length, 0)
  const tokens = Math.round(totalChars / 4)

  // Cost per call with knowledge attached, at Claude Sonnet 4.5 input pricing
  // ($3 / million tokens). Doesn't include the prompt itself or output.
  const costPerCallWithKB = (tokens * 3) / 1_000_000

  const monthlyCost = useMemo(() => {
    if (!config) return { withKB: 0, withoutKB: 0, savings: 0 }
    let withKB = 0
    let total = 0
    FEATURES.forEach((f) => {
      const monthlyCalls = f.callsPerDay * 30
      total += monthlyCalls
      if (config[f.key]) withKB += monthlyCalls
    })
    return {
      withKB: withKB * costPerCallWithKB,
      total,
      savings: (total - withKB) * costPerCallWithKB,
    }
  }, [config, costPerCallWithKB])

  const toggle = (key: string) => {
    if (!config) return
    setConfig({ ...config, [key]: !config[key] })
    setDirty(true)
    setSaved(false)
  }

  const setBulk = (group: 'deep' | 'quick', value: boolean) => {
    if (!config) return
    const next = { ...config }
    FEATURES.filter((f) => f.group === group).forEach((f) => { next[f.key] = value })
    setConfig(next)
    setDirty(true)
    setSaved(false)
  }

  const save = async () => {
    if (!config) return
    setSaving(true)
    setError(null)
    try {
      const res = await invokeAction('setKnowledgeFeatureConfig', { features: config })
      if (!res.ok) throw new Error(res.error || 'Failed to save')
      setConfig((res as { data?: Record<string, boolean> }).data || config)
      setDirty(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (!hasWriteBackend()) {
    return (
      <Card>
        <CardHeader title="Knowledge bank usage" subtitle="Configure Anthropic + Apps Script first." />
      </Card>
    )
  }

  const enabledCount = config ? Object.values(config).filter(Boolean).length : 0

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <BookOpen size={16} className="text-[var(--color-brand-600)]" />
            Knowledge bank usage
          </span>
        }
        subtitle={
          tokens > 0
            ? `Your bank is ~${tokens.toLocaleString()} tokens. Each "ON" feature pays $${costPerCallWithKB.toFixed(3)} extra per call to inject it.`
            : 'Your knowledge bank is empty — fill it on the /knowledge page first.'
        }
        action={
          <Button variant="ghost" onClick={refresh} disabled={loading}>
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
          </Button>
        }
      />

      {error && (
        <div className="mb-3 p-3 rounded-[var(--radius-md)] bg-[color:rgba(239,76,76,0.08)] border border-[var(--color-danger)]/20 text-[12px] text-[var(--color-danger)]">
          {error}
        </div>
      )}

      {loading || !config ? (
        <div className="text-[13px] text-muted py-4 flex items-center gap-2">
          <Loader2 size={14} className="animate-spin" /> Loading current settings…
        </div>
      ) : (
        <>
          {/* Cost summary */}
          {tokens > 0 && (
            <div className="mb-4 p-3 rounded-[var(--radius-md)] surface-2 grid grid-cols-2 gap-3 text-[12px]">
              <div>
                <div className="text-muted">Active features</div>
                <div className="font-display text-[16px] font-semibold text-body">
                  {enabledCount} of {FEATURES.length}
                </div>
              </div>
              <div>
                <div className="text-muted">Est. monthly KB cost</div>
                <div className="font-display text-[16px] font-semibold text-body">
                  ${monthlyCost.withKB.toFixed(2)}/mo
                </div>
                {monthlyCost.savings > 0 && (
                  <div className="text-[10px] text-[var(--color-success)] mt-0.5">
                    saving ${monthlyCost.savings.toFixed(2)}/mo vs all-on
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Deep group */}
          <div className="mb-5">
            <div className="flex items-center justify-between mb-2">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-faint)]">Deep generation</div>
                <div className="text-[12px] text-muted">Recommended ON. Output quality is the whole point of these features.</div>
              </div>
              <div className="flex gap-1">
                <button onClick={() => setBulk('deep', true)}  className="text-[11px] text-muted hover:text-body">All on</button>
                <span className="text-[var(--text-faint)]">·</span>
                <button onClick={() => setBulk('deep', false)} className="text-[11px] text-muted hover:text-body">All off</button>
              </div>
            </div>
            <div className="space-y-1.5">
              {FEATURES.filter((f) => f.group === 'deep').map((f) => (
                <FeatureRow key={f.key} meta={f} on={config[f.key] === true} onToggle={() => toggle(f.key)} costPerCall={costPerCallWithKB} />
              ))}
            </div>
          </div>

          {/* Quick group */}
          <div className="mb-5">
            <div className="flex items-center justify-between mb-2">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-faint)]">Quick / mechanical</div>
                <div className="text-[12px] text-muted">Default OFF — high-volume actions where cost per call matters more than maximum quality.</div>
              </div>
              <div className="flex gap-1">
                <button onClick={() => setBulk('quick', true)}  className="text-[11px] text-muted hover:text-body">All on</button>
                <span className="text-[var(--text-faint)]">·</span>
                <button onClick={() => setBulk('quick', false)} className="text-[11px] text-muted hover:text-body">All off</button>
              </div>
            </div>
            <div className="space-y-1.5">
              {FEATURES.filter((f) => f.group === 'quick').map((f) => (
                <FeatureRow key={f.key} meta={f} on={config[f.key] === true} onToggle={() => toggle(f.key)} costPerCall={costPerCallWithKB} />
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button onClick={save} variant="primary" disabled={saving || !dirty}>
              {saving ? <><Loader2 size={14} className="animate-spin" /> Saving…</> : <><Save size={14} /> Save changes</>}
            </Button>
            {saved && <Badge tone="success">Saved</Badge>}
            {dirty && !saving && !saved && <span className="text-[12px] text-muted">Unsaved changes</span>}
          </div>
        </>
      )}
    </Card>
  )
}

function FeatureRow({
  meta, on, onToggle, costPerCall,
}: {
  meta: FeatureMeta
  on: boolean
  onToggle: () => void
  costPerCall: number
}) {
  const monthlyKB = on ? meta.callsPerDay * 30 * costPerCall : 0
  return (
    <button
      onClick={onToggle}
      className={cn(
        'w-full flex items-start gap-3 p-2.5 rounded-[var(--radius-md)] text-left transition-colors',
        'border border-transparent hover:surface-2',
        on && 'bg-[color:rgba(122,94,255,0.06)] border-[color:rgba(122,94,255,0.18)]',
      )}
    >
      {/* Toggle switch */}
      <div
        className={cn(
          'shrink-0 mt-0.5 w-9 h-5 rounded-full p-0.5 transition-colors',
          on ? 'bg-[var(--color-brand-600)]' : 'bg-[var(--surface-3)]',
        )}
      >
        <div
          className={cn(
            'w-4 h-4 rounded-full bg-white shadow-sm transition-transform',
            on && 'translate-x-4',
          )}
        />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="text-[13px] font-medium text-body">{meta.label}</div>
          {meta.callsPerDay >= 1 && (
            <span className="text-[10px] text-[var(--text-faint)]">~{meta.callsPerDay}/day</span>
          )}
          {on && monthlyKB > 0 && (
            <Badge tone="brand" className="ml-auto">+${monthlyKB.toFixed(2)}/mo</Badge>
          )}
        </div>
        <div className="text-[11px] text-muted mt-0.5 leading-relaxed">{meta.description}</div>
      </div>
    </button>
  )
}

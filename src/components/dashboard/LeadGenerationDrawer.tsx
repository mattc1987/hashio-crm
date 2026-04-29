// Lead generation drawer — multi-option flow for adding leads to the pipeline.
//
// Options:
// 1. AI suggest target accounts — Claude proposes lookalike accounts
// 2. Import CSV — links to existing /import page
// 3. Manual entry — quick-add form
// 4. Webhook info — points to Settings ingest URL

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Sparkles, Upload, UserPlus, Webhook, Loader2, AlertCircle,
  CheckCircle2, ExternalLink, Wand2, RefreshCw, Plus,
} from 'lucide-react'
import { Drawer } from '../Drawer'
import { Button, Badge, Input, Textarea } from '../ui'
import { suggestTargets, type SuggestedTarget } from '../../lib/bdrAi'
import { api } from '../../lib/api'
import type { SheetData } from '../../lib/types'
import { cn } from '../../lib/cn'

interface Props {
  open: boolean
  onClose: () => void
  data: SheetData
}

type Mode = 'menu' | 'ai-suggest' | 'manual'

export function LeadGenerationDrawer({ open, onClose, data }: Props) {
  const navigate = useNavigate()
  const [mode, setMode] = useState<Mode>('menu')
  const [criteria, setCriteria] = useState('')
  const [count, setCount] = useState(10)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [targets, setTargets] = useState<SuggestedTarget[]>([])
  const [researchSteps, setResearchSteps] = useState<string[]>([])
  const [creating, setCreating] = useState<Set<number>>(new Set())
  const [created, setCreated] = useState<Set<number>>(new Set())

  // Manual form state
  const [manualForm, setManualForm] = useState({
    firstName: '', lastName: '', email: '', linkedinUrl: '', companyName: '', title: '',
  })
  const [manualSaving, setManualSaving] = useState(false)
  const [manualResult, setManualResult] = useState<{ ok: boolean; message: string } | null>(null)

  const reset = () => {
    setMode('menu')
    setTargets([])
    setResearchSteps([])
    setError(null)
    setCriteria('')
    setCreating(new Set())
    setCreated(new Set())
    setManualResult(null)
    setManualForm({ firstName: '', lastName: '', email: '', linkedinUrl: '', companyName: '', title: '' })
  }

  const handleClose = () => {
    onClose()
    setTimeout(reset, 300)
  }

  const runAiSuggest = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await suggestTargets(data, { criteria, count })
      setTargets(res.targets || [])
      setResearchSteps(res.researchSteps || [])
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const createLeadFromTarget = async (target: SuggestedTarget, idx: number) => {
    setCreating((s) => new Set([...s, idx]))
    try {
      // Create one lead per target role suggested. If no roles, a single lead w/ generic title.
      const roles = target.targetRoles && target.targetRoles.length > 0 ? target.targetRoles : ['']
      for (const role of roles) {
        await api.lead.create({
          source: 'ai-suggested',
          externalId: `ai-${Date.now()}-${idx}-${role || 'role'}`.toLowerCase().replace(/\s+/g, '-'),
          firstName: '',
          lastName: '',
          email: '',
          linkedinUrl: '',
          headline: role || '',
          title: role || '',
          companyName: target.companyName,
          companyLinkedinUrl: target.linkedinHint || '',
          companyDomain: '',
          companyIndustry: 'Cannabis Cultivation',
          companySize: target.size,
          location: target.state,
          engagementSignals: '[]',
          temperature: 'cold',
          score: 0,
          status: 'new',
          notes: `AI-suggested target. ${target.whyFit} (Confidence: ${target.confidence}/100)`,
          convertedContactId: '',
          createdAt: new Date().toISOString(),
          lastSignalAt: '',
        })
      }
      setCreated((s) => new Set([...s, idx]))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setCreating((s) => { const next = new Set(s); next.delete(idx); return next })
    }
  }

  const createManualLead = async () => {
    if (!manualForm.firstName.trim() && !manualForm.email.trim() && !manualForm.companyName.trim()) {
      setManualResult({ ok: false, message: 'At least one of: name, email, or company is required.' })
      return
    }
    setManualSaving(true)
    setManualResult(null)
    try {
      await api.lead.create({
        source: 'manual',
        externalId: `manual-${Date.now()}`,
        firstName: manualForm.firstName,
        lastName: manualForm.lastName,
        email: manualForm.email,
        linkedinUrl: manualForm.linkedinUrl,
        headline: manualForm.title,
        title: manualForm.title,
        companyName: manualForm.companyName,
        companyLinkedinUrl: '',
        companyDomain: '',
        companyIndustry: '',
        companySize: '',
        location: '',
        engagementSignals: '[]',
        temperature: 'cold',
        score: 0,
        status: 'new',
        notes: 'Manually added.',
        convertedContactId: '',
        createdAt: new Date().toISOString(),
        lastSignalAt: '',
      })
      setManualResult({ ok: true, message: 'Lead created.' })
      setManualForm({ firstName: '', lastName: '', email: '', linkedinUrl: '', companyName: '', title: '' })
    } catch (err) {
      setManualResult({ ok: false, message: (err as Error).message })
    } finally {
      setManualSaving(false)
    }
  }

  return (
    <Drawer
      open={open}
      onClose={handleClose}
      width={620}
      title={
        <span className="flex items-center gap-2">
          <Plus size={15} className="text-[var(--color-brand-600)]" />
          Find more leads
        </span>
      }
      subtitle="Pipeline-creation toolkit. Pick the path that fits."
      footer={
        mode !== 'menu' ? (
          <>
            <Button variant="ghost" onClick={() => { reset() }}>← Back to options</Button>
            <Button variant="secondary" onClick={handleClose}>Done</Button>
          </>
        ) : null
      }
    >
      {mode === 'menu' && (
        <div className="grid grid-cols-1 gap-2.5">
          <OptionCard
            icon={<Sparkles size={16} className="text-[var(--color-brand-600)]" />}
            title="AI suggest target accounts"
            description="Claude analyzes your existing customers + ICP and proposes lookalike accounts to pursue."
            cta="Run AI suggest →"
            onClick={() => setMode('ai-suggest')}
          />
          <OptionCard
            icon={<Upload size={16} className="text-[var(--color-info)]" />}
            title="Import a CSV"
            description="Bulk upload from Apollo, Clay, ZoomInfo, or any spreadsheet of prospects."
            cta="Open Import →"
            onClick={() => { onClose(); navigate('/import') }}
          />
          <OptionCard
            icon={<UserPlus size={16} className="text-[var(--color-success)]" />}
            title="Add a single lead manually"
            description="Quick form for one prospect — name, email, LinkedIn, company."
            cta="Add manually →"
            onClick={() => setMode('manual')}
          />
          <OptionCard
            icon={<Webhook size={16} className="text-[var(--color-warning)]" />}
            title="Wire a webhook (Teamfluence / Zapier / Apollo)"
            description="Auto-flow leads from your prospecting tool. The webhook URL + payload schema are in Settings."
            cta="Open Settings →"
            onClick={() => { onClose(); navigate('/settings') }}
          />
        </div>
      )}

      {mode === 'ai-suggest' && (
        <div className="flex flex-col gap-4">
          <div className="surface-2 rounded-[var(--radius-md)] p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)] mb-2">
              Optional criteria
            </div>
            <Textarea
              value={criteria}
              onChange={(e) => setCriteria(e.target.value)}
              placeholder='e.g. "Tier 2-3 indoor cultivators in Colorado that just got rec licenses" or "operations directors at multi-state operators expanding to Oklahoma"'
              rows={3}
              className="text-[12px]"
            />
            <div className="flex items-center gap-2 mt-2">
              <span className="text-[11px] text-muted">Generate</span>
              <select
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
                className="surface-2 border-soft rounded h-7 px-2 text-[11px]"
              >
                {[5, 10, 15, 20].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              <span className="text-[11px] text-muted">target accounts</span>
              <Button
                variant="primary"
                size="sm"
                icon={loading ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
                onClick={runAiSuggest}
                disabled={loading}
                className="ml-auto"
              >
                {loading ? 'Researching…' : targets.length > 0 ? 'Regenerate' : 'Suggest targets'}
              </Button>
            </div>
          </div>

          {error && (
            <div className="surface-2 rounded-[var(--radius-md)] p-3 text-[12px] text-[var(--color-danger)] flex items-start gap-2">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              <div>{error}</div>
            </div>
          )}

          {targets.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)] font-semibold">
                {targets.length} target{targets.length === 1 ? '' : 's'} suggested
              </div>
              {targets.map((t, i) => (
                <TargetCard
                  key={i}
                  target={t}
                  isCreating={creating.has(i)}
                  isCreated={created.has(i)}
                  onAdd={() => createLeadFromTarget(t, i)}
                />
              ))}
            </div>
          )}

          {researchSteps.length > 0 && (
            <div className="surface-2 rounded-[var(--radius-md)] p-3">
              <div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)] font-semibold mb-1.5">
                Suggested next research
              </div>
              <ul className="text-[12px] text-muted space-y-1 list-disc pl-5">
                {researchSteps.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {mode === 'manual' && (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="First name">
              <Input value={manualForm.firstName} onChange={(e) => setManualForm({ ...manualForm, firstName: e.target.value })} />
            </Field>
            <Field label="Last name">
              <Input value={manualForm.lastName} onChange={(e) => setManualForm({ ...manualForm, lastName: e.target.value })} />
            </Field>
          </div>
          <Field label="Email">
            <Input type="email" value={manualForm.email} onChange={(e) => setManualForm({ ...manualForm, email: e.target.value })} placeholder="jane@acme.com" />
          </Field>
          <Field label="LinkedIn URL">
            <Input value={manualForm.linkedinUrl} onChange={(e) => setManualForm({ ...manualForm, linkedinUrl: e.target.value })} placeholder="https://linkedin.com/in/janedoe" />
          </Field>
          <Field label="Company">
            <Input value={manualForm.companyName} onChange={(e) => setManualForm({ ...manualForm, companyName: e.target.value })} />
          </Field>
          <Field label="Title / Role">
            <Input value={manualForm.title} onChange={(e) => setManualForm({ ...manualForm, title: e.target.value })} placeholder="Director of Cultivation" />
          </Field>
          <Button
            variant="primary"
            icon={<Plus size={13} />}
            onClick={createManualLead}
            disabled={manualSaving}
          >
            {manualSaving ? 'Adding…' : 'Add lead'}
          </Button>
          {manualResult && (
            <div className={cn(
              'p-3 rounded-[var(--radius-md)] text-[12px]',
              manualResult.ok ? 'bg-[color:rgba(48,179,107,0.1)] text-[var(--color-success)]' : 'bg-[color:rgba(239,76,76,0.08)] text-[var(--color-danger)]',
            )}>
              {manualResult.message}
            </div>
          )}
        </div>
      )}
    </Drawer>
  )
}

function OptionCard({
  icon, title, description, cta, onClick,
}: {
  icon: React.ReactNode
  title: string
  description: string
  cta: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="text-left surface border-soft rounded-[var(--radius-md)] p-4 hover:surface-2 hover:border-[var(--color-brand-500)] transition-all group"
    >
      <div className="flex items-start gap-3">
        <span className="w-8 h-8 rounded-full surface-2 grid place-items-center shrink-0">{icon}</span>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-[13px] text-body mb-0.5">{title}</div>
          <div className="text-[11px] text-muted leading-relaxed mb-1.5">{description}</div>
          <div className="text-[11px] text-[var(--color-brand-600)] group-hover:text-[var(--color-brand-700)] font-medium">{cta}</div>
        </div>
      </div>
    </button>
  )
}

function TargetCard({
  target, isCreating, isCreated, onAdd,
}: {
  target: SuggestedTarget
  isCreating: boolean
  isCreated: boolean
  onAdd: () => void
}) {
  return (
    <div className={cn(
      'surface border-soft rounded-[var(--radius-md)] p-3 transition-all',
      isCreated && 'opacity-60',
    )}>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-[13px] text-body">{target.companyName}</span>
            {target.state && <Badge tone="neutral">{target.state}</Badge>}
            {target.size && <Badge tone="info">{target.size}</Badge>}
            {target.licenseType && target.licenseType !== 'Unknown' && <Badge tone="brand">{target.licenseType}</Badge>}
            <Badge tone={target.confidence >= 70 ? 'success' : target.confidence >= 40 ? 'warning' : 'neutral'}>
              {target.confidence}% conf
            </Badge>
          </div>
          {target.targetRoles && target.targetRoles.length > 0 && (
            <div className="text-[11px] text-muted mt-1">Roles to target: {target.targetRoles.join(' · ')}</div>
          )}
          <div className="text-[12px] text-muted mt-1.5 leading-relaxed">{target.whyFit}</div>
          {target.linkedinHint && (
            <a
              href={target.linkedinHint}
              target="_blank"
              rel="noreferrer"
              className="text-[11px] text-[var(--color-brand-600)] hover:text-[var(--color-brand-700)] inline-flex items-center gap-1 mt-1.5"
            >
              LinkedIn / source <ExternalLink size={10} />
            </a>
          )}
        </div>
        <Button
          size="sm"
          variant={isCreated ? 'secondary' : 'primary'}
          icon={isCreating ? <Loader2 size={12} className="animate-spin" /> : isCreated ? <CheckCircle2 size={12} /> : <Plus size={12} />}
          onClick={onAdd}
          disabled={isCreating || isCreated}
        >
          {isCreated ? 'Added' : isCreating ? 'Adding…' : 'Add to leads'}
        </Button>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">{label}</span>
      {children}
    </label>
  )
}

void RefreshCw // imported for potential future use

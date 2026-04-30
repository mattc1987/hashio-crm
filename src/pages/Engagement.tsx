import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Mail, MailOpen, MousePointerClick, Reply, Search,
  ArrowUpDown, ArrowUp, ArrowDown, AlertCircle, Send,
  Link2, Flame, ThumbsUp, MessageCircle, Eye,
  UserPlus, Briefcase, RefreshCw, CheckCircle2,
} from 'lucide-react'
import { useSheetData } from '../lib/sheet-context'
import { Card, Input, PageHeader, Empty, Avatar, Badge, Stat, Button } from '../components/ui'
import { date, relativeDate } from '../lib/format'
import type { EmailSend, Lead } from '../lib/types'
import { parseSignals, temperatureColor, temperatureLabel, scoreLead } from '../lib/leadScoring'
import { invokeAction, hasWriteBackend } from '../lib/api'
import { cn } from '../lib/cn'

type SortKey = 'sentAt' | 'opened' | 'clicked' | 'replied' | 'recipient' | 'sequence'
type SortDir = 'asc' | 'desc'
type Channel = 'email' | 'linkedin'

interface EnrichedSend extends EmailSend {
  recipientName: string
  sequenceName: string
  stepLabel: string
}

export function Engagement() {
  const { state, refresh } = useSheetData()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [channel, setChannel] = useState<Channel>('email')
  const [filterEngagement, setFilterEngagement] = useState<'all' | 'opened' | 'clicked' | 'replied' | 'unopened'>('all')
  const [sortKey, setSortKey] = useState<SortKey>('sentAt')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [checkingReplies, setCheckingReplies] = useState(false)
  const [installingTrigger, setInstallingTrigger] = useState(false)
  const [replyResult, setReplyResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [scanningInbound, setScanningInbound] = useState(false)
  const [installingInboundTrigger, setInstallingInboundTrigger] = useState(false)

  const checkReplies = async () => {
    setCheckingReplies(true)
    setReplyResult(null)
    try {
      const res = await invokeAction('checkReplies', {})
      if (!res.ok) throw new Error(res.error || 'Failed')
      const d = (res as { data?: { checked?: number; updated?: number } }).data
      setReplyResult({
        ok: true,
        message: `Scan complete — ${d?.updated ?? 0} new replies detected${d?.checked != null ? ` (${d.checked} sends checked)` : ''}.`,
      })
      await refresh()
    } catch (err) {
      setReplyResult({ ok: false, message: (err as Error).message })
    } finally {
      setCheckingReplies(false)
    }
  }

  const scanInboundEmails = async () => {
    setScanningInbound(true)
    setReplyResult(null)
    try {
      const res = await invokeAction('scanInboundEmails', { daysBack: 30 })
      if (!res.ok) throw new Error(res.error || 'Failed')
      const d = (res as { data?: { scanned?: number; logged?: number; skipped?: number; knownContacts?: number } }).data
      setReplyResult({
        ok: true,
        message:
          `Inbound scan: ${d?.logged ?? 0} new email${d?.logged === 1 ? '' : 's'} logged ` +
          `(${d?.scanned ?? 0} messages scanned · ${d?.skipped ?? 0} already known · ` +
          `${d?.knownContacts ?? 0} contacts in lookup).`,
      })
      await refresh()
    } catch (err) {
      setReplyResult({ ok: false, message: (err as Error).message })
    } finally {
      setScanningInbound(false)
    }
  }

  const installInboundTrigger = async () => {
    setInstallingInboundTrigger(true)
    setReplyResult(null)
    try {
      const res = await invokeAction('installInboundEmailTrigger', {})
      if (!res.ok) throw new Error(res.error || 'Failed')
      setReplyResult({
        ok: true,
        message: 'Auto-scan scheduled — inbound emails from contacts will be logged every hour.',
      })
    } catch (err) {
      setReplyResult({ ok: false, message: (err as Error).message })
    } finally {
      setInstallingInboundTrigger(false)
    }
  }

  const installTrigger = async () => {
    setInstallingTrigger(true)
    setReplyResult(null)
    try {
      const res = await invokeAction('installReplyTrigger', {})
      if (!res.ok) throw new Error(res.error || 'Failed')
      setReplyResult({
        ok: true,
        message: 'Auto-check scheduled — replies will be detected every 5 minutes from now on.',
      })
    } catch (err) {
      setReplyResult({ ok: false, message: (err as Error).message })
    } finally {
      setInstallingTrigger(false)
    }
  }

  const data = 'data' in state ? state.data : undefined
  const sends = data?.emailSends ?? []
  const contacts = data?.contacts ?? []
  const sequences = data?.sequences ?? []
  const sequenceSteps = data?.sequenceSteps ?? []
  const leads = data?.leads ?? []

  const enriched: EnrichedSend[] = useMemo(() => {
    return sends.map((s) => {
      const c = contacts.find((x) => x.id === s.contactId)
      const seq = sequences.find((q) => q.id === s.sequenceId)
      const step = sequenceSteps.find((st) => st.id === s.stepId)
      return {
        ...s,
        recipientName: c ? `${c.firstName} ${c.lastName}`.trim() : s.to,
        sequenceName: seq?.name || '—',
        stepLabel: step?.label || '—',
      }
    })
  }, [sends, contacts, sequences, sequenceSteps])

  // Totals for the stat cards
  const stats = useMemo(() => {
    const total = enriched.length
    const opened = enriched.filter((s) => !!s.openedAt).length
    const clicked = enriched.filter((s) => !!s.clickedAt).length
    const replied = enriched.filter((s) => !!s.repliedAt).length
    return {
      total,
      opened,
      clicked,
      replied,
      openRate: total ? (opened / total) * 100 : 0,
      clickRate: total ? (clicked / total) * 100 : 0,
      replyRate: total ? (replied / total) * 100 : 0,
    }
  }, [enriched])

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim()
    let result = enriched.filter((s) => {
      if (filterEngagement === 'opened' && !s.openedAt) return false
      if (filterEngagement === 'clicked' && !s.clickedAt) return false
      if (filterEngagement === 'replied' && !s.repliedAt) return false
      if (filterEngagement === 'unopened' && s.openedAt) return false
      if (!q) return true
      return (
        s.to.toLowerCase().includes(q) ||
        s.subject.toLowerCase().includes(q) ||
        s.recipientName.toLowerCase().includes(q) ||
        s.sequenceName.toLowerCase().includes(q)
      )
    })

    // Sort
    result = result.slice().sort((a, b) => {
      let cmp = 0
      switch (sortKey) {
        case 'sentAt':
          cmp = (a.sentAt || '').localeCompare(b.sentAt || '')
          break
        case 'opened':
          cmp = (a.openedAt || '').localeCompare(b.openedAt || '')
          break
        case 'clicked':
          cmp = (a.clickedAt || '').localeCompare(b.clickedAt || '')
          break
        case 'replied':
          cmp = (a.repliedAt || '').localeCompare(b.repliedAt || '')
          break
        case 'recipient':
          cmp = a.recipientName.localeCompare(b.recipientName)
          break
        case 'sequence':
          cmp = a.sequenceName.localeCompare(b.sequenceName)
          break
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
    return result
  }, [enriched, query, filterEngagement, sortKey, sortDir])

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(k); setSortDir('desc') }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Engagement"
        subtitle="Every signal across email + LinkedIn. Sort, filter, see who's hot."
        action={
          <div className="surface-2 border-soft rounded-[var(--radius-md)] p-0.5 flex items-center">
            <button
              onClick={() => setChannel('email')}
              className={cn(
                'h-9 px-4 text-[12px] font-medium rounded-[var(--radius-sm)] inline-flex items-center gap-1.5 transition-colors',
                channel === 'email' ? 'surface text-body shadow-soft-xs' : 'text-muted hover:text-body',
              )}
            >
              <Mail size={13} /> Email
            </button>
            <button
              onClick={() => setChannel('linkedin')}
              className={cn(
                'h-9 px-4 text-[12px] font-medium rounded-[var(--radius-sm)] inline-flex items-center gap-1.5 transition-colors',
                channel === 'linkedin' ? 'surface text-body shadow-soft-xs' : 'text-muted hover:text-body',
              )}
            >
              <Link2 size={13} /> LinkedIn
            </button>
          </div>
        }
      />

      {/* ---------------- Stat strip (channel-specific) ---------------- */}
      {channel === 'email' ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Sent" value={stats.total.toLocaleString()} hint="all-time" />
          <Stat
            label="Opened"
            value={stats.opened.toLocaleString()}
            delta={`${stats.openRate.toFixed(1)}%`}
            deltaTone={stats.openRate >= 30 ? 'success' : stats.openRate >= 15 ? 'neutral' : 'danger'}
          />
          <Stat
            label="Clicked"
            value={stats.clicked.toLocaleString()}
            delta={`${stats.clickRate.toFixed(1)}%`}
            deltaTone={stats.clickRate >= 5 ? 'success' : 'neutral'}
          />
          <Stat
            label="Replied"
            value={stats.replied.toLocaleString()}
            delta={`${stats.replyRate.toFixed(1)}%`}
            deltaTone={stats.replyRate >= 3 ? 'success' : 'neutral'}
          />
        </div>
      ) : (
        <LinkedInStatStrip leads={leads} />
      )}

      {/* ---------------- Channel content ---------------- */}
      {channel === 'linkedin' ? (
        <LinkedInEngagementCard leads={leads} query={query} setQuery={setQuery} />
      ) : (
      <>
      {/* Email-detection toolbar — replies + inbound */}
      {hasWriteBackend() && (
        <Card>
          <div className="flex flex-col gap-3">
            {/* Reply detection */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[12px] text-muted flex-1 min-w-[200px]">
                <strong className="text-body">Replies</strong> — to your sequence sends. Run a scan now or auto-check every 5 min.
              </span>
              <Button
                size="sm"
                icon={<RefreshCw size={13} />}
                onClick={checkReplies}
                disabled={checkingReplies}
              >
                {checkingReplies ? 'Scanning…' : 'Check for replies now'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon={<CheckCircle2 size={13} />}
                onClick={installTrigger}
                disabled={installingTrigger}
              >
                {installingTrigger ? 'Installing…' : 'Auto-check every 5 min'}
              </Button>
            </div>

            {/* Inbound email detection — cold inbound from contacts */}
            <div className="flex items-center gap-2 flex-wrap pt-3 border-soft-t">
              <span className="text-[12px] text-muted flex-1 min-w-[200px]">
                <strong className="text-body">Inbound emails</strong> — when a contact emails you out of the blue (not a reply), log it as activity.
              </span>
              <Button
                size="sm"
                icon={<RefreshCw size={13} />}
                onClick={scanInboundEmails}
                disabled={scanningInbound}
              >
                {scanningInbound ? 'Scanning…' : 'Scan inbound now'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon={<CheckCircle2 size={13} />}
                onClick={installInboundTrigger}
                disabled={installingInboundTrigger}
              >
                {installingInboundTrigger ? 'Installing…' : 'Auto-scan hourly'}
              </Button>
            </div>
          </div>
          {replyResult && (
            <div
              className={cn(
                'mt-3 p-2 rounded-[var(--radius-md)] text-[12px]',
                replyResult.ok
                  ? 'bg-[color:rgba(48,179,107,0.1)] text-[var(--color-success)]'
                  : 'bg-[color:rgba(239,76,76,0.08)] text-[var(--color-danger)]',
              )}
            >
              {replyResult.message}
            </div>
          )}
        </Card>
      )}

      {/* ---------------- EMAIL channel: filters + table ---------------- */}
      <Card padded={false}>
        <div className="p-3 border-soft-b flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
            <Input
              placeholder="Search recipient, subject, sequence…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex items-center gap-1.5 overflow-x-auto">
            <Chip active={filterEngagement === 'all'} onClick={() => setFilterEngagement('all')}>All</Chip>
            <Chip active={filterEngagement === 'opened'} onClick={() => setFilterEngagement('opened')}>
              <MailOpen size={11} /> Opened
            </Chip>
            <Chip active={filterEngagement === 'clicked'} onClick={() => setFilterEngagement('clicked')}>
              <MousePointerClick size={11} /> Clicked
            </Chip>
            <Chip active={filterEngagement === 'replied'} onClick={() => setFilterEngagement('replied')}>
              <Reply size={11} /> Replied
            </Chip>
            <Chip active={filterEngagement === 'unopened'} onClick={() => setFilterEngagement('unopened')}>
              Unopened
            </Chip>
          </div>
        </div>

        {filtered.length === 0 ? (
          <Empty
            icon={<Send size={22} />}
            title={enriched.length === 0 ? 'No emails sent yet' : 'No matches'}
            description={
              enriched.length === 0
                ? 'Once your sequences fire, every send shows up here with open/click/reply tracking.'
                : query
                ? `No emails match "${query}".`
                : 'Try a different filter.'
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="surface-2 text-muted text-left">
                <tr>
                  <Th onClick={() => toggleSort('recipient')} active={sortKey === 'recipient'} dir={sortDir}>Recipient</Th>
                  <Th onClick={() => toggleSort('sequence')} active={sortKey === 'sequence'} dir={sortDir}>Sequence · step</Th>
                  <Th>Subject</Th>
                  <Th onClick={() => toggleSort('sentAt')} active={sortKey === 'sentAt'} dir={sortDir}>Sent</Th>
                  <Th onClick={() => toggleSort('opened')} active={sortKey === 'opened'} dir={sortDir}>Opened</Th>
                  <Th onClick={() => toggleSort('clicked')} active={sortKey === 'clicked'} dir={sortDir}>Clicked</Th>
                  <Th onClick={() => toggleSort('replied')} active={sortKey === 'replied'} dir={sortDir}>Replied</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[color:var(--border)]">
                {filtered.map((s) => (
                  <SendRow
                    key={s.id}
                    send={s}
                    onOpen={() => s.contactId && navigate(`/contacts/${s.contactId}`)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      </>
      )}
    </div>
  )
}

/* ==========================================================================
   LinkedIn channel
   ========================================================================== */

interface LinkedInRow {
  leadId: string
  leadName: string
  leadCompany: string
  leadEmail: string
  signalKind: string
  signalTarget: string
  signalTs: string
  leadScore: number
  leadTemperature: ReturnType<typeof scoreLead>['temperature']
}

function flattenLeadSignals(leads: Lead[]): LinkedInRow[] {
  const out: LinkedInRow[] = []
  for (const lead of leads) {
    if (lead.status === 'archived') continue
    const result = scoreLead(lead)
    const signals = parseSignals(lead.engagementSignals)
    for (const s of signals) {
      // Only show LinkedIn-flavored signals on this tab
      if (!isLinkedInSignal(s.kind)) continue
      out.push({
        leadId: lead.id,
        leadName: `${lead.firstName} ${lead.lastName}`.trim() || lead.email || lead.id,
        leadCompany: lead.companyName,
        leadEmail: lead.email,
        signalKind: s.kind,
        signalTarget: s.target || '',
        signalTs: s.ts,
        leadScore: result.score,
        leadTemperature: result.temperature,
      })
    }
  }
  return out.sort((a, b) => (b.signalTs || '').localeCompare(a.signalTs || ''))
}

function isLinkedInSignal(kind: string): boolean {
  return /(company-follow|company-page-visit|post-like|post-comment|post-share|profile-view|connection-accept|inmail-reply)/.test(kind)
}

function LinkedInStatStrip({ leads }: { leads: Lead[] }) {
  const rows = useMemo(() => flattenLeadSignals(leads), [leads])
  const follows  = rows.filter((r) => r.signalKind === 'company-follow').length
  const likes    = rows.filter((r) => r.signalKind === 'post-like').length
  const comments = rows.filter((r) => r.signalKind === 'post-comment').length
  const replies  = rows.filter((r) => r.signalKind === 'inmail-reply' || r.signalKind === 'connection-accept').length

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <Stat label="Total LinkedIn signals" value={rows.length.toLocaleString()} hint="all-time across all leads" />
      <Stat label="Follows" value={follows.toString()} />
      <Stat label="Post engagement" value={(likes + comments).toString()} hint={`${likes} likes · ${comments} comments`} />
      <Stat label="High-intent" value={replies.toString()} hint="InMail replies + connections" />
    </div>
  )
}

function LinkedInEngagementCard({
  leads, query, setQuery,
}: {
  leads: Lead[]
  query: string
  setQuery: (q: string) => void
}) {
  const [kindFilter, setKindFilter] = useState<string>('all')
  const allRows = useMemo(() => flattenLeadSignals(leads), [leads])

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim()
    return allRows.filter((r) => {
      if (kindFilter !== 'all' && r.signalKind !== kindFilter) return false
      if (!q) return true
      return (
        r.leadName.toLowerCase().includes(q) ||
        r.leadCompany.toLowerCase().includes(q) ||
        r.signalTarget.toLowerCase().includes(q)
      )
    })
  }, [allRows, query, kindFilter])

  const kinds = useMemo(() => {
    const set = new Set<string>()
    allRows.forEach((r) => set.add(r.signalKind))
    return Array.from(set).sort()
  }, [allRows])

  return (
    <Card padded={false}>
      <div className="p-3 border-soft-b flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
          <Input
            placeholder="Search lead, company, post URL…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto">
          <ChipSmall active={kindFilter === 'all'} onClick={() => setKindFilter('all')}>All</ChipSmall>
          {kinds.map((k) => (
            <ChipSmall key={k} active={kindFilter === k} onClick={() => setKindFilter(k)}>
              {linkedInKindIcon(k)}
              {k.replace(/-/g, ' ')}
            </ChipSmall>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <Empty
          icon={<Link2 size={22} />}
          title={allRows.length === 0 ? 'No LinkedIn signals yet' : 'No matches'}
          description={
            allRows.length === 0
              ? "Once Teamfluence (or any source) starts feeding the lead webhook with engagement signals, you'll see them here. Each follow, like, comment, profile view, etc."
              : "Try a different filter."
          }
        />
      ) : (
        <ul className="divide-y divide-[color:var(--border)]">
          {filtered.map((r, i) => (
            <li key={`${r.leadId}-${i}-${r.signalTs}`}>
              <Link
                to={`/leads`}
                className="flex items-center gap-3 px-4 py-3 hover:surface-2 transition-colors group"
              >
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: temperatureColor(r.leadTemperature) }}
                  title={temperatureLabel(r.leadTemperature)}
                />
                <Avatar name={r.leadName} size={28} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13px] font-medium text-body truncate">{r.leadName}</span>
                    <span className="text-[11px] text-muted truncate">{r.leadCompany}</span>
                  </div>
                  <div className="text-[11px] text-muted mt-0.5 flex items-center gap-1.5 truncate">
                    {linkedInKindIcon(r.signalKind)}
                    <span className="font-medium text-body">{r.signalKind.replace(/-/g, ' ')}</span>
                    {r.signalTarget && <span className="truncate">· {r.signalTarget}</span>}
                  </div>
                </div>
                <Badge tone="brand">score {r.leadScore}</Badge>
                <span className="text-[10px] text-[var(--text-faint)] tabular shrink-0">
                  {r.signalTs ? relativeDate(r.signalTs) : ''}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function linkedInKindIcon(kind: string) {
  if (kind === 'post-like')         return <ThumbsUp size={11} className="text-[var(--color-info)]" />
  if (kind === 'post-comment')      return <MessageCircle size={11} className="text-[var(--color-info)]" />
  if (kind === 'post-share')        return <Send size={11} className="text-[var(--color-info)]" />
  if (kind === 'profile-view')      return <Eye size={11} className="text-muted" />
  if (kind === 'company-follow')    return <UserPlus size={11} className="text-[var(--color-success)]" />
  if (kind === 'company-page-visit')return <Eye size={11} className="text-muted" />
  if (kind === 'connection-accept') return <UserPlus size={11} className="text-[var(--color-success)]" />
  if (kind === 'inmail-reply')      return <Reply size={11} className="text-[var(--color-brand-700)]" />
  return <Flame size={11} className="text-[var(--color-warning)]" />
}

function ChipSmall({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'h-8 px-3 text-[11px] font-medium rounded-[var(--radius-sm)] transition-colors whitespace-nowrap inline-flex items-center gap-1.5',
        active ? 'bg-[var(--color-brand-600)] text-white' : 'surface-2 text-muted hover:text-body',
      )}
    >
      {children}
    </button>
  )
}

void Briefcase

function Th({
  children,
  onClick,
  active,
  dir,
}: {
  children: React.ReactNode
  onClick?: () => void
  active?: boolean
  dir?: SortDir
}) {
  if (!onClick) {
    return <th className="px-4 py-2.5 font-medium whitespace-nowrap">{children}</th>
  }
  const Icon = active ? (dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown
  return (
    <th className="px-4 py-2.5 font-medium whitespace-nowrap">
      <button
        onClick={onClick}
        className={cn(
          'inline-flex items-center gap-1 hover:text-body transition-colors',
          active && 'text-body',
        )}
      >
        {children}
        <Icon size={11} className={cn(!active && 'opacity-50')} />
      </button>
    </th>
  )
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'h-8 px-3 text-[12px] font-medium rounded-[var(--radius-sm)] transition-colors whitespace-nowrap inline-flex items-center gap-1.5',
        active ? 'bg-[var(--color-brand-600)] text-white' : 'surface-2 text-muted hover:text-body',
      )}
    >
      {children}
    </button>
  )
}

function SendRow({ send, onOpen }: { send: EnrichedSend; onOpen?: () => void }) {
  const clickable = !!send.contactId
  return (
    <tr
      className={cn(
        'hover:surface-2 transition-colors',
        clickable && 'cursor-pointer',
      )}
      onClick={clickable ? onOpen : undefined}
    >
      <td className="px-4 py-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <Avatar name={send.recipientName} size={28} />
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-body truncate max-w-[180px] hover:text-[var(--color-brand-700)]">{send.recipientName}</div>
            <div className="text-[11px] text-muted truncate max-w-[180px]">{send.to}</div>
          </div>
        </div>
      </td>
      <td className="px-4 py-3 text-[12px] text-muted">
        <div className="truncate max-w-[200px]">{send.sequenceName}</div>
        <div className="text-[11px] text-[var(--text-faint)] truncate max-w-[200px]">{send.stepLabel}</div>
      </td>
      <td className="px-4 py-3 text-[12px]">
        <div className="truncate max-w-[260px] text-body">{send.subject}</div>
        {send.status === 'bounced' && (
          <div className="inline-flex items-center gap-1 text-[11px] text-[var(--color-danger)] mt-0.5">
            <AlertCircle size={11} /> bounced
          </div>
        )}
      </td>
      <td className="px-4 py-3 text-[12px] text-muted whitespace-nowrap">
        <div className="flex items-center gap-1">
          <Mail size={12} className="text-[var(--text-faint)]" />
          {send.sentAt ? relativeDate(send.sentAt) : '—'}
        </div>
        <div className="text-[10px] text-[var(--text-faint)]">{send.sentAt ? date(send.sentAt, 'MMM d, h:mm a') : ''}</div>
      </td>
      <Cell value={send.openedAt} icon={<MailOpen size={12} />} tone="success" />
      <Cell value={send.clickedAt} icon={<MousePointerClick size={12} />} tone="info" />
      <Cell value={send.repliedAt} icon={<Reply size={12} />} tone="brand" />
    </tr>
  )
}

function Cell({ value, icon, tone }: { value?: string; icon: React.ReactNode; tone: 'success' | 'info' | 'brand' }) {
  if (!value) return <td className="px-4 py-3 text-[12px] text-[var(--text-faint)]">—</td>
  return (
    <td className="px-4 py-3 text-[12px] whitespace-nowrap">
      <Badge tone={tone}>
        <span className="inline-flex items-center gap-1">
          {icon}
          {relativeDate(value)}
        </span>
      </Badge>
    </td>
  )
}

import { useMemo, useState } from 'react'
import {
  Mail, MailOpen, MousePointerClick, Reply, Search,
  ArrowUpDown, ArrowUp, ArrowDown, AlertCircle, Send,
} from 'lucide-react'
import { useSheetData } from '../lib/sheet-context'
import { Card, Input, PageHeader, Empty, Avatar, Badge, Stat } from '../components/ui'
import { date, relativeDate } from '../lib/format'
import type { EmailSend } from '../lib/types'
import { cn } from '../lib/cn'

type SortKey = 'sentAt' | 'opened' | 'clicked' | 'replied' | 'recipient' | 'sequence'
type SortDir = 'asc' | 'desc'

interface EnrichedSend extends EmailSend {
  recipientName: string
  sequenceName: string
  stepLabel: string
}

export function Engagement() {
  const { state } = useSheetData()
  const [query, setQuery] = useState('')
  const [filterEngagement, setFilterEngagement] = useState<'all' | 'opened' | 'clicked' | 'replied' | 'unopened'>('all')
  const [sortKey, setSortKey] = useState<SortKey>('sentAt')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const data = 'data' in state ? state.data : undefined
  const sends = data?.emailSends ?? []
  const contacts = data?.contacts ?? []
  const sequences = data?.sequences ?? []
  const sequenceSteps = data?.sequenceSteps ?? []

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
        subtitle="Email sends, opens, clicks, replies. Sort + filter to see who's hot."
      />

      {/* ---------------- Stat strip ---------------- */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat
          label="Sent"
          value={stats.total.toLocaleString()}
          hint="all-time"
        />
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

      {/* ---------------- Filters + table ---------------- */}
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
                  <SendRow key={s.id} send={s} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

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

function SendRow({ send }: { send: EnrichedSend }) {
  return (
    <tr className="hover:surface-2 transition-colors">
      <td className="px-4 py-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <Avatar name={send.recipientName} size={28} />
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-body truncate max-w-[180px]">{send.recipientName}</div>
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

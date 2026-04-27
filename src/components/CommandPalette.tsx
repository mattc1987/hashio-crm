// Cmd+K command palette — global fuzzy search across contacts, companies,
// deals, sequences, tasks, booking links. Linear-style: keyboard-first,
// arrow-key navigation, Enter to jump.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Building2, Briefcase, Users, CheckSquare, Zap, Calendar, FileText, Send,
  Search, ArrowRight, Plus, Mail,
} from 'lucide-react'
import { useSheetData } from '../lib/sheet-context'
import { cn } from '../lib/cn'

type ItemKind =
  | 'contact' | 'company' | 'deal' | 'task'
  | 'sequence' | 'booking-link' | 'template'
  | 'page' | 'action'

interface PaletteItem {
  kind: ItemKind
  id: string
  title: string
  subtitle?: string
  to?: string
  onSelect?: () => void
  icon: React.ComponentType<{ size?: number; className?: string }>
}

const KIND_LABEL: Record<ItemKind, string> = {
  contact: 'Contact',
  company: 'Company',
  deal: 'Deal',
  task: 'Task',
  sequence: 'Sequence',
  'booking-link': 'Scheduling',
  template: 'Template',
  page: 'Page',
  action: 'Action',
}

const STATIC_PAGES: PaletteItem[] = [
  { kind: 'page', id: 'p-dashboard',  title: 'Dashboard',     to: '/',           icon: Briefcase },
  { kind: 'page', id: 'p-deals',      title: 'Deals',         to: '/deals',      icon: Briefcase },
  { kind: 'page', id: 'p-companies',  title: 'Companies',     to: '/companies',  icon: Building2 },
  { kind: 'page', id: 'p-contacts',   title: 'Contacts',      to: '/contacts',   icon: Users },
  { kind: 'page', id: 'p-tasks',      title: 'Tasks',         to: '/tasks',      icon: CheckSquare },
  { kind: 'page', id: 'p-sequences',  title: 'Sequences',     to: '/sequences',  icon: Zap },
  { kind: 'page', id: 'p-templates',  title: 'Email templates', to: '/templates', icon: FileText },
  { kind: 'page', id: 'p-engagement', title: 'Engagement',    to: '/engagement', icon: Send },
  { kind: 'page', id: 'p-scheduling', title: 'Scheduling',    to: '/scheduling', icon: Calendar },
  { kind: 'page', id: 'p-import',     title: 'Import',        to: '/import',     icon: Send },
  { kind: 'page', id: 'p-settings',   title: 'Settings',      to: '/settings',   icon: Briefcase },
]

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const { state } = useSheetData()
  const data = 'data' in state ? state.data : undefined

  // Toggle with Cmd+K / Ctrl+K
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
      } else if (e.key === 'Escape' && open) {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // Focus input when opened, reset state when closed
  useEffect(() => {
    if (open) {
      setActiveIndex(0)
      setTimeout(() => inputRef.current?.focus(), 10)
    } else {
      setQuery('')
    }
  }, [open])

  // Build the master item list
  const items: PaletteItem[] = useMemo(() => {
    if (!data) return STATIC_PAGES
    const out: PaletteItem[] = []

    // Quick actions
    out.push(
      { kind: 'action', id: 'a-new-deal',     title: 'New deal',        to: '/deals',      icon: Plus },
      { kind: 'action', id: 'a-new-contact',  title: 'New contact',     to: '/contacts',   icon: Plus },
      { kind: 'action', id: 'a-new-company',  title: 'New company',     to: '/companies',  icon: Plus },
      { kind: 'action', id: 'a-new-task',     title: 'New task',        to: '/tasks',      icon: Plus },
      { kind: 'action', id: 'a-new-sequence', title: 'New sequence',    to: '/sequences',  icon: Plus },
    )

    // Contacts
    for (const c of data.contacts) {
      const company = data.companies.find((co) => co.id === c.companyId)
      out.push({
        kind: 'contact',
        id: c.id,
        title: `${c.firstName} ${c.lastName}`.trim() || c.email || c.id,
        subtitle: [c.title, company?.name, c.email].filter(Boolean).join(' · '),
        to: `/contacts`, // contacts list (no detail page yet — drawer)
        icon: Users,
      })
    }
    // Companies
    for (const co of data.companies) {
      out.push({
        kind: 'company',
        id: co.id,
        title: co.name,
        subtitle: [co.industry, co.address].filter(Boolean).join(' · '),
        to: `/companies/${co.id}`,
        icon: Building2,
      })
    }
    // Deals
    for (const d of data.deals) {
      const co = data.companies.find((x) => x.id === d.companyId)
      out.push({
        kind: 'deal',
        id: d.id,
        title: d.title,
        subtitle: [d.stage, co?.name, d.value ? `$${d.value.toLocaleString()}` : null].filter(Boolean).join(' · '),
        to: `/deals`,
        icon: Briefcase,
      })
    }
    // Tasks
    for (const t of data.tasks) {
      if (t.status === 'completed' || t.status === 'cancelled') continue
      out.push({
        kind: 'task',
        id: t.id,
        title: t.title,
        subtitle: t.dueDate ? `Due ${t.dueDate.slice(0, 10)}` : 'No due date',
        to: `/tasks`,
        icon: CheckSquare,
      })
    }
    // Sequences
    for (const s of data.sequences) {
      out.push({
        kind: 'sequence',
        id: s.id,
        title: s.name,
        subtitle: `${s.status} sequence`,
        to: `/sequences/${s.id}`,
        icon: Zap,
      })
    }
    // Booking links
    for (const b of data.bookingLinks) {
      out.push({
        kind: 'booking-link',
        id: b.id,
        title: b.name,
        subtitle: `/${b.slug} · ${b.durationMinutes} min`,
        to: `/scheduling/${b.id}`,
        icon: Calendar,
      })
    }
    // Templates
    for (const tp of data.emailTemplates) {
      out.push({
        kind: 'template',
        id: tp.id,
        title: tp.name,
        subtitle: tp.subject || 'No subject',
        to: `/templates`,
        icon: Mail,
      })
    }

    return [...STATIC_PAGES, ...out]
  }, [data])

  // Fuzzy filter
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items.slice(0, 60)
    const tokens = q.split(/\s+/)
    return items
      .map((item) => {
        const haystack = `${item.title} ${item.subtitle || ''} ${KIND_LABEL[item.kind]}`.toLowerCase()
        const score = tokens.every((t) => haystack.includes(t)) ? haystack.indexOf(tokens[0]) : -1
        return { item, score }
      })
      .filter((r) => r.score >= 0)
      .sort((a, b) => a.score - b.score)
      .slice(0, 60)
      .map((r) => r.item)
  }, [items, query])

  useEffect(() => {
    if (activeIndex >= filtered.length) setActiveIndex(Math.max(0, filtered.length - 1))
  }, [filtered, activeIndex])

  const select = (it: PaletteItem) => {
    setOpen(false)
    if (it.onSelect) it.onSelect()
    else if (it.to) navigate(it.to)
  }

  const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(filtered.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const item = filtered[activeIndex]
      if (item) select(item)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[10vh] px-4">
      <div className="absolute inset-0 bg-black/40 animate-fade-in" onClick={() => setOpen(false)} aria-hidden />
      <div
        className={cn(
          'relative w-full max-w-xl surface border-soft rounded-[var(--radius-lg)] shadow-soft-xl flex flex-col',
          'animate-fade-in max-h-[70vh]',
        )}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-soft-b">
          <Search size={16} className="text-[var(--text-faint)] shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActiveIndex(0) }}
            onKeyDown={onInputKey}
            placeholder="Search anything — Cmd+K to close"
            className="flex-1 bg-transparent border-none outline-none text-[14px] text-body placeholder:text-[var(--text-faint)]"
          />
          <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 text-[10px] font-mono surface-2 border-soft rounded text-muted">
            esc
          </kbd>
        </div>
        <div className="overflow-y-auto flex-1">
          {filtered.length === 0 ? (
            <div className="p-8 text-center text-muted text-[13px]">No matches.</div>
          ) : (
            <ul className="py-1">
              {filtered.map((it, i) => {
                const Icon = it.icon
                const active = i === activeIndex
                return (
                  <li key={`${it.kind}-${it.id}`}>
                    <button
                      onClick={() => select(it)}
                      onMouseEnter={() => setActiveIndex(i)}
                      className={cn(
                        'w-full flex items-center gap-3 px-4 py-2.5 text-left text-[13px] transition-colors',
                        active ? 'bg-[color:rgba(122,94,255,0.10)]' : 'hover:surface-2',
                      )}
                    >
                      <Icon size={14} className={active ? 'text-[var(--color-brand-600)]' : 'text-[var(--text-faint)]'} />
                      <div className="min-w-0 flex-1">
                        <div className="text-body font-medium truncate">{it.title}</div>
                        {it.subtitle && (
                          <div className="text-muted text-[11px] truncate">{it.subtitle}</div>
                        )}
                      </div>
                      <span
                        className={cn(
                          'text-[10px] font-medium uppercase tracking-wider',
                          active ? 'text-[var(--color-brand-600)]' : 'text-[var(--text-faint)]',
                        )}
                      >
                        {KIND_LABEL[it.kind]}
                      </span>
                      {active && <ArrowRight size={12} className="text-[var(--color-brand-600)]" />}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
        <div className="px-4 py-2 border-soft-t flex items-center justify-between text-[10px] text-muted">
          <div className="flex items-center gap-3">
            <span><kbd className="font-mono surface-2 border-soft px-1 rounded">↑↓</kbd> navigate</span>
            <span><kbd className="font-mono surface-2 border-soft px-1 rounded">↵</kbd> open</span>
          </div>
          <span>{filtered.length} result{filtered.length === 1 ? '' : 's'}</span>
        </div>
      </div>
    </div>
  )
}

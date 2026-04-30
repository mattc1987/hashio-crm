// Contact filter bar — robust but simple. HubSpot-style: search box,
// removable chips for each active filter, "+ Add filter" popover, and
// saved views (with localStorage persistence).

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Search, Plus, Star, X, ChevronDown, BookmarkPlus, Trash2,
  Filter as FilterIcon,
} from 'lucide-react'
import { Input, Button, Badge } from './ui'
import {
  type ContactFilterState,
  type SavedView,
  describeActiveChips,
  isFilterEmpty,
  loadSavedViews,
  addSavedView,
  removeSavedView,
  EMPTY_FILTER,
  ACTIVITY_LABELS,
  parseTags,
} from '../lib/contactFilter'
import type { Contact, Company } from '../lib/types'
import { cn } from '../lib/cn'

interface Props {
  state: ContactFilterState
  setState: (s: ContactFilterState) => void
  contacts: Contact[]   // for building filter option lists (tags, states, etc.)
  companies: Company[]
  totalCount: number
  filteredCount: number
}

export function ContactFilterBar({ state, setState, contacts, companies, totalCount, filteredCount }: Props) {
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [savedViews, setSavedViews] = useState<SavedView[]>(loadSavedViews())
  const [savingView, setSavingView] = useState(false)
  const [newViewName, setNewViewName] = useState('')

  // Listen for cross-tab/component saves
  useEffect(() => {
    const handler = () => setSavedViews(loadSavedViews())
    window.addEventListener('hashio-contact-views-change', handler)
    return () => window.removeEventListener('hashio-contact-views-change', handler)
  }, [])

  const chips = useMemo(() => describeActiveChips(state), [state])

  // Build option lists from contacts
  const allTags = useMemo(() => {
    const set = new Set<string>()
    for (const c of contacts) parseTags(c.tags).forEach((t) => set.add(t))
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [contacts])
  const allStates = useMemo(() => {
    const set = new Set<string>()
    for (const c of contacts) if (c.state) set.add(c.state)
    return Array.from(set).sort()
  }, [contacts])
  const allStatuses = useMemo(() => {
    const set = new Set<string>()
    for (const c of contacts) if (c.status) set.add(c.status)
    return Array.from(set).sort()
  }, [contacts])

  const handleSaveView = () => {
    const name = newViewName.trim()
    if (!name) return
    addSavedView(name, state)
    setSavedViews(loadSavedViews())
    setSavingView(false)
    setNewViewName('')
  }

  return (
    <div className="flex flex-col gap-2.5">
      {/* Top row — search + count + add filter + save view */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
          <Input
            placeholder="Search name, email, company, title…"
            value={state.query}
            onChange={(e) => setState({ ...state, query: e.target.value })}
            className="pl-9"
          />
        </div>
        <span className="text-[12px] text-muted whitespace-nowrap">
          <strong className="text-body tabular">{filteredCount.toLocaleString()}</strong>
          {filteredCount !== totalCount && <> of {totalCount.toLocaleString()}</>}
        </span>
        <div className="flex-1" />
        <div className="relative">
          <Button
            size="sm"
            icon={<Plus size={13} />}
            onClick={() => setPopoverOpen((v) => !v)}
            className={popoverOpen ? 'bg-[var(--surface-2)]' : ''}
          >
            Add filter
          </Button>
          {popoverOpen && (
            <AddFilterPopover
              state={state}
              setState={setState}
              tags={allTags}
              states={allStates}
              statuses={allStatuses}
              companies={companies}
              onClose={() => setPopoverOpen(false)}
            />
          )}
        </div>
        {!isFilterEmpty(state) && (
          <Button
            size="sm"
            variant="ghost"
            icon={<BookmarkPlus size={13} />}
            onClick={() => setSavingView(true)}
          >
            Save view
          </Button>
        )}
      </div>

      {/* Active chips */}
      {chips.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <FilterIcon size={11} className="text-muted" />
          {chips.map((chip) => (
            <button
              key={chip.key}
              onClick={() => setState(chip.onRemove(state))}
              className="inline-flex items-center gap-1 h-6 px-2 text-[11px] font-medium rounded-full bg-[color:rgba(122,94,255,0.1)] text-[var(--color-brand-700)] dark:text-[var(--color-brand-300)] hover:bg-[color:rgba(122,94,255,0.18)] transition-colors"
            >
              {chip.label}
              <X size={9} />
            </button>
          ))}
          <button
            onClick={() => setState({ ...EMPTY_FILTER, query: state.query })}
            className="text-[11px] text-muted hover:text-body"
          >
            Clear all
          </button>
        </div>
      )}

      {/* Saved views */}
      {savedViews.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <Star size={11} className="text-[var(--text-faint)]" />
          <span className="text-[10px] uppercase tracking-wider text-[var(--text-faint)] font-semibold mr-1">Views</span>
          {savedViews.map((v) => (
            <SavedViewChip
              key={v.id}
              view={v}
              isPreset={v.id.startsWith('preset-')}
              onApply={() => setState(v.state)}
              onDelete={() => {
                removeSavedView(v.id)
                setSavedViews(loadSavedViews())
              }}
            />
          ))}
        </div>
      )}

      {/* Save-view dialog */}
      {savingView && (
        <div className="surface-2 border-soft rounded-[var(--radius-md)] p-3 flex items-center gap-2">
          <BookmarkPlus size={13} className="text-[var(--color-brand-600)]" />
          <Input
            placeholder='Name this view (e.g. "VIPs in Colorado")'
            value={newViewName}
            onChange={(e) => setNewViewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSaveView() }}
            autoFocus
          />
          <Button size="sm" variant="primary" onClick={handleSaveView} disabled={!newViewName.trim()}>Save</Button>
          <Button size="sm" variant="ghost" onClick={() => { setSavingView(false); setNewViewName('') }}>Cancel</Button>
        </div>
      )}
    </div>
  )
}

// ============================================================
// SavedViewChip — apply on click, delete on hover-x
// ============================================================

function SavedViewChip({
  view, isPreset, onApply, onDelete,
}: {
  view: SavedView
  isPreset: boolean
  onApply: () => void
  onDelete: () => void
}) {
  return (
    <span className="group inline-flex items-center surface border-soft rounded-full text-[11px] font-medium overflow-hidden hover:border-[var(--color-brand-500)] transition-colors">
      <button onClick={onApply} className="px-2.5 py-0.5 text-body hover:text-[var(--color-brand-700)] dark:hover:text-[var(--color-brand-300)]">
        {view.name}
      </button>
      {!isPreset && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          className="px-1 py-1 text-[var(--text-faint)] hover:text-[var(--color-danger)] opacity-0 group-hover:opacity-100 transition-opacity"
          title="Delete view"
        >
          <Trash2 size={10} />
        </button>
      )}
    </span>
  )
}

// ============================================================
// AddFilterPopover — the dropdown menu of filters to add
// ============================================================

function AddFilterPopover({
  state, setState, tags, states, statuses, companies, onClose,
}: {
  state: ContactFilterState
  setState: (s: ContactFilterState) => void
  tags: string[]
  states: string[]
  statuses: string[]
  companies: Company[]
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [section, setSection] = useState<string | null>(null)

  // Close on outside click
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    setTimeout(() => document.addEventListener('click', onClick), 0)
    return () => document.removeEventListener('click', onClick)
  }, [onClose])

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full mt-1 z-30 w-72 surface border-soft rounded-[var(--radius-md)] shadow-soft-lg overflow-hidden flex flex-col"
    >
      {section === null ? (
        <div className="p-1 max-h-[420px] overflow-y-auto">
          <SectionButton label="Tag" hint={`${tags.length} options`} onClick={() => setSection('tags')} />
          <SectionButton label="State / region" hint={`${states.length} options`} onClick={() => setSection('states')} />
          <SectionButton label="Status" hint={`${statuses.length} options`} onClick={() => setSection('statuses')} />
          <SectionButton label="Company" hint={`${companies.length} options`} onClick={() => setSection('companies')} />
          <div className="border-soft-t my-1" />
          <ToggleRow
            label="Has email"
            value={state.hasEmail}
            onChange={(v) => setState({ ...state, hasEmail: v })}
          />
          <ToggleRow
            label="Has phone"
            value={state.hasPhone}
            onChange={(v) => setState({ ...state, hasPhone: v })}
          />
          <ToggleRow
            label="Has LinkedIn"
            value={state.hasLinkedin}
            onChange={(v) => setState({ ...state, hasLinkedin: v })}
          />
          <ToggleRow
            label="Has open deal"
            value={state.hasOpenDeal}
            onChange={(v) => setState({ ...state, hasOpenDeal: v })}
          />
          <ToggleRow
            label="Is customer (active MRR)"
            value={state.isCustomer}
            onChange={(v) => setState({ ...state, isCustomer: v })}
          />
          <div className="border-soft-t my-1" />
          <SectionButton
            label={ACTIVITY_LABELS[state.activity]}
            hint="Activity"
            onClick={() => setSection('activity')}
          />
        </div>
      ) : (
        <div className="flex flex-col">
          <button
            onClick={() => setSection(null)}
            className="px-3 py-2 text-[11px] text-muted hover:text-body border-soft-b text-left inline-flex items-center gap-1"
          >
            ← Back
          </button>
          <div className="p-1 max-h-[360px] overflow-y-auto">
            {section === 'tags' && (
              <MultiSelect
                options={tags}
                selected={state.tags}
                onChange={(v) => setState({ ...state, tags: v })}
                emptyMsg="No tags yet. Tag your contacts to use this filter."
              />
            )}
            {section === 'states' && (
              <MultiSelect
                options={states}
                selected={state.states}
                onChange={(v) => setState({ ...state, states: v })}
                emptyMsg="No state values yet."
              />
            )}
            {section === 'statuses' && (
              <MultiSelect
                options={statuses}
                selected={state.statuses}
                onChange={(v) => setState({ ...state, statuses: v })}
                emptyMsg="No status values yet."
              />
            )}
            {section === 'companies' && (
              <MultiSelect
                options={companies.map((c) => c.id)}
                labelFor={(id) => companies.find((c) => c.id === id)?.name || id}
                selected={state.companyIds}
                onChange={(v) => setState({ ...state, companyIds: v })}
                emptyMsg="No companies yet."
              />
            )}
            {section === 'activity' && (
              <div>
                {(Object.keys(ACTIVITY_LABELS) as Array<keyof typeof ACTIVITY_LABELS>).map((k) => (
                  <button
                    key={k}
                    onClick={() => { setState({ ...state, activity: k }); setSection(null) }}
                    className={cn(
                      'w-full text-left px-3 py-2 text-[12px] rounded-[var(--radius-sm)] hover:surface-2',
                      state.activity === k && 'surface-2 text-body',
                    )}
                  >
                    {ACTIVITY_LABELS[k]}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function SectionButton({ label, hint, onClick }: { label: string; hint?: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center justify-between px-3 py-2 text-[12px] rounded-[var(--radius-sm)] hover:surface-2 group"
    >
      <span className="text-body font-medium">{label}</span>
      <span className="flex items-center gap-1 text-[10px] text-muted">
        {hint && <span>{hint}</span>}
        <ChevronDown size={11} className="-rotate-90" />
      </span>
    </button>
  )
}

function ToggleRow({
  label, value, onChange,
}: {
  label: string
  value: boolean | null
  onChange: (v: boolean | null) => void
}) {
  return (
    <div className="flex items-center justify-between px-3 py-2 text-[12px]">
      <span className="text-body">{label}</span>
      <div className="surface-2 border-soft rounded-full p-0.5 flex items-center text-[10px]">
        <Tab active={value === null}  onClick={() => onChange(null)}>any</Tab>
        <Tab active={value === true}  onClick={() => onChange(true)}>yes</Tab>
        <Tab active={value === false} onClick={() => onChange(false)}>no</Tab>
      </div>
    </div>
  )
}

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'h-5 px-2 rounded-full font-medium transition-colors',
        active ? 'bg-[var(--color-brand-600)] text-white' : 'text-muted hover:text-body',
      )}
    >
      {children}
    </button>
  )
}

function MultiSelect({
  options, selected, onChange, labelFor, emptyMsg,
}: {
  options: string[]
  selected: string[]
  onChange: (v: string[]) => void
  labelFor?: (val: string) => string
  emptyMsg?: string
}) {
  const [filter, setFilter] = useState('')
  const filtered = useMemo(() => {
    const q = filter.toLowerCase().trim()
    if (!q) return options
    return options.filter((o) => (labelFor ? labelFor(o) : o).toLowerCase().includes(q))
  }, [options, filter, labelFor])

  if (options.length === 0 && emptyMsg) {
    return <div className="text-[12px] text-muted px-3 py-3">{emptyMsg}</div>
  }

  return (
    <div className="flex flex-col">
      <div className="px-1 pb-1 sticky top-0 bg-[var(--bg-elev)]">
        <Input
          placeholder="Filter…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="text-[12px] h-7"
        />
      </div>
      {filtered.map((opt) => {
        const isSelected = selected.includes(opt)
        return (
          <button
            key={opt}
            onClick={() => onChange(isSelected ? selected.filter((v) => v !== opt) : [...selected, opt])}
            className={cn(
              'w-full flex items-center justify-between px-3 py-1.5 text-[12px] rounded-[var(--radius-sm)] hover:surface-2',
              isSelected && 'bg-[color:rgba(122,94,255,0.08)] text-[var(--color-brand-700)] dark:text-[var(--color-brand-300)]',
            )}
          >
            <span className="truncate">{labelFor ? labelFor(opt) : opt}</span>
            {isSelected && <Badge tone="brand">✓</Badge>}
          </button>
        )
      })}
    </div>
  )
}

// avoid linter complaint about unused import (used conditionally above)
void Star

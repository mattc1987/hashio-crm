import { useMemo, useState } from 'react'
import { Plus, Search, FileText, Copy, Trash2, FolderOpen, Folder, Sparkles, ChevronDown, ChevronRight } from 'lucide-react'
import { useSheetData } from '../lib/sheet-context'
import { Card, Button, Input, Textarea, PageHeader, Empty, Badge } from '../components/ui'
import { SavedIndicator } from '../components/SavedIndicator'
import { api, hasWriteBackend } from '../lib/api'
import { resolveMergeTags } from '../lib/sequences'
import type { EmailTemplate } from '../lib/types'
import { cn } from '../lib/cn'
import { EmailTemplateBuilderDrawer } from '../components/templateBuilder/EmailTemplateBuilderDrawer'

const UNFILED = '__unfiled__'

export function Templates() {
  const { state, refresh } = useSheetData()
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [activeFolder, setActiveFolder] = useState<string | null>(null) // null = "All"
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set())
  const [aiBuilderOpen, setAiBuilderOpen] = useState(false)

  const data = 'data' in state ? state.data : undefined
  const emailTemplates = data?.emailTemplates ?? []

  // Build folder tree — group by category
  const folders = useMemo(() => {
    const counts = new Map<string, number>()
    for (const t of emailTemplates) {
      const key = (t.category || '').trim() || UNFILED
      counts.set(key, (counts.get(key) || 0) + 1)
    }
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => {
        if (a.name === UNFILED) return 1
        if (b.name === UNFILED) return -1
        return a.name.localeCompare(b.name)
      })
  }, [emailTemplates])

  const existingFolders = useMemo(
    () => folders.filter((f) => f.name !== UNFILED).map((f) => f.name),
    [folders],
  )

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim()
    return emailTemplates.filter((t) => {
      // Folder filter
      if (activeFolder !== null) {
        const cat = (t.category || '').trim() || UNFILED
        if (cat !== activeFolder) return false
      }
      // Text search
      if (q) {
        return (
          t.name.toLowerCase().includes(q) ||
          t.subject.toLowerCase().includes(q) ||
          t.body.toLowerCase().includes(q) ||
          (t.category || '').toLowerCase().includes(q)
        )
      }
      return true
    }).sort((a, b) => a.name.localeCompare(b.name))
  }, [emailTemplates, query, activeFolder])

  if (!data) return <PageHeader title="Templates" />

  const current = editing ? emailTemplates.find((t) => t.id === editing) : null

  const create = async () => {
    const res = await api.emailTemplate.create({
      name: 'Untitled template',
      subject: '',
      body: '',
      category: activeFolder && activeFolder !== UNFILED ? activeFolder : '',
    })
    if (res.row?.id) setEditing(res.row.id as string)
    refresh()
  }

  const update = (t: EmailTemplate, patch: Partial<EmailTemplate>) => {
    api.emailTemplate.update({ id: t.id, ...patch })
  }

  const remove = async (t: EmailTemplate) => {
    if (!confirm(`Delete "${t.name}"?`)) return
    await api.emailTemplate.remove(t.id)
    if (editing === t.id) setEditing(null)
    refresh()
  }

  const duplicate = async (t: EmailTemplate) => {
    await api.emailTemplate.create({
      name: t.name + ' (copy)',
      subject: t.subject,
      body: t.body,
      category: t.category,
    })
    refresh()
  }

  const moveToFolder = async (t: EmailTemplate, newFolder: string) => {
    await api.emailTemplate.update({ id: t.id, category: newFolder })
    refresh()
  }

  const toggleFolder = (name: string) => {
    setCollapsedFolders((cur) => {
      const next = new Set(cur)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Email templates"
        subtitle={`${emailTemplates.length} template${emailTemplates.length === 1 ? '' : 's'} · ${existingFolders.length} folder${existingFolders.length === 1 ? '' : 's'}`}
        action={
          <div className="flex items-center gap-2">
            {hasWriteBackend() && (
              <Button
                variant="primary"
                icon={<Sparkles size={14} />}
                onClick={() => setAiBuilderOpen(true)}
                title="AI expert copywriter builds you a high-converting email"
              >
                Build with AI
              </Button>
            )}
            <Button icon={<Plus size={14} />} onClick={create}>
              New template
            </Button>
          </div>
        }
      />

      <EmailTemplateBuilderDrawer
        open={aiBuilderOpen}
        onClose={() => setAiBuilderOpen(false)}
        defaultFolder={activeFolder && activeFolder !== UNFILED ? activeFolder : undefined}
        existingFolders={existingFolders}
        onCreated={(id) => { refresh(); setEditing(id) }}
      />

      <div className="grid grid-cols-1 lg:grid-cols-[260px_320px_1fr] gap-5">
        {/* Folder sidebar */}
        <Card padded={false}>
          <div className="px-3 py-3 border-soft-b">
            <div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)] font-semibold">
              Folders
            </div>
          </div>
          <div className="py-1">
            <FolderRow
              icon={<FileText size={13} />}
              label="All templates"
              count={emailTemplates.length}
              active={activeFolder === null}
              onClick={() => setActiveFolder(null)}
            />
            {folders.map((f) => (
              <FolderRow
                key={f.name}
                icon={f.name === UNFILED ? <Folder size={13} /> : <FolderOpen size={13} />}
                label={f.name === UNFILED ? 'Unfiled' : f.name}
                count={f.count}
                active={activeFolder === f.name}
                onClick={() => setActiveFolder(activeFolder === f.name ? null : f.name)}
              />
            ))}
          </div>
        </Card>

        {/* Template list */}
        <Card padded={false}>
          <div className="p-3 border-soft-b">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
              <Input
                placeholder="Search subject, body, name…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            {activeFolder !== null && (
              <div className="mt-2 text-[11px] text-muted flex items-center gap-1.5">
                <FolderOpen size={11} />
                <span>
                  Showing folder: <strong className="text-body">{activeFolder === UNFILED ? 'Unfiled' : activeFolder}</strong>
                </span>
                <button onClick={() => setActiveFolder(null)} className="text-[var(--color-brand-600)] hover:text-[var(--color-brand-700)] ml-auto">
                  Clear
                </button>
              </div>
            )}
          </div>

          {filtered.length === 0 ? (
            <Empty
              icon={<FileText size={22} />}
              title={emailTemplates.length === 0 ? 'No templates yet' : 'No matches'}
              description={
                emailTemplates.length === 0
                  ? 'Click "Build with AI" to generate your first one.'
                  : undefined
              }
            />
          ) : query || activeFolder !== null ? (
            // Flat list when filtered
            <div className="divide-y divide-[color:var(--border)] max-h-[70vh] overflow-y-auto">
              {filtered.map((t) => (
                <TemplateRow key={t.id} template={t} active={editing === t.id} onClick={() => setEditing(t.id)} />
              ))}
            </div>
          ) : (
            // Grouped by folder when no query / no folder filter
            <div className="divide-y divide-[color:var(--border)] max-h-[70vh] overflow-y-auto">
              {folders.map((f) => {
                const inFolder = filtered.filter((t) => ((t.category || '').trim() || UNFILED) === f.name)
                if (inFolder.length === 0) return null
                const collapsed = collapsedFolders.has(f.name)
                return (
                  <div key={f.name}>
                    <button
                      onClick={() => toggleFolder(f.name)}
                      className="w-full px-3 py-2 surface-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted hover:text-body sticky top-0 z-10"
                    >
                      {collapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
                      <span>{f.name === UNFILED ? 'Unfiled' : f.name}</span>
                      <Badge tone="neutral" className="ml-auto">{inFolder.length}</Badge>
                    </button>
                    {!collapsed && inFolder.map((t) => (
                      <TemplateRow key={t.id} template={t} active={editing === t.id} onClick={() => setEditing(t.id)} />
                    ))}
                  </div>
                )
              })}
            </div>
          )}
        </Card>

        {/* Editor */}
        {current ? (
          <TemplateEditor
            template={current}
            onChange={(patch) => update(current, patch)}
            onDuplicate={() => duplicate(current)}
            onDelete={() => remove(current)}
            onMoveFolder={(folder) => moveToFolder(current, folder)}
            existingFolders={existingFolders}
          />
        ) : (
          <Card>
            <Empty
              icon={<FileText size={22} />}
              title="Pick a template to edit"
              description='Or click "Build with AI" to generate a new one.'
            />
          </Card>
        )}
      </div>
    </div>
  )
}

// ============================================================
// Folder row in the sidebar
// ============================================================

function FolderRow({ icon, label, count, active, onClick }: {
  icon: React.ReactNode
  label: string
  count: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-2 px-3 py-1.5 text-[12px] hover:surface-2 transition-colors',
        active && 'bg-[color:rgba(122,94,255,0.08)] text-[var(--color-brand-700)] dark:text-[var(--color-brand-300)]',
      )}
    >
      <span className={active ? 'text-[var(--color-brand-600)]' : 'text-[var(--text-faint)]'}>{icon}</span>
      <span className={cn('flex-1 text-left truncate', active ? 'font-medium' : 'text-body')}>{label}</span>
      <span className="text-[10px] text-[var(--text-faint)] tabular">{count}</span>
    </button>
  )
}

// ============================================================
// Template row in the list
// ============================================================

function TemplateRow({ template, active, onClick }: { template: EmailTemplate; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full text-left px-4 py-3 transition-colors',
        active ? 'surface-2' : 'hover:surface-2',
      )}
    >
      <div className="text-[13px] font-medium text-body truncate">{template.name}</div>
      <div className="text-[11px] text-muted truncate mt-0.5">
        {template.subject || <em>No subject</em>}
      </div>
      {template.category && (
        <div className="mt-1.5">
          <Badge tone="neutral">{template.category}</Badge>
        </div>
      )}
    </button>
  )
}

// ============================================================
// Template editor (right column)
// ============================================================

function TemplateEditor({
  template, onChange, onDuplicate, onDelete, onMoveFolder, existingFolders,
}: {
  template: EmailTemplate
  onChange: (patch: Partial<EmailTemplate>) => void
  onDuplicate: () => void
  onDelete: () => void
  onMoveFolder: (folder: string) => void
  existingFolders: string[]
}) {
  const [showPreview, setShowPreview] = useState(false)
  const [showFolderPicker, setShowFolderPicker] = useState(false)
  const preview = useMemo(
    () => ({
      subject: resolveMergeTags(template.subject, { contact: DEMO_CONTACT, deal: DEMO_DEAL, company: DEMO_COMPANY }),
      body: resolveMergeTags(template.body, { contact: DEMO_CONTACT, deal: DEMO_DEAL, company: DEMO_COMPANY }),
    }),
    [template.subject, template.body],
  )

  return (
    <Card padded={false}>
      <div className="px-5 py-4 border-soft-b flex items-center gap-3 flex-wrap">
        <input
          value={template.name}
          onChange={(e) => onChange({ name: e.target.value })}
          className="bg-transparent border-none outline-none font-display text-[15px] font-semibold text-body flex-1 min-w-[200px]"
        />
        <SavedIndicator value={JSON.stringify(template)} />
        <div className="relative">
          <button
            onClick={() => setShowFolderPicker((v) => !v)}
            className="inline-flex items-center gap-1 surface-2 border-soft rounded-[var(--radius-sm)] px-2 py-1 text-[11px] hover:surface-3"
            title="Move to folder"
          >
            <FolderOpen size={11} />
            {template.category || 'Unfiled'}
            <ChevronDown size={9} />
          </button>
          {showFolderPicker && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowFolderPicker(false)} />
              <div className="absolute right-0 top-full mt-1 z-20 w-56 surface border-soft shadow-soft-lg rounded-[var(--radius-md)] p-1 max-h-72 overflow-y-auto">
                <button
                  onClick={() => { onMoveFolder(''); setShowFolderPicker(false) }}
                  className="w-full text-left px-3 py-1.5 text-[12px] hover:surface-2 rounded-[var(--radius-sm)]"
                >
                  Unfiled
                </button>
                {existingFolders.map((f) => (
                  <button
                    key={f}
                    onClick={() => { onMoveFolder(f); setShowFolderPicker(false) }}
                    className="w-full text-left px-3 py-1.5 text-[12px] hover:surface-2 rounded-[var(--radius-sm)]"
                  >
                    {f}
                  </button>
                ))}
                <div className="border-soft-t my-1" />
                <NewFolderInput onCreate={(name) => { onMoveFolder(name); setShowFolderPicker(false) }} />
              </div>
            </>
          )}
        </div>
        <Button size="sm" icon={<Copy size={12} />} onClick={onDuplicate}>Duplicate</Button>
        <Button size="sm" variant="danger" icon={<Trash2 size={12} />} onClick={onDelete}>Delete</Button>
      </div>
      <div className="p-5 flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">Subject line</span>
          <Input
            value={template.subject}
            onChange={(e) => onChange({ subject: e.target.value })}
            placeholder="e.g. Following up on {{company}}"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">Body</span>
          <Textarea
            value={template.body}
            onChange={(e) => onChange({ body: e.target.value })}
            placeholder={"Hi {{firstName}},\n\n…"}
            rows={14}
          />
        </label>

        <div className="border-soft-t pt-4">
          <button
            type="button"
            onClick={() => setShowPreview((v) => !v)}
            className="text-[12px] font-medium text-[var(--color-brand-600)] hover:text-[var(--color-brand-700)]"
          >
            {showPreview ? 'Hide preview' : 'Preview with sample contact (Jane Doe @ Acme)'}
          </button>
          {showPreview && (
            <div className="surface-2 rounded-[var(--radius-md)] p-4 mt-3 text-[13px]">
              <div className="text-[11px] uppercase tracking-wider text-[var(--text-faint)] font-semibold mb-1">Subject</div>
              <div className="text-body font-medium">{preview.subject || <em className="text-muted">(empty)</em>}</div>
              <div className="text-[11px] uppercase tracking-wider text-[var(--text-faint)] font-semibold mt-3 mb-1">Body</div>
              <div className="text-body whitespace-pre-wrap">{preview.body || <em className="text-muted">(empty)</em>}</div>
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}

function NewFolderInput({ onCreate }: { onCreate: (name: string) => void }) {
  const [name, setName] = useState('')
  return (
    <div className="flex items-center gap-1 px-2 py-1">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="+ new folder"
        className="text-[11px] h-7"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && name.trim()) {
            onCreate(name.trim())
            setName('')
          }
        }}
      />
      {name.trim() && (
        <Button size="sm" variant="primary" onClick={() => { onCreate(name.trim()); setName('') }}>Add</Button>
      )}
    </div>
  )
}

const DEMO_CONTACT = {
  id: '', firstName: 'Jane', lastName: 'Doe', email: 'jane@acme.com',
  phone: '', title: 'Ops Director', role: 'Operations', companyId: '', status: 'Customer',
  state: 'CO', linkedinUrl: '', tags: '', createdAt: '',
}
const DEMO_COMPANY = {
  id: '', name: 'Acme Cultivation', industry: 'Cultivation',
  licenseCount: '', size: '', website: '', address: '', notes: '',
  vertical: 'cultivator' as const, verticalConfidence: '', verticalSource: '',
  createdAt: '', updatedAt: '',
}
const DEMO_DEAL = {
  id: '', title: 'Acme — HashIO License', contactId: '', companyId: '',
  value: 12000, stage: 'Qualified', probability: 50, closeDate: '',
  mrr: 1000, billingCycle: 'monthly' as const, billingMonth: '', contractStart: '',
  contractEnd: '', mrrStatus: '', notes: '', createdAt: '', updatedAt: '',
}

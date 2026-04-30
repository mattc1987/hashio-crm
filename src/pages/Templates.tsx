import { useMemo, useState } from 'react'
import { Plus, Search, FileText, Copy, Trash2 } from 'lucide-react'
import { useSheetData } from '../lib/sheet-context'
import { Card, Button, Input, Textarea, PageHeader, Empty, Badge } from '../components/ui'
import { SavedIndicator } from '../components/SavedIndicator'
import { api } from '../lib/api'
import { resolveMergeTags } from '../lib/sequences'
import type { EmailTemplate } from '../lib/types'
import { cn } from '../lib/cn'

export function Templates() {
  const { state, refresh } = useSheetData()
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<string | null>(null)

  const data = 'data' in state ? state.data : undefined
  const emailTemplates = data?.emailTemplates ?? []

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim()
    return emailTemplates.filter(
      (t) => !q || t.name.toLowerCase().includes(q) || t.subject.toLowerCase().includes(q),
    )
  }, [emailTemplates, query])

  if (!data) return <PageHeader title="Templates" />

  const current = editing ? emailTemplates.find((t) => t.id === editing) : null

  const create = async () => {
    const res = await api.emailTemplate.create({
      name: 'Untitled template',
      subject: '',
      body: '',
      category: '',
    })
    if (res.row?.id) setEditing(res.row.id)
    refresh()
  }

  // Inline edits flow through the reactive local cache. No refresh() here
  // because that would re-render the form mid-typing and steal keystrokes.
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

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Email templates"
        subtitle={`${emailTemplates.length} template${emailTemplates.length === 1 ? '' : 's'}`}
        action={
          <Button variant="primary" icon={<Plus size={14} />} onClick={create}>
            New template
          </Button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-6">
        <Card padded={false}>
          <div className="p-3 border-soft-b">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
              <Input
                placeholder="Search templates…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>

          {filtered.length === 0 ? (
            <Empty
              icon={<FileText size={22} />}
              title={emailTemplates.length === 0 ? 'No templates' : 'No matches'}
              description={
                emailTemplates.length === 0
                  ? 'Save reusable email copy here — reference it from sequences or send ad-hoc.'
                  : undefined
              }
            />
          ) : (
            <div className="divide-y divide-[color:var(--border)]">
              {filtered.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setEditing(t.id)}
                  className={cn(
                    'w-full text-left px-4 py-3 transition-colors',
                    editing === t.id ? 'surface-2' : 'hover:surface-2',
                  )}
                >
                  <div className="text-[13px] font-medium text-body truncate">{t.name}</div>
                  <div className="text-[11px] text-muted truncate mt-0.5">
                    {t.subject || <em>No subject</em>}
                  </div>
                  {t.category && (
                    <div className="mt-1.5">
                      <Badge tone="neutral">{t.category}</Badge>
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </Card>

        {current ? (
          <TemplateEditor
            template={current}
            onChange={(patch) => update(current, patch)}
            onDuplicate={() => duplicate(current)}
            onDelete={() => remove(current)}
          />
        ) : (
          <Card>
            <Empty
              icon={<FileText size={22} />}
              title="Pick a template to edit"
              description="Or click ‘New template’ to create one."
            />
          </Card>
        )}
      </div>
    </div>
  )
}

function TemplateEditor({
  template,
  onChange,
  onDuplicate,
  onDelete,
}: {
  template: EmailTemplate
  onChange: (patch: Partial<EmailTemplate>) => void
  onDuplicate: () => void
  onDelete: () => void
}) {
  const [showPreview, setShowPreview] = useState(false)
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
        <input
          value={template.category}
          onChange={(e) => onChange({ category: e.target.value })}
          placeholder="category"
          className="bg-transparent border-soft rounded-[var(--radius-sm)] px-2 py-1 text-[11px] w-28"
        />
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

const DEMO_CONTACT = {
  id: '', firstName: 'Jane', lastName: 'Doe', email: 'jane@acme.com',
  phone: '', title: 'Ops Director', role: 'Operations', companyId: '', status: 'Customer',
  state: 'CO', linkedinUrl: '', tags: '', createdAt: '',
}
const DEMO_COMPANY = {
  id: '', name: 'Acme Cultivation', industry: 'Cultivation',
  licenseCount: '', size: '', website: '', address: '', notes: '', createdAt: '', updatedAt: '',
}
const DEMO_DEAL = {
  id: '', title: 'Acme — HashIO License', contactId: '', companyId: '',
  value: 12000, stage: 'Qualified', probability: 50, closeDate: '',
  mrr: 1000, billingCycle: 'monthly' as const, billingMonth: '', contractStart: '',
  contractEnd: '', mrrStatus: '', notes: '', createdAt: '', updatedAt: '',
}

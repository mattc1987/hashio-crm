// AI Email Template Builder — wizard for generating a single high-quality
// email template with subject + body + alternatives, written by an
// expert-copywriter Claude persona.

import { useState } from 'react'
import {
  Sparkles, Wand2, Loader2, AlertCircle, CheckCircle2, FolderOpen, Copy,
} from 'lucide-react'
import { Drawer } from '../Drawer'
import { Button, Input, Textarea, Badge } from '../ui'
import {
  buildEmailTemplate,
  USE_CASE_OPTIONS, FRAMEWORK_OPTIONS, TONE_OPTIONS, LENGTH_OPTIONS, CTA_OPTIONS, SUBJECT_STYLE_OPTIONS,
  type EmailTemplateBuildInput, type EmailUseCase, type EmailFramework, type EmailTone,
  type EmailLength, type CtaType, type SubjectStyle, type BuiltEmailTemplate,
} from '../../lib/emailTemplateAi'
import { api } from '../../lib/api'
import { cn } from '../../lib/cn'

interface Props {
  open: boolean
  onClose: () => void
  /** Pre-set the folder (when triggered from a specific folder context). */
  defaultFolder?: string
  /** Existing folder names so the wizard can offer them as a dropdown. */
  existingFolders: string[]
  onCreated?: (templateId: string) => void
}

type Phase = 'configure' | 'generating' | 'preview' | 'saving'

export function EmailTemplateBuilderDrawer({ open, onClose, defaultFolder, existingFolders, onCreated }: Props) {
  const [phase, setPhase] = useState<Phase>('configure')
  const [error, setError] = useState<string | null>(null)
  const [built, setBuilt] = useState<BuiltEmailTemplate | null>(null)

  // Wizard state
  const [useCase, setUseCase] = useState<EmailUseCase>('cold-outreach')
  const [useCaseDetail, setUseCaseDetail] = useState('')
  const [audience, setAudience] = useState('')
  const [framework, setFramework] = useState<EmailFramework>('auto')
  const [tone, setTone] = useState<EmailTone>('direct')
  const [length, setLength] = useState<EmailLength>('short')
  const [ctaType, setCtaType] = useState<CtaType>('auto')
  const [subjectStyle, setSubjectStyle] = useState<SubjectStyle>('auto')
  const [voiceSamples, setVoiceSamples] = useState('')
  const [folder, setFolder] = useState(defaultFolder || '')

  // Editable preview
  const [editedSubject, setEditedSubject] = useState('')
  const [editedBody, setEditedBody] = useState('')
  const [editedName, setEditedName] = useState('')
  const [editedFolder, setEditedFolder] = useState('')

  const reset = () => {
    setPhase('configure')
    setError(null)
    setBuilt(null)
    setUseCase('cold-outreach')
    setUseCaseDetail('')
    setAudience('')
    setFramework('auto')
    setTone('direct')
    setLength('short')
    setCtaType('auto')
    setSubjectStyle('auto')
    setVoiceSamples('')
    setFolder(defaultFolder || '')
  }

  const handleClose = () => {
    onClose()
    setTimeout(reset, 300)
  }

  const handleGenerate = async () => {
    setPhase('generating')
    setError(null)
    try {
      const input: EmailTemplateBuildInput = {
        useCase,
        useCaseDetail: useCaseDetail.trim() || undefined,
        audience: audience.trim() || undefined,
        framework,
        tone,
        length,
        ctaType,
        subjectStyle,
        voiceSamples: voiceSamples.trim() || undefined,
        folder: folder.trim() || undefined,
      }
      const result = await buildEmailTemplate(input)
      setBuilt(result)
      setEditedSubject(result.subject)
      setEditedBody(result.body)
      setEditedName(result.name)
      setEditedFolder(result.category || folder.trim() || '')
      setPhase('preview')
    } catch (err) {
      setError((err as Error).message)
      setPhase('configure')
    }
  }

  const handleSave = async () => {
    if (!built) return
    setPhase('saving')
    setError(null)
    try {
      const res = await api.emailTemplate.create({
        name: editedName.trim() || built.name,
        subject: editedSubject,
        body: editedBody,
        category: editedFolder.trim(),
        createdAt: new Date().toISOString(),
      })
      if (!res.ok || !res.row) throw new Error(res.error || 'Failed to save template')
      onCreated?.(res.row.id as string)
      handleClose()
    } catch (err) {
      setError((err as Error).message)
      setPhase('preview')
    }
  }

  return (
    <Drawer
      open={open}
      onClose={handleClose}
      width={780}
      title={
        <span className="flex items-center gap-2">
          <Sparkles size={15} className="text-[var(--color-brand-600)]" />
          AI Email Template Builder
        </span>
      }
      subtitle={
        phase === 'configure' ? 'Expert copywriter Claude builds you a high-converting email — pick a use case, frame it, set the tone' :
        phase === 'generating' ? 'Drafting subject + body + alternatives…' :
        phase === 'preview' ? 'Edit before saving. Alternative subjects + CTAs in case the primary doesn\'t fit.' :
        'Saving…'
      }
      footer={
        phase === 'configure' ? (
          <>
            <Button variant="ghost" onClick={handleClose}>Cancel</Button>
            <Button
              variant="primary"
              icon={<Wand2 size={13} />}
              onClick={handleGenerate}
              disabled={useCase === 'custom' && !useCaseDetail.trim()}
            >
              Generate template
            </Button>
          </>
        ) : phase === 'preview' && built ? (
          <>
            <Button variant="ghost" onClick={() => setPhase('configure')}>← Back</Button>
            <Button variant="secondary" onClick={handleGenerate}>Regenerate</Button>
            <Button
              variant="primary"
              icon={<CheckCircle2 size={13} />}
              onClick={handleSave}
            >
              Save template
            </Button>
          </>
        ) : null
      }
    >
      {error && (
        <div className="mb-4 surface-2 rounded-[var(--radius-md)] p-3 text-[12px] text-[var(--color-danger)] flex items-start gap-2">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <div>{error}</div>
        </div>
      )}

      {phase === 'configure' && (
        <ConfigureStep
          useCase={useCase} setUseCase={setUseCase}
          useCaseDetail={useCaseDetail} setUseCaseDetail={setUseCaseDetail}
          audience={audience} setAudience={setAudience}
          framework={framework} setFramework={setFramework}
          tone={tone} setTone={setTone}
          length={length} setLength={setLength}
          ctaType={ctaType} setCtaType={setCtaType}
          subjectStyle={subjectStyle} setSubjectStyle={setSubjectStyle}
          voiceSamples={voiceSamples} setVoiceSamples={setVoiceSamples}
          folder={folder} setFolder={setFolder}
          existingFolders={existingFolders}
        />
      )}

      {phase === 'generating' && <GeneratingState />}

      {phase === 'preview' && built && (
        <PreviewStep
          built={built}
          editedSubject={editedSubject} setEditedSubject={setEditedSubject}
          editedBody={editedBody} setEditedBody={setEditedBody}
          editedName={editedName} setEditedName={setEditedName}
          editedFolder={editedFolder} setEditedFolder={setEditedFolder}
          existingFolders={existingFolders}
        />
      )}

      {phase === 'saving' && (
        <div className="flex items-center gap-2 text-[12px] text-muted py-8 justify-center">
          <Loader2 size={14} className="animate-spin" /> Saving template…
        </div>
      )}
    </Drawer>
  )
}

// ============================================================
// Configure phase
// ============================================================

function ConfigureStep(props: {
  useCase: EmailUseCase; setUseCase: (v: EmailUseCase) => void
  useCaseDetail: string; setUseCaseDetail: (v: string) => void
  audience: string; setAudience: (v: string) => void
  framework: EmailFramework; setFramework: (v: EmailFramework) => void
  tone: EmailTone; setTone: (v: EmailTone) => void
  length: EmailLength; setLength: (v: EmailLength) => void
  ctaType: CtaType; setCtaType: (v: CtaType) => void
  subjectStyle: SubjectStyle; setSubjectStyle: (v: SubjectStyle) => void
  voiceSamples: string; setVoiceSamples: (v: string) => void
  folder: string; setFolder: (v: string) => void
  existingFolders: string[]
}) {
  const { useCase, setUseCase, useCaseDetail, setUseCaseDetail, audience, setAudience,
    framework, setFramework, tone, setTone, length, setLength, ctaType, setCtaType,
    subjectStyle, setSubjectStyle, voiceSamples, setVoiceSamples,
    folder, setFolder, existingFolders } = props

  return (
    <div className="flex flex-col gap-6">
      <Section number={1} title="What kind of email is this?">
        <RadioGrid options={USE_CASE_OPTIONS} value={useCase} onChange={setUseCase} columns={2} />
        {useCase === 'custom' && (
          <Textarea
            value={useCaseDetail}
            onChange={(e) => setUseCaseDetail(e.target.value)}
            placeholder="Describe the scenario — e.g. 'Email to a customer whose contract ends in 90 days, but they've slowed engagement'"
            rows={2}
            className="text-[12px] mt-2"
          />
        )}
      </Section>

      <Section number={2} title="Audience" hint="Optional but powerful — the AI tailors every line.">
        <Textarea
          value={audience}
          onChange={(e) => setAudience(e.target.value)}
          placeholder='e.g. "Director of Cultivation at a 100K+ sqft cannabis grower in CA"'
          rows={2}
          className="text-[12px]"
        />
      </Section>

      <Section number={3} title="Copywriting framework">
        <RadioGrid options={FRAMEWORK_OPTIONS} value={framework} onChange={setFramework} columns={2} />
      </Section>

      <Section number={4} title="Tone">
        <RadioGrid options={TONE_OPTIONS} value={tone} onChange={setTone} columns={2} />
      </Section>

      <Section number={5} title="Length">
        <RadioGrid options={LENGTH_OPTIONS} value={length} onChange={setLength} columns={2} />
      </Section>

      <Section number={6} title="Call to action">
        <RadioGrid options={CTA_OPTIONS} value={ctaType} onChange={setCtaType} columns={2} />
      </Section>

      <Section number={7} title="Subject line style">
        <RadioGrid options={SUBJECT_STYLE_OPTIONS} value={subjectStyle} onChange={setSubjectStyle} columns={2} />
      </Section>

      <Section number={8} title="Folder" hint="Templates organize into folders for quick access.">
        <FolderInput value={folder} setValue={setFolder} existingFolders={existingFolders} />
      </Section>

      <Section number={9} title="Match my voice (optional)" hint="Paste 1-2 of your best emails. AI clones tone, sentence patterns, signoffs.">
        <Textarea
          value={voiceSamples}
          onChange={(e) => setVoiceSamples(e.target.value)}
          placeholder="Paste a winning email here…"
          rows={5}
          className="text-[11px] font-mono"
        />
      </Section>
    </div>
  )
}

function FolderInput({ value, setValue, existingFolders }: { value: string; setValue: (v: string) => void; existingFolders: string[] }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <FolderOpen size={14} className="text-[var(--text-faint)] shrink-0" />
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="e.g. 'Cold outreach' or 'Demo follow-up'"
        />
      </div>
      {existingFolders.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] uppercase tracking-wider text-[var(--text-faint)] font-semibold">Existing:</span>
          {existingFolders.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setValue(f)}
              className={cn(
                'inline-flex items-center gap-1 h-6 px-2 text-[11px] font-medium rounded-full transition-colors',
                value === f
                  ? 'bg-[var(--color-brand-600)] text-white'
                  : 'surface-2 border-soft text-muted hover:text-body',
              )}
            >
              {f}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ============================================================
// Reusable selector grid
// ============================================================

function RadioGrid<T extends string>({
  options, value, onChange, columns,
}: {
  options: Array<{ value: T; label: string; hint: string }>
  value: T
  onChange: (v: T) => void
  columns: 1 | 2 | 3
}) {
  const colClass = columns === 1 ? 'grid-cols-1' : columns === 2 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1 md:grid-cols-3'
  return (
    <div className={cn('grid gap-2', colClass)}>
      {options.map((opt) => {
        const selected = value === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              'text-left surface border-2 rounded-[var(--radius-md)] p-3 transition-all hover:border-[var(--color-brand-500)]',
              selected ? 'border-[var(--color-brand-600)] bg-[color:rgba(122,94,255,0.10)] shadow-soft-sm' : 'border-[var(--border)]',
            )}
          >
            <div className="flex items-start gap-2">
              <div className={cn(
                'w-4 h-4 rounded-full border-2 grid place-items-center shrink-0 mt-0.5 transition-all',
                selected ? 'bg-[var(--color-brand-600)] border-[var(--color-brand-600)]' : 'border-[var(--border-strong)]',
              )}>
                {selected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className={cn(
                  'font-medium text-[13px]',
                  selected ? 'text-[var(--color-brand-700)] dark:text-[var(--color-brand-300)]' : 'text-body',
                )}>
                  {opt.label}
                </div>
                <div className="text-[11px] text-muted mt-0.5">{opt.hint}</div>
              </div>
            </div>
          </button>
        )
      })}
    </div>
  )
}

function Section({ number, title, hint, children }: { number: number; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div>
        <div className="flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-[color:rgba(122,94,255,0.15)] text-[var(--color-brand-700)] dark:text-[var(--color-brand-300)] grid place-items-center text-[11px] font-semibold">
            {number}
          </span>
          <span className="font-display font-semibold text-[14px] text-body">{title}</span>
        </div>
        {hint && <div className="text-[11px] text-muted ml-7 mt-0.5">{hint}</div>}
      </div>
      <div className="ml-7">{children}</div>
    </div>
  )
}

// ============================================================
// Generating state
// ============================================================

function GeneratingState() {
  return (
    <div className="py-8 flex flex-col items-center gap-4">
      <div className="w-12 h-12 rounded-full bg-[var(--color-brand-600)] grid place-items-center animate-pulse">
        <Sparkles size={20} className="text-white" />
      </div>
      <div className="text-[13px] font-medium text-body">Crafting your template…</div>
      <div className="text-[11px] text-muted text-center max-w-md leading-relaxed">
        Expert copywriter persona is at work — applying the framework, picking the strongest hook,
        cutting every wasted word, drafting alternative subjects + CTAs. ~10-30 sec.
      </div>
    </div>
  )
}

// ============================================================
// Preview
// ============================================================

function PreviewStep(props: {
  built: BuiltEmailTemplate
  editedSubject: string; setEditedSubject: (v: string) => void
  editedBody: string; setEditedBody: (v: string) => void
  editedName: string; setEditedName: (v: string) => void
  editedFolder: string; setEditedFolder: (v: string) => void
  existingFolders: string[]
}) {
  const { built, editedSubject, setEditedSubject, editedBody, setEditedBody,
    editedName, setEditedName, editedFolder, setEditedFolder, existingFolders } = props

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="bg-gradient-to-br from-[color:rgba(122,94,255,0.08)] to-transparent border border-[color:rgba(122,94,255,0.2)] rounded-[var(--radius-md)] p-4">
        <div className="flex items-center gap-2 mb-1">
          <Sparkles size={13} className="text-[var(--color-brand-600)]" />
          <span className="text-[10px] uppercase tracking-wider text-[var(--color-brand-700)] dark:text-[var(--color-brand-300)] font-semibold">
            Generated by {built.model}
          </span>
          <Badge tone="brand" className="ml-auto">Framework: {built.framework}</Badge>
        </div>
        <div className="text-[12px] text-body italic mt-2">{built.useCaseNotes}</div>
        {built.mergeTagsUsed && built.mergeTagsUsed.length > 0 && (
          <div className="text-[11px] text-muted mt-2">
            <strong>Merge tags used:</strong> {built.mergeTagsUsed.map((t) => <code key={t} className="font-mono surface-2 px-1 rounded mr-1">{t}</code>)}
          </div>
        )}
      </div>

      {/* Editable fields */}
      <div className="flex flex-col gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)] font-semibold mb-1">Template name</div>
          <Input value={editedName} onChange={(e) => setEditedName(e.target.value)} className="text-[13px]" />
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)] font-semibold mb-1">Folder</div>
          <FolderInput value={editedFolder} setValue={setEditedFolder} existingFolders={existingFolders} />
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)] font-semibold mb-1">Subject</div>
          <Input value={editedSubject} onChange={(e) => setEditedSubject(e.target.value)} className="text-[12px]" />
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)] font-semibold mb-1">Body</div>
          <Textarea value={editedBody} onChange={(e) => setEditedBody(e.target.value)} rows={12} className="text-[12px] font-mono" />
        </div>
      </div>

      {/* Alternatives */}
      {built.alternativeSubjects && built.alternativeSubjects.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)] font-semibold mb-1.5">
            Alternative subjects — click to swap in
          </div>
          <div className="flex flex-col gap-1.5">
            {built.alternativeSubjects.map((alt, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setEditedSubject(alt)}
                className="text-left text-[12px] surface border-soft rounded-[var(--radius-md)] p-2.5 hover:border-[var(--color-brand-500)] hover:surface-2 transition-colors"
              >
                <span className="text-[var(--color-brand-600)] font-medium mr-1">→</span>
                {alt}
              </button>
            ))}
          </div>
        </div>
      )}

      {built.alternativeCtas && built.alternativeCtas.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)] font-semibold mb-1.5">
            Alternative CTAs — copy these into the body if you prefer a different angle
          </div>
          <div className="flex flex-col gap-1.5">
            {built.alternativeCtas.map((alt, i) => (
              <div
                key={i}
                className="group text-[12px] surface border-soft rounded-[var(--radius-md)] p-2.5 flex items-start gap-2"
              >
                <span className="text-[var(--text-faint)] mt-0.5">•</span>
                <div className="flex-1 text-body">{alt}</div>
                <button
                  type="button"
                  onClick={() => navigator.clipboard?.writeText(alt)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-muted hover:text-body"
                  title="Copy to clipboard"
                >
                  <Copy size={11} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

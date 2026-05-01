import { useEffect, useMemo, useRef, useState } from 'react'
import Papa from 'papaparse'
import { Upload, CheckCircle2, AlertTriangle, ArrowRight, ArrowLeft, X } from 'lucide-react'
import { Card, CardHeader, Button, PageHeader, Badge, Select } from '../components/ui'
import { cn } from '../lib/cn'
import { api, invokeAction, bulkCreate } from '../lib/api'
import { recordCreateMany, localId } from '../lib/localCache'
import { useSheetData } from '../lib/sheet-context'

type Entity = 'companies' | 'contacts' | 'deals' | 'tasks'

interface FieldDef {
  key: string
  label: string
  required?: boolean
  aliases: string[] // source-column names we'll auto-map from
}

const ENTITY_FIELDS: Record<Entity, FieldDef[]> = {
  contacts: [
    { key: 'firstName',   label: 'First name',     required: true,  aliases: ['first name','firstname','first','given name','fname'] },
    { key: 'lastName',    label: 'Last name',      required: true,  aliases: ['last name','lastname','last','surname','family name','lname'] },
    { key: 'email',       label: 'Email',          required: true,  aliases: ['email','email address','e-mail','work email','primary email'] },
    { key: 'phone',       label: 'Phone',                            aliases: ['phone','phone number','mobile','mobile phone','mobile number','cell','work phone'] },
    { key: 'title',       label: 'Title (verbatim job title)',       aliases: ['title','job title','position','job role'] },
    { key: 'role',        label: 'Role / Department category',       aliases: ['role','department','dept','function','category','team'] },
    { key: 'companyName', label: 'Company name (we will match or create)', aliases: ['company','company name','associated company','organization','account','org'] },
    { key: 'state',       label: 'State / region',                   aliases: ['state','region','state/region','state region','location'] },
    { key: 'linkedinUrl', label: 'LinkedIn URL',                     aliases: ['linkedin','linkedin url','linkedin profile','linkedin.com'] },
    { key: 'tags',        label: 'Tags (comma-separated)',           aliases: ['tags','labels','groups'] },
    { key: 'status',      label: 'Status',                           aliases: ['status','lifecycle stage','contact stage','lifecycle'] },
    { key: 'notes',       label: 'Notes',                            aliases: ['notes','note','comments','description','about'] },
  ],
  companies: [
    { key: 'name',         label: 'Name',            required: true, aliases: ['name','company name','account','organization'] },
    { key: 'industry',     label: 'Industry',                        aliases: ['industry','sector','vertical'] },
    { key: 'website',      label: 'Website',                         aliases: ['website','domain','url','site'] },
    { key: 'address',      label: 'Address',                         aliases: ['address','street','hq','location','city'] },
    { key: 'size',         label: 'Size',                            aliases: ['size','headcount','employees','company size'] },
    { key: 'licenseCount', label: 'License count',                   aliases: ['license count','licenses','# licenses','cultivation licenses'] },
    { key: 'notes',        label: 'Notes',                           aliases: ['notes','note','description','about'] },
  ],
  deals: [
    { key: 'title',        label: 'Deal title',      required: true, aliases: ['title','deal name','name','opportunity','deal'] },
    { key: 'companyName',  label: 'Company name (we will match or create)', required: true, aliases: ['company','company name','associated company','account'] },
    { key: 'value',        label: 'Value (annual)',                  aliases: ['value','amount','deal amount','acv','annual value'] },
    { key: 'stage',        label: 'Stage',                           aliases: ['stage','deal stage','pipeline stage'] },
    { key: 'probability',  label: 'Probability %',                   aliases: ['probability','%','likelihood'] },
    { key: 'closeDate',    label: 'Close date',                      aliases: ['close date','closing date','expected close'] },
    { key: 'mrr',          label: 'MRR (monthly)',                   aliases: ['mrr','monthly','monthly recurring revenue'] },
    { key: 'billingCycle', label: 'Billing cycle',                   aliases: ['billing cycle','cycle','billing cadence','frequency'] },
    { key: 'notes',        label: 'Notes',                           aliases: ['notes','description','deal notes'] },
  ],
  tasks: [
    { key: 'title',       label: 'Title',            required: true, aliases: ['title','task','subject','name'] },
    { key: 'dueDate',     label: 'Due date',                         aliases: ['due date','due','deadline'] },
    { key: 'priority',    label: 'Priority',                         aliases: ['priority','urgency'] },
    { key: 'notes',       label: 'Notes',                            aliases: ['notes','description','details'] },
  ],
}

const ENTITY_LABELS: Record<Entity, string> = {
  contacts: 'Contacts',
  companies: 'Companies',
  deals: 'Deals',
  tasks: 'Tasks',
}

type Step = 'pick' | 'mapping' | 'commit'

export function Import() {
  const { state, refresh } = useSheetData()
  const [entity, setEntity] = useState<Entity>('contacts')
  const [step, setStep] = useState<Step>('pick')

  const [sourceColumns, setSourceColumns] = useState<string[]>([])
  const [rows, setRows] = useState<Record<string, string>[]>([])
  const [mapping, setMapping] = useState<Record<string, string>>({}) // source col -> target field key (or '' for ignore)

  const [progress, setProgress] = useState<{
    ok: number
    failed: number
    skipped: number
    total: number
    done: boolean
    cancelled?: boolean
    /** Optional human-readable label for the current phase (e.g. "Pre-creating
     *  companies" / "Writing contacts"). When set, shown above the bar. */
    phase?: string
  } | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Warn before nav away while import is in progress (avoid losing work).
  const importRunning = !!progress && !progress.done
  useEffect(() => {
    if (!importRunning) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [importRunning])
  const cancelRef = useRef(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const fields = ENTITY_FIELDS[entity]
  const data = 'data' in state ? state.data : undefined

  const mappedTargets = useMemo(() => new Set(Object.values(mapping).filter(Boolean)), [mapping])
  const missingRequired = useMemo(
    () => fields.filter((f) => f.required && !mappedTargets.has(f.key)),
    [fields, mappedTargets],
  )

  const reset = () => {
    setStep('pick')
    setSourceColumns([])
    setRows([])
    setMapping({})
    setProgress(null)
    setError(null)
    cancelRef.current = false
  }

  const onFile = (file: File) => {
    setError(null)
    setProgress(null)
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: 'greedy',
      complete: (res) => {
        if (res.errors?.length) {
          const fatal = res.errors.find((e) => e.type === 'FieldMismatch' && e.code !== 'TooFewFields')
          if (fatal) { setError(fatal.message); return }
        }
        const cols = res.meta.fields || []
        setSourceColumns(cols)
        setRows(res.data)
        setMapping(autoMap(cols, fields))
        setStep('mapping')
      },
    })
  }

  const commit = async () => {
    if (!rows.length) return
    cancelRef.current = false
    setProgress({ ok: 0, failed: 0, skipped: 0, total: rows.length, done: false })
    setError(null)

    // Company name lookup (for contacts + deals). Pre-build the name→id map.
    const companyIdByName = new Map<string, string>()
    ;(data?.companies || []).forEach((c) => {
      if (c.name) companyIdByName.set(c.name.toLowerCase().trim(), c.id)
    })

    // Existing-email lookup for idempotent contact imports.
    const existingContactEmails = new Set<string>()
    if (entity === 'contacts') {
      ;(data?.contacts || []).forEach((c) => {
        if (c.email) existingContactEmails.add(c.email.toLowerCase().trim())
      })
    }

    // ── PASS 1: prep all rows in memory + bulk-create missing companies ──
    // - Apply column mapping
    // - Skip dupes (existing email)
    // - Pre-create any missing companies (BULK — single HTTP call per 200)
    // - Skip empty rows
    let ok = 0, failed = 0, skipped = 0
    const preparedRows: Record<string, unknown>[] = []

    // Resolve all unique company names first → batch any missing creates.
    // We pre-generate local IDs and ship them to Apps Script's bulkCreate in
    // ONE HTTP call (per chunk of 200) instead of one round-trip per company.
    // Saves 800 sequential 2-second calls (≈25 min) on a typical HubSpot
    // export — that was the 90% of the import-time budget previously.
    const allCompanyNames = new Set<string>()
    for (const raw of rows) {
      const mapped = applyMapping(raw, mapping)
      if ('companyName' in mapped) {
        const cname = String(mapped.companyName || '').trim()
        if (cname) allCompanyNames.add(cname)
      }
    }

    const missingCompanyNames: string[] = []
    for (const cname of allCompanyNames) {
      if (!companyIdByName.has(cname.toLowerCase())) {
        missingCompanyNames.push(cname)
      }
    }

    if (missingCompanyNames.length > 0) {
      setProgress({
        ok: 0, failed: 0, skipped: 0, total: rows.length, done: false,
        phase: `Pre-creating ${missingCompanyNames.length} compan${missingCompanyNames.length === 1 ? 'y' : 'ies'}…`,
      })

      const ts = new Date().toISOString()
      const newCompanyRows = missingCompanyNames.map((cname) => ({
        id: localId('companies'),
        name: cname,
        createdAt: ts,
        updatedAt: ts,
      }))

      // Map name → pre-generated id BEFORE we even call the network — so if
      // the bulk write fails partially or the user cancels, the remaining
      // contacts still link by name (and Apps Script will auto-dedupe by id
      // on retry since we re-use the same local IDs).
      newCompanyRows.forEach((c) => {
        companyIdByName.set(c.name.toLowerCase(), c.id)
      })

      // Optimistic local cache update — companies appear in UI immediately.
      recordCreateMany('companies', newCompanyRows as Record<string, unknown>[])

      // Bulk write in chunks of 200 (Apps Script payload size limit).
      const COMPANY_BATCH = 200
      for (let i = 0; i < newCompanyRows.length; i += COMPANY_BATCH) {
        if (cancelRef.current) break
        const chunk = newCompanyRows.slice(i, i + COMPANY_BATCH) as Record<string, unknown>[]
        try {
          const res = await bulkCreate('companies', chunk)
          if (!res.ok) {
            // Fall back to per-row for this chunk only — preserves IDs.
            for (const row of chunk) {
              if (cancelRef.current) break
              try { await api.company.create(row) } catch { /* non-fatal */ }
            }
          }
        } catch {
          // Network or Apps Script error — keep going, contacts will still
          // reference these companies by their local IDs.
        }
        setProgress({
          ok: 0, failed: 0, skipped: 0, total: rows.length, done: false,
          phase: `Pre-creating companies… ${Math.min(i + COMPANY_BATCH, newCompanyRows.length)} / ${newCompanyRows.length}`,
        })
      }
    }

    for (let i = 0; i < rows.length; i++) {
      if (cancelRef.current) break
      try {
        const mapped = applyMapping(rows[i], mapping)

        if (entity === 'contacts') {
          const email = String(mapped.email || '').toLowerCase().trim()
          if (email && existingContactEmails.has(email)) {
            skipped++
            continue
          }
          if (email) existingContactEmails.add(email)
        }

        if ('companyName' in mapped) {
          const cname = String(mapped.companyName || '').trim()
          delete mapped.companyName
          if (cname) {
            const id = companyIdByName.get(cname.toLowerCase())
            if (id) mapped.companyId = id
          }
        }

        if (isEmpty(mapped, entity)) { failed++; continue }
        preparedRows.push(mapped)
      } catch {
        failed++
      }
    }

    if (cancelRef.current) {
      setProgress({ ok, failed, skipped, total: rows.length, done: true, cancelled: true })
      return
    }

    // ── PASS 2: bulk write to Apps Script (batches of 200) ────────────────
    // Falls back to per-row if bulkCreate isn't available (e.g. Apps Script
    // not redeployed yet) — graceful degradation.
    const BATCH_SIZE = 200
    let useBulk = true

    for (let i = 0; i < preparedRows.length; i += BATCH_SIZE) {
      if (cancelRef.current) break
      const batch = preparedRows.slice(i, i + BATCH_SIZE)

      // Optimistically record in local cache (BATCHED — one storage write +
      // one event for the whole batch instead of 200, avoids cascading
      // re-renders that turn the bulk write into per-row speed).
      const ts = new Date().toISOString()
      const withIds = batch.map((row) => ({
        ...row,
        id: (row.id as string) || localId(entity),
        createdAt: (row.createdAt as string) || ts,
      }))
      recordCreateMany(entity, withIds)
      const provisional = withIds

      if (useBulk) {
        try {
          const res = await invokeAction('bulkCreate', { entity, rows: provisional })
          if (res.ok) {
            ok += batch.length
          } else {
            // bulkCreate not available → fall back to per-row from here
            useBulk = false
            failed += batch.length
            // Replay this batch as per-row
            for (const row of provisional) {
              try {
                const r = await apiCreateFor(entity, row as Record<string, unknown>)
                if (r.ok) { ok++; failed-- }
              } catch { /* count stays */ }
            }
          }
        } catch {
          useBulk = false
          for (const row of provisional) {
            try {
              const r = await apiCreateFor(entity, row as Record<string, unknown>)
              if (r.ok) ok++; else failed++
            } catch { failed++ }
          }
        }
      } else {
        // Per-row fallback path
        for (const row of provisional) {
          if (cancelRef.current) break
          try {
            const r = await apiCreateFor(entity, row as Record<string, unknown>)
            if (r.ok) ok++; else failed++
          } catch { failed++ }
        }
      }

      setProgress({
        ok, failed, skipped, total: rows.length, done: false,
        phase: `Writing ${ENTITY_LABELS[entity].toLowerCase()}… ${ok + failed + skipped} / ${rows.length}`,
      })
    }

    setProgress({ ok, failed, skipped, total: rows.length, done: cancelRef.current ? true : true, cancelled: cancelRef.current })
    refresh()
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Import data"
        subtitle="Bring contacts, deals, companies, or tasks in from a CSV — including HubSpot exports."
      />

      {/* Step rail */}
      <div className="flex items-center gap-2 text-[12px] text-muted flex-wrap">
        <StepPill active={step === 'pick'} label="1. Choose + upload" done={step !== 'pick'} />
        <ArrowRight size={12} className="text-[var(--text-faint)]" />
        <StepPill active={step === 'mapping'} label="2. Map columns" done={step === 'commit'} />
        <ArrowRight size={12} className="text-[var(--text-faint)]" />
        <StepPill active={step === 'commit'} label="3. Import" done={!!progress?.done} />
      </div>

      {/* ---------------- Step 1: pick + upload ---------------- */}
      {step === 'pick' && (
        <>
          <Card>
            <CardHeader title="What are you importing?" />
            <div className="flex flex-wrap gap-2">
              {(Object.keys(ENTITY_LABELS) as Entity[]).map((e) => (
                <button
                  key={e}
                  onClick={() => { setEntity(e); reset(); setEntity(e) }}
                  className={cn(
                    'h-9 px-4 text-[13px] rounded-[var(--radius-md)] font-medium transition-colors',
                    entity === e ? 'bg-[var(--color-brand-600)] text-white' : 'surface-2 text-muted hover:text-body',
                  )}
                >
                  {ENTITY_LABELS[e]}
                </button>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Your CSV"
              subtitle={`We'll try to auto-map HubSpot columns to ${ENTITY_LABELS[entity].toLowerCase()}.`}
            />
            <div
              className="border-2 border-dashed border-[var(--border-strong)] rounded-[var(--radius-lg)] p-8 text-center hover:border-[var(--color-brand-500)] transition-colors cursor-pointer"
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                const f = e.dataTransfer.files[0]
                if (f) onFile(f)
              }}
            >
              <Upload size={28} className="mx-auto mb-3 text-[var(--text-faint)]" />
              <div className="text-[13px] font-medium text-body">Drop a CSV here, or click to choose</div>
              <div className="text-[11px] text-muted mt-1">UTF-8, first row is headers. HubSpot exports work.</div>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                hidden
                onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
              />
            </div>
            {error && (
              <div className="mt-4 flex items-start gap-2 p-3 rounded-[var(--radius-md)] bg-[color:rgba(239,76,76,0.08)] text-[var(--color-danger)]">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <div className="text-[12px]">{error}</div>
              </div>
            )}
          </Card>
        </>
      )}

      {/* ---------------- Step 2: mapping ---------------- */}
      {step === 'mapping' && (
        <>
          <Card padded={false}>
            <div className="px-5 py-4 border-soft-b">
              <CardHeader
                title={`Map CSV columns → ${ENTITY_LABELS[entity].toLowerCase()} fields`}
                subtitle={`${rows.length} row${rows.length === 1 ? '' : 's'} detected. Auto-mapping applied — adjust any that look wrong.`}
                action={
                  <Button size="sm" onClick={reset} icon={<X size={12} />}>Start over</Button>
                }
              />
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="surface-2 text-muted text-left">
                  <tr>
                    <th className="px-4 py-2 font-medium">CSV column</th>
                    <th className="px-4 py-2 font-medium">Sample value</th>
                    <th className="px-4 py-2 font-medium w-[260px]">Maps to</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[color:var(--border)]">
                  {sourceColumns.map((col) => (
                    <tr key={col}>
                      <td className="px-4 py-2 font-mono text-[12px]">{col}</td>
                      <td className="px-4 py-2 text-muted truncate max-w-[280px]">
                        {sampleValue(rows, col) || <span className="text-[var(--text-faint)]">(empty)</span>}
                      </td>
                      <td className="px-4 py-2">
                        <Select
                          value={mapping[col] ?? ''}
                          onChange={(e) => setMapping({ ...mapping, [col]: e.target.value })}
                        >
                          <option value="">— ignore —</option>
                          {fields.map((f) => (
                            <option key={f.key} value={f.key}>
                              {f.label}{f.required ? ' *' : ''}
                            </option>
                          ))}
                        </Select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {missingRequired.length > 0 && (
              <div className="px-5 py-3 border-soft-t flex items-start gap-2 text-[12px]">
                <AlertTriangle size={13} className="mt-0.5 shrink-0 text-[var(--color-warning)]" />
                <div>
                  <span className="text-body font-medium">Missing required field{missingRequired.length === 1 ? '' : 's'}:</span>{' '}
                  <span className="text-muted">{missingRequired.map((f) => f.label).join(', ')}</span>. Map them above to continue.
                </div>
              </div>
            )}

            <div className="px-5 py-4 border-soft-t flex items-center justify-between">
              <div className="text-[12px] text-muted">
                {Object.values(mapping).filter(Boolean).length} of {fields.length} fields mapped.
              </div>
              <div className="flex items-center gap-2">
                <Button onClick={() => setStep('pick')} icon={<ArrowLeft size={12} />}>Back</Button>
                <Button
                  variant="primary"
                  onClick={() => setStep('commit')}
                  disabled={missingRequired.length > 0}
                  icon={<ArrowRight size={12} />}
                >
                  Continue to preview
                </Button>
              </div>
            </div>
          </Card>

          {/* Preview of mapped rows */}
          <Card padded={false}>
            <div className="px-5 py-4 border-soft-b">
              <CardHeader title="Preview (first 5 mapped rows)" />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead className="surface-2 text-muted text-left">
                  <tr>
                    {fields
                      .filter((f) => mappedTargets.has(f.key))
                      .map((f) => (
                        <th key={f.key} className="px-4 py-2 font-medium whitespace-nowrap">{f.label}</th>
                      ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[color:var(--border)]">
                  {rows.slice(0, 5).map((row, i) => {
                    const mapped = applyMapping(row, mapping)
                    return (
                      <tr key={i}>
                        {fields
                          .filter((f) => mappedTargets.has(f.key))
                          .map((f) => (
                            <td key={f.key} className="px-4 py-2 whitespace-nowrap max-w-[200px] truncate">
                              {String(mapped[f.key] ?? '')}
                            </td>
                          ))}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {/* ---------------- Step 3: commit ---------------- */}
      {step === 'commit' && (
        <>
          <Card>
            <CardHeader
              title={progress?.done
                ? (progress.cancelled ? 'Import cancelled' : 'Import finished')
                : progress
                ? `Importing… ${progress.ok + progress.failed + progress.skipped} / ${progress.total}`
                : `Ready to import ${rows.length} row${rows.length === 1 ? '' : 's'}`}
              subtitle={
                entity === 'contacts'
                  ? 'Unknown company names will be auto-created. Re-uploads are safe — contacts that already exist (matched by email) are skipped automatically.'
                  : undefined
              }
            />
            {progress && (
              <>
                {progress.phase && !progress.done && (
                  <div className="text-[12px] text-muted mb-2">{progress.phase}</div>
                )}
                <div className="relative h-2 surface-3 rounded-full overflow-hidden mb-3">
                  <div
                    className="absolute inset-y-0 left-0 bg-[var(--color-brand-600)] transition-all"
                    style={{ width: `${((progress.ok + progress.failed) / Math.max(1, progress.total)) * 100}%` }}
                  />
                </div>
                <div className="flex items-center gap-4 text-[12px] flex-wrap">
                  <span className="text-[var(--color-success)] font-medium">✓ {progress.ok} saved</span>
                  {progress.skipped > 0 && (
                    <span className="text-muted font-medium">↺ {progress.skipped} skipped (already exist)</span>
                  )}
                  {progress.failed > 0 && (
                    <span className="text-[var(--color-danger)] font-medium">✗ {progress.failed} failed</span>
                  )}
                  <span className="text-muted">of {progress.total} total</span>
                </div>
                {progress.done && (
                  <div className="mt-4 flex items-start gap-2">
                    {progress.failed === 0 ? (
                      <CheckCircle2 size={16} className="text-[var(--color-success)] mt-0.5 shrink-0" />
                    ) : (
                      <AlertTriangle size={16} className="text-[var(--color-warning)] mt-0.5 shrink-0" />
                    )}
                    <div className="text-[13px] text-body">
                      {progress.cancelled
                        ? 'You cancelled the import. Saved rows are kept.'
                        : progress.failed === 0
                        ? 'All rows imported.'
                        : `${progress.failed} row${progress.failed === 1 ? '' : 's'} had problems (usually missing required fields or duplicate email).`}
                    </div>
                    <Badge tone={progress.failed === 0 && !progress.cancelled ? 'success' : 'warning'}>
                      {progress.cancelled ? 'Stopped' : progress.failed === 0 ? 'Success' : 'Partial'}
                    </Badge>
                  </div>
                )}
              </>
            )}
            <div className="mt-5 flex items-center gap-2">
              {!progress && (
                <>
                  <Button onClick={() => setStep('mapping')} icon={<ArrowLeft size={12} />}>Back to mapping</Button>
                  <Button variant="primary" onClick={commit}>
                    Import {rows.length} row{rows.length === 1 ? '' : 's'}
                  </Button>
                </>
              )}
              {progress && !progress.done && (
                <Button variant="danger" onClick={() => { cancelRef.current = true }}>Cancel import</Button>
              )}
              {progress?.done && (
                <Button onClick={reset}>Import another CSV</Button>
              )}
            </div>
          </Card>
        </>
      )}
    </div>
  )
}

/* ==========================================================================
   Helpers
   ========================================================================== */

function StepPill({ label, active, done }: { label: string; active: boolean; done?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full text-[11px] font-medium',
        active && 'bg-[var(--color-brand-600)] text-white',
        done && !active && 'bg-[color:rgba(48,179,107,0.14)] text-[var(--color-success)]',
        !active && !done && 'surface-2 text-muted',
      )}
    >
      {done && !active && <CheckCircle2 size={11} />}
      {label}
    </span>
  )
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function autoMap(sourceCols: string[], fields: FieldDef[]): Record<string, string> {
  const mapping: Record<string, string> = {}
  const used = new Set<string>()
  for (const col of sourceCols) {
    const norm = normalize(col)
    // Exact alias match first
    let hit = fields.find(
      (f) => !used.has(f.key) && (normalize(f.key) === norm || f.aliases.some((a) => normalize(a) === norm)),
    )
    // Substring fallback
    if (!hit) {
      hit = fields.find(
        (f) => !used.has(f.key) && f.aliases.some((a) => norm.includes(normalize(a)) || normalize(a).includes(norm)),
      )
    }
    if (hit) {
      mapping[col] = hit.key
      used.add(hit.key)
    } else {
      mapping[col] = ''
    }
  }
  return mapping
}

function applyMapping(row: Record<string, string>, mapping: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [src, target] of Object.entries(mapping)) {
    if (!target) continue
    const val = row[src]
    if (val === undefined || val === null || val === '') continue
    // Merge notes: if multiple source columns map to 'notes', join them.
    if (target === 'notes' && out.notes) {
      out.notes = `${out.notes} · ${val}`
    } else {
      out[target] = val
    }
  }
  return out
}

function isEmpty(mapped: Record<string, unknown>, entity: Entity): boolean {
  const required = ENTITY_FIELDS[entity].filter((f) => f.required).map((f) => f.key)
  for (const k of required) {
    if (k === 'companyName') continue // may be resolved away to companyId
    if (!mapped[k] && !mapped['companyId']) return true
  }
  return false
}

async function apiCreateFor(entity: Entity, payload: Record<string, unknown>) {
  if (entity === 'companies') return api.company.create(payload)
  if (entity === 'contacts')  return api.contact.create(payload)
  if (entity === 'deals')     return api.deal.create(payload)
  if (entity === 'tasks')     return api.task.create(payload)
  throw new Error('unknown entity: ' + entity)
}

function sampleValue(rows: Record<string, string>[], col: string): string {
  for (const r of rows) {
    const v = r[col]
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v)
  }
  return ''
}

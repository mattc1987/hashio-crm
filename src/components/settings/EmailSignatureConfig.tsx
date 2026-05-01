// Email signature config. Apps Script's GmailApp.sendEmail() does NOT
// auto-pull the user's Gmail signature — so we manage it ourselves and
// append to every outgoing BDR/sequence email.
//
// Two tiers:
//   1. Custom signature pasted here (Script Properties — wins)
//   2. Auto-pulled from Gmail SendAs settings (Gmail Advanced Service —
//      requires enabling that service in Apps Script)

import { useEffect, useState } from 'react'
import { Mail, Save, Loader2, RefreshCw, Trash2 } from 'lucide-react'
import { Card, CardHeader, Button, Textarea, Badge } from '../ui'
import { invokeAction, hasWriteBackend } from '../../lib/api'

interface SignatureState {
  plain: string
  html: string
  source: 'custom' | 'gmail' | 'none'
}

export function EmailSignatureConfig() {
  const [state, setState] = useState<SignatureState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [draftPlain, setDraftPlain] = useState('')
  const [draftHtml, setDraftHtml] = useState('')
  const [showHtmlEditor, setShowHtmlEditor] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [previewMode, setPreviewMode] = useState<'plain' | 'rendered'>('rendered')

  const refresh = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await invokeAction('getEmailSignature', {})
      if (!res.ok) throw new Error(res.error || 'Failed to load')
      const d = (res as { data?: SignatureState }).data
      if (d) {
        setState(d)
        setDraftPlain(d.plain)
        setDraftHtml(d.html)
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void refresh() }, [])

  const save = async () => {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const res = await invokeAction('setEmailSignature', {
        plain: draftPlain.trim(),
        html: draftHtml.trim() || undefined,
      })
      if (!res.ok) throw new Error(res.error || 'Failed to save')
      const d = (res as { data?: SignatureState }).data
      if (d) setState(d)
      setEditing(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const clear = async () => {
    if (!confirm('Clear your custom signature and fall back to Gmail auto-detect?')) return
    setSaving(true)
    setError(null)
    try {
      const res = await invokeAction('setEmailSignature', { plain: '', html: '' })
      if (!res.ok) throw new Error(res.error || 'Failed to clear')
      const d = (res as { data?: SignatureState }).data
      if (d) {
        setState(d)
        setDraftPlain(d.plain)
        setDraftHtml(d.html)
      }
      setEditing(false)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (!hasWriteBackend()) {
    return (
      <Card>
        <CardHeader title="Email signature" subtitle="Apps Script not configured." />
      </Card>
    )
  }

  const sourceLabel =
    state?.source === 'custom' ? <Badge tone="brand">Custom</Badge> :
    state?.source === 'gmail'  ? <Badge tone="success">Auto-pulled from Gmail</Badge> :
                                 <Badge tone="warning">Not set</Badge>

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Mail size={16} className="text-[var(--color-brand-600)]" />
            Email signature
          </span>
        }
        subtitle="Appended to every email Hashio sends on your behalf (sequences, BDR replies, etc.)"
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

      {loading ? (
        <div className="text-[13px] text-muted py-3 flex items-center gap-2">
          <Loader2 size={14} className="animate-spin" /> Loading current signature…
        </div>
      ) : state ? (
        <>
          {/* Source + status */}
          <div className="flex items-center gap-2 mb-3 text-[12px]">
            <span className="text-muted">Status:</span>
            {sourceLabel}
            {state.source === 'gmail' && (
              <span className="text-[11px] text-[var(--text-faint)]">
                (your Gmail signature is being used — paste a custom one below to override)
              </span>
            )}
            {state.source === 'none' && (
              <span className="text-[11px] text-[var(--color-warning)]">
                Outgoing emails currently have no signature
              </span>
            )}
          </div>

          {!editing ? (
            <>
              {/* Preview */}
              {state.plain || state.html ? (
                <div className="mb-3 surface-2 rounded-[var(--radius-md)] p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-faint)]">
                      Preview
                    </div>
                    <div className="flex items-center gap-1 surface rounded-[var(--radius-sm)] p-0.5 border border-[var(--border)]">
                      <button
                        onClick={() => setPreviewMode('rendered')}
                        className={
                          'px-2 py-0.5 text-[11px] rounded ' +
                          (previewMode === 'rendered' ? 'bg-[var(--surface-2)] text-body' : 'text-muted')
                        }
                      >Rendered</button>
                      <button
                        onClick={() => setPreviewMode('plain')}
                        className={
                          'px-2 py-0.5 text-[11px] rounded ' +
                          (previewMode === 'plain' ? 'bg-[var(--surface-2)] text-body' : 'text-muted')
                        }
                      >Plain text</button>
                    </div>
                  </div>
                  {previewMode === 'rendered' && state.html ? (
                    <div
                      className="text-[13px] text-body"
                      // eslint-disable-next-line react/no-danger
                      dangerouslySetInnerHTML={{ __html: state.html }}
                    />
                  ) : (
                    <pre className="text-[12px] text-body whitespace-pre-wrap font-mono">{state.plain || '(empty)'}</pre>
                  )}
                </div>
              ) : null}

              <div className="flex items-center gap-2">
                <Button onClick={() => { setDraftPlain(state.plain); setDraftHtml(state.html); setEditing(true) }}>
                  {state.source === 'custom' ? 'Edit signature' : 'Set custom signature'}
                </Button>
                {state.source === 'custom' && (
                  <Button variant="ghost" onClick={clear}>
                    <Trash2 size={12} /> Clear (use Gmail's)
                  </Button>
                )}
                {saved && <Badge tone="success">Saved</Badge>}
              </div>

              {state.source === 'none' && (
                <div className="mt-3 p-3 rounded-[var(--radius-md)] surface-2 text-[12px] text-muted">
                  <strong className="text-body">Tip:</strong> Apps Script can auto-pull your Gmail signature if you enable the
                  Gmail Advanced Service in your Apps Script project (Services → + → Gmail API). Otherwise, paste your
                  signature here and we'll append it to every outgoing email.
                </div>
              )}
            </>
          ) : (
            <>
              <label className="block mb-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-faint)] mb-1">
                  Plain-text signature
                </div>
                <Textarea
                  value={draftPlain}
                  onChange={(e) => setDraftPlain(e.target.value)}
                  placeholder={'Matt Campbell\nFounder, Hashio Inc.\nmatt@gohashio.com · gohashio.com\n+1-555-555-5555'}
                  className="min-h-[140px] font-mono text-[12px]"
                />
                <div className="text-[11px] text-[var(--text-faint)] mt-1">
                  This shows in plain-text email clients. We'll auto-render this as basic HTML if you don't supply your own below.
                </div>
              </label>

              <button
                onClick={() => setShowHtmlEditor((s) => !s)}
                className="text-[12px] text-[var(--color-brand-600)] hover:underline mb-2"
              >
                {showHtmlEditor ? 'Hide HTML editor' : 'Use custom HTML signature instead (advanced)'}
              </button>

              {showHtmlEditor && (
                <label className="block mb-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-faint)] mb-1">
                    HTML signature (optional)
                  </div>
                  <Textarea
                    value={draftHtml}
                    onChange={(e) => setDraftHtml(e.target.value)}
                    placeholder={'<p style="font-family:Arial;font-size:13px;color:#333">\n  <strong>Matt Campbell</strong><br>\n  Founder, Hashio Inc.<br>\n  <a href="mailto:matt@gohashio.com">matt@gohashio.com</a>\n</p>'}
                    className="min-h-[140px] font-mono text-[11px]"
                  />
                  <div className="text-[11px] text-[var(--text-faint)] mt-1">
                    Paste your existing Gmail HTML signature here. Tip: in Gmail → Settings → Signature, switch to source view to copy the HTML.
                  </div>
                </label>
              )}

              <div className="flex items-center gap-2 pt-2 border-t border-[var(--border)]">
                <Button onClick={save} variant="primary" disabled={saving || (!draftPlain.trim() && !draftHtml.trim())}>
                  {saving ? <><Loader2 size={14} className="animate-spin" /> Saving…</> : <><Save size={14} /> Save signature</>}
                </Button>
                <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
              </div>
            </>
          )}
        </>
      ) : null}
    </Card>
  )
}

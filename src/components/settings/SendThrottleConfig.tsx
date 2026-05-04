// Send throttle / stagger config. Caps how many SEND steps fire per
// scheduler tick + how long to defer the overflow. Stops the engine
// from blasting 30 emails simultaneously when 30 prospects are
// enrolled at once — Gmail and prospect inboxes flag that pattern as
// spam-bot behavior.
//
// Storage: Apps Script Script Properties (MAX_SENDS_PER_TICK,
// STAGGER_DEFER_MIN_MIN, STAGGER_DEFER_MAX_MIN). Read on every
// scheduler tick — no redeploy needed when changed.

import { useEffect, useState } from 'react'
import { Gauge, Save, Loader2, RefreshCw, AlertTriangle } from 'lucide-react'
import { Card, CardHeader, Button, Input, Badge } from '../ui'
import { invokeAction, hasWriteBackend } from '../../lib/api'

interface ThrottleStatus {
  maxSendsPerTick: number
  staggerMinMin: number
  staggerMaxMin: number
}

const DEFAULTS: ThrottleStatus = {
  maxSendsPerTick: 5,
  staggerMinMin: 5,
  staggerMaxMin: 25,
}

export function SendThrottleConfig() {
  const [config, setConfig] = useState<ThrottleStatus>(DEFAULTS)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [dirty, setDirty] = useState(false)

  const refresh = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await invokeAction('getSendThrottleConfig', {})
      if (!res.ok) throw new Error(res.error || 'Failed to load')
      const d = (res as { data?: ThrottleStatus }).data
      if (d) {
        setConfig({
          maxSendsPerTick: Number(d.maxSendsPerTick) || DEFAULTS.maxSendsPerTick,
          staggerMinMin: Number(d.staggerMinMin) || DEFAULTS.staggerMinMin,
          staggerMaxMin: Number(d.staggerMaxMin) || DEFAULTS.staggerMaxMin,
        })
      }
      setDirty(false)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void refresh() }, [])

  const update = (patch: Partial<ThrottleStatus>) => {
    setConfig({ ...config, ...patch })
    setDirty(true)
    setSaved(false)
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const res = await invokeAction('setSendThrottleConfig', { config })
      if (!res.ok) throw new Error(res.error || 'Failed to save')
      setDirty(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (!hasWriteBackend()) {
    return (
      <Card>
        <CardHeader title="Send throttle / stagger" subtitle="Apps Script not configured." />
      </Card>
    )
  }

  // Estimate: how long a 30-person batch takes to drain at current settings
  const estimatedDrainMin = Math.max(
    0,
    Math.ceil((30 - config.maxSendsPerTick) / Math.max(1, config.maxSendsPerTick)) * 5,
  ) // every scheduler tick is 5 min

  // Sanity warnings
  const warnHighRate = config.maxSendsPerTick > 10
  const warnInverted = config.staggerMinMin >= config.staggerMaxMin

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Gauge size={16} className="text-[var(--color-brand-600)]" />
            Send throttle / stagger
          </span>
        }
        subtitle="Caps how fast outbound emails fire. Prevents Gmail spam-flagging when many prospects are enrolled at once."
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

      <div className="mb-4 p-3 rounded-[var(--radius-md)] surface-2 text-[12px]">
        <strong className="text-body">How throttling works:</strong>
        <ol className="list-decimal pl-5 mt-1 text-muted space-y-0.5">
          <li>The scheduler runs every 5 min and looks at all enrollments due to fire.</li>
          <li>If more than <strong>{config.maxSendsPerTick}</strong> of them are about to send an email/SMS, the first {config.maxSendsPerTick} fire and the rest get deferred.</li>
          <li>Each deferred enrollment gets a random offset between <strong>{config.staggerMinMin}–{config.staggerMaxMin} min</strong> from now — so they trickle out, not bunch at the next tick.</li>
        </ol>
      </div>

      {loading ? (
        <div className="text-[13px] text-muted py-3 flex items-center gap-2">
          <Loader2 size={14} className="animate-spin" /> Loading…
        </div>
      ) : (
        <>
          <div className="space-y-4">
            <div>
              <div className="text-[13px] font-medium text-body mb-1">Max sends per tick</div>
              <div className="text-[11px] text-muted mb-2">
                The scheduler runs every 5 min. With this set to <strong>{config.maxSendsPerTick}</strong>,
                that's at most <strong>{config.maxSendsPerTick * 12}/hour</strong> = <strong>{config.maxSendsPerTick * 60} per 5-hour window</strong> across the whole CRM.
              </div>
              <Input
                type="number"
                min={1}
                max={50}
                value={config.maxSendsPerTick}
                onChange={(e) => update({ maxSendsPerTick: Math.max(1, Math.min(50, Number(e.target.value) || 1)) })}
                className="max-w-[120px]"
              />
              {warnHighRate && (
                <div className="text-[11px] text-[var(--color-warning)] mt-1 flex items-center gap-1">
                  <AlertTriangle size={11} /> Above 10/tick (= 120/hr) increases spam-flag risk. Recommended: 3–8.
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-[13px] font-medium text-body mb-1">Stagger min (min)</div>
                <div className="text-[11px] text-muted mb-2">Earliest a deferred send can re-fire</div>
                <Input
                  type="number"
                  min={1}
                  max={120}
                  value={config.staggerMinMin}
                  onChange={(e) => update({ staggerMinMin: Math.max(1, Math.min(120, Number(e.target.value) || 1)) })}
                />
              </div>
              <div>
                <div className="text-[13px] font-medium text-body mb-1">Stagger max (min)</div>
                <div className="text-[11px] text-muted mb-2">Latest a deferred send can re-fire</div>
                <Input
                  type="number"
                  min={2}
                  max={240}
                  value={config.staggerMaxMin}
                  onChange={(e) => update({ staggerMaxMin: Math.max(2, Math.min(240, Number(e.target.value) || 2)) })}
                />
              </div>
            </div>
            {warnInverted && (
              <div className="text-[11px] text-[var(--color-warning)] flex items-center gap-1">
                <AlertTriangle size={11} /> Min should be less than Max.
              </div>
            )}

            <div className="p-3 rounded-[var(--radius-md)] bg-[color:rgba(122,94,255,0.06)] border border-[color:rgba(122,94,255,0.18)] text-[12px]">
              <strong className="text-body">Estimate at current settings:</strong>
              <div className="text-muted mt-1">
                A 30-person batch enrolled all at once will drain over roughly <strong>{estimatedDrainMin} min</strong> ({config.maxSendsPerTick} fire immediately,
                ~{Math.ceil((30 - config.maxSendsPerTick) / config.maxSendsPerTick)} more ticks of {config.maxSendsPerTick} each, with random spacing so it looks human).
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 mt-4 pt-3 border-t border-[var(--border)]">
            <Button onClick={save} variant="primary" disabled={saving || !dirty || warnInverted}>
              {saving ? <><Loader2 size={14} className="animate-spin" /> Saving…</> : <><Save size={14} /> Save settings</>}
            </Button>
            {saved && <Badge tone="success">Saved</Badge>}
            {dirty && !saving && !saved && <span className="text-[12px] text-muted">Unsaved changes</span>}
          </div>
        </>
      )}
    </Card>
  )
}

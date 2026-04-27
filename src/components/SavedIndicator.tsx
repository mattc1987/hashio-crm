// Tiny component that shows "Saved · just now" / "Saving…" alongside an
// auto-saving editor. Drop it next to a page title.
//
// Usage:
//   <SavedIndicator value={someStateThatChangesOnSave} />
//
// Pass it any value that changes when a save happens (e.g. updatedAt
// timestamp, or a JSON-stringified record). When it changes, we flash
// "Saving…" briefly then settle to "Saved · 3s ago" with relative time.

import { useEffect, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import { cn } from '../lib/cn'

export function SavedIndicator({ value, className }: { value: unknown; className?: string }) {
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [pulse, setPulse] = useState(false)
  const firstRender = useRef(true)
  const lastValue = useRef(value)

  // Track changes to `value` — every change = a fresh save.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      lastValue.current = value
      setSavedAt(Date.now())
      return
    }
    if (lastValue.current !== value) {
      lastValue.current = value
      setSavedAt(Date.now())
      setPulse(true)
      const id = setTimeout(() => setPulse(false), 400)
      return () => clearTimeout(id)
    }
  }, [value])

  // Force a re-render every 30s so the relative time updates.
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick((t) => t + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  if (savedAt === null) return null
  const ago = Math.max(0, Math.floor((Date.now() - savedAt) / 1000))
  const label =
    ago < 3 ? 'just now'
    : ago < 60 ? `${ago}s ago`
    : ago < 3600 ? `${Math.floor(ago / 60)}m ago`
    : `${Math.floor(ago / 3600)}h ago`

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 text-[11px] text-muted',
        'transition-opacity',
        className,
      )}
      title="Changes save automatically — no Save button needed."
    >
      <span
        className={cn(
          'w-4 h-4 rounded-full grid place-items-center transition-all',
          pulse
            ? 'bg-[var(--color-brand-500)] text-white scale-110'
            : 'bg-[color:rgba(48,179,107,0.15)] text-[var(--color-success)]',
        )}
      >
        <Check size={10} strokeWidth={3} />
      </span>
      <span>{pulse ? 'Saving…' : `Saved · ${label}`}</span>
    </div>
  )
}

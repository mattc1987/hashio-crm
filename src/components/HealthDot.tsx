import { cn } from '../lib/cn'
import type { HealthTier } from '../lib/clientHealth'

const TIERS: Record<HealthTier, { color: string; label: string }> = {
  green:    { color: 'bg-[var(--color-success)]', label: 'Healthy' },
  yellow:   { color: 'bg-[var(--color-warning)]', label: 'Watch'   },
  red:      { color: 'bg-[var(--color-danger)]',  label: 'At risk' },
  inactive: { color: 'bg-[var(--text-faint)]',    label: 'Inactive' },
}

export function HealthDot({
  tier,
  reason,
  size = 8,
  showLabel = false,
}: {
  tier: HealthTier
  reason?: string
  size?: number
  showLabel?: boolean
}) {
  const meta = TIERS[tier]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5',
        showLabel ? 'text-[11px] text-muted' : '',
      )}
      title={reason ? `${meta.label} — ${reason}` : meta.label}
    >
      <span
        className={cn('rounded-full shrink-0', meta.color)}
        style={{ width: size, height: size }}
      />
      {showLabel && <span>{meta.label}</span>}
    </span>
  )
}

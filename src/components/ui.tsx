import { type ReactNode, type ButtonHTMLAttributes, type InputHTMLAttributes, type HTMLAttributes, forwardRef } from 'react'
import { cn } from '../lib/cn'
import { initials } from '../lib/format'

/* -------------------------------------------------------------------------- */
/*  Card                                                                      */
/* -------------------------------------------------------------------------- */

export function Card({
  className,
  children,
  padded = true,
  interactive = false,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { padded?: boolean; interactive?: boolean }) {
  return (
    <div
      className={cn(
        'surface border-soft shadow-soft-sm',
        'rounded-[var(--radius-lg)]',
        interactive && 'transition-all hover:shadow-soft-md hover:-translate-y-[1px] cursor-pointer',
        padded && 'p-5',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  )
}

export function CardHeader({ title, subtitle, action, className }: {
  title: ReactNode
  subtitle?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-start justify-between gap-4 mb-4', className)}>
      <div className="min-w-0">
        <div className="font-display text-[15px] font-semibold text-body truncate">{title}</div>
        {subtitle && <div className="text-muted text-[13px] mt-0.5">{subtitle}</div>}
      </div>
      {action}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  Button                                                                    */
/* -------------------------------------------------------------------------- */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
type ButtonSize = 'sm' | 'md' | 'lg'

const btnVariants: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--color-brand-600)] text-white hover:bg-[var(--color-brand-700)] active:bg-[var(--color-brand-800)] shadow-soft-sm',
  secondary:
    'surface border-soft text-body hover:surface-2 active:surface-3 shadow-soft-xs',
  ghost:
    'bg-transparent text-body hover:surface-2 active:surface-3',
  danger:
    'bg-[var(--color-danger)] text-white hover:brightness-95 active:brightness-90 shadow-soft-sm',
}
const btnSizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[12px] rounded-[var(--radius-sm)] gap-1.5',
  md: 'h-9 px-4 text-[13px] rounded-[var(--radius-md)] gap-2',
  lg: 'h-11 px-5 text-[14px] rounded-[var(--radius-lg)] gap-2',
}

export const Button = forwardRef<HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize; icon?: ReactNode }
>(function Button(
  { className, variant = 'secondary', size = 'md', icon, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center font-medium transition-all',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]',
        'disabled:opacity-50 disabled:pointer-events-none',
        'whitespace-nowrap select-none',
        btnVariants[variant],
        btnSizes[size],
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  )
})

/* -------------------------------------------------------------------------- */
/*  Input                                                                     */
/* -------------------------------------------------------------------------- */

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          'surface border-soft',
          'h-9 px-3 text-[13px] rounded-[var(--radius-md)] w-full',
          'text-body placeholder:text-[var(--text-faint)]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:border-transparent',
          'transition-colors',
          className,
        )}
        {...rest}
      />
    )
  },
)

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...rest }, ref) {
    return (
      <textarea
        ref={ref}
        className={cn(
          'surface border-soft',
          'px-3 py-2 text-[13px] rounded-[var(--radius-md)] w-full',
          'text-body placeholder:text-[var(--text-faint)]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:border-transparent',
          'transition-colors resize-y min-h-[80px]',
          className,
        )}
        {...rest}
      />
    )
  },
)

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...rest }, ref) {
    return (
      <select
        ref={ref}
        className={cn(
          'surface border-soft',
          'h-9 pl-3 pr-8 text-[13px] rounded-[var(--radius-md)] w-full',
          'text-body',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
          'appearance-none bg-[url("data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20width=%2710%27%20height=%276%27%20viewBox=%270%200%2010%206%27%20fill=%27none%27%3E%3Cpath%20d=%27M1%201l4%204%204-4%27%20stroke=%27%239a9aa3%27%20stroke-width=%271.5%27%20stroke-linecap=%27round%27%20stroke-linejoin=%27round%27/%3E%3C/svg%3E")] bg-no-repeat bg-[position:calc(100%-10px)_center]',
          className,
        )}
        {...rest}
      >
        {children}
      </select>
    )
  },
)

/* -------------------------------------------------------------------------- */
/*  Badge                                                                     */
/* -------------------------------------------------------------------------- */

type BadgeTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info'

const badgeTones: Record<BadgeTone, string> = {
  neutral: 'bg-[var(--surface-3)] text-[var(--text-muted)]',
  brand:   'bg-[var(--color-brand-100)] text-[var(--color-brand-800)] dark:bg-[color:rgba(150,128,255,0.15)] dark:text-[var(--color-brand-300)]',
  success: 'bg-[color:rgba(48,179,107,0.12)] text-[var(--color-success)]',
  warning: 'bg-[color:rgba(245,165,36,0.14)] text-[var(--color-warning)]',
  danger:  'bg-[color:rgba(239,76,76,0.12)] text-[var(--color-danger)]',
  info:    'bg-[color:rgba(59,130,246,0.12)] text-[var(--color-info)]',
}

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode
  tone?: BadgeTone
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5',
        'text-[11px] font-medium rounded-[var(--radius-sm)]',
        'whitespace-nowrap',
        badgeTones[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

/* -------------------------------------------------------------------------- */
/*  Stat                                                                      */
/* -------------------------------------------------------------------------- */

export function Stat({
  label,
  value,
  delta,
  deltaTone,
  hint,
  className,
}: {
  label: string
  value: ReactNode
  delta?: string
  deltaTone?: 'success' | 'danger' | 'neutral'
  hint?: string
  className?: string
}) {
  return (
    <Card className={cn('flex flex-col gap-1', className)}>
      <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--text-faint)]">
        {label}
      </div>
      <div className="font-display text-[28px] font-semibold tabular text-body leading-tight mt-1">
        {value}
      </div>
      {(delta || hint) && (
        <div className="flex items-center gap-2 mt-0.5">
          {delta && (
            <span
              className={cn(
                'text-[12px] font-medium tabular',
                deltaTone === 'success' && 'text-[var(--color-success)]',
                deltaTone === 'danger' && 'text-[var(--color-danger)]',
                (!deltaTone || deltaTone === 'neutral') && 'text-muted',
              )}
            >
              {delta}
            </span>
          )}
          {hint && <span className="text-[12px] text-muted">{hint}</span>}
        </div>
      )}
    </Card>
  )
}

/* -------------------------------------------------------------------------- */
/*  Avatar                                                                    */
/* -------------------------------------------------------------------------- */

export function Avatar({
  firstName,
  lastName,
  name,
  size = 32,
  className,
}: {
  firstName?: string
  lastName?: string
  name?: string
  size?: number
  className?: string
}) {
  const text = initials(firstName, lastName, name)
  return (
    <div
      className={cn(
        'inline-flex items-center justify-center font-semibold text-[11px]',
        'bg-[color:rgba(122,94,255,0.14)] text-[var(--color-brand-700)]',
        'dark:bg-[color:rgba(150,128,255,0.2)] dark:text-[var(--color-brand-300)]',
        'rounded-full shrink-0 select-none',
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.36) }}
    >
      {text}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  Skeleton                                                                  */
/* -------------------------------------------------------------------------- */

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'relative overflow-hidden surface-3 rounded-[var(--radius-sm)]',
        className,
      )}
    >
      <div className="absolute inset-0 animate-[shimmer_1.6s_infinite] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
      <style>{`@keyframes shimmer {0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}`}</style>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  Empty state                                                               */
/* -------------------------------------------------------------------------- */

export function Empty({
  title,
  description,
  action,
  icon,
}: {
  title: string
  description?: string
  action?: ReactNode
  icon?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6">
      {icon && (
        <div className="mb-4 w-12 h-12 rounded-full surface-2 flex items-center justify-center text-[var(--text-faint)]">
          {icon}
        </div>
      )}
      <div className="font-display font-semibold text-[15px] text-body">{title}</div>
      {description && <div className="text-muted text-[13px] mt-1 max-w-sm">{description}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  Section header                                                            */
/* -------------------------------------------------------------------------- */

export function SectionLabel({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-faint)] mb-3',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: ReactNode
  subtitle?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-4 mb-6">
      <div>
        <h1 className="font-display text-[22px] font-semibold text-body tracking-tight leading-tight">
          {title}
        </h1>
        {subtitle && <div className="text-muted text-[13px] mt-1">{subtitle}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

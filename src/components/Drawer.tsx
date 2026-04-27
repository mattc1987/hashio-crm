import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '../lib/cn'

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = 480,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  subtitle?: ReactNode
  children: ReactNode
  footer?: ReactNode
  width?: number
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="absolute inset-0 bg-black/40 animate-fade-in"
        onClick={onClose}
        aria-hidden
      />
      <div
        className={cn(
          'relative h-full bg-[var(--bg-elev)] border-soft-l shadow-soft-xl flex flex-col',
          'animate-fade-in',
        )}
        style={{ width: `min(${width}px, 100vw)` }}
        role="dialog"
        aria-modal="true"
      >
        <header className="flex items-start justify-between gap-3 px-5 py-4 border-soft-b">
          <div className="min-w-0">
            <div className="font-display font-semibold text-[15px] text-body">{title}</div>
            {subtitle && <div className="text-[12px] text-muted mt-0.5">{subtitle}</div>}
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 grid place-items-center rounded-[var(--radius-sm)] text-muted hover:text-body hover:surface-2"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <footer className="px-5 py-3 border-soft-t flex items-center justify-end gap-2 bg-[var(--surface)]">
            {footer}
          </footer>
        )}
      </div>
    </div>
  )
}

/** A simple form field wrapper used inside Drawers. */
export function Field({
  label,
  hint,
  children,
  required,
}: {
  label: string
  hint?: string
  children: ReactNode
  required?: boolean
}) {
  return (
    <label className="flex flex-col gap-1.5 mb-4">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
        {label}
        {required && <span className="text-[var(--color-danger)] ml-0.5">*</span>}
      </span>
      {children}
      {hint && <span className="text-[11px] text-muted">{hint}</span>}
    </label>
  )
}

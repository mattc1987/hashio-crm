import { useLocation } from 'react-router-dom'
import { Menu, RefreshCw, Search, Sun, Moon, Monitor } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cn } from '../lib/cn'
import { getThemePref, setThemePref, type ThemePref } from '../lib/theme'
import { NAV, NAV_OUTREACH, NAV_SECONDARY } from './Sidebar'

function pageLabel(path: string): string {
  const all = [...NAV, ...NAV_OUTREACH, ...NAV_SECONDARY]
  const exact = all.find((n) => n.to === path)
  if (exact) return exact.label
  const prefix = all.find((n) => n.to !== '/' && path.startsWith(n.to))
  return prefix?.label || 'Hashio CRM'
}

export function TopBar({
  onMenuClick,
  onRefresh,
  refreshing,
}: {
  onMenuClick: () => void
  onRefresh: () => void
  refreshing: boolean
}) {
  const { pathname } = useLocation()
  const label = pageLabel(pathname)

  return (
    <header
      className={cn(
        'sticky top-0 z-20',
        'bg-glass border-soft-b',
        'h-14 flex items-center gap-3 px-4 lg:px-6',
      )}
    >
      <button
        onClick={onMenuClick}
        className="lg:hidden surface border-soft rounded-[var(--radius-md)] w-9 h-9 grid place-items-center text-muted hover:text-body"
        aria-label="Open menu"
      >
        <Menu size={18} />
      </button>

      <div className="min-w-0 flex-1 flex items-baseline gap-2">
        <div className="font-display font-semibold text-[15px] text-body truncate">{label}</div>
      </div>

      <div className="hidden md:block relative max-w-sm flex-1">
        <Search
          size={14}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)] pointer-events-none"
        />
        <input
          type="search"
          placeholder="Search…"
          className={cn(
            'surface border-soft w-full h-9 pl-9 pr-3 text-[13px] rounded-[var(--radius-md)]',
            'text-body placeholder:text-[var(--text-faint)]',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
          )}
        />
      </div>

      <ThemeToggle />

      <button
        onClick={onRefresh}
        className={cn(
          'surface border-soft rounded-[var(--radius-md)] w-9 h-9 grid place-items-center text-muted hover:text-body transition-colors',
          refreshing && 'pointer-events-none opacity-70',
        )}
        aria-label="Refresh data"
        title="Refresh"
      >
        <RefreshCw size={15} className={cn(refreshing && 'animate-spin')} />
      </button>
    </header>
  )
}

function ThemeToggle() {
  const [pref, setPref] = useState<ThemePref>('system')

  useEffect(() => setPref(getThemePref()), [])

  const cycle = () => {
    const next: ThemePref = pref === 'system' ? 'light' : pref === 'light' ? 'dark' : 'system'
    setPref(next)
    setThemePref(next)
  }

  const Icon = pref === 'light' ? Sun : pref === 'dark' ? Moon : Monitor

  return (
    <button
      onClick={cycle}
      className="surface border-soft rounded-[var(--radius-md)] w-9 h-9 grid place-items-center text-muted hover:text-body transition-colors"
      aria-label={`Theme: ${pref}`}
      title={`Theme: ${pref}`}
    >
      <Icon size={15} />
    </button>
  )
}

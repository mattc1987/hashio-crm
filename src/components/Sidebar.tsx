import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  Briefcase,
  Building2,
  Users,
  CheckSquare,
  Upload,
  Settings,
  TrendingUp,
  Zap,
  FileText,
  Send,
  Calendar,
} from 'lucide-react'
import { cn } from '../lib/cn'

export interface NavEntry {
  to: string
  label: string
  icon: React.ComponentType<{ size?: number; className?: string; strokeWidth?: number }>
  end?: boolean
}

export const NAV: NavEntry[] = [
  { to: '/',          label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/deals',     label: 'Deals',     icon: Briefcase },
  { to: '/companies', label: 'Companies', icon: Building2 },
  { to: '/contacts',  label: 'Contacts',  icon: Users },
  { to: '/tasks',     label: 'Tasks',     icon: CheckSquare },
]

export const NAV_OUTREACH: NavEntry[] = [
  { to: '/sequences',  label: 'Sequences',  icon: Zap },
  { to: '/templates',  label: 'Templates',  icon: FileText },
  { to: '/scheduling', label: 'Scheduling', icon: Calendar },
  { to: '/engagement', label: 'Engagement', icon: Send },
]

export const NAV_SECONDARY: NavEntry[] = [
  { to: '/exec',     label: 'Exec Updates', icon: TrendingUp },
  { to: '/import',   label: 'Import',       icon: Upload },
  { to: '/settings', label: 'Settings',     icon: Settings },
]

function NavItem({ entry, onNavigate }: { entry: NavEntry; onNavigate?: () => void }) {
  const Icon = entry.icon
  return (
    <NavLink
      to={entry.to}
      end={entry.end}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 px-3 py-2 rounded-[var(--radius-md)]',
          'text-[13px] font-medium transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
          isActive
            ? 'bg-[color:rgba(122,94,255,0.12)] text-[var(--color-brand-700)] dark:bg-[color:rgba(150,128,255,0.15)] dark:text-[var(--color-brand-300)]'
            : 'text-muted hover:text-body hover:surface-2',
        )
      }
    >
      <Icon size={16} strokeWidth={2} className="shrink-0" />
      <span className="truncate">{entry.label}</span>
    </NavLink>
  )
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <aside
      className={cn(
        'flex flex-col h-full w-full',
        'bg-glass border-soft-r',
      )}
    >
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-5 h-14 border-soft-b shrink-0">
        <div
          className="w-7 h-7 rounded-[8px] grid place-items-center text-white font-bold text-[14px]"
          style={{
            background:
              'linear-gradient(135deg, var(--color-brand-400), var(--color-brand-700))',
          }}
        >
          H
        </div>
        <div className="min-w-0">
          <div className="font-display font-semibold text-[13px] text-body leading-none">
            Hashio CRM
          </div>
          <div className="text-[10px] font-mono text-[var(--text-faint)] mt-0.5 leading-none tracking-wider">
            v0.1 · internal
          </div>
        </div>
      </div>

      {/* Primary nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <div className="flex flex-col gap-0.5">
          {NAV.map((n) => (
            <NavItem key={n.to} entry={n} onNavigate={onNavigate} />
          ))}
        </div>

        <div className="mt-6 mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-faint)]">
          Outreach
        </div>
        <div className="flex flex-col gap-0.5">
          {NAV_OUTREACH.map((n) => (
            <NavItem key={n.to} entry={n} onNavigate={onNavigate} />
          ))}
        </div>

        <div className="mt-6 mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-faint)]">
          Workspace
        </div>
        <div className="flex flex-col gap-0.5">
          {NAV_SECONDARY.map((n) => (
            <NavItem key={n.to} entry={n} onNavigate={onNavigate} />
          ))}
        </div>
      </nav>

      {/* Footer */}
      <div className="px-5 py-3 border-soft-t text-[11px] text-muted">
        <div className="truncate">Signed in as <span className="text-body font-medium">Matt</span></div>
        <div className="text-[var(--text-faint)] mt-0.5 truncate">owner · hashio.co</div>
      </div>
    </aside>
  )
}

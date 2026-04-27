import { useEffect, useState, useCallback } from 'react'
import { Outlet, useLocation, Link } from 'react-router-dom'
import { CloudOff } from 'lucide-react'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { CommandPalette } from './CommandPalette'
import { useSheet } from '../lib/useSheet'
import { SheetDataContext } from '../lib/sheet-context'
import { hasWriteBackend } from '../lib/api'
import { onLocalChange, pendingCount } from '../lib/localCache'

export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const { state, refresh } = useSheet()
  const location = useLocation()
  const [pending, setPending] = useState(() => pendingCount().total)
  const offline = !hasWriteBackend()

  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [mobileOpen])

  useEffect(() => {
    return onLocalChange(() => setPending(pendingCount().total))
  }, [])

  const closeDrawer = useCallback(() => setMobileOpen(false), [])

  return (
    <SheetDataContext.Provider value={{ state, refresh }}>
      <CommandPalette />
      <div className="min-h-screen bg-app text-body">
        {/* Desktop sidebar (fixed) */}
        <div
          className="hidden lg:block fixed inset-y-0 left-0 w-[240px] z-30"
        >
          <Sidebar />
        </div>

        {/* Mobile drawer */}
        {mobileOpen && (
          <>
            <div
              className="lg:hidden fixed inset-0 bg-black/40 z-40 animate-fade-in"
              onClick={closeDrawer}
              aria-hidden
            />
            <div className="lg:hidden fixed inset-y-0 left-0 w-[260px] z-50 animate-fade-in">
              <Sidebar onNavigate={closeDrawer} />
            </div>
          </>
        )}

        {/* Main column */}
        <div className="lg:pl-[240px] min-h-screen flex flex-col">
          <TopBar
            onMenuClick={() => setMobileOpen(true)}
            onRefresh={refresh}
            refreshing={state.status === 'loading'}
          />
          {offline && pending > 0 && (
            <div className="px-4 lg:px-8 py-2 text-[12px] flex items-center gap-2 bg-[color:rgba(245,165,36,0.1)] border-soft-b">
              <CloudOff size={13} className="text-[var(--color-warning)] shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="text-body font-medium">Working offline.</span>{' '}
                <span className="text-muted">
                  {pending} change{pending === 1 ? '' : 's'} saved only in this browser.{' '}
                  <Link to="/settings" className="text-[var(--color-brand-600)] hover:text-[var(--color-brand-700)] font-medium">
                    Activate backend
                  </Link>{' '}
                  to sync.
                </span>
              </div>
            </div>
          )}
          <main className="flex-1 px-4 lg:px-8 py-6 max-w-[1400px] w-full mx-auto">
            <Outlet />
          </main>
          <footer className="px-4 lg:px-8 py-4 border-soft-t text-[11px] text-[var(--text-faint)] font-mono flex items-center justify-between">
            <div>
              {state.status === 'ready' && `synced · ${new Date(state.data.fetchedAt).toLocaleTimeString()}`}
              {state.status === 'loading' && 'loading…'}
              {state.status === 'error' && `error · ${state.error}`}
              {state.status === 'idle' && 'idle'}
            </div>
            <div className="hidden sm:block">hashio crm · v0.1</div>
          </footer>
        </div>
      </div>
    </SheetDataContext.Provider>
  )
}

import { Link } from 'react-router-dom'
import {
  CircleDollarSign,
  AlertCircle,
  Sparkles,
  ArrowRight,
} from 'lucide-react'
import { useSheetData } from '../lib/sheet-context'
import { Card, CardHeader, Stat, Badge, PageHeader, Empty, Skeleton, Avatar } from '../components/ui'
import { currency, num, date, totalActiveMRR, activeMRRByCompany, formatPeriod, parsePeriod, isActiveMRR } from '../lib/format'
import type { Deal, Task, ExecUpdate, Company, Cashflow } from '../lib/types'
import { cn } from '../lib/cn'
import { TodayWidget } from '../components/dashboard/TodayWidget'
import { LineChart } from '../components/charts/LineChart'
import { HealthDot } from '../components/HealthDot'
import { computeClientHealth } from '../lib/clientHealth'

export function Dashboard() {
  const { state } = useSheetData()

  if (state.status === 'loading' && !('data' in state && state.data)) {
    return <DashboardSkeleton />
  }
  if (state.status === 'error' && !('data' in state && state.data)) {
    return (
      <div>
        <PageHeader title="Dashboard" />
        <Card>
          <Empty
            icon={<AlertCircle size={22} />}
            title="Couldn't reach the Sheet"
            description={state.error}
          />
        </Card>
      </div>
    )
  }

  const data = 'data' in state && state.data
  if (!data) return <DashboardSkeleton />

  const { companies, contacts, deals, tasks, execUpdates, cashflow, bookings, emailSends, activity } = data

  const activeMRR = totalActiveMRR(deals)
  const activeClients = countActiveClients(companies, deals)
  const openDealsValue = deals
    .filter((d) => !d.stage.toLowerCase().startsWith('closed'))
    .reduce((s, d) => s + (d.value || 0), 0)
  const latestExec = [...execUpdates].sort((a, b) => b.period.localeCompare(a.period))[0]
  const mrrDelta = latestExec ? (latestExec.savedMRR || 0) - (latestExec.prevMRR || 0) : 0
  const mrrDeltaPct = latestExec && latestExec.prevMRR
    ? (mrrDelta / latestExec.prevMRR) * 100
    : 0

  const nowPeriod = new Date().toISOString().slice(0, 7).replace('-', '_')
  const currentExpense = cashflow.find((c) => c.period === nowPeriod)?.expenses || 0
  const profit = activeMRR - currentExpense

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Dashboard"
        subtitle="Your Hashio business at a glance."
      />

      {/* Today widget */}
      <TodayWidget
        bookings={bookings}
        tasks={tasks}
        emailSends={emailSends}
        contacts={contacts}
      />

      {/* Stat strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Stat
          label="Current MRR"
          value={currency(activeMRR, { compact: activeMRR >= 100000 })}
          delta={
            latestExec
              ? `${mrrDelta >= 0 ? '▲' : '▼'} ${currency(Math.abs(mrrDelta), { compact: true })} (${mrrDeltaPct.toFixed(1)}%)`
              : undefined
          }
          deltaTone={mrrDelta > 0 ? 'success' : mrrDelta < 0 ? 'danger' : 'neutral'}
          hint={latestExec ? `vs. ${formatPeriod(latestExec.period, 'MMM yyyy')}` : undefined}
        />
        <Stat
          label="Active Clients"
          value={num(activeClients)}
          hint={`of ${num(companies.length)} total`}
        />
        <Stat
          label="Open Pipeline"
          value={currency(openDealsValue, { compact: openDealsValue >= 100000 })}
          hint={`${num(deals.filter((d) => !d.stage.toLowerCase().startsWith('closed')).length)} open deals`}
        />
        <Stat
          label="Monthly Profit"
          value={currency(profit, { compact: Math.abs(profit) >= 100000 })}
          deltaTone={profit >= 0 ? 'success' : 'danger'}
          hint={`${currency(activeMRR)} − ${currency(currentExpense)} expenses`}
        />
      </div>

      {/* MRR trend chart */}
      <MRRTrend execUpdates={execUpdates} cashflow={cashflow} currentMRR={activeMRR} />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <PipelineSnapshot deals={deals} />
        <UpcomingTasks tasks={tasks} deals={deals} contacts={contacts} />
      </div>

      <TopClientsByMRR
        companies={companies}
        deals={deals}
        contacts={contacts}
        tasks={tasks}
        activity={activity}
        emailSends={emailSends}
        bookings={bookings}
      />

      {latestExec && <LatestExecUpdate exec={latestExec} />}
    </div>
  )
}

/* ---------- Sections ---------- */

function PipelineSnapshot({ deals }: { deals: Deal[] }) {
  const stages = groupByStage(deals)
  return (
    <Card className="xl:col-span-2">
      <CardHeader
        title="Pipeline"
        subtitle="Open deal value by stage"
        action={
          <Link
            to="/deals"
            className="text-[12px] font-medium text-[var(--color-brand-600)] hover:text-[var(--color-brand-700)] flex items-center gap-1"
          >
            View all <ArrowRight size={13} />
          </Link>
        }
      />
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-2">
        {stages.map((s) => (
          <div
            key={s.name}
            className="surface-2 rounded-[var(--radius-md)] p-3 border-soft"
          >
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)] truncate">
              {s.name}
            </div>
            <div className="font-display text-[18px] font-semibold mt-1 tabular">
              {currency(s.value, { compact: true })}
            </div>
            <div className="text-[11px] text-muted mt-0.5">
              {num(s.count)} deal{s.count === 1 ? '' : 's'}
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

function UpcomingTasks({ tasks, deals, contacts }: { tasks: Task[]; deals: Deal[]; contacts: Array<{id:string; firstName:string; lastName:string}> }) {
  const open = tasks
    .filter((t) => t.status !== 'completed' && t.status !== 'cancelled')
    .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''))
    .slice(0, 5)

  return (
    <Card>
      <CardHeader
        title="Upcoming tasks"
        action={
          <Link
            to="/tasks"
            className="text-[12px] font-medium text-[var(--color-brand-600)] hover:text-[var(--color-brand-700)] flex items-center gap-1"
          >
            All <ArrowRight size={13} />
          </Link>
        }
      />
      {open.length === 0 ? (
        <div className="text-muted text-[13px] py-6 text-center">Nothing on deck — nice.</div>
      ) : (
        <ul className="flex flex-col gap-2">
          {open.map((t) => {
            const deal = deals.find((d) => d.id === t.dealId)
            const contact = contacts.find((c) => c.id === t.contactId)
            const tone = t.priority === 'high' ? 'danger' : t.priority === 'low' ? 'neutral' : 'warning'
            return (
              <li
                key={t.id}
                className="flex items-start gap-3 p-3 surface-2 rounded-[var(--radius-md)]"
              >
                <div
                  className={cn(
                    'w-2 h-2 rounded-full mt-1.5 shrink-0',
                    tone === 'danger' && 'bg-[var(--color-danger)]',
                    tone === 'warning' && 'bg-[var(--color-warning)]',
                    tone === 'neutral' && 'bg-[var(--text-faint)]',
                  )}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium text-body truncate">{t.title}</div>
                  <div className="text-[11px] text-muted mt-0.5 truncate">
                    {t.dueDate ? date(t.dueDate) : 'No due date'}
                    {deal && <> · {deal.title}</>}
                    {contact && <> · {contact.firstName} {contact.lastName}</>}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

function TopClientsByMRR({
  companies,
  deals,
  contacts,
  tasks,
  activity,
  emailSends,
  bookings,
}: {
  companies: Company[]
  deals: Deal[]
  contacts: Array<{ id: string; firstName: string; lastName: string; companyId: string }>
  tasks: import('../lib/types').Task[]
  activity: import('../lib/types').Activity[]
  emailSends: import('../lib/types').EmailSend[]
  bookings: import('../lib/types').Booking[]
}) {
  const rows = companies
    .map((c) => ({
      company: c,
      mrr: activeMRRByCompany(deals, c.id),
      primary: contacts.find((ct) => ct.companyId === c.id),
      health: computeClientHealth(c, { deals, tasks, activity, emailSends, bookings, contacts }),
    }))
    .filter((r) => r.mrr > 0)
    .sort((a, b) => b.mrr - a.mrr)
    .slice(0, 8)

  return (
    <Card>
      <CardHeader
        title="Top clients by MRR"
        action={
          <Link
            to="/companies"
            className="text-[12px] font-medium text-[var(--color-brand-600)] hover:text-[var(--color-brand-700)] flex items-center gap-1"
          >
            All clients <ArrowRight size={13} />
          </Link>
        }
      />
      {rows.length === 0 ? (
        <Empty
          icon={<CircleDollarSign size={22} />}
          title="No active MRR yet"
          description="Once deals are Closed Won with an MRR value, they'll appear here."
        />
      ) : (
        <div className="divide-y divide-[color:var(--border)]">
          {rows.map(({ company, mrr, primary, health }) => (
            <Link
              key={company.id}
              to={`/companies/${company.id}`}
              className="flex items-center gap-3 py-3 px-1 -mx-1 hover:surface-2 rounded-[var(--radius-sm)] transition-colors"
            >
              <HealthDot tier={health.tier} reason={health.reason} size={8} />
              <Avatar name={company.name} size={34} />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-body truncate">{company.name}</div>
                <div className="text-[11px] text-muted truncate">
                  {company.industry || '—'}
                  {primary && <> · {primary.firstName} {primary.lastName}</>}
                  {health.daysSinceLastTouch !== null && (
                    <span className="text-[var(--text-faint)]"> · last touch {health.daysSinceLastTouch}d ago</span>
                  )}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="font-display text-[14px] font-semibold tabular text-body">
                  {currency(mrr)}
                </div>
                <div className="text-[10px] text-muted uppercase tracking-wider">/ mo</div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </Card>
  )
}

function LatestExecUpdate({ exec }: { exec: ExecUpdate }) {
  const mrrDelta = (exec.savedMRR || 0) - (exec.prevMRR || 0)
  const growthTone = mrrDelta >= 0 ? 'success' : 'danger'
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Sparkles size={14} className="text-[var(--color-brand-600)]" />
            Exec update — {formatPeriod(exec.period, 'MMMM yyyy')}
          </span>
        }
        subtitle="Latest monthly report"
        action={
          <Link
            to="/exec"
            className="text-[12px] font-medium text-[var(--color-brand-600)] hover:text-[var(--color-brand-700)] flex items-center gap-1"
          >
            All updates <ArrowRight size={13} />
          </Link>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <MiniStat label="New customers" value={num(exec.newCustomers)} />
        <MiniStat label="MRR" value={currency(exec.savedMRR, { compact: true })} tone={growthTone} />
        <MiniStat label="Prev MRR" value={currency(exec.prevMRR, { compact: true })} />
        <MiniStat label="Demos booked" value={num(exec.demosBooked)} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {exec.wins && <ExecBlock label="Wins" tone="success" body={exec.wins} />}
        {exec.plans && <ExecBlock label="Plans" tone="info" body={exec.plans} />}
        {exec.losses && <ExecBlock label="Losses" tone="danger" body={exec.losses} />}
        {exec.problems && <ExecBlock label="Problems" tone="warning" body={exec.problems} />}
      </div>
    </Card>
  )
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: 'success' | 'danger' }) {
  return (
    <div className="surface-2 rounded-[var(--radius-md)] p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
        {label}
      </div>
      <div
        className={cn(
          'font-display text-[18px] font-semibold mt-1 tabular',
          tone === 'success' && 'text-[var(--color-success)]',
          tone === 'danger' && 'text-[var(--color-danger)]',
        )}
      >
        {value}
      </div>
    </div>
  )
}

function ExecBlock({ label, tone, body }: { label: string; tone: 'success' | 'info' | 'danger' | 'warning'; body: string }) {
  return (
    <div className="surface-2 rounded-[var(--radius-md)] p-4">
      <div className="flex items-center gap-2 mb-2">
        <Badge tone={tone}>{label}</Badge>
      </div>
      <p className="text-[13px] text-body leading-relaxed whitespace-pre-wrap">{body}</p>
    </div>
  )
}

/* ---------- MRR Trend ---------- */

function MRRTrend({
  execUpdates,
  cashflow,
  currentMRR,
}: {
  execUpdates: ExecUpdate[]
  cashflow: Cashflow[]
  currentMRR: number
}) {
  // Build monthly series from ExecUpdates (savedMRR by period)
  const sorted = [...execUpdates]
    .filter((e) => e.period && (e.savedMRR || e.prevMRR))
    .sort((a, b) => a.period.localeCompare(b.period))

  // Synthesize a current-month entry so the line ends at "today"
  const nowKey = new Date().toISOString().slice(0, 7).replace('-', '_')
  const hasCurrent = sorted.some((e) => e.period === nowKey)
  const series = sorted.map((e) => ({ x: e.period, y: e.savedMRR || 0 }))
  if (!hasCurrent && currentMRR > 0) series.push({ x: nowKey, y: currentMRR })

  const expenses = cashflow
    .filter((c) => c.period && c.expenses)
    .sort((a, b) => a.period.localeCompare(b.period))
    .map((c) => ({ x: c.period, y: c.expenses }))

  if (series.length < 2) {
    return null // Not enough data points to plot
  }

  const peak = Math.max(...series.map((s) => s.y))
  const low = Math.min(...series.map((s) => s.y))

  return (
    <Card>
      <CardHeader
        title="MRR over time"
        subtitle={`${formatPeriod(series[0].x, 'MMM yyyy')} → today · peak ${currency(peak, { compact: true })}`}
        action={
          <div className="flex items-center gap-3 text-[11px]">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-0.5 bg-[var(--color-brand-600)]" />
              <span className="text-muted">MRR</span>
            </span>
            {expenses.length > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-0.5 bg-[var(--color-warning)]" />
                <span className="text-muted">Expenses</span>
              </span>
            )}
          </div>
        }
      />
      <div className="pt-2 pb-6">
        <LineChart
          height={160}
          yLabel={(n) => currency(n, { compact: true })}
          series={[
            { name: 'MRR', color: 'var(--color-brand-600)', values: series },
            ...(expenses.length > 0
              ? [{ name: 'Expenses', color: 'var(--color-warning)', values: expenses }]
              : []),
          ]}
        />
      </div>
      <div className="grid grid-cols-3 gap-4 pt-3 border-soft-t">
        <MiniInline label="Current" value={currency(currentMRR, { compact: true })} />
        <MiniInline label="Peak" value={currency(peak, { compact: true })} />
        <MiniInline label="Low" value={currency(low, { compact: true })} />
      </div>
    </Card>
  )
}

function MiniInline({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)]">{label}</div>
      <div className="font-display text-[15px] font-semibold tabular text-body mt-0.5">{value}</div>
    </div>
  )
}

void parsePeriod // referenced via imports; keeps TS happy if unused inline

/* ---------- Helpers ---------- */

function countActiveClients(companies: Company[], deals: Deal[]): number {
  const activeCompanyIds = new Set(deals.filter(isActiveMRR).map((d) => d.companyId))
  return companies.filter((c) => activeCompanyIds.has(c.id)).length
}

const STAGE_ORDER = ['Lead', 'Qualified', 'Demo', 'Proposal', 'Negotiation', 'Closed Won', 'Closed Lost']

function groupByStage(deals: Deal[]): Array<{ name: string; value: number; count: number }> {
  const open = deals.filter((d) => !d.stage.toLowerCase().startsWith('closed'))
  const map = new Map<string, { value: number; count: number }>()
  STAGE_ORDER.slice(0, 5).forEach((s) => map.set(s, { value: 0, count: 0 }))
  for (const d of open) {
    const key = d.stage || 'Lead'
    const cur = map.get(key) || { value: 0, count: 0 }
    map.set(key, { value: cur.value + (d.value || 0), count: cur.count + 1 })
  }
  return Array.from(map.entries()).map(([name, v]) => ({ name, ...v }))
}

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Dashboard" subtitle="Loading your Hashio data…" />
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <Skeleton className="h-4 w-20 mb-3" />
            <Skeleton className="h-8 w-32 mb-2" />
            <Skeleton className="h-3 w-24" />
          </Card>
        ))}
      </div>
      <Card>
        <Skeleton className="h-5 w-40 mb-4" />
        <div className="grid grid-cols-5 gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      </Card>
    </div>
  )
}

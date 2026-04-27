import { useSheetData } from '../lib/sheet-context'
import { Card, CardHeader, Badge, PageHeader, Empty, Button } from '../components/ui'
import { currency, num, formatPeriod } from '../lib/format'
import { Plus, Sparkles } from 'lucide-react'

export function ExecUpdates() {
  const { state } = useSheetData()
  const data = 'data' in state ? state.data : undefined
  if (!data) return <PageHeader title="Exec Updates" />

  const sorted = [...data.execUpdates].sort((a, b) => b.period.localeCompare(a.period))

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Exec Updates"
        subtitle="Monthly snapshot for stakeholders"
        action={<Button variant="primary" icon={<Plus size={14} />}>New update</Button>}
      />

      {sorted.length === 0 ? (
        <Card>
          <Empty
            icon={<Sparkles size={22} />}
            title="No exec updates yet"
            description="Create a monthly summary with wins, plans, losses, and problems."
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-5">
          {sorted.map((e) => {
            const delta = (e.savedMRR || 0) - (e.prevMRR || 0)
            const pct = e.prevMRR ? (delta / e.prevMRR) * 100 : 0
            return (
              <Card key={e.id}>
                <CardHeader
                  title={formatPeriod(e.period, 'MMMM yyyy')}
                  subtitle={`${num(e.newCustomers)} new · ${num(e.demosBooked)} demos booked`}
                  action={
                    <Badge tone={delta >= 0 ? 'success' : 'danger'}>
                      {delta >= 0 ? '▲' : '▼'} {currency(Math.abs(delta), { compact: true })} ({pct.toFixed(1)}%)
                    </Badge>
                  }
                />
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
                  <Metric label="MRR" value={currency(e.savedMRR, { compact: true })} />
                  <Metric label="Previous MRR" value={currency(e.prevMRR, { compact: true })} />
                  <Metric label="New customers" value={num(e.newCustomers)} />
                  <Metric label="Demos" value={num(e.demosBooked)} />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {e.wins && <Block label="Wins" tone="success" body={e.wins} />}
                  {e.plans && <Block label="Plans" tone="info" body={e.plans} />}
                  {e.losses && <Block label="Losses" tone="danger" body={e.losses} />}
                  {e.problems && <Block label="Problems" tone="warning" body={e.problems} />}
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="surface-2 rounded-[var(--radius-md)] p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
        {label}
      </div>
      <div className="font-display text-[18px] font-semibold mt-1 tabular">{value}</div>
    </div>
  )
}

function Block({ label, tone, body }: { label: string; tone: 'success' | 'info' | 'danger' | 'warning'; body: string }) {
  return (
    <div className="surface-2 rounded-[var(--radius-md)] p-4">
      <div className="mb-2"><Badge tone={tone}>{label}</Badge></div>
      <p className="text-[13px] text-body leading-relaxed whitespace-pre-wrap">{body}</p>
    </div>
  )
}

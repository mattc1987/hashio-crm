// Tiny dependency-free SVG line chart. Designed for trend cards (MRR over
// time, expenses over time, etc.). No tooltips, no axes — just a clean
// sparkline-ish visual with optional point markers.

import { useMemo } from 'react'

export interface LineChartSeries {
  name: string
  color: string  // CSS var or hex
  values: Array<{ x: string; y: number }>
}

export function LineChart({
  series,
  height = 120,
  yLabel,
  showPoints = true,
}: {
  series: LineChartSeries[]
  height?: number
  yLabel?: (n: number) => string
  showPoints?: boolean
}) {
  const { paths, allXs, yMax, yMin } = useMemo(() => {
    const allYs = series.flatMap((s) => s.values.map((v) => v.y))
    const yMax = allYs.length ? Math.max(...allYs) : 1
    const yMin = allYs.length ? Math.min(...allYs, 0) : 0
    const range = yMax - yMin || 1
    // Collect unique x labels in order they first appear
    const allXs: string[] = []
    for (const s of series) for (const v of s.values) {
      if (!allXs.includes(v.x)) allXs.push(v.x)
    }
    allXs.sort()
    const xToIdx = new Map<string, number>()
    allXs.forEach((x, i) => xToIdx.set(x, i))

    const xCount = Math.max(1, allXs.length - 1)
    const W = 100, H = 100
    const margin = 4

    const paths = series.map((s) => {
      const points = s.values
        .slice()
        .sort((a, b) => a.x.localeCompare(b.x))
        .map((v) => {
          const xi = xToIdx.get(v.x)!
          const px = margin + (xi / xCount) * (W - 2 * margin)
          const py = H - margin - ((v.y - yMin) / range) * (H - 2 * margin)
          return { x: px, y: py, raw: v }
        })
      const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ')
      return { name: s.name, color: s.color, d, points }
    })

    return { paths, allXs, yMax, yMin }
  }, [series])

  return (
    <div style={{ height }} className="relative w-full">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full">
        {/* Subtle gridlines */}
        {[0.25, 0.5, 0.75].map((p) => (
          <line key={p} x1={4} x2={96} y1={4 + p * 92} y2={4 + p * 92}
            stroke="var(--border)" strokeWidth="0.3" strokeDasharray="0.6 0.6" />
        ))}
        {paths.map((p) => (
          <g key={p.name}>
            <path d={p.d} fill="none" stroke={p.color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            {showPoints && p.points.map((pt, i) => (
              <circle key={i} cx={pt.x} cy={pt.y} r="1.1" fill={p.color} />
            ))}
          </g>
        ))}
      </svg>
      {/* Y-axis label hover for the latest value */}
      {yLabel && series.length > 0 && (
        <div className="absolute top-0 right-0 text-[10px] text-[var(--text-faint)] tabular">
          peak {yLabel(yMax)}
        </div>
      )}
      {yLabel && series.length > 0 && (
        <div className="absolute bottom-0 right-0 text-[10px] text-[var(--text-faint)] tabular">
          low {yLabel(yMin)}
        </div>
      )}
      {/* X labels */}
      {allXs.length > 0 && (
        <div className="absolute -bottom-4 left-0 right-0 flex justify-between text-[9px] font-mono text-[var(--text-faint)]">
          <span>{allXs[0]}</span>
          {allXs.length > 1 && <span>{allXs[allXs.length - 1]}</span>}
        </div>
      )}
    </div>
  )
}

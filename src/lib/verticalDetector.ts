// Detect a cannabis company's vertical from its name (regex-first, free,
// instant). For ambiguous cases (low confidence), the caller falls back to
// an AI lookup that takes name + state and uses Claude's broader knowledge.
//
// Heuristics built from Matt's domain expertise — patterns he uses when
// scanning company names manually:
//
//   Cultivator signals: "Cultivation", "Cultivators", "Grow", "Grown",
//     "Growers", "Farms", "Farm", "Gardens", "Greenhouse",
//     "Botanical(s)", "Cannabis Co" (often grow-only).
//   Processor signals: "Labs", "Lab", "Processing", "Manufacturing",
//     "Extraction", "Extracts", "Concentrates", "Distillate",
//     "Solventless", "Rosin", "Live Resin".
//   Vertical signals: "Holdings" (often portfolio), "Group" + cannabis
//     keywords, "Industries", "Brands" (multiple SKUs imply processing+
//     usually some cultivation).
//   Retail signals: "Dispensary", "Dispensaries", "Boutique", "Co-op"
//     (membership model), "Wellness Center" (often dispensary).
//
// Output:
//   vertical: 'cultivator' | 'processor' | 'vertical' | 'retail' | 'unknown'
//   confidence: 0-100 (heuristic; 75+ = strong, 40-74 = ambiguous, <40 = unknown)
//   source: 'name-match' | 'unknown'
//   matchedKeywords: string[] — diagnostic, helps tune the rules
import type { CompanyVertical } from './types'

interface DetectorRule {
  pattern: RegExp
  vertical: Exclude<CompanyVertical, '' | 'unknown'>
  weight: number  // 1-100, how strongly this signal commits to the vertical
  label: string
}

// Order matters only for diagnostics; all rules evaluate.
const RULES: DetectorRule[] = [
  // ---- Cultivator signals (grow operations) ----
  { pattern: /\bcultivation\b/i, vertical: 'cultivator', weight: 92, label: 'cultivation' },
  { pattern: /\bcultivators?\b/i, vertical: 'cultivator', weight: 92, label: 'cultivators' },
  { pattern: /\bgrowers?\b/i, vertical: 'cultivator', weight: 88, label: 'grower(s)' },
  { pattern: /\bgreenhouse\b/i, vertical: 'cultivator', weight: 80, label: 'greenhouse' },
  { pattern: /\bfarms?\b/i, vertical: 'cultivator', weight: 75, label: 'farm(s)' },
  { pattern: /\bgardens?\b/i, vertical: 'cultivator', weight: 70, label: 'gardens' },
  { pattern: /\bnurser(?:y|ies)\b/i, vertical: 'cultivator', weight: 75, label: 'nursery' },
  { pattern: /\b(?:botanical|botanicals)\b/i, vertical: 'cultivator', weight: 60, label: 'botanical(s)' },
  { pattern: /\bgrow\b/i, vertical: 'cultivator', weight: 75, label: 'grow' },
  { pattern: /\bharvest(?:s|ed)?\b/i, vertical: 'cultivator', weight: 65, label: 'harvest' },

  // ---- Processor signals ----
  { pattern: /\blabs?\b/i, vertical: 'processor', weight: 88, label: 'labs/lab' },
  { pattern: /\bprocessing\b/i, vertical: 'processor', weight: 92, label: 'processing' },
  { pattern: /\bmanufactur(?:e|ing|er)\b/i, vertical: 'processor', weight: 88, label: 'manufacturing' },
  { pattern: /\bextraction\b/i, vertical: 'processor', weight: 92, label: 'extraction' },
  { pattern: /\bextracts?\b/i, vertical: 'processor', weight: 88, label: 'extracts' },
  { pattern: /\bconcentrates?\b/i, vertical: 'processor', weight: 85, label: 'concentrates' },
  { pattern: /\bdistillate\b/i, vertical: 'processor', weight: 90, label: 'distillate' },
  { pattern: /\bsolventless\b/i, vertical: 'processor', weight: 90, label: 'solventless' },
  { pattern: /\b(?:live\s+)?rosin\b/i, vertical: 'processor', weight: 85, label: 'rosin' },
  { pattern: /\blive\s+resin\b/i, vertical: 'processor', weight: 85, label: 'live resin' },
  { pattern: /\bedibles?\b/i, vertical: 'processor', weight: 82, label: 'edibles' },
  { pattern: /\bvape(?:s|d|ing)?\b/i, vertical: 'processor', weight: 80, label: 'vape' },
  { pattern: /\bcartridges?\b/i, vertical: 'processor', weight: 78, label: 'cartridges' },

  // ---- Vertical (multi-stage operators) ----
  // These are weaker signals on their own but strong combined with cultivation
  // or processing; the scoring loop captures that.
  { pattern: /\bholdings?\b/i, vertical: 'vertical', weight: 50, label: 'holdings' },
  { pattern: /\bindustries\b/i, vertical: 'vertical', weight: 55, label: 'industries' },
  { pattern: /\bbrands?\b/i, vertical: 'vertical', weight: 45, label: 'brands' },
  // "Group" alone is too generic. Pair with another cannabis keyword.

  // ---- Retail (dispensaries) ----
  { pattern: /\bdispensar(?:y|ies)\b/i, vertical: 'retail', weight: 95, label: 'dispensary' },
  { pattern: /\bboutique\b/i, vertical: 'retail', weight: 75, label: 'boutique' },
  { pattern: /\bco-?op\b/i, vertical: 'retail', weight: 70, label: 'co-op' },
  { pattern: /\bwellness\s+center\b/i, vertical: 'retail', weight: 75, label: 'wellness center' },
]

export interface VerticalDetection {
  vertical: CompanyVertical
  confidence: number
  source: 'name-match' | 'unknown'
  matchedKeywords: string[]
}

export function detectVerticalFromName(name: string): VerticalDetection {
  const out: VerticalDetection = {
    vertical: 'unknown',
    confidence: 0,
    source: 'unknown',
    matchedKeywords: [],
  }
  if (!name) return out

  // Tally weights per vertical. Multiple matches in same vertical strengthen
  // the signal (capped at 95 so we never claim 100% from name alone).
  const tallies: Record<string, { weight: number; labels: string[] }> = {}
  for (const rule of RULES) {
    if (rule.pattern.test(name)) {
      if (!tallies[rule.vertical]) tallies[rule.vertical] = { weight: 0, labels: [] }
      tallies[rule.vertical].weight = Math.max(tallies[rule.vertical].weight, rule.weight)
      tallies[rule.vertical].labels.push(rule.label)
    }
  }

  if (Object.keys(tallies).length === 0) return out

  // If both cultivator AND processor signals fire → almost certainly vertical
  // (operator does both stages).
  if (tallies['cultivator'] && tallies['processor']) {
    return {
      vertical: 'vertical',
      confidence: Math.min(95, Math.round((tallies['cultivator'].weight + tallies['processor'].weight) / 2 + 10)),
      source: 'name-match',
      matchedKeywords: [...tallies['cultivator'].labels, ...tallies['processor'].labels],
    }
  }

  // "Holdings" / "Industries" / "Brands" alongside cultivator OR processor →
  // also a strong vertical hint.
  if (tallies['vertical'] && (tallies['cultivator'] || tallies['processor'])) {
    const supportingTally = tallies['cultivator'] || tallies['processor']
    return {
      vertical: 'vertical',
      confidence: Math.min(90, Math.round((tallies['vertical'].weight + supportingTally.weight) / 2 + 5)),
      source: 'name-match',
      matchedKeywords: [...tallies['vertical'].labels, ...supportingTally.labels],
    }
  }

  // Otherwise: pick the vertical with highest weight
  let best: { vertical: Exclude<CompanyVertical, '' | 'unknown'>; weight: number; labels: string[] } | null = null
  for (const v of Object.keys(tallies) as Array<Exclude<CompanyVertical, '' | 'unknown'>>) {
    const t = tallies[v]
    if (!best || t.weight > best.weight) best = { vertical: v, weight: t.weight, labels: t.labels }
  }
  if (!best) return out

  // "Vertical" alone (just "Holdings" / "Industries" / "Brands") with no
  // grow/processing signal is too weak — leave it as unknown so the AI
  // fallback can take a swing.
  if (best.vertical === 'vertical' && best.weight < 60) {
    return {
      vertical: 'unknown',
      confidence: best.weight,
      source: 'unknown',
      matchedKeywords: best.labels,
    }
  }

  return {
    vertical: best.vertical,
    confidence: Math.min(95, best.weight),
    source: 'name-match',
    matchedKeywords: best.labels,
  }
}

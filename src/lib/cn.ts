// Tiny className joiner — no deps. (We don't need `clsx` for this scale.)
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

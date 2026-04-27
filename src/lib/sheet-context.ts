import { createContext, useContext } from 'react'
import type { LoadState } from './useSheet'

interface Ctx {
  state: LoadState
  refresh: () => Promise<void> | void
}

export const SheetDataContext = createContext<Ctx | null>(null)

export function useSheetData() {
  const ctx = useContext(SheetDataContext)
  if (!ctx) throw new Error('useSheetData must be used within <SheetDataContext.Provider>')
  return ctx
}

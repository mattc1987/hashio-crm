// Light/dark theme — auto-follow system, overridable via localStorage.
// Stored values: 'light' | 'dark' | 'system' (default).

export type ThemePref = 'light' | 'dark' | 'system'

const KEY = 'hashio-theme'

export function getThemePref(): ThemePref {
  const v = (typeof localStorage !== 'undefined' && localStorage.getItem(KEY)) || 'system'
  return v === 'light' || v === 'dark' ? v : 'system'
}

export function setThemePref(pref: ThemePref) {
  localStorage.setItem(KEY, pref)
  applyTheme(pref)
}

export function applyTheme(pref: ThemePref) {
  const html = document.documentElement
  if (pref === 'system') {
    html.removeAttribute('data-theme')
  } else {
    html.setAttribute('data-theme', pref)
  }
}

export function initTheme() {
  applyTheme(getThemePref())
}

export function resolvedTheme(): 'light' | 'dark' {
  const pref = getThemePref()
  if (pref !== 'system') return pref
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

// Full-screen "desktop app" mode. Browsers allow full screen only from a click, so it is entered on the Login
// click, and after a page reload (which always leaves full screen) on the next click anywhere. Pressing Esc or the
// header button turns it off and that choice is remembered until the next login.
const KEY = 'geom_fullscreen'
const setPref = (on: boolean) => { try { localStorage.setItem(KEY, on ? '1' : '0') } catch { /* storage blocked */ } }
const getPref = () => { try { return localStorage.getItem(KEY) === '1' } catch { return false } }

export const isFull = () => !!document.fullscreenElement

export function enterFull() {
  setPref(true)
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => { /* not allowed here */ })
}

export function toggleFull() {
  if (document.fullscreenElement) { setPref(false); document.exitFullscreen?.().catch(() => {}) }
  else enterFull()
}

/** Call once inside the logged-in layout; returns a cleanup. */
export function keepFull(onChange: (full: boolean) => void) {
  let wasFull = isFull()
  const change = () => {
    const full = isFull()
    if (wasFull && !full && !document.hidden) setPref(false)   // the user left full screen (Esc / F11)
    wasFull = full
    onChange(full)
  }
  const reenter = () => { if (getPref() && !isFull()) enterFull() }
  document.addEventListener('fullscreenchange', change)
  window.addEventListener('pointerdown', reenter, true)
  window.addEventListener('keydown', reenter, true)
  return () => {
    document.removeEventListener('fullscreenchange', change)
    window.removeEventListener('pointerdown', reenter, true)
    window.removeEventListener('keydown', reenter, true)
  }
}

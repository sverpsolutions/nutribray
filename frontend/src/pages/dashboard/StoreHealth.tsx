import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'react-hot-toast'
import { dashboard_api, type store_health_row } from '../../api/dashboard'

const PING_MS = 120_000
const inr = (v: unknown) => '₹' + Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })

function ago(ts: string | null) {
  if (!ts) return 'never'
  const mins = Math.round((Date.now() - new Date(ts).getTime()) / 60000)
  if (mins < 60) return `${Math.max(mins, 0)} min ago`
  if (mins < 48 * 60) return `${Math.round(mins / 60)} h ago`
  return `${Math.round(mins / 1440)} days ago`
}

type state = 'online' | 'offline' | 'stale' | 'no-server' | 'checking'
const STATE: Record<state, { label: string; dot: string; chip: string }> = {
  online: { label: 'Online', dot: 'bg-[#16A34A]', chip: 'bg-[#E6F4EC] text-[#116B3A]' },
  stale: { label: 'Online · sync late', dot: 'bg-[#F2B441]', chip: 'bg-[#FDF1DE] text-[#8A4B00]' },
  offline: { label: 'Unreachable', dot: 'bg-[#D92D20]', chip: 'bg-[#FBE8E6] text-[#A3261E]' },
  'no-server': { label: 'No POS link', dot: 'bg-[#98A2B3]', chip: 'bg-app-bg text-text-secondary' },
  checking: { label: 'Checking…', dot: 'bg-[#98A2B3] animate-pulse', chip: 'bg-app-bg text-text-secondary' },
}

export default function StoreHealth() {
  const [rows, setRows] = useState<store_health_row[]>([])
  const [reach, setReach] = useState<Record<number, boolean> | null>(null)
  const [checkedAt, setCheckedAt] = useState<Date | null>(null)

  const loadRows = () => dashboard_api.storeHealth().then(setRows).catch(() => toast.error('Failed to load stores'))
  const ping = () => {
    setReach(null)
    return dashboard_api.ping().then(r => { setReach(r); setCheckedAt(new Date()) }).catch(() => toast.error('Connection check failed'))
  }

  useEffect(() => {
    loadRows(); ping()
    const t = setInterval(() => { loadRows(); ping() }, PING_MS)
    return () => clearInterval(t)
  }, [])

  const stateOf = (r: store_health_row): state => {
    if (!r.has_server) return 'no-server'
    if (!reach) return 'checking'
    if (!reach[r.id]) return 'offline'
    // reachable but nothing synced for a day: the sync job is not reaching it
    const lastOk = r.last_sync_ok ? new Date(r.last_sync_ok).getTime() : 0
    return Date.now() - lastOk > 24 * 3600_000 ? 'stale' : 'online'
  }
  const counts = rows.reduce((c, r) => { const s = stateOf(r); c[s] = (c[s] || 0) + 1; return c }, {} as Record<string, number>)
  const order: state[] = ['offline', 'stale', 'checking', 'online', 'no-server']
  const sorted = [...rows].sort((a, b) => order.indexOf(stateOf(a)) - order.indexOf(stateOf(b)) || a.name.localeCompare(b.name))

  return (
    <div className="p-6 lg:p-8 flex flex-col gap-6 max-w-[1500px]">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <h1 className="m-0">Store health</h1>
          <p className="text-[14px] text-text-muted m-0 mt-1">
            Live link to each store's POS server over the VPN
            {checkedAt && <> · checked {checkedAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}, rechecks every 2 minutes</>}
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          <Link to="/inventory/monitor" className="btn btn-secondary hover:no-underline">Sync monitor</Link>
          <button type="button" className="btn btn-primary" onClick={() => { loadRows(); ping() }} disabled={!reach}>
            <i className={`fas fa-sync-alt ${reach ? '' : 'fa-spin'}`}></i> Check now
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {(['online', 'stale', 'offline', 'no-server'] as state[]).map(s => (
          <div key={s} className="bg-app-card border border-border rounded-xl p-4 flex items-center gap-3">
            <span className={`w-3 h-3 rounded-full ${STATE[s].dot}`}></span>
            <span className="text-[14px] text-text-secondary">{STATE[s].label}</span>
            <span className="ml-auto font-mono text-[24px] font-semibold text-text-primary">{reach || s === 'no-server' ? counts[s] || 0 : '…'}</span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {sorted.map(r => {
          const s = stateOf(r)
          return (
            <article key={r.id} className="bg-app-card border border-border rounded-xl p-4 flex flex-col gap-3">
              <div className="flex items-start gap-2">
                <div className="min-w-0">
                  <h2 className="!text-[15px] !normal-case !tracking-normal font-semibold text-text-primary m-0 truncate">{r.name}</h2>
                  <span className="font-mono text-[12px] text-text-muted">{r.code}</span>
                </div>
                <span className={`ml-auto status-badge shrink-0 ${STATE[s].chip}`}><span className={`dot ${STATE[s].dot}`}></span>{STATE[s].label}</span>
              </div>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[13px] m-0">
                <dt className="text-text-muted">Today</dt><dd className="m-0 text-right font-mono font-medium text-text-primary">{Number(r.today_sales) ? inr(r.today_sales) : '—'}</dd>
                <dt className="text-text-muted">Last sync</dt><dd className="m-0 text-right text-text-primary">{ago(r.last_sync_ok)}</dd>
                <dt className="text-text-muted">Last bill</dt><dd className="m-0 text-right text-text-primary">{r.last_bill_date ? new Date(r.last_bill_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '—'}</dd>
              </dl>
              {s === 'offline' && <p className="m-0 text-[12px] text-[#A3261E]">Store PC off or Radmin VPN disconnected. Ask the store to start it, or check its VPN IP in Outlet Master.</p>}
              {s === 'stale' && <p className="m-0 text-[12px] text-[#8A4B00]">Reachable, but no successful sync in 24 h{r.last_error ? `: ${r.last_error.slice(0, 80)}` : ''}.</p>}
            </article>
          )
        })}
      </div>
    </div>
  )
}

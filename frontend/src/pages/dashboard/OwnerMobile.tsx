import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { dashboard_api, type dashboard_summary } from '../../api/dashboard'
import { useThemeStore } from '../../store/themeStore'

// Phone page for the owner, installable from the browser menu ("Add to Home screen").
const REFRESH_MS = 60_000
const inr = (v: unknown) => '₹' + Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })
const short = (v: unknown) => {
  const n = Number(v || 0)
  return n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(2)} L` : inr(n)
}

export default function OwnerMobile() {
  const { isDarkMode, toggleDarkMode } = useThemeStore()
  const [data, setData] = useState<dashboard_summary | null>(null)
  const [reach, setReach] = useState<Record<number, boolean> | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true); setError('')
    try {
      const [d, p] = await Promise.all([dashboard_api.summary(7), dashboard_api.ping().catch(() => null)])
      setData(d); setReach(p)
    } catch {
      setError('Could not load. Pull down or tap refresh.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    const t = setInterval(load, REFRESH_MS)
    return () => clearInterval(t)
  }, [])

  const k = data?.kpi
  const delta = k && Number(k.yesterday_sales) ? ((Number(k.today_sales) - Number(k.yesterday_sales)) / Number(k.yesterday_sales)) * 100 : null
  const online = reach ? Object.values(reach).filter(Boolean).length : null
  const maxStore = Math.max(1, ...(data?.stores.map(s => Number(s.today_sales)) ?? [0]))

  return (
    <div className="min-h-screen bg-app-bg text-text-primary font-sans pb-10">
      <header className="sticky top-0 z-10 bg-[#0C1B24] text-white px-4 pt-[max(env(safe-area-inset-top),12px)] pb-3 flex items-center gap-3">
        <span className="w-9 h-9 rounded-lg bg-[#14A3A8] text-[#06222A] font-bold flex items-center justify-center">MB</span>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-[16px] leading-tight">Owner view</div>
          <div className="text-[12px] text-[#8A9AA5]">
            {data ? new Date(data.date).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }) : '…'}
          </div>
        </div>
        <button type="button" onClick={toggleDarkMode} aria-label={isDarkMode ? 'Light mode' : 'Dark mode'}
          className="w-11 h-11 rounded-lg flex items-center justify-center text-[#B9C4CC] active:bg-[#16303B]">
          <i className={`fas ${isDarkMode ? 'fa-sun' : 'fa-moon'}`}></i>
        </button>
        <button type="button" onClick={load} aria-label="Refresh"
          className="w-11 h-11 rounded-lg flex items-center justify-center text-[#B9C4CC] active:bg-[#16303B]">
          <i className={`fas fa-sync-alt ${loading ? 'fa-spin' : ''}`}></i>
        </button>
      </header>

      {error && <p className="mx-4 mt-4 p-3 rounded-lg bg-[#FBE8E6] text-[#A3261E] text-[14px]">{error}</p>}

      {k && data && (
        <main className="px-4 pt-4 flex flex-col gap-4">
          <section className="rounded-2xl bg-primary text-white p-5">
            <div className="text-[13px] opacity-80">Today's sales</div>
            <div className="font-mono text-[36px] font-semibold leading-tight tracking-tight">{inr(k.today_sales)}</div>
            <div className="text-[13px] opacity-90 mt-1">
              {k.today_bills} bills · avg {inr(k.avg_bill)}
              {delta !== null && <> · {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}% vs yesterday</>}
            </div>
          </section>

          <section className="grid grid-cols-2 gap-3">
            {[
              ['This month', short(k.month_sales)],
              ['Receivables', short(k.receivables)],
              ['Stores online', online === null ? '…' : `${online} / ${Object.keys(reach!).length}`],
              ['Out of stock', String(data.stockout_count)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl bg-app-card border border-border p-4">
                <div className="text-[12px] text-text-secondary">{label}</div>
                <div className="font-mono text-[20px] font-semibold mt-1">{value}</div>
              </div>
            ))}
          </section>

          <section className="rounded-xl bg-app-card border border-border">
            <h2 className="!text-[15px] !normal-case !tracking-normal font-semibold m-0 px-4 pt-4 pb-2">Stores today</h2>
            <ul className="m-0 p-0 list-none">
              {data.stores.map(s => (
                <li key={s.id} className="px-4 py-3 border-t border-border-table">
                  <div className="flex items-center gap-2 text-[14px]">
                    {reach && s.id in reach && (
                      <span className={`w-2 h-2 rounded-full shrink-0 ${reach[s.id] ? 'bg-[#16A34A]' : 'bg-[#D92D20]'}`}
                        aria-label={reach[s.id] ? 'online' : 'unreachable'} />
                    )}
                    <span className="truncate">{s.name}</span>
                    <span className="ml-auto font-mono font-medium">{Number(s.today_sales) ? inr(s.today_sales) : '—'}</span>
                  </div>
                  {Number(s.today_sales) > 0 && (
                    <div className="mt-1.5 h-1.5 rounded bg-border-table"><div className="h-1.5 rounded bg-accent" style={{ width: `${(Number(s.today_sales) / maxStore) * 100}%` }} /></div>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-xl bg-app-card border border-border">
            <h2 className="!text-[15px] !normal-case !tracking-normal font-semibold m-0 px-4 pt-4 pb-2">Best sellers out of stock</h2>
            <ul className="m-0 p-0 list-none">
              {data.stockouts.slice(0, 6).map(s => (
                <li key={`${s.outlet_id}-${s.product_id}`} className="px-4 py-3 border-t border-border-table flex gap-3 text-[14px]">
                  <div className="min-w-0 flex-1"><div className="truncate">{s.name}</div><div className="text-[12px] text-text-muted">{s.outlet}</div></div>
                  <span className="font-mono font-semibold text-[#A3261E]">{Number(s.stock_qty).toLocaleString('en-IN', { maximumFractionDigits: 1 })}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-xl bg-app-card border border-border p-4 flex items-center gap-3 text-[14px]">
            <i className="fas fa-truck text-primary"></i>
            <span>{data.transfers.pending} transfers pending</span>
            <Link to="/dashboard" className="ml-auto font-medium">Full dashboard →</Link>
          </section>
        </main>
      )}
      {!data && !error && <p className="p-6 text-text-muted">Loading…</p>}
    </div>
  )
}

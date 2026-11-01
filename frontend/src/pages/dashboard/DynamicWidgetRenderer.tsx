import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
} from 'chart.js'
import { Bar } from 'react-chartjs-2'
import { dashboardBuilderApi, type WidgetModel } from '../../api/dashboardBuilder'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip)

const inr = (v: unknown, dec = 0) =>
  '₹' + Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: dec, maximumFractionDigits: dec })

const shortInr = (v: unknown) => {
  const n = Number(v || 0)
  return n >= 1e7 ? `₹${(n / 1e7).toFixed(2)}Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(2)}L` : inr(n)
}

const dmy = (d?: string | null) => (d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '—')

interface Props {
  widget: WidgetModel
  days?: number
  outletId?: number | null
  categoryId?: number | null
  previewMode?: boolean
}

export default function DynamicWidgetRenderer({
  widget,
  days = 7,
  outletId = null,
  categoryId = null,
  previewMode = false
}: Props) {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [trendDays, setTrendDays] = useState(days)

  useEffect(() => {
    let alive = true
    setLoading(true)
    dashboardBuilderApi.getWidgetData(widget.widget_key, {
      days: widget.widget_key === 'sales_trend_chart' ? trendDays : days,
      outlet_id: outletId || undefined,
      category_id: categoryId || undefined
    })
      .then(res => {
        if (alive) {
          setData(res)
          setLoading(false)
        }
      })
      .catch(() => {
        if (alive) setLoading(false)
      })

    return () => { alive = false }
  }, [widget.widget_key, days, trendDays, outletId, categoryId])

  // Map col_span to responsive classes
  const getColSpanClass = (span: number = 1) => {
    switch (span) {
      case 2:
        return 'col-span-1 md:col-span-2'
      case 3:
        return 'col-span-1 md:col-span-2 lg:col-span-3'
      case 4:
        return 'col-span-1 md:col-span-2 lg:col-span-4'
      default:
        return 'col-span-1'
    }
  }

  const colClass = getColSpanClass(widget.col_span)

  // 1. KPI: Today's Sales
  if (widget.widget_key === 'kpi_today_sales') {
    const today = Number(data?.today_sales || 0)
    const yest = Number(data?.yesterday_sales || 0)
    const delta = yest ? ((today - yest) / yest) * 100 : null
    return (
      <div className={`bg-app-card border border-border rounded-xl p-5 flex flex-col justify-between ${colClass}`}>
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">{widget.name}</span>
          <span className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 flex items-center justify-center text-sm">
            <i className="fas fa-chart-line" />
          </span>
        </div>
        <div className="my-2">
          <span className="font-mono text-2xl lg:text-3xl font-bold text-text-primary tracking-tight">
            {loading ? '…' : inr(today)}
          </span>
        </div>
        <div className="flex items-center justify-between text-xs pt-2 border-t border-border/50">
          <span className={delta === null ? 'text-text-muted' : delta >= 0 ? 'text-emerald-600 font-semibold' : 'text-red-500 font-semibold'}>
            {delta === null ? '—' : `${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta).toFixed(1)}% vs yesterday`}
          </span>
          <span className="text-text-muted">{data?.today_bills ?? 0} bills</span>
        </div>
      </div>
    )
  }

  // 2. KPI: MTD Sales
  if (widget.widget_key === 'kpi_mtd_sales') {
    const mtd = Number(data?.mtd_sales || 0)
    const runRate = Number(data?.daily_run_rate || 0)
    return (
      <div className={`bg-app-card border border-border rounded-xl p-5 flex flex-col justify-between ${colClass}`}>
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">{widget.name}</span>
          <span className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-950/60 text-blue-600 flex items-center justify-center text-sm">
            <i className="fas fa-calendar-alt" />
          </span>
        </div>
        <div className="my-2">
          <span className="font-mono text-2xl lg:text-3xl font-bold text-text-primary tracking-tight">
            {loading ? '…' : shortInr(mtd)}
          </span>
        </div>
        <div className="flex items-center justify-between text-xs pt-2 border-t border-border/50 text-text-muted">
          <span>Run rate: {inr(runRate)}/day</span>
          <span>{data?.mtd_bills ?? 0} bills</span>
        </div>
      </div>
    )
  }

  // 3. KPI: Gross Margin
  if (widget.widget_key === 'kpi_gross_margin') {
    const marginPct = Number(data?.margin_pct || 0)
    const profit = Number(data?.gross_profit || 0)
    return (
      <div className={`bg-app-card border border-border rounded-xl p-5 flex flex-col justify-between ${colClass}`}>
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">{widget.name}</span>
          <span className="w-8 h-8 rounded-lg bg-purple-50 dark:bg-purple-950/60 text-purple-600 flex items-center justify-center text-sm">
            <i className="fas fa-percentage" />
          </span>
        </div>
        <div className="my-2 flex items-baseline gap-2">
          <span className="font-mono text-2xl lg:text-3xl font-bold text-text-primary tracking-tight">
            {loading ? '…' : `${marginPct.toFixed(1)}%`}
          </span>
          <span className="text-xs text-text-muted">margin</span>
        </div>
        <div className="flex items-center justify-between text-xs pt-2 border-t border-border/50 text-text-muted">
          <span>Gross profit: <strong className="text-text-primary">{shortInr(profit)}</strong></span>
        </div>
      </div>
    )
  }

  // 4. KPI: Stock Valuation
  if (widget.widget_key === 'kpi_stock_valuation') {
    const val = Number(data?.valuation_cost || 0)
    const units = Number(data?.total_units || 0)
    return (
      <div className={`bg-app-card border border-border rounded-xl p-5 flex flex-col justify-between ${colClass}`}>
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">{widget.name}</span>
          <span className="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-950/60 text-amber-600 flex items-center justify-center text-sm">
            <i className="fas fa-boxes" />
          </span>
        </div>
        <div className="my-2">
          <span className="font-mono text-2xl lg:text-3xl font-bold text-text-primary tracking-tight">
            {loading ? '…' : shortInr(val)}
          </span>
        </div>
        <div className="flex items-center justify-between text-xs pt-2 border-t border-border/50 text-text-muted">
          <span>{units.toLocaleString('en-IN')} units</span>
          <span>{data?.sku_count ?? 0} SKUs</span>
        </div>
      </div>
    )
  }

  // 5. Chart: Daily Sales Trend
  if (widget.widget_key === 'sales_trend_chart') {
    const trend = data?.trend || []
    const chartData = {
      labels: trend.map((t: any) => dmy(t.day)),
      datasets: [
        {
          label: 'Sales',
          data: trend.map((t: any) => Number(t.sales || 0)),
          backgroundColor: '#0F6CBD',
          borderRadius: 4,
        }
      ]
    }
    const chartOptions = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        tooltip: {
          callbacks: {
            label: (ctx: any) => `Sales: ${inr(ctx.raw)}`
          }
        }
      },
      scales: {
        x: { grid: { display: false } },
        y: { ticks: { callback: (v: any) => shortInr(v) } }
      }
    }

    return (
      <div className={`bg-app-card border border-border rounded-xl p-5 ${colClass}`}>
        <div className="flex items-center justify-between pb-3 mb-2 border-b border-border">
          <div>
            <h3 className="text-sm font-semibold text-text-primary m-0">{widget.name}</h3>
            <p className="text-xs text-text-muted m-0">Revenue progression across permitted locations</p>
          </div>
          <div className="flex border border-border rounded-lg overflow-hidden text-xs">
            {[7, 14, 30].map(d => (
              <button
                key={d}
                type="button"
                className={`px-2.5 py-1 ${trendDays === d ? 'bg-primary text-white font-semibold' : 'bg-app-bg text-text-secondary hover:text-text-primary'}`}
                onClick={() => setTrendDays(d)}
              >
                {d}D
              </button>
            ))}
          </div>
        </div>
        <div className="h-56 mt-2">
          {loading ? (
            <div className="h-full flex items-center justify-center text-xs text-text-muted">Loading trend…</div>
          ) : (
            <Bar data={chartData} options={chartOptions} />
          )}
        </div>
      </div>
    )
  }

  // 6. Category-Wise Sales Breakdown
  if (widget.widget_key === 'category_sales_breakdown') {
    const cats = data?.categories || []
    return (
      <div className={`bg-app-card border border-border rounded-xl p-5 ${colClass}`}>
        <div className="flex items-center justify-between pb-3 mb-3 border-b border-border">
          <div>
            <h3 className="text-sm font-semibold text-text-primary m-0">{widget.name}</h3>
            <p className="text-xs text-text-muted m-0">Revenue contribution by product category</p>
          </div>
          <span className="text-xs font-mono font-bold text-primary">
            Total: {shortInr(data?.total_sales || 0)}
          </span>
        </div>
        {loading ? (
          <div className="py-8 text-center text-xs text-text-muted">Loading categories…</div>
        ) : cats.length === 0 ? (
          <div className="py-8 text-center text-xs text-text-muted">No sales for assigned categories in this period</div>
        ) : (
          <div className="space-y-3">
            {cats.map((c: any) => (
              <div key={c.category_id} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-text-primary">{c.category_name}</span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-medium text-text-primary">{inr(c.sales)}</span>
                    <span className="text-text-muted">({c.share_pct}%)</span>
                  </div>
                </div>
                <div className="w-full bg-app-bg rounded-full h-2 overflow-hidden border border-border/40">
                  <div
                    className="bg-primary h-full rounded-full transition-all"
                    style={{ width: `${Math.min(100, c.share_pct || 0)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  // 7. Store-Wise Sales Comparison
  if (widget.widget_key === 'store_sales_comparison') {
    const stores = data?.stores || []
    return (
      <div className={`bg-app-card border border-border rounded-xl p-5 ${colClass}`}>
        <div className="flex items-center justify-between pb-3 mb-3 border-b border-border">
          <div>
            <h3 className="text-sm font-semibold text-text-primary m-0">{widget.name}</h3>
            <p className="text-xs text-text-muted m-0">Performance ranking across authorized stores</p>
          </div>
          <span className="text-xs text-text-muted">{stores.length} outlets</span>
        </div>
        {loading ? (
          <div className="py-8 text-center text-xs text-text-muted">Loading stores…</div>
        ) : stores.length === 0 ? (
          <div className="py-8 text-center text-xs text-text-muted">No stores within current scope</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-border text-text-muted uppercase text-[10px]">
                  <th className="pb-2 font-semibold">Store</th>
                  <th className="pb-2 text-right font-semibold">Today Sales</th>
                  <th className="pb-2 text-right font-semibold">Bills</th>
                  <th className="pb-2 text-right font-semibold">MTD Sales</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {stores.map((s: any) => (
                  <tr key={s.id} className="hover:bg-app-bg/60">
                    <td className="py-2.5 font-medium text-text-primary">
                      {s.name}
                      {s.code && <span className="text-[10px] text-text-muted ml-1.5 font-mono">({s.code})</span>}
                    </td>
                    <td className="py-2.5 text-right font-mono font-semibold text-text-primary">
                      {inr(s.today_sales)}
                    </td>
                    <td className="py-2.5 text-right text-text-secondary">
                      {s.today_bills}
                    </td>
                    <td className="py-2.5 text-right font-mono text-text-secondary">
                      {shortInr(s.month_sales)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    )
  }

  // 8. Top Selling Products
  if (widget.widget_key === 'top_selling_products') {
    const products = data?.products || []
    return (
      <div className={`bg-app-card border border-border rounded-xl p-5 ${colClass}`}>
        <div className="flex items-center justify-between pb-3 mb-3 border-b border-border">
          <div>
            <h3 className="text-sm font-semibold text-text-primary m-0">{widget.name}</h3>
            <p className="text-xs text-text-muted m-0">Top items by revenue in assigned scope</p>
          </div>
        </div>
        {loading ? (
          <div className="py-8 text-center text-xs text-text-muted">Loading products…</div>
        ) : products.length === 0 ? (
          <div className="py-8 text-center text-xs text-text-muted">No sales items found within scope</div>
        ) : (
          <div className="space-y-2.5">
            {products.map((p: any, idx: number) => (
              <div key={p.id || idx} className="flex items-center justify-between text-xs py-1.5 border-b border-border/40 last:border-none">
                <div className="flex items-center gap-2.5 min-w-0 pr-2">
                  <span className="font-mono text-[11px] font-bold text-text-muted w-4">{idx + 1}.</span>
                  <div className="truncate">
                    <p className="font-medium text-text-primary m-0 truncate">{p.name}</p>
                    <span className="text-[10px] text-text-muted">Code: {p.item_code} {p.category_name ? `• ${p.category_name}` : ''}</span>
                  </div>
                </div>
                <div className="text-right whitespace-nowrap pl-2">
                  <span className="font-mono font-semibold text-text-primary block">{inr(p.value)}</span>
                  <span className="text-[10px] text-text-muted">{Number(p.qty).toFixed(0)} units</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  // 9. Slow-Moving Products
  if (widget.widget_key === 'slow_moving_products') {
    const items = data?.slow_moving || []
    return (
      <div className={`bg-app-card border border-border rounded-xl p-5 ${colClass}`}>
        <div className="flex items-center justify-between pb-3 mb-3 border-b border-border">
          <div>
            <h3 className="text-sm font-semibold text-text-primary m-0">{widget.name}</h3>
            <p className="text-xs text-text-muted m-0">Overstocked items with minimal movement in past 30 days</p>
          </div>
        </div>
        {loading ? (
          <div className="py-8 text-center text-xs text-text-muted">Loading slow moving…</div>
        ) : items.length === 0 ? (
          <div className="py-8 text-center text-xs text-text-muted">Healthy stock movement across scope!</div>
        ) : (
          <div className="space-y-2.5">
            {items.map((item: any) => (
              <div key={item.id} className="flex items-center justify-between text-xs py-1.5 border-b border-border/40 last:border-none">
                <div className="truncate pr-2">
                  <p className="font-medium text-text-primary m-0 truncate">{item.name}</p>
                  <span className="text-[10px] text-text-muted">Code: {item.item_code} • {item.category_name}</span>
                </div>
                <div className="text-right whitespace-nowrap">
                  <span className="font-mono font-semibold text-amber-600 block">{item.stock_qty} in stock</span>
                  <span className="text-[10px] text-text-muted">Sold: {item.sold_30d} (30d)</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  // 10. Near-Expiry Batches (≤5d, ≤15d, ≤30d with vendor contact)
  if (widget.widget_key === 'near_expiry_batches') {
    const batches = data?.batches || []
    return (
      <div className={`bg-app-card border border-border rounded-xl p-5 ${colClass}`}>
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-3 border-b border-border">
          <div>
            <h3 className="text-sm font-semibold text-text-primary m-0">{widget.name}</h3>
            <p className="text-xs text-text-muted m-0">Critical expiry alerts with supplier contact</p>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300">
              ≤5d: {data?.critical_5d_count || 0}
            </span>
            <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
              ≤15d: {data?.warning_15d_count || 0}
            </span>
            <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300">
              ≤30d: {data?.watch_30d_count || 0}
            </span>
          </div>
        </div>
        {loading ? (
          <div className="py-8 text-center text-xs text-text-muted">Loading expiry alerts…</div>
        ) : batches.length === 0 ? (
          <div className="py-8 text-center text-xs text-emerald-600 font-medium">No expiring batches within next 30 days!</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-border text-text-muted uppercase text-[10px]">
                  <th className="pb-2 font-semibold">Product & Batch</th>
                  <th className="pb-2 font-semibold">Location</th>
                  <th className="pb-2 font-semibold">Expiry Date</th>
                  <th className="pb-2 font-semibold text-right">Stock</th>
                  <th className="pb-2 font-semibold">Vendor Contact</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {batches.map((b: any) => {
                  const isCritical = b.days_left <= 5
                  const isWarning = b.days_left > 5 && b.days_left <= 15
                  return (
                    <tr key={b.batch_id} className="hover:bg-app-bg/60">
                      <td className="py-2.5 pr-2">
                        <span className="font-medium text-text-primary block truncate max-w-[180px]">{b.product_name}</span>
                        <span className="text-[10px] text-text-muted font-mono">B#{b.batch_no}</span>
                      </td>
                      <td className="py-2.5 text-text-secondary">{b.outlet_name}</td>
                      <td className="py-2.5 whitespace-nowrap">
                        <span className={`px-2 py-0.5 rounded font-semibold text-[11px] ${
                          isCritical
                            ? 'bg-red-100 text-red-700 dark:bg-red-950/80 dark:text-red-300'
                            : isWarning
                            ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/80 dark:text-amber-300'
                            : 'bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300'
                        }`}>
                          {b.days_left}d ({dmy(b.expiry_date)})
                        </span>
                      </td>
                      <td className="py-2.5 text-right font-mono font-semibold text-text-primary">
                        {b.stock_qty}
                      </td>
                      <td className="py-2.5 whitespace-nowrap">
                        <span className="block font-medium text-text-primary">{b.supplier_name || '—'}</span>
                        {b.supplier_phone && (
                          <a
                            href={`tel:${b.supplier_phone}`}
                            className="text-[11px] text-primary hover:underline flex items-center gap-1"
                          >
                            <i className="fas fa-phone-alt text-[9px]" /> {b.supplier_phone}
                          </a>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    )
  }

  // 11. Out-of-Stock Alerts
  if (widget.widget_key === 'out_of_stock_alerts') {
    const stockouts = data?.stockouts || []
    return (
      <div className={`bg-app-card border border-border rounded-xl p-5 ${colClass}`}>
        <div className="flex items-center justify-between pb-3 mb-3 border-b border-border">
          <div>
            <h3 className="text-sm font-semibold text-text-primary m-0">{widget.name}</h3>
            <p className="text-xs text-text-muted m-0">Zero-stock items with active demand in last 30 days</p>
          </div>
          <span className="text-xs text-red-500 font-bold">{stockouts.length} items</span>
        </div>
        {loading ? (
          <div className="py-8 text-center text-xs text-text-muted">Loading stockouts…</div>
        ) : stockouts.length === 0 ? (
          <div className="py-8 text-center text-xs text-emerald-600 font-medium">No stockouts detected!</div>
        ) : (
          <div className="space-y-2">
            {stockouts.map((s: any, idx: number) => (
              <div key={idx} className="flex items-center justify-between text-xs py-1.5 border-b border-border/40 last:border-none">
                <div className="truncate pr-2">
                  <p className="font-medium text-text-primary m-0 truncate">{s.name}</p>
                  <span className="text-[10px] text-text-muted">Outlet: {s.outlet} • Code: {s.item_code}</span>
                </div>
                <div className="text-right whitespace-nowrap">
                  <span className="text-red-500 font-bold block">0 in stock</span>
                  <span className="text-[10px] text-text-muted">{s.sold_qty} sold (30d)</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  // 12. Pending Operations Cockpit
  if (widget.widget_key === 'pending_operations_summary') {
    return (
      <div className={`bg-app-card border border-border rounded-xl p-5 ${colClass}`}>
        <div className="flex items-center justify-between pb-3 mb-3 border-b border-border">
          <div>
            <h3 className="text-sm font-semibold text-text-primary m-0">{widget.name}</h3>
            <p className="text-xs text-text-muted m-0">Pending approvals, inward orders, and branch transfers</p>
          </div>
          <span className="text-xs px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 font-bold">
            {data?.total_pending ?? 0} Actions Pending
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-2">
          <Link to="/purchases/po" className="p-3 rounded-lg bg-app-bg border border-border hover:border-primary/50 transition-all text-center">
            <span className="text-xs text-text-muted block">Purchase Orders</span>
            <span className="text-xl font-bold font-mono text-text-primary block mt-1">{data?.pending_po ?? 0}</span>
            <span className="text-[10px] text-amber-600 font-medium">Pending Release</span>
          </Link>
          <Link to="/purchases/grn" className="p-3 rounded-lg bg-app-bg border border-border hover:border-primary/50 transition-all text-center">
            <span className="text-xs text-text-muted block">Pending GRN</span>
            <span className="text-xl font-bold font-mono text-text-primary block mt-1">{data?.pending_grn ?? 0}</span>
            <span className="text-[10px] text-amber-600 font-medium">To Inward</span>
          </Link>
          <Link to="/purchases/returns" className="p-3 rounded-lg bg-app-bg border border-border hover:border-primary/50 transition-all text-center">
            <span className="text-xs text-text-muted block">Purchase Returns</span>
            <span className="text-xl font-bold font-mono text-text-primary block mt-1">{data?.pending_prn ?? 0}</span>
            <span className="text-[10px] text-amber-600 font-medium">PRN Open</span>
          </Link>
          <Link to="/logistics/list" className="p-3 rounded-lg bg-app-bg border border-border hover:border-primary/50 transition-all text-center">
            <span className="text-xs text-text-muted block">Branch Transfers</span>
            <span className="text-xl font-bold font-mono text-text-primary block mt-1">{data?.pending_transfers ?? 0}</span>
            <span className="text-[10px] text-amber-600 font-medium">In Transit</span>
          </Link>
        </div>
      </div>
    )
  }

  // 13. Vendor Outstanding Summary
  if (widget.widget_key === 'vendor_outstanding_summary') {
    return (
      <div className={`bg-app-card border border-border rounded-xl p-5 ${colClass}`}>
        <div className="flex items-center justify-between pb-3 mb-3 border-b border-border">
          <div>
            <h3 className="text-sm font-semibold text-text-primary m-0">{widget.name}</h3>
            <p className="text-xs text-text-muted m-0">Accounts payable and supplier credit exposure</p>
          </div>
          <Link to="/accounts/bills" className="text-xs text-primary hover:underline">
            View Bills <i className="fas fa-arrow-right ml-1" />
          </Link>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-2">
          <div className="p-3 rounded-lg bg-app-bg border border-border">
            <span className="text-xs text-text-muted block">Total Outstanding</span>
            <span className="text-xl font-bold font-mono text-text-primary block mt-1">
              {loading ? '…' : shortInr(data?.total_outstanding || 0)}
            </span>
          </div>
          <div className="p-3 rounded-lg bg-app-bg border border-border">
            <span className="text-xs text-text-muted block">Overdue Amount</span>
            <span className="text-xl font-bold font-mono text-red-500 block mt-1">
              {loading ? '…' : shortInr(data?.overdue_amount || 0)}
            </span>
          </div>
          <div className="p-3 rounded-lg bg-app-bg border border-border">
            <span className="text-xs text-text-muted block">Unpaid Bills</span>
            <span className="text-xl font-bold font-mono text-text-primary block mt-1">
              {loading ? '…' : `${data?.unpaid_bills_count ?? 0} bills`}
            </span>
          </div>
        </div>
      </div>
    )
  }

  // Generic fallback
  return (
    <div className={`bg-app-card border border-border rounded-xl p-5 ${colClass}`}>
      <span className="text-xs font-semibold text-text-secondary">{widget.name}</span>
      <p className="text-xs text-text-muted mt-2">Widget ready: {widget.widget_key}</p>
    </div>
  )
}

// Small helpers shared by the Accounts pages.
export const inr = (v: unknown) => '₹' + Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const dmy = (v?: string | null) => v ? new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
export const today = () => new Date().toLocaleDateString('en-CA')
export const daysAgo = (n: number) => new Date(Date.now() - n * 864e5).toLocaleDateString('en-CA')
export const errMsg = (e: any): string => {
  const d = e?.response?.data?.detail
  if (Array.isArray(d)) return d.map((x: any) => x.msg).join(', ')
  if (typeof d !== 'string') return e?.message || 'Something went wrong'
  const m = [...d.matchAll(/'msg': ["'](?:Value error, )?(.*?)["'], 'input'/g)].map(x => x[1])
  return m.length ? m.join(' • ') : d
}

export function Stat({ label, value, tone, hint, onClick }: { label: string; value: React.ReactNode; tone?: string; hint?: React.ReactNode; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} disabled={!onClick}
      className="bg-app-card border border-border rounded-fiori px-4 py-3 text-left enabled:hover:border-primary transition-colors">
      <div className="text-[11px] uppercase tracking-wide text-text-muted">{label}</div>
      <div className={`text-[20px] font-semibold ${tone || 'text-text-primary'}`}>{value}</div>
      {hint && <div className="text-[11px] text-text-muted">{hint}</div>}
    </button>
  )
}

export const Section = ({ title, right, children, tone }: { title: string; right?: React.ReactNode; children: React.ReactNode; tone?: string }) => (
  <section className={`bg-app-card border ${tone || 'border-border'} rounded-fiori p-3`}>
    <div className="flex items-center justify-between mb-2 gap-2">
      <h4 className="text-[12px] font-semibold uppercase tracking-wider text-primary m-0">{title}</h4>{right}
    </div>
    {children}
  </section>
)

export function csv(name: string, cols: string[], rows: Record<string, unknown>[]) {
  const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([[cols.join(','), ...rows.map(r => cols.map(c => cell(r[c])).join(','))].join('\n')], { type: 'text/csv' }))
  a.download = name
  a.click()
}

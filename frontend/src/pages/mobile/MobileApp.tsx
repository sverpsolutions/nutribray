import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../../api/axios';
import { useAuthStore } from '../../store/authStore';

// Phone app for plant staff, installable from the browser ("Add to Home screen"). Open it at /m.
type Tab = 'home' | 'orders' | 'stock' | 'count' | 'more' | 'transfers' | 'production';
const num = (v: unknown, d = 0) => Number(v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: d });
const msg = (e: any) => e?.response?.data?.detail?.toString?.() || 'Something went wrong';

function useGet<T = any>(url: string, params?: object, every = 0) {
  const [data, setData] = useState<T | null>(null);
  const [busy, setBusy] = useState(true);
  const key = JSON.stringify(params ?? {});
  const load = useCallback((quiet = false) => {
    if (!quiet) setBusy(true);
    return api.get(url, { params: JSON.parse(key) }).then((r) => setData(r.data))
      .catch((e) => { if (!quiet) toast.error(msg(e)); }).finally(() => setBusy(false));
  }, [url, key]);
  useEffect(() => {
    load();
    if (!every) return;
    const t = setInterval(() => load(true), every);
    return () => clearInterval(t);
  }, [load, every]);
  return { data, busy, load };
}

const STATUS: Record<string, string> = {
  PENDING_APPROVAL: 'st st-warn', OPEN: 'st st-ok', PARTIAL: 'st st-info',
  COMPLETED: 'st st-none', CLOSED: 'st st-none', REJECTED: 'st st-bad', CANCELLED: 'st st-bad',
};
const label = (s: string) => (s === 'PENDING_APPROVAL' ? 'Waiting approval' : s === 'OPEN' ? 'Approved' : s.charAt(0) + s.slice(1).toLowerCase());

function Tile({ title, value, sub, tone, onClick }: { title: string; value: any; sub?: string; tone?: 'ok' | 'warn' | 'bad' | 'info'; onClick?: () => void }) {
  const c = Number(value) ? tone : undefined;   // a zero is never coloured
  return (
    <button onClick={onClick} className={`text-left rounded-xl border px-3.5 py-3 active:opacity-80 ${c ? 'border-transparent' : 'border-slate-200 bg-white'}`}
      style={c ? { background: `var(--st-${c}-bg)` } : undefined}>
      <div className="text-xs font-medium text-slate-500">{title}</div>
      <div className="text-3xl font-semibold leading-tight tabular-nums" style={{ color: c ? `var(--st-${c})` : 'var(--color-text-primary)' }}>{value}</div>
      {sub && <div className="text-xs text-slate-500">{sub}</div>}
    </button>
  );
}

const Search = ({ value, onChange, ph }: { value: string; onChange: (v: string) => void; ph: string }) => (
  <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={ph} type="search" inputMode="search"
    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-base outline-none focus:ring-2 focus:ring-primary/30" />
);

const Empty = ({ busy, text }: { busy: boolean; text: string }) => <div className="py-12 text-center text-slate-400">{busy ? 'Loading…' : text}</div>;

function Home({ go }: { go: (t: Tab, f?: string) => void }) {
  const { data: d, busy, load } = useGet('/manufacturing/plant-dashboard', {}, 60000);
  if (!d) return <Empty busy={busy} text="No data" />;
  const a = d.approvals, c = d.cards, p = d.planning;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3">
        <Tile title="Orders to approve" value={a.customer_orders} tone="warn" sub="Tap to review" onClick={() => go('orders', 'PENDING_APPROVAL')} />
        <Tile title="Transfers to approve" value={a.transfers} tone="warn" sub="Tap to review" onClick={() => go('transfers')} />
        <Tile title="Open orders" value={c.orders_pending} tone="info" sub={`${c.orders_overdue} overdue`} onClick={() => go('orders', 'OPEN')} />
        <Tile title="Shortages" value={p.with_shortage} tone="warn" sub={`${p.rm_short} raw · ${p.pm_short} packing`} />
      </div>
      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-500">Today in production</h2>
        <div className="grid grid-cols-3 gap-2 text-center">
          {[['Good', c.today_good, 'text-[var(--st-ok)]'], ['Rejected', c.today_rejected, 'text-[var(--st-bad)]'], ['Efficiency', c.today_efficiency == null ? '–' : `${num(c.today_efficiency, 1)}%`, 'text-[var(--st-info)]']].map(([t, v, k]: any) => (
            <div key={t} className="rounded-xl bg-white p-3 border border-slate-200"><div className={`text-xl font-bold ${k}`}>{typeof v === 'number' ? num(v) : v}</div><div className="text-xs text-slate-500">{t}</div></div>
          ))}
        </div>
      </section>
      <section className="rounded-xl bg-white p-4 border border-slate-200">
        <h2 className="mb-2 text-sm font-semibold text-slate-500">Waiting for a decision</h2>
        {[['Customer orders', a.customer_orders], ['Transfers', a.transfers], ['Printing jobs', a.print_jobs], ['Damages', a.damages], ['Production orders', a.production_orders], ['Finished goods QC', a.fg_qc]].map(([t, v]: any) => (
          <div key={t} className="flex justify-between border-b border-slate-100 py-2 last:border-0"><span>{t}</span><b className={`tabular-nums ${v ? 'text-[var(--st-warn)]' : 'text-slate-400'}`}>{v}</b></div>
        ))}
      </section>
      <button onClick={() => load()} className="w-full rounded-xl bg-white py-3 font-medium text-primary border border-slate-200 active:bg-slate-50">Refresh</button>
    </div>
  );
}

function Orders({ initial }: { initial: string }) {
  const [status, setStatus] = useState(initial);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<any>(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const { data, busy, load } = useGet<any[]>('/manufacturing/sales-orders', { status: status || undefined, search: q });
  useEffect(() => setStatus(initial), [initial]);
  const act = async (kind: 'approve' | 'reject') => {
    if (kind === 'reject' && !reason.trim()) return toast.error('Write a reason to reject');
    setSaving(true);
    try {
      await api.post(`/manufacturing/sales-orders/${sel.id}/${kind}`, kind === 'reject' ? { reason } : {});
      toast.success(kind === 'approve' ? 'Order approved' : 'Order rejected');
      setSel(null); setReason(''); load(true);
    } catch (e) { toast.error(msg(e)); } finally { setSaving(false); }
  };
  return (
    <div className="space-y-3">
      <Search value={q} onChange={setQ} ph="Search order, customer, item" />
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {[['PENDING_APPROVAL', 'Waiting approval'], ['OPEN', 'Approved'], ['PARTIAL', 'Partial'], ['', 'All']].map(([v, t]) => (
          <button key={v} onClick={() => setStatus(v)} className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium ${status === v ? 'bg-primary text-white' : 'bg-white text-slate-600 border border-slate-300'}`}>{t}</button>
        ))}
      </div>
      {!data?.length && <Empty busy={busy} text="No orders" />}
      {data?.map((o) => (
        <button key={o.id} onClick={() => setSel(o)} className="block w-full rounded-xl bg-white p-4 text-left border border-slate-200 active:bg-slate-50">
          <div className="flex items-center justify-between"><b>{o.so_no}</b><span className={`${STATUS[o.status] || 'bg-slate-100'}`}>{label(o.status)}</span></div>
          <div className="mt-1 text-sm text-slate-700">{o.customer}</div>
          <div className="text-sm text-slate-500">{o.product}</div>
          <div className="mt-2 flex justify-between text-xs text-slate-500"><span>Qty {num(o.ordered_qty)} {o.unit}</span><span>Due {o.delivery_date || '–'}</span></div>
        </button>
      ))}
      {sel && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/50" onClick={() => setSel(null)}>
          <div onClick={(e) => e.stopPropagation()} className="max-h-[85dvh] w-full overflow-y-auto rounded-t-3xl bg-white p-5" style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}>
            <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-slate-300" />
            <div className="flex items-center justify-between"><h3 className="text-xl font-bold">{sel.so_no}</h3><span className={`${STATUS[sel.status] || ''}`}>{label(sel.status)}</span></div>
            <dl className="mt-3 divide-y divide-slate-100 text-sm">
              {[['Customer', sel.customer], ['Customer PO', sel.customer_po_no], ['Item', sel.product], ['Brand', sel.brand], ['Ordered', `${num(sel.ordered_qty)} ${sel.unit}`], ['Dispatched', num(sel.dispatched_qty)],
                ['Order date', sel.so_date], ['Delivery', sel.delivery_date]].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 py-2"><dt className="text-slate-500">{k}</dt><dd className="text-right font-medium">{v || '–'}</dd></div>
              ))}
            </dl>
            {sel.status === 'PENDING_APPROVAL' && (
              <div className="mt-4 space-y-3">
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Reason (needed only to reject)" className="w-full rounded-xl border border-slate-200 p-3 text-base" />
                <div className="grid grid-cols-2 gap-3">
                  <button disabled={saving} onClick={() => act('reject')} className="rounded-xl bg-rose-100 py-3.5 font-semibold text-rose-700 active:bg-rose-200">Reject</button>
                  <button disabled={saving} onClick={() => act('approve')} className="rounded-xl bg-emerald-600 py-3.5 font-semibold text-white active:bg-emerald-700">Approve</button>
                </div>
              </div>
            )}
            <button onClick={() => setSel(null)} className="mt-3 w-full rounded-xl py-3 text-slate-500">Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Stock() {
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  useEffect(() => { const t = setTimeout(() => setDq(q), 350); return () => clearTimeout(t); }, [q]);
  const { data, busy } = useGet<any[]>('/manufacturing/stock', { search: dq });
  return (
    <div className="space-y-3">
      <Search value={q} onChange={setQ} ph="Search item, code or batch" />
      {!data?.length && <Empty busy={busy} text="No stock found" />}
      {data?.slice(0, 200).map((r, i) => (
        <div key={i} className="rounded-xl bg-white p-4 border border-slate-200">
          <div className="flex items-start justify-between gap-3">
            <div><div className="font-semibold leading-snug">{r.item}</div><div className="text-xs text-slate-500">{r.item_code}{r.batch_no ? ` · Batch ${r.batch_no}` : ''}{r.brand ? ` · ${r.brand}` : ''}</div></div>
            <div className="text-right"><div className="text-xl font-bold text-primary">{num(r.qty, 2)}</div><div className="text-xs text-slate-500">{r.unit}</div></div>
          </div>
          <div className="mt-2 flex justify-between text-xs text-slate-500"><span>{r.store}</span>{r.units_per_carton > 1 && <span>{r.cartons} cartons + {num(r.loose)} loose</span>}</div>
        </div>
      ))}
    </div>
  );
}

function Count() {
  const [open, setOpen] = useState<number | null>(null);
  return open ? <CountSheet id={open} back={() => setOpen(null)} /> : <CountList pick={setOpen} />;
}

function CountList({ pick }: { pick: (id: number) => void }) {
  const { data, busy } = useGet<any[]>('/manufacturing/stock-take');
  const rows = data?.filter((c) => c.status === 'COUNTING');
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500">Stock takes open for counting. Count blind and save; the manager approves on the desktop.</p>
      {!rows?.length && <Empty busy={busy} text="No stock take is open for counting" />}
      {rows?.map((c) => (
        <button key={c.id} onClick={() => pick(c.id)} className="block w-full rounded-xl bg-white p-4 text-left border border-slate-200 active:bg-slate-50">
          <div className="flex justify-between"><b>{c.count_no}</b><span className="text-sm text-slate-500">{c.counted}/{c.lines} counted</span></div>
          <div className="text-sm text-slate-600">{c.store}</div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-[var(--st-ok-dot)]" style={{ width: `${c.lines ? (c.counted / c.lines) * 100 : 0}%` }} /></div>
        </button>
      ))}
    </div>
  );
}

function CountSheet({ id, back }: { id: number; back: () => void }) {
  const { data, load } = useGet<any>(`/manufacturing/stock-take/${id}`);
  const [q, setQ] = useState('');
  const [vals, setVals] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);
  const lines: any[] = useMemo(() => (data?.lines ?? []).filter((l: any) => !q || `${l.item} ${l.item_code} ${l.barcode ?? ''} ${l.batch_no ?? ''}`.toLowerCase().includes(q.toLowerCase())), [data, q]);
  const dirty = Object.keys(vals).length;
  const save = async () => {
    setSaving(true);
    try {
      await api.post(`/manufacturing/stock-take/${id}/count`, { lines: Object.entries(vals).map(([k, v]) => ({ id: Number(k), counted_qty: v === '' ? null : Number(v) })) });
      toast.success(`${dirty} saved`); setVals({}); load(true);
    } catch (e) { toast.error(msg(e)); } finally { setSaving(false); }
  };
  return (
    <div className="space-y-3 pb-24">
      <button onClick={back} className="text-sm font-medium text-primary">‹ All stock takes</button>
      <h2 className="text-lg font-bold">{data?.count?.count_no}</h2>
      <Search value={q} onChange={setQ} ph="Search or type barcode" />
      {lines.map((l) => (
        <div key={l.id} className="flex items-center gap-3 rounded-xl bg-white p-3 border border-slate-200">
          <div className="min-w-0 flex-1"><div className="truncate font-medium">{l.item}</div><div className="text-xs text-slate-500">{l.item_code}{l.batch_no ? ` · ${l.batch_no}` : ''}</div></div>
          <input inputMode="decimal" type="number" min="0" step="any" placeholder={l.counted_qty != null ? String(Number(l.counted_qty)) : 'Qty'}
            value={vals[l.id] ?? ''} onChange={(e) => setVals({ ...vals, [l.id]: e.target.value })}
            className={`w-24 rounded-xl border px-3 py-2.5 text-right text-lg ${l.counted_qty != null && vals[l.id] === undefined ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200'}`} />
        </div>
      ))}
      {dirty > 0 && (
        <div className="fixed inset-x-0 bottom-16 z-40 p-3" style={{ bottom: 'calc(4rem + env(safe-area-inset-bottom))' }}>
          <button disabled={saving} onClick={save} className="w-full rounded-xl bg-primary py-4 text-lg font-semibold text-white active:bg-primary-hover">Save {dirty} count{dirty > 1 ? 's' : ''}</button>
        </div>
      )}
    </div>
  );
}

function Transfers() {
  const [status, setStatus] = useState('PENDING');
  const [sel, setSel] = useState<any>(null);
  const [adding, setAdding] = useState(false);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const { data, busy, load } = useGet<any[]>('/manufacturing/transfers', { status: status || undefined });
  const act = async (kind: 'approve' | 'reject') => {
    if (kind === 'reject' && reason.trim().length < 3) return toast.error('Write a reason to reject');
    setSaving(true);
    try {
      await api.post(`/manufacturing/transfers/${sel.id}/${kind}`, kind === 'reject' ? { reason } : {});
      toast.success(kind === 'approve' ? 'Transfer approved, stock moved' : 'Transfer rejected');
      setSel(null); setReason(''); load(true);
    } catch (e) { toast.error(msg(e)); } finally { setSaving(false); }
  };
  if (adding) return <NewTransfer back={(done) => { setAdding(false); if (done) { setStatus('PENDING'); load(true); } }} />;
  return (
    <div className="space-y-3">
      <button onClick={() => setAdding(true)} className="w-full rounded-xl bg-primary py-3.5 text-base font-semibold text-white active:bg-primary-hover">+ New transfer</button>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {[['PENDING', 'Waiting'], ['APPROVED', 'Approved'], ['REJECTED', 'Rejected'], ['', 'All']].map(([v, t]) => (
          <button key={v} onClick={() => setStatus(v)} className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium ${status === v ? 'bg-primary text-white' : 'bg-white text-slate-600 border border-slate-300'}`}>{t}</button>
        ))}
      </div>
      {!data?.length && <Empty busy={busy} text="No transfers" />}
      {data?.map((t) => (
        <button key={t.id} onClick={() => setSel(t)} className="block w-full rounded-xl bg-white p-4 text-left border border-slate-200 active:bg-slate-50">
          <div className="flex items-center justify-between"><b>{t.transfer_no}</b><span className={`${t.status === 'PENDING' ? 'st st-warn' : t.status === 'APPROVED' ? 'st st-ok' : 'st st-bad'}`}>{label(t.status)}</span></div>
          <div className="mt-1 text-sm text-slate-700">{t.from_store} → {t.to_store}</div>
          <div className="text-xs text-slate-500">{t.lines?.length || 0} item(s) · {t.requested} · {t.requested_by_name}</div>
        </button>
      ))}
      {sel && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/50" onClick={() => setSel(null)}>
          <div onClick={(e) => e.stopPropagation()} className="max-h-[85dvh] w-full overflow-y-auto rounded-t-3xl bg-white p-5" style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}>
            <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-slate-300" />
            <h3 className="text-xl font-bold">{sel.transfer_no}</h3>
            <div className="text-sm text-slate-500">{sel.from_store} → {sel.to_store}</div>
            <div className="mt-3 divide-y divide-slate-100">
              {sel.lines?.map((l: any) => (
                <div key={l.id} className="flex justify-between gap-3 py-2 text-sm"><div><div className="font-medium">{l.item}</div><div className="text-xs text-slate-500">{l.item_code}{l.batch_no ? ` · ${l.batch_no}` : ''}</div></div><b>{num(l.qty, 2)} {l.unit}</b></div>
              ))}
            </div>
            {sel.remarks && <p className="mt-2 text-sm text-slate-500">{sel.remarks}</p>}
            {sel.status === 'PENDING' && (
              <div className="mt-4 space-y-3">
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Reason (needed only to reject)" className="w-full rounded-xl border border-slate-200 p-3 text-base" />
                <div className="grid grid-cols-2 gap-3">
                  <button disabled={saving} onClick={() => act('reject')} className="rounded-xl bg-rose-100 py-3.5 font-semibold text-rose-700 active:bg-rose-200">Reject</button>
                  <button disabled={saving} onClick={() => act('approve')} className="rounded-xl bg-emerald-600 py-3.5 font-semibold text-white active:bg-emerald-700">Approve</button>
                </div>
              </div>
            )}
            <button onClick={() => setSel(null)} className="mt-3 w-full rounded-xl py-3 text-slate-500">Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

function NewTransfer({ back }: { back: (done?: boolean) => void }) {
  const { data: mine } = useGet<any[]>('/manufacturing/stores');
  const { data: all } = useGet<any[]>('/manufacturing/stores', { for_pick: true });
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [qty, setQty] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => { const t = setTimeout(() => setDq(q), 350); return () => clearTimeout(t); }, [q]);
  const { data: stock, busy } = useGet<any[]>('/manufacturing/stock', from ? { store_id: from, search: dq } : { store_id: -1 });
  const k = (r: any) => `${r.product_id}|${r.batch_no}|${r.brand_id}`;
  const picked = (stock ?? []).filter((r) => Number(qty[k(r)]) > 0);
  const send = async () => {
    if (!from || !to) return toast.error('Choose both stores');
    setSaving(true);
    try {
      await api.post('/manufacturing/transfers', { from_store_id: Number(from), to_store_id: Number(to),
        lines: picked.map((r) => ({ product_id: r.product_id, qty: Number(qty[k(r)]), batch_no: r.batch_no || '', brand_id: r.brand_id || 0 })) });
      toast.success('Transfer sent for approval'); back(true);
    } catch (e) { toast.error(msg(e)); } finally { setSaving(false); }
  };
  const sel = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-base';
  return (
    <div className="space-y-3 pb-24">
      <button onClick={() => back()} className="text-sm font-medium text-primary">‹ Back</button>
      <label className="block text-sm text-slate-500">From store
        <select value={from} onChange={(e) => { setFrom(e.target.value); setQty({}); }} className={sel}><option value="">Choose…</option>{mine?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <label className="block text-sm text-slate-500">To store
        <select value={to} onChange={(e) => setTo(e.target.value)} className={sel}><option value="">Choose…</option>{all?.filter((s) => String(s.id) !== from).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      {from && <Search value={q} onChange={setQ} ph="Search item or batch to send" />}
      {from && !stock?.length && <Empty busy={busy} text="No stock in this store" />}
      {stock?.slice(0, 100).map((r) => (
        <div key={k(r)} className="flex items-center gap-3 rounded-xl bg-white p-3 border border-slate-200">
          <div className="min-w-0 flex-1"><div className="truncate font-medium">{r.item}</div><div className="text-xs text-slate-500">{r.batch_no ? `${r.batch_no} · ` : ''}Available {num(r.qty, 2)} {r.unit}</div></div>
          <input type="number" inputMode="decimal" min="0" step="any" max={Number(r.qty)} placeholder="Qty" value={qty[k(r)] ?? ''} onChange={(e) => setQty({ ...qty, [k(r)]: e.target.value })} className="w-24 rounded-xl border border-slate-200 px-3 py-2.5 text-right text-lg" />
        </div>
      ))}
      {picked.length > 0 && (
        <div className="fixed inset-x-0 z-40 p-3" style={{ bottom: 'calc(4rem + env(safe-area-inset-bottom))' }}>
          <button disabled={saving} onClick={send} className="w-full rounded-xl bg-primary py-4 text-lg font-semibold text-white active:bg-primary-hover">Send {picked.length} item{picked.length > 1 ? 's' : ''} for approval</button>
        </div>
      )}
    </div>
  );
}

function Production() {
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const { data, busy } = useGet<any[]>('/manufacturing/prod/orders', { status: status || undefined, search: q }, 60000);
  return (
    <div className="space-y-3">
      <Search value={q} onChange={setQ} ph="Search order, item, customer" />
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {[['', 'All'], ['DRAFT', 'Draft'], ['READY', 'Ready'], ['MATERIAL_SHORTAGE', 'Shortage'], ['IN_PRODUCTION', 'Running'], ['AWAITING_QC', 'QC']].map(([v, t]) => (
          <button key={v} onClick={() => setStatus(v)} className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium ${status === v ? 'bg-primary text-white' : 'bg-white text-slate-600 border border-slate-300'}`}>{t}</button>
        ))}
      </div>
      {!data?.length && <Empty busy={busy} text="No production orders" />}
      {data?.map((o) => {
        const pct = Math.min(100, Number(o.planned_qty) ? (Number(o.completed_qty) / Number(o.planned_qty)) * 100 : 0);
        return (
          <div key={o.id} className="rounded-xl bg-white p-4 border border-slate-200">
            <div className="flex items-center justify-between"><b>{o.order_no}</b><span className={`${o.status === 'MATERIAL_SHORTAGE' ? 'st st-warn' : o.status === 'IN_PRODUCTION' ? 'st st-info' : 'st st-none'}`}>{label(o.status.replace(/_/g, ' '))}</span></div>
            <div className="mt-1 text-sm text-slate-700">{o.product}</div>
            <div className="text-xs text-slate-500">{o.customer || o.brand}{o.so_no ? ` · ${o.so_no}` : ''}</div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-[var(--st-ok-dot)]" style={{ width: `${pct}%` }} /></div>
            <div className="mt-1 flex justify-between text-xs text-slate-500"><span>Done {num(o.completed_qty)} of {num(o.planned_qty)}</span><span>Rejected {num(o.rejected_qty)}</span></div>
          </div>
        );
      })}
      <p className="pt-1 text-center text-xs text-slate-400">Material issue and output entry are done on the desktop, where materials are reconciled.</p>
    </div>
  );
}

function More({ go }: { go: (t: Tab) => void }) {
  const { user, logout } = useAuthStore();
  const nav = useNavigate();
  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-white p-4 border border-slate-200"><div className="text-lg font-bold">{(user as any)?.name || (user as any)?.username || 'User'}</div><div className="text-sm text-slate-500">{(user as any)?.role || ''}</div></div>
      {([['transfers', 'Stock transfers', 'Request, approve or reject'], ['production', 'Production orders', 'What is running and how much is done']] as [Tab, string, string][]).map(([k, t, d]) => (
        <button key={k} onClick={() => go(k)} className="w-full rounded-xl bg-white p-4 text-left border border-slate-200 active:bg-slate-50"><div className="font-semibold">{t}</div><div className="text-sm text-slate-500">{d}</div></button>
      ))}
      <button onClick={() => nav('/manufacturing/plant')} className="w-full rounded-xl bg-white p-4 text-left font-medium border border-slate-200 active:bg-slate-50">Open full desktop version</button>
      <button onClick={() => { logout(); nav('/login'); }} className="w-full rounded-xl bg-rose-50 p-4 text-left font-medium text-rose-700 active:bg-rose-100">Log out</button>
      <p className="pt-2 text-center text-xs text-slate-400">Tip: use your browser menu → "Add to Home screen" to install this app.</p>
    </div>
  );
}

const TABS: [Tab, string, string][] = [['home', 'Home', 'M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z'], ['orders', 'Orders', 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6'],
  ['stock', 'Stock', 'M3 7l9-4 9 4-9 4zM3 7v10l9 4 9-4V7'], ['count', 'Count', 'M5 4h14v16H5zM9 9l2 2 4-4M9 15h6'], ['more', 'More', 'M5 12h.01M12 12h.01M19 12h.01']];

export default function MobileApp() {
  const token = useAuthStore((s) => s.access_token);
  const [tab, setTab] = useState<Tab>('home');
  const [filter, setFilter] = useState('PENDING_APPROVAL');
  useEffect(() => {
    const m = document.querySelector('link[rel="manifest"]');
    const old = m?.getAttribute('href');
    m?.setAttribute('href', '/manifest-mobile.webmanifest');
    return () => { if (old) m?.setAttribute('href', old); };
  }, []);
  if (!token) return <Navigate to="/login" replace />;
  const go = (t: Tab, f?: string) => { if (f !== undefined) setFilter(f); setTab(t); window.scrollTo(0, 0); };
  const title = TABS.find((t) => t[0] === tab)?.[1] ?? (tab === 'transfers' ? 'Transfers' : 'Production');
  return (
    <div className="min-h-dvh bg-white text-slate-800" style={{ fontFamily: 'var(--font-sans)' }}>
      <header className="sticky top-0 z-30 flex min-h-12 items-center justify-between px-4 text-slate-900" style={{ background: 'var(--color-sidebar)', paddingTop: 'env(safe-area-inset-top)' }}>
        <h1 className="text-base font-semibold">{title}</h1>
        <span className="text-xs text-slate-500">Nutribray plant</span>
      </header>
      <main className="p-4" style={{ paddingBottom: 'calc(5.5rem + env(safe-area-inset-bottom))' }}>
        {tab === 'home' && <Home go={go} />}
        {tab === 'orders' && <Orders initial={filter} />}
        {tab === 'stock' && <Stock />}
        {tab === 'count' && <Count />}
        {tab === 'more' && <More go={go} />}
        {tab === 'transfers' && <Transfers />}
        {tab === 'production' && <Production />}
      </main>
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-slate-200" style={{ background: 'var(--color-sidebar)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {TABS.map(([k, t, path]) => (
          <button key={k} onClick={() => go(k, k === 'orders' ? filter : undefined)} className={`flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium ${tab === k || (k === 'more' && (tab === 'transfers' || tab === 'production')) ? 'text-primary' : 'text-slate-400'}`}>
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={tab === k ? 2.2 : 1.7} strokeLinecap="round" strokeLinejoin="round"><path d={path} /></svg>{t}
          </button>
        ))}
      </nav>
    </div>
  );
}

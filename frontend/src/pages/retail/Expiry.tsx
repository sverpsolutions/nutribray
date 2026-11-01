import { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import api from '../../api/axios';
import { useMyAccess } from '../../hooks/useMyAccess';
import { Badge, Stat, Table, Tabs, btnPri, btnSec, err, fmt, inp, key, useList } from '../manufacturing/mfgShared';

const TONE: Record<string, string> = { 'Already expired': 'bg-rose-100 text-rose-800', 'Within 7 days': 'bg-orange-100 text-orange-800',
  'Within 15 days': 'bg-amber-100 text-amber-800', 'Within 30 days': 'bg-yellow-100 text-yellow-800' };
const Band = ({ s }: { s: string }) => <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${TONE[s] || 'bg-slate-100 text-slate-700'}`}>{s}</span>;

export default function Expiry() {
  const me = useMyAccess();
  const tabs = ['Near Expiry & Batches', ...(me.can('expiry.remove_expired') ? ['Expired Item Out'] : []), ...(me.can('expiry.change_batch') ? ['Wrong Batch Correction'] : []),
    ...(me.can('expiry.edit') ? ['Expiry Date Correction', 'Warning Bands'] : []), 'Registers'];
  const [tab, setTab] = useState(tabs[0]);
  return (
    <div className="p-4 max-w-7xl mx-auto">
      <h1 className="text-xl font-bold text-slate-800 mb-1"><i className="fas fa-hourglass-half text-indigo-600 mr-2" />Expiry & Batches</h1>
      <p className="text-xs text-slate-500 mb-4">Every figure uses the batch's own expiry date and stock at the store. Removals and corrections go to Approvals — nothing changes stock until approved.</p>
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'Near Expiry & Batches' && <Batches />}
      {tab === 'Expired Item Out' && <ExpiredOut />}
      {tab === 'Wrong Batch Correction' && <BatchFix />}
      {tab === 'Expiry Date Correction' && <ExpiryFix />}
      {tab === 'Warning Bands' && <Bands />}
      {tab === 'Registers' && <Registers />}
    </div>
  );
}

const StorePick = ({ value, onChange, all = true }: { value: string; onChange: (v: string) => void; all?: boolean }) => {
  const me = useMyAccess();
  return (
    <select className={`${inp} w-60`} value={value} onChange={(e) => onChange(e.target.value)}>
      {all && <option value="">All my stores (consolidated)</option>}{!all && <option value="">Choose store…</option>}
      {me.stores.map((s) => <option key={s.id} value={s.id}>{s.outlet_name}</option>)}
    </select>
  );
};

function Batches() {
  const [bands] = useList<any>('/expiry/bands');
  const [store, setStore] = useState('');
  const [days, setDays] = useState('90');
  const [q, setQ] = useState('');
  const [rows] = useList<any>('/expiry/batches', { outlet_id: store || undefined, within_days: days === 'all' ? undefined : days === '0' ? undefined : Number(days),
    expired_only: days === '0', search: q });
  const by = useMemo(() => rows.reduce((m: any, r: any) => { m[r.status] = m[r.status] || { n: 0, v: 0 }; m[r.status].n++; m[r.status].v += r.stock_value || 0; return m; }, {}), [rows]);
  return (
    <>
      <div className="flex flex-wrap gap-2 mb-3">
        <StorePick value={store} onChange={setStore} />
        <select className={`${inp} w-48`} value={days} onChange={(e) => setDays(e.target.value)}>
          {bands.map((b) => <option key={b.days} value={b.days}>{b.label}</option>)}<option value="all">All batches</option>
        </select>
        <input className={`${inp} w-64`} placeholder="Item / code / batch / GRN" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2 mb-3">
        {Object.entries(by).map(([k, v]: any) => <Stat key={k} label={k} value={v.n} sub={`₹${fmt(v.v)}`} tone={k === 'Already expired' ? 'red' : k === 'OK' ? 'green' : 'amber'} />)}
      </div>
      <Table rows={rows} empty="No batches in this window." cols={[
        ['Store', (r) => r.store], ['Code', (r) => r.item_code], ['Item', (r) => r.item], ['Batch', (r) => r.batch_no],
        ['GRN', (r) => r.grn_no ? <>{r.grn_no}<div className="text-[11px] text-slate-500">{r.grn_date}</div></> : '—'],
        ['Mfg', (r) => r.mfg_date || '—'], ['Expiry', (r) => <b>{r.exp_date}</b>], ['Days', (r) => r.days_left, 'text-right'],
        ['Available', (r) => fmt(r.qty), 'text-right'], ['Value', (r) => `₹${fmt(r.stock_value)}`, 'text-right'],
        ['Status', (r) => <><Band s={r.status} />{r.removal_pending > 0 && <div className="text-[11px] text-amber-700">{fmt(r.removal_pending)} removal pending</div>}</>],
      ]} />
    </>
  );
}

function ExpiredOut() {
  const [store, setStore] = useState('');
  const [rows, load] = useList<any>(store ? '/expiry/batches' : '', { outlet_id: store, expired_only: true });
  const [sel, setSel] = useState<Record<number, string>>({});
  const [f, setF] = useState<any>({ reason: '', disposition: 'WRITE_OFF', photo: '' });
  const upload = async (file: File) => {
    const fd = new FormData(); fd.append('file', file);
    try { setF({ ...f, photo: (await api.post('/approvals/file', fd, { headers: { 'Content-Type': 'multipart/form-data' } })).data.path }); } catch (e) { err(e); }
  };
  const submit = async () => {
    const lines = Object.entries(sel).filter(([, q]) => Number(q) > 0).map(([b, q]) => ({ batch_id: Number(b), qty: Number(q) }));
    if (!lines.length) return toast.error('Enter the quantity to remove');
    try {
      const r = await api.post('/expiry/removals', { outlet_id: Number(store), lines, ...f, photo: f.photo || null, request_key: key().slice(0, 40) });
      toast.success(`${r.data.length} removal request(s) sent for approval`); setSel({}); load();
    } catch (e) { err(e); }
  };
  return (
    <div className="space-y-3">
      <StorePick value={store} onChange={setStore} all={false} />
      {store && <>
        <Table rows={rows} empty="No expired stock at this store." cols={[
          ['Item', (r) => <>{r.item}<div className="text-[11px] text-slate-500">{r.item_code}</div></>], ['Batch', (r) => r.batch_no], ['Expiry', (r) => r.exp_date],
          ['GRN', (r) => r.grn_no || '—'], ['Available', (r) => fmt(r.qty), 'text-right'], ['Already requested', (r) => fmt(r.removal_pending), 'text-right'],
          ['Remove qty', (r) => <input type="number" min={0} max={r.qty - r.removal_pending} className={`${inp} w-24`} value={sel[r.batch_id] || ''}
            disabled={r.qty - r.removal_pending <= 0} onChange={(e) => setSel({ ...sel, [r.batch_id]: e.target.value })} />],
        ]} />
        <div className="bg-white border rounded-lg p-3 grid md:grid-cols-3 gap-3 items-end">
          <input className={inp} placeholder="Reason (required)" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
          <select className={inp} value={f.disposition} onChange={(e) => setF({ ...f, disposition: e.target.value })}>
            <option value="WRITE_OFF">Write off</option><option value="RETURN_TO_VENDOR">Return to vendor</option><option value="DESTROY">Destroy</option><option value="QUARANTINE">Quarantine</option>
          </select>
          <div className="flex items-center gap-2 text-sm"><input type="file" accept="image/*,.pdf" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />{f.photo && <span className="text-emerald-700">attached</span>}</div>
          <div className="md:col-span-3 flex justify-end"><button className={btnPri} onClick={submit}>Send for approval</button></div>
        </div>
      </>}
    </div>
  );
}

function BatchFix() {
  const [no, setNo] = useState('');
  const [bill, setBill] = useState<any>(null);
  const [pick, setPick] = useState<any>({});
  const find = () => api.get('/expiry/invoice-lines', { params: { invoice_no: no } }).then((r) => setBill(r.data)).catch(err);
  const send = (ln: any) => {
    const p = pick[ln.id];
    if (!p?.to || !p?.reason) return toast.error('Choose the correct batch and give a reason');
    api.post('/expiry/batch-correction', { invoice_item_id: ln.id, to_batch_id: Number(p.to), reason: p.reason })
      .then((r) => { toast.success(r.data.status === 'APPROVED' ? 'Corrected' : `Request ${r.data.request_no} sent for approval`); find(); }).catch(err);
  };
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">When the wrong batch was picked at billing: the bill keeps its history; an approved correction gives stock back to the wrong batch and takes it from the right one (item total unchanged).</p>
      <div className="flex gap-2"><input className={`${inp} w-64`} placeholder="Bill number" value={no} onChange={(e) => setNo(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && find()} />
        <button className={btnSec} onClick={find}>Find bill</button></div>
      {bill && <Table rows={bill.lines} cols={[
        ['Item', (l) => l.item], ['Qty', (l) => fmt(l.qty)], ['Sold batch', (l) => <>{l.batch_no || '—'}<div className="text-[11px] text-slate-500">exp {l.expiry_date || '—'}</div></>],
        ['Correct batch', (l) => <select className={`${inp} w-56`} value={pick[l.id]?.to || ''} onChange={(e) => setPick({ ...pick, [l.id]: { ...pick[l.id], to: e.target.value } })}>
          <option value="">—</option>{l.batches.map((b: any) => <option key={b.batch_id} value={b.batch_id}>{b.batch_no} · exp {b.exp_date || '—'} · stock {fmt(b.qty)}</option>)}</select>],
        ['Reason', (l) => <input className={`${inp} w-56`} value={pick[l.id]?.reason || ''} onChange={(e) => setPick({ ...pick, [l.id]: { ...pick[l.id], reason: e.target.value } })} />],
        ['', (l) => l.last_request?.includes('PENDING') ? <span className="text-xs text-amber-700">{l.last_request}</span> : <button className={btnPri} disabled={!l.batch_id} onClick={() => send(l)}>Request correction</button>],
      ]} />}
    </div>
  );
}

function ExpiryFix() {
  const [q, setQ] = useState('');
  const [rows] = useList<any>('/expiry/batches', { search: q, include_zero: true });
  const [f, setF] = useState<any>(null);
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">Only for an expiry date keyed wrongly on the batch master (always needs approval — attach the supplier invoice / pack photo). To fix a sale's batch use Wrong Batch Correction.</p>
      <input className={`${inp} w-72`} placeholder="Search batch / item" value={q} onChange={(e) => setQ(e.target.value)} />
      {q.length >= 2 && <Table rows={rows.slice(0, 50)} cols={[['Store', (r) => r.store], ['Item', (r) => r.item], ['Batch', (r) => r.batch_no], ['Expiry', (r) => r.exp_date],
        ['', (r) => <button className={btnSec} onClick={() => setF({ batch_id: r.batch_id, label: `${r.item} · ${r.batch_no}`, old: r.exp_date, new_exp_date: '', reason: '' })}>Correct expiry</button>]]} />}
      {f && <div className="bg-white border rounded-lg p-3 flex flex-wrap gap-2 items-center">
        <b className="text-sm">{f.label}</b><span className="text-sm">current {f.old} →</span>
        <input type="date" className={`${inp} w-44`} value={f.new_exp_date} onChange={(e) => setF({ ...f, new_exp_date: e.target.value })} />
        <input className={`${inp} flex-1`} placeholder="Reason and source document (min 10 characters)" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
        <button className={btnPri} onClick={() => api.post('/expiry/expiry-correction', f).then((r) => { toast.success(`Request ${r.data.request_no} sent for approval`); setF(null); }).catch(err)}>Send for approval</button>
      </div>}
    </div>
  );
}

function Bands() {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => { api.get('/expiry/bands').then((r) => setRows(r.data)).catch(err); }, []);
  return (
    <div className="bg-white border rounded-lg p-3 space-y-2 max-w-lg">
      {rows.map((r, i) => (
        <div key={i} className="flex gap-2 items-center">
          <input type="number" className={`${inp} w-24`} value={r.days} disabled={r.days === 0} onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, days: Number(e.target.value) } : x))} />
          <span className="text-xs">days</span>
          <input className={inp} value={r.label} onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} />
          {r.days !== 0 && <button className="text-rose-600" onClick={() => setRows(rows.filter((_, j) => j !== i))}><i className="fas fa-trash" /></button>}
        </div>
      ))}
      <div className="flex gap-2"><button className={btnSec} onClick={() => setRows([...rows, { days: 45, label: 'Within 45 days' }])}>Add band</button>
        <button className={btnPri} onClick={() => api.put('/expiry/bands', rows).then(() => toast.success('Saved')).catch(err)}>Save bands</button></div>
    </div>
  );
}

function Registers() {
  const [rem] = useList<any>('/expiry/removals');
  const [cor] = useList<any>('/expiry/corrections');
  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-sm">Expired stock removed</h3>
      <Table rows={rem} empty="None yet." cols={[['Request', (r) => r.request_no], ['Store', (r) => r.store], ['Item', (r) => r.item], ['Batch', (r) => r.batch_no],
        ['Expiry', (r) => r.exp_date], ['Qty', (r) => fmt(r.qty)], ['Value', (r) => `₹${fmt(r.cost_value)}`], ['How', (r) => r.disposition], ['Reason', (r) => r.reason],
        ['By / approved', (r) => `${r.requested_by_name || ''} / ${r.approved_by_name || ''}`]]} />
      <h3 className="font-semibold text-sm">Batch & expiry corrections</h3>
      <Table rows={cor} empty="None yet." cols={[['Request', (r) => r.request_no], ['Kind', (r) => <Badge s={r.kind === 'EXPIRY' ? 'SUPERSEDED' : 'APPROVED'} />],
        ['Bill', (r) => r.invoice_no || '—'], ['Item', (r) => r.item], ['From', (r) => `${r.from_batch_no || ''} (${r.from_expiry || '—'})`],
        ['To', (r) => `${r.to_batch_no || ''} (${r.to_expiry || '—'})`], ['Qty', (r) => r.qty == null ? '—' : fmt(r.qty)], ['Reason', (r) => r.reason],
        ['By / approved', (r) => `${r.requested_by_name || ''} / ${r.approved_by_name || ''}`]]} />
    </div>
  );
}

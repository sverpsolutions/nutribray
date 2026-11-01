import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { saveAs } from 'file-saver';
import api from '../../api/axios';
import { ItemPicker, Stat, Table, Tabs, btnPri, btnSec, ctnText, err, fmt, inp, useList } from './mfgShared';

const COLOR: Record<string, string> = { GREEN: 'bg-emerald-600', AMBER: 'bg-amber-500', RED: 'bg-rose-600' };
const ST: Record<string, string> = { Available: 'text-emerald-700', 'Awaiting Warehouse Transfer': 'text-sky-700', 'Awaiting Quality Approval': 'text-violet-700',
  'Awaiting Purchase': 'text-amber-700', 'Partially Available': 'text-orange-700', Short: 'text-rose-700 font-bold' };
const TYPE: Record<string, string> = { RM: 'Raw', PM: 'Packing', FG: 'Finished', SFG: 'Semi', CONS: 'Consumable', OTH: 'Other' };

const Overall = ({ o }: { o: any }) => o ? <span className={`px-3 py-1 rounded-full text-white text-xs font-bold ${COLOR[o.color]}`}>{o.color} · {o.label}</span> : null;

const REPORT = '/manufacturing/planning';
async function download(scope: string, fmt: 'xlsx' | 'pdf') {
  try {
    const r = await api.get(`${REPORT}/report`, { params: { scope, fmt }, responseType: 'blob' });
    saveAs(r.data, `material_requirement_${scope.replace(':', '_')}.${fmt}`);
  } catch (e: any) {
    const t = e?.response?.data instanceof Blob ? await e.response.data.text().catch(() => '') : '';
    let msg = 'Could not create the file';
    try { msg = JSON.parse(t)?.detail || msg; } catch { /* keep default */ }
    toast.error(msg);
  }
}

function ExportBar({ scope, label }: { scope: string; label: string }) {
  const [mail, setMail] = useState(false);
  return (
    <>
      <div className="flex gap-2">
        <button className={btnSec} onClick={() => download(scope, 'xlsx')}><i className="fas fa-file-excel text-emerald-700 mr-1" />Excel</button>
        <button className={btnSec} onClick={() => download(scope, 'pdf')}><i className="fas fa-file-pdf text-rose-700 mr-1" />PDF</button>
        <button className={btnSec} onClick={() => setMail(true)}><i className="fas fa-envelope text-indigo-700 mr-1" />E-mail</button>
      </div>
      {mail && <EmailDialog scope={scope} label={label} onClose={() => setMail(false)} />}
    </>
  );
}

function EmailDialog({ scope, label, onClose }: { scope: string; label: string; onClose: () => void }) {
  const [f, setF] = useState({ to: '', cc: '', subject: `Material requirement - ${label}`, message: 'Please find the material requirement attached.', xlsx: true, pdf: true });
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      await api.post(`${REPORT}/email`, { scope, to: f.to, cc: f.cc || null, subject: f.subject, message: f.message, formats: [f.xlsx && 'xlsx', f.pdf && 'pdf'].filter(Boolean) });
      toast.success(`Sent to ${f.to}`); onClose();
    } catch (e: any) {
      if (e?.response?.status === 503) {   // server mailbox not set up: save the file and open the user's own mail program
        await download(scope, 'xlsx');
        window.location.href = `mailto:${encodeURIComponent(f.to)}?subject=${encodeURIComponent(f.subject)}&body=${encodeURIComponent(f.message + '\n\n(Attach the downloaded Excel file.)')}`;
        toast('Server e-mail is not set up - the Excel was downloaded and your mail program opened. Attach the file and send.', { duration: 8000 });
        onClose();
      } else err(e);
    } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-bold text-slate-800">E-mail material requirement</h3>
        <label className="block text-xs font-semibold text-slate-600">To (comma separated)<input className={inp} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} placeholder="name@company.com" /></label>
        <label className="block text-xs font-semibold text-slate-600">Cc<input className={inp} value={f.cc} onChange={(e) => setF({ ...f, cc: e.target.value })} /></label>
        <label className="block text-xs font-semibold text-slate-600">Subject<input className={inp} value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} /></label>
        <label className="block text-xs font-semibold text-slate-600">Message<textarea className={inp} rows={3} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} /></label>
        <div className="flex gap-4 text-sm"><label><input type="checkbox" checked={f.xlsx} onChange={(e) => setF({ ...f, xlsx: e.target.checked })} /> Excel</label>
          <label><input type="checkbox" checked={f.pdf} onChange={(e) => setF({ ...f, pdf: e.target.checked })} /> PDF</label></div>
        <div className="flex justify-end gap-2"><button className={btnSec} onClick={onClose}>Cancel</button>
          <button className={btnPri} disabled={busy || !f.to.trim() || !(f.xlsx || f.pdf)} onClick={send}>{busy ? 'Sending…' : 'Send'}</button></div>
      </div>
    </div>
  );
}

// Draft PO: every shortage line with an editable quantity / rate and a supplier, grouped into one draft PO per supplier
function PoDialog({ lines, onClose }: { lines: any[]; onClose: () => void }) {
  const [sups, setSups] = useState<any[]>([]);
  const [rows, setRows] = useState(() => lines.map((l) => ({ product_id: l.product_id, item: l.item, item_code: l.item_code, unit: l.unit, short: l.shortage,
    qty: String(l.purchase_suggested), rate: '', supplier_id: l.supplier_id ? String(l.supplier_id) : '' })));
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get('/suppliers', { params: { per_page: 200 } }).then((r) => setSups(r.data?.data ?? r.data ?? [])).catch(() => setSups([])); }, []);
  const upd = (i: number, k: string, v: string) => setRows((rs) => rs.map((r, j) => j === i ? { ...r, [k]: v } : r));
  const all = (v: string) => setRows((rs) => rs.map((r) => ({ ...r, supplier_id: v })));
  const ok = rows.every((r) => r.supplier_id && Number(r.qty) > 0);
  const create = async () => {
    setBusy(true);
    try {
      const by: Record<string, any[]> = {};
      rows.forEach((r) => (by[r.supplier_id] ||= []).push({ product_id: r.product_id, qty: Number(r.qty), rate: r.rate === '' ? null : Number(r.rate) }));
      const made: string[] = [];
      for (const [sid, ls] of Object.entries(by)) { const r = await api.post(`${REPORT}/purchase`, { supplier_id: Number(sid), lines: ls }); made.push(...r.data.purchase_orders); }
      toast.success(`Draft PO ${made.join(', ')} created - open Purchases → PO List to review and approve`, { duration: 8000 }); onClose();
    } catch (e) { err(e); } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-[95vw] p-4 space-y-3 max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-bold text-slate-800">Create draft purchase order(s)</h3>
        <p className="text-xs text-slate-500">One draft PO is made per supplier. Nothing is sent to the supplier until the PO is approved in Purchases.</p>
        {sups.length === 0 && <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">No suppliers yet - add them in Masters → Suppliers first.</div>}
        <label className="text-xs font-semibold text-slate-600 flex items-center gap-2">Same supplier for all:
          <select className={`${inp} w-64`} value="" onChange={(e) => all(e.target.value)}><option value="">choose…</option>{sups.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <Table rows={rows} cols={[
          ['Material', (r) => <>{r.item}<div className="text-[11px] text-slate-500">{r.item_code}</div></>],
          ['Short', (r) => `${fmt(r.short)} ${r.unit}`, 'text-right'],
          ['Order qty', (r) => <input type="number" className={`${inp} w-24 text-right`} value={r.qty} onChange={(e) => upd(rows.indexOf(r), 'qty', e.target.value)} />],
          ['Rate (optional)', (r) => <input type="number" className={`${inp} w-24 text-right`} value={r.rate} placeholder="item price" onChange={(e) => upd(rows.indexOf(r), 'rate', e.target.value)} />],
          ['Supplier', (r) => <select className={inp} value={r.supplier_id} onChange={(e) => upd(rows.indexOf(r), 'supplier_id', e.target.value)}><option value="">choose…</option>{sups.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>],
        ]} />
        <div className="flex justify-end gap-2"><button className={btnSec} onClick={onClose}>Cancel</button>
          <button className={btnPri} disabled={busy || !ok} onClick={create}>{busy ? 'Creating…' : 'Create draft PO'}</button></div>
      </div>
    </div>
  );
}

function Lines({ lines, onTransfer, onBuy }: { lines: any[]; onTransfer?: (l: any[]) => void; onBuy?: boolean }) {
  const [po, setPo] = useState<any[] | null>(null);
  const tr = lines.filter((l) => l.transfer_suggested > 0);
  const buy = lines.filter((l) => l.purchase_suggested > 0);
  return (
    <div className="space-y-2">
      {[['Raw materials & ingredients', (l: any) => l.item_type !== 'PM', 'fa-wheat-awn', 'bg-emerald-600', 'border-emerald-200 bg-emerald-50/40'],
        ['Packing materials', (l: any) => l.item_type === 'PM', 'fa-box', 'bg-amber-500', 'border-amber-200 bg-amber-50/40']].map(([title, test, icon, bar, box]: any) => {
        const grp = lines.filter(test).sort((a, b) => (b.shortage > 0 ? 1 : 0) - (a.shortage > 0 ? 1 : 0) || String(a.item).localeCompare(String(b.item)));
        if (!grp.length) return null;
        const short = grp.filter((l) => l.shortage > 0).length;
        return (
          <div key={title} className={`rounded-lg border ${box} overflow-hidden`}>
            <div className={`${bar} text-white px-3 py-1.5 text-sm font-semibold flex items-center justify-between`}>
              <span><i className={`fas ${icon} mr-2`} />{title} <span className="opacity-80 font-normal">({grp.length})</span></span>
              <span className="text-xs font-medium">{short ? `${short} short` : 'All available'}</span>
            </div>
      <Table rows={grp} cols={[
        ['Component', (l) => <>{l.item}<div className="text-[11px] text-slate-500">{l.item_code} · {TYPE[l.item_type] || l.item_type}</div></>],
        ['Required', (l) => <>{fmt(l.net_required)} {l.unit}{l.round_up && Number(l.theoretical) !== Number(l.required) && <div className="text-[11px] text-slate-500">theoretical {fmt(l.theoretical)}</div>}</>, 'text-right'],
        ['Plant stock', (l) => fmt(l.plant), 'text-right'], ['Reserved (others)', (l) => fmt(l.reserved_other), 'text-right'],
        ['Available', (l) => fmt(l.available), 'text-right'], ['Shortage', (l) => l.shortage > 0 ? <b className="text-rose-700">{fmt(l.shortage)}</b> : '—', 'text-right'],
        ['Warehouse', (l) => fmt(l.warehouse), 'text-right'], ['QC hold', (l) => fmt(l.qc_hold), 'text-right'],
        ['PO pending', (l) => l.pending_po > 0 ? <>{fmt(l.pending_po)}<div className="text-[11px] text-slate-500">{l.po_eta || ''}</div></> : '—', 'text-right'],
        ['Transfer', (l) => l.transfer_suggested > 0 ? fmt(l.transfer_suggested) : '—', 'text-right'],
        ['Buy', (l) => l.purchase_suggested > 0 ? fmt(l.purchase_suggested) : '—', 'text-right'],
        ['Status', (l) => <span className={`text-xs ${ST[l.status]}`}>{l.status}</span>],
      ]} />
          </div>
        );
      })}
      <div className="flex gap-2">
        {onTransfer && tr.length > 0 && <button className={btnSec} onClick={() => onTransfer(tr)}><i className="fas fa-truck mr-1" />Request warehouse transfer ({tr.length})</button>}
        {onBuy && buy.length > 0 && <button className={btnSec} onClick={() => setPo(buy)}><i className="fas fa-cart-plus mr-1" />Create draft PO ({buy.length})</button>}
      </div>
      {po && <PoDialog lines={po} onClose={() => setPo(null)} />}
    </div>
  );
}

async function requestTransfer(lines: any[], orderId?: number) {
  if (!confirm(`Raise a warehouse transfer request for ${lines.length} item(s)? Stock moves only after another person approves it.`)) return;
  try { const r = await api.post('/manufacturing/planning/transfer-request', { lines: lines.map((l) => ({ product_id: l.product_id, qty: l.transfer_suggested })), for_order_id: orderId });
    toast.success(`Transfer request ${r.data.transfers.join(', ')} sent for approval (Department Stores → Transfers)`); } catch (e) { err(e); }
}

export default function MfgPlanning() {
  const [tab, setTab] = useState('Check an order');
  return (
    <div className="p-4 w-full">
      <h1 className="text-xl font-bold text-slate-800 mb-1"><i className="fas fa-clipboard-check text-indigo-600 mr-2" />Material Planning</h1>
      <p className="text-xs text-slate-500 mb-4">BOM requirement vs usable plant stock (reserved, QC-hold, WIP and scrap never count). Warehouse stock and pending POs are shown separately — they are not in the plant yet.</p>
      <Tabs tabs={['Check an order', 'Open orders', 'All materials']} value={tab} onChange={setTab} />
      {tab === 'Check an order' && <Check />}
      {tab !== 'Check an order' && <Open consolidated={tab === 'All materials'} />}
    </div>
  );
}

function Check() {
  const [orders] = useList<any>('/manufacturing/sales-orders', { status: 'OPEN' });
  const [f, setF] = useState<any>({ qty: '' });
  const [r, setR] = useState<any>(null);
  const run = (g: any = f) => api.post('/manufacturing/planning/check', { product_id: g.product_id, sales_order_id: g.sales_order_id || null, qty: g.qty ? Number(g.qty) : null })
    .then((x) => setR(x.data)).catch(err);
  // choosing an order fills its quantity and checks availability straight away
  const pickOrder = (id: number | null) => {
    const o = orders.find((x) => x.id === id);
    const g = { ...f, sales_order_id: id, qty: o ? String(o.ordered_qty) : '' };
    setF(g); setR(null);
    if (id) run(g);
  };
  const cur = orders.find((o) => o.id === f.sales_order_id);
  return (
    <div className="space-y-3">
      <div className="bg-white border rounded-lg p-3 grid md:grid-cols-4 gap-3 items-end">
        <label className="md:col-span-4 text-xs font-semibold text-slate-600">Customer order (optional) - pick one and the quantity fills in and the check runs
          <select className={inp} value={f.sales_order_id || ''} onChange={(e) => pickOrder(Number(e.target.value) || null)}>
          <option value="">— no order: choose a product below —</option>{orders.map((o) => <option key={o.id} value={o.id}>{o.so_no} · {o.customer || o.brand} · {o.product} · {fmt(o.ordered_qty)} pcs ({ctnText(o.ordered_qty, o.units_per_carton) || '-'})</option>)}</select></label>
        {cur && <div className="md:col-span-4 text-sm bg-indigo-50 border border-indigo-200 rounded p-2"><b>{cur.customer || cur.brand}</b> · {cur.product} · PO {cur.customer_po_no || '—'} · ordered <b>{fmt(cur.ordered_qty)} pcs ({ctnText(cur.ordered_qty, cur.units_per_carton) || '-'})</b>{cur.delivery_date && ` · due ${cur.delivery_date}`}</div>}
        {!f.sales_order_id && <div className="text-xs font-semibold text-slate-600">Finished product<ItemPicker value={f.product_id} label={f.product_name} onPick={(p) => setF({ ...f, product_id: p?.id, product_name: p?.name })} /></div>}
        <label className="text-xs font-semibold text-slate-600">Quantity (finished units)<input type="number" className={inp} value={f.qty} placeholder={f.sales_order_id ? 'order qty' : ''} onChange={(e) => setF({ ...f, qty: e.target.value })} /></label>
        <button className={btnPri} onClick={() => run()}>Check availability</button>
      </div>
      {r && <>
        <div className="flex items-center gap-3"><Overall o={r.overall} /><span className="text-xs text-slate-500">BOM {r.bom.bom_no} r{r.bom.revision} · {fmt(r.qty)} units</span>{f.sales_order_id && <div className="ml-auto"><ExportBar scope={`SO:${f.sales_order_id}`} label={orders.find((o) => o.id === f.sales_order_id)?.so_no || 'order'} /></div>}</div>
        <Lines lines={r.lines} onTransfer={(l) => requestTransfer(l)} onBuy />
      </>}
    </div>
  );
}

function Open({ consolidated }: { consolidated: boolean }) {
  const [by, setBy] = useState('priority');
  const [d, setD] = useState<any>(null);
  const [open, setOpen] = useState<string | null>(null);
  const load = () => { setD(null); api.get('/manufacturing/planning/open', { params: { order_by: by } }).then((r) => setD(r.data)).catch(err); };
  useEffect(load, [by]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <div className="text-slate-500 p-4"><i className="fas fa-spinner fa-spin mr-2" />Checking every open order…</div>;
  const allocate = () => confirm(`Reserve materials for open production orders by ${by === 'date' ? 'production date' : 'priority'}?`) &&
    api.post('/manufacturing/planning/allocate', { order_by: by }).then((r) => { toast.success(`${r.data.length} order(s) allocated`); load(); }).catch(err);
  const c = d.orders;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Stat label="Open orders" value={c.length} /><Stat label="Ready (GREEN)" value={c.filter((o: any) => o.overall?.color === 'GREEN').length} tone="green" />
        <Stat label="Needs transfer / purchase (AMBER)" value={c.filter((o: any) => o.overall?.color === 'AMBER').length} tone="amber" />
        <Stat label="Blocked by shortage (RED)" value={c.filter((o: any) => o.overall?.color === 'RED').length} tone="red" />
      </div>
      <div className="flex gap-2 items-center">
        <select className={`${inp} w-56`} value={by} onChange={(e) => setBy(e.target.value)}><option value="priority">Allocate by priority</option><option value="date">Allocate by production date</option></select>
        <button className={btnSec} onClick={allocate}>Reserve materials</button>
        <button className={btnSec} onClick={load}><i className="fas fa-sync" /></button>
        <div className="ml-auto"><ExportBar scope={consolidated ? 'totals' : 'all'} label={consolidated ? 'all materials' : 'all open orders'} /></div>
      </div>
      {consolidated ? <Table rows={d.consolidated} cols={[
        ['Material', (t) => <>{t.item}<div className="text-[11px] text-slate-500">{t.item_code} · {TYPE[t.item_type] || t.item_type}</div></>],
        ['Orders', (t) => t.orders, 'text-right'], ['Total required', (t) => `${fmt(t.required)} ${t.unit}`, 'text-right'], ['Plant stock', (t) => fmt(t.plant), 'text-right'],
        ['Order shortages', (t) => fmt(t.shortage), 'text-right'], ['Company shortage', (t) => fmt(t.company_shortage), 'text-right'],
        ['Warehouse', (t) => fmt(t.warehouse), 'text-right'], ['After warehouse', (t) => fmt(t.after_warehouse), 'text-right'],
        ['QC hold', (t) => fmt(t.qc_hold), 'text-right'], ['PO pending', (t) => fmt(t.pending_po), 'text-right'],
        ['Still to buy', (t) => t.to_buy > 0 ? <b className="text-rose-700">{fmt(t.to_buy)}</b> : '—', 'text-right'],
      ]} /> : c.map((o: any) => (
        <div key={`${o.kind}${o.id}`} className="bg-white border rounded-lg">
          <button className="w-full flex flex-wrap items-center gap-3 p-3 text-left" onClick={() => setOpen(open === `${o.kind}${o.id}` ? null : `${o.kind}${o.id}`)}>
            <Overall o={o.overall} />
            <b>{o.order_no}</b><span className="text-sm">{o.customer || 'Own stock'} · {o.product} · {fmt(o.qty)}</span>
            <span className="text-xs text-slate-500">due {o.need_by || '—'} · priority {o.priority} · {o.bom || ''}{o.kind === 'SO' && ' · not yet planned'}{o.released_at && ' · released'}</span>
          </button>
          {open === `${o.kind}${o.id}` && <div className="p-3 border-t">{o.error && <div className="text-rose-700 text-sm mb-2">{o.error}</div>}
            <div className="flex justify-end mb-2"><ExportBar scope={`${o.kind}:${o.id}`} label={`${o.order_no} ${o.customer || ''}`.trim()} /></div>
            <Lines lines={o.lines} onTransfer={(l) => requestTransfer(l, o.kind === 'MO' ? o.id : undefined)} onBuy /></div>}
        </div>
      ))}
    </div>
  );
}

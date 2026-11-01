import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import api from '../../api/axios';
import { useMyAccess } from '../../hooks/useMyAccess';
import { Stat, Table, Tabs, btnPri, btnSec, err, inp, useList } from '../manufacturing/mfgShared';

const MODS = [['po', 'Purchase Order'], ['grn', 'GRN'], ['wholesale', 'Wholesale Bill'], ['items', 'Item Master'], ['prices', 'Price Update']] as const;
const TONE: Record<string, string> = { VALID: 'text-emerald-700', CHANGED: 'text-indigo-700', UNCHANGED: 'text-slate-400', INVALID: 'text-rose-700 font-semibold' };
const today = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);

async function download(url: string, name: string) {
  try {
    const r = await api.get(url, { responseType: 'blob' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(r.data); a.download = name; a.click(); URL.revokeObjectURL(a.href);
  } catch (e) { err(e); }
}

export default function ExcelImport() {
  const me = useMyAccess();
  const mods = MODS.filter(([k]) => me.can(`imports.${k}`));
  const tabs = [...mods.map(([, l]) => l), 'History'];
  const [tab, setTab] = useState<string>('');
  useEffect(() => { if (!tab && me.ready) setTab(tabs[0]); }, [me.ready]); // eslint-disable-line react-hooks/exhaustive-deps
  const mod = MODS.find(([, l]) => l === tab)?.[0];
  return (
    <div className="p-4 max-w-7xl mx-auto">
      <h1 className="text-xl font-bold text-slate-800 mb-1"><i className="fas fa-file-excel text-emerald-600 mr-2" />Excel Import</h1>
      <p className="text-xs text-slate-500 mb-4">Download the template, fill it, upload, check the preview, then confirm. Totals, GST, stock and numbering are always done by the server; nothing is saved until you confirm, and a file is imported only once.</p>
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {mod ? <Importer key={mod} mod={mod} /> : tab === 'History' ? <History /> : null}
    </div>
  );
}

function Header({ mod, h, setH }: { mod: string; h: any; setH: (v: any) => void }) {
  const me = useMyAccess();
  const [sups, setSups] = useState<any[]>([]);
  const [custQ, setCustQ] = useState('');
  const [custs, setCusts] = useState<any[]>([]);
  const [pos, setPos] = useState<any[]>([]);
  useEffect(() => {
    if (mod === 'po' || mod === 'grn') api.get('/suppliers', { params: { per_page: 500 } }).then((r) => setSups(r.data.data || r.data || [])).catch(() => {});
    if (mod === 'grn') api.get('/purchases/po', { params: { per_page: 100, status: 'approved' } }).then((r) => setPos((r.data.data || r.data || []).filter((p: any) => p.approval_status === 'approved'))).catch(() => {});
  }, [mod]);
  useEffect(() => {
    if (custQ.length < 2) return;
    const t = setTimeout(() => api.get('/customers', { params: { search: custQ, per_page: 20 } }).then((r) => setCusts(r.data.data || [])).catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [custQ]);
  const F = (k: string, l: string, type = 'text') => <label className="text-xs font-semibold text-slate-600">{l}<input type={type} className={inp} value={h[k] ?? ''} onChange={(e) => setH({ ...h, [k]: e.target.value })} /></label>;
  if (mod === 'items') return null;
  if (mod === 'prices') return <div className="grid md:grid-cols-2 gap-3">{F('reason', 'Reason for the price change')}</div>;
  return (
    <div className="grid md:grid-cols-4 gap-3">
      <label className="text-xs font-semibold text-slate-600">Store<select className={inp} value={h.outlet_id || ''} onChange={(e) => setH({ ...h, outlet_id: Number(e.target.value) || null })}>
        <option value="">Choose…</option>{me.stores.map((s) => <option key={s.id} value={s.id}>{s.outlet_name}</option>)}</select></label>
      {(mod === 'po' || mod === 'grn') && <label className="text-xs font-semibold text-slate-600">Supplier<select className={inp} value={h.supplier_id || ''} onChange={(e) => setH({ ...h, supplier_id: Number(e.target.value) || null })}>
        <option value="">Choose…</option>{sups.map((s) => <option key={s.id} value={s.id}>{s.name}{s.supplier_code ? ` (${s.supplier_code})` : ''}</option>)}</select></label>}
      {mod === 'po' && <>{F('po_date', 'PO date', 'date')}{F('expected_date', 'Expected delivery', 'date')}
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={!!h.save_as_draft} onChange={(e) => setH({ ...h, save_as_draft: e.target.checked })} />Save as draft (else sent for approval)</label></>}
      {mod === 'grn' && <>
        <label className="text-xs font-semibold text-slate-600">Against PO (optional)<select className={inp} value={h.po_id || ''} onChange={(e) => setH({ ...h, po_id: Number(e.target.value) || null })}>
          <option value="">— direct GRN —</option>{pos.filter((p) => !h.supplier_id || p.supplier_id === h.supplier_id).map((p) => <option key={p.id} value={p.id}>{p.po_no}</option>)}</select></label>
        {F('invoice_no', 'Supplier invoice no')}{F('invoice_date', 'Invoice date', 'date')}
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={!!h.post_now} onChange={(e) => setH({ ...h, post_now: e.target.checked })} />Post to stock now (else draft)</label>
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={!!h.allow_over_receipt} onChange={(e) => setH({ ...h, allow_over_receipt: e.target.checked })} />Allow over-receipt (PO approvers only)</label></>}
      {mod === 'wholesale' && <>
        <div className="relative"><label className="text-xs font-semibold text-slate-600">Customer<input className={inp} placeholder="Search customer" value={h.customer_name || custQ}
          onChange={(e) => { setCustQ(e.target.value); setH({ ...h, customer_id: null, customer_name: '' }); }} /></label>
          {custs.length > 0 && !h.customer_id && <div className="absolute z-30 bg-white border rounded shadow w-full max-h-48 overflow-auto">{custs.map((c) => (
            <button key={c.id} className="block w-full text-left px-2 py-1 text-sm hover:bg-indigo-50" onClick={() => { setH({ ...h, customer_id: c.id, customer_name: c.name }); setCusts([]); }}>
              {c.name} <span className="text-slate-400">{c.gst_number || c.phone}</span></button>))}</div>}</div>
        {F('invoice_date', 'Billing date (open business day)', 'date')}{F('customer_po', 'Customer PO ref')}{F('payment_terms', 'Payment terms')}{F('discount_approval_no', 'High-discount approval no')}</>}
    </div>
  );
}

function Importer({ mod }: { mod: string }) {
  const [h, setH] = useState<any>({ po_date: today(), invoice_date: today() });
  const [file, setFile] = useState<File | null>(null);
  const [res, setRes] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState<'all' | 'INVALID'>('all');
  const upload = async () => {
    if (!file) return toast.error('Choose the Excel file');
    const fd = new FormData();
    fd.append('file', file);
    fd.append('header', JSON.stringify(Object.fromEntries(Object.entries(h).filter(([k]) => k !== 'customer_name'))));
    setBusy(true);
    try { setRes((await api.post(`/imports/${mod}/preview`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })).data); }
    catch (e) { err(e); } finally { setBusy(false); }
  };
  const commit = async (opts: any) => {
    setBusy(true);
    try {
      const r = await api.post(`/imports/${mod}/commit/${res.job_id}`, { ...opts, reason: h.reason });
      toast.success(r.data.message || 'Imported', { duration: 8000 }); setRes({ ...res, done: r.data });
    } catch (e: any) {
      if (e?.response?.status === 409 && confirm(`${e.response.data.detail}\n\nImport it again anyway?`)) { setBusy(false); return commit({ ...opts, allow_duplicate_file: true }); }
      err(e);
    } finally { setBusy(false); }
  };
  const s = res?.summary;
  const cols: [string, (r: any) => any, string?][] = [['Row', (r) => r._row], ['Item', (r) => <>{r.item_code || r.barcode || ''}<div className="text-[11px] text-slate-500">{r.item_name}</div></>]];
  if (mod === 'prices') cols.push(['Changes (old → new)', (r) => r.changes ? Object.entries(r.changes).map(([k, v]: any) => `${k}: ${v.old} → ${v.new}`).join(' · ') : '']);
  else if (mod === 'items') cols.push(['Action', (r) => r.mode], ['Category', (r) => r.category], ['MRP / SP / WSP', (r) => [r.mrp, r.sp, r.wsp].filter((x) => x != null).join(' / ')]);
  else cols.push(['Qty', (r) => r.qty ?? r.received_qty, 'text-right'], ['Rate / cost', (r) => r.rate ?? r.basic_cost, 'text-right'], ['Batch / expiry', (r) => [r.batch_no, r.expiry_date].filter(Boolean).join(' · ')]);
  cols.push(['Status', (r) => <span className={TONE[r.status]}>{r.status}</span>], ['Error / note', (r) => <span className="text-xs text-rose-700">{(r._errors || []).join('; ')}{r._info && <span className="text-amber-700"> {r._info}</span>}</span>]);
  return (
    <div className="space-y-3">
      <div className="bg-white border rounded-lg p-3 space-y-3">
        <Header mod={mod} h={h} setH={setH} />
        <div className="flex flex-wrap items-center gap-2">
          <button className={btnSec} onClick={() => download(`/imports/${mod}/template`, `${mod}_import_template.xlsx`)}><i className="fas fa-download mr-1" />Template</button>
          <input type="file" accept=".xlsx" onChange={(e) => { setFile(e.target.files?.[0] || null); setRes(null); }} />
          <button className={btnPri} disabled={busy || !file} onClick={upload}><i className="fas fa-search mr-1" />Upload & preview</button>
        </div>
      </div>
      {res && <>
        {res.already_imported && <div className="border border-amber-300 bg-amber-50 rounded p-2 text-sm">This file was already imported as <b>{res.already_imported.import_no}</b> ({res.already_imported.created_refs || '-'}).</div>}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <Stat label="Rows" value={s.total} /><Stat label="Valid" value={s.valid} tone="green" /><Stat label="Invalid" value={s.invalid} tone={s.invalid ? 'red' : 'slate'} />
          {mod === 'prices' && <><Stat label="Changed" value={s.changed || 0} tone="blue" /><Stat label="Unchanged" value={s.unchanged || 0} /></>}
        </div>
        {res.done ? <div className="border border-emerald-300 bg-emerald-50 rounded p-3 text-sm"><b>{res.done.status}</b> — {res.done.message} {res.done.refs && <>· <b>{res.done.refs}</b></>}
          {res.done.rejected > 0 && <button className="ml-3 underline" onClick={() => download(`/imports/jobs/${res.job_id}/export`, `${res.import_no}_errors.xlsx`)}>Download rejected rows</button>}</div>
          : <div className="flex flex-wrap gap-2">
            {s.invalid === 0 && <button className={btnPri} disabled={busy} onClick={() => commit({})}>Confirm import</button>}
            {s.invalid > 0 && s.valid > 0 && <button className={btnSec} disabled={busy} onClick={() => confirm(`Import only the ${s.valid} valid row(s)? The ${s.invalid} invalid row(s) will be reported, not imported.`) && commit({ only_valid: true })}>Import only valid rows</button>}
            {s.invalid > 0 && <button className={btnSec} onClick={() => download(`/imports/jobs/${res.job_id}/export`, `${res.import_no}_errors.xlsx`)}><i className="fas fa-file-excel mr-1" />Download errors</button>}
            <select className={`${inp} w-40`} value={show} onChange={(e) => setShow(e.target.value as any)}><option value="all">All rows</option><option value="INVALID">Only errors</option></select>
          </div>}
        <Table rows={res.rows.filter((r: any) => show === 'all' || r.status === 'INVALID').slice(0, 1000)} cols={cols} />
      </>}
    </div>
  );
}

function History() {
  const [rows] = useList<any>('/imports/jobs');
  return <Table rows={rows} empty="No imports yet." cols={[['Import', (r) => r.import_no], ['When', (r) => r.uploaded], ['Type', (r) => r.module], ['File', (r) => r.file_name],
    ['Store', (r) => r.store || '—'], ['By', (r) => r.uploaded_by], ['Rows', (r) => `${r.valid_rows}/${r.total_rows}`, 'text-right'], ['Failed', (r) => r.failed_rows, 'text-right'],
    ['Status', (r) => r.status], ['Created', (r) => r.created_refs || '—'], ['Message', (r) => <span className="text-xs">{r.message}</span>],
    ['', (r) => r.failed_rows > 0 && <button className={btnSec} onClick={() => download(`/imports/jobs/${r.id}/export`, `${r.import_no}_errors.xlsx`)}>Errors</button>]]} />;
}

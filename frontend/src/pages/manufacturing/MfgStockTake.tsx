import { useEffect, useRef, useState } from 'react';
import { toast } from 'react-hot-toast';
import { saveAs } from 'file-saver';
import api from '../../api/axios';
import { ItemPicker, Table, btnPri, btnSec, err, fmt, inp, useList } from './mfgShared';

const BASE = '/manufacturing/stock-take';
const TONE: Record<string, string> = { COUNTING: 'bg-sky-100 text-sky-800', SUBMITTED: 'bg-amber-100 text-amber-800', APPROVED: 'bg-emerald-100 text-emerald-800', CANCELLED: 'bg-slate-200 text-slate-600' };
const Tag = ({ s }: { s: string }) => <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${TONE[s] || 'bg-slate-100'}`}>{s}</span>;
const TYPES = [['', 'All items'], ['RM', 'Raw materials'], ['PM', 'Packing materials'], ['FG', 'Finished goods'], ['SFG', 'Semi-finished'], ['CONS', 'Consumables']];

async function sheet(id: number, kind: 'count' | 'variance', fmtx: 'xlsx' | 'pdf', no: string) {
  try { const r = await api.get(`${BASE}/${id}/sheet`, { params: { kind, fmt: fmtx }, responseType: 'blob' }); saveAs(r.data, `${no}_${kind}.${fmtx}`); } catch (e) { err(e); }
}

export default function MfgStockTake() {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="p-4 w-full">
      <h1 className="text-xl font-bold text-slate-800 mb-1"><i className="fas fa-clipboard-list text-indigo-600 mr-2" />Stock Take (Physical Count)</h1>
      <p className="text-xs text-slate-500 mb-4">Freeze a store's stock → count it on the floor (blind) → submit → review differences and reasons → manager approves → differences post to the stock ledger.</p>
      {open ? <Count id={open} back={() => setOpen(null)} /> : <List onOpen={setOpen} />}
    </div>
  );
}

function List({ onOpen }: { onOpen: (id: number) => void }) {
  const [rows, reload] = useList<any>(BASE);
  const [stores] = useList<any>('/manufacturing/stores');
  const [f, setF] = useState<any>({ store_id: '', item_type: '', blind: true, include_zero: false, remarks: '' });
  const [show, setShow] = useState(false);
  const create = () => api.post(BASE, { store_id: Number(f.store_id), item_type: f.item_type || null, blind: f.blind, include_zero: f.include_zero, remarks: f.remarks || null })
    .then((r) => { toast.success(`${r.data.count_no} created with ${r.data.lines} line(s)`); setShow(false); reload(); onOpen(r.data.id); }).catch(err);
  return (
    <div className="space-y-3">
      <div className="flex"><button className={`${btnPri} ml-auto`} onClick={() => setShow(!show)}><i className="fas fa-plus mr-1" />New stock take</button></div>
      {show && <div className="bg-white border rounded-lg p-3 grid md:grid-cols-4 gap-3 items-end">
        <label className="text-xs font-semibold text-slate-600">Store<select className={inp} value={f.store_id} onChange={(e) => setF({ ...f, store_id: e.target.value })}>
          <option value="">choose…</option>{stores.filter((s) => s.is_active !== false).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label className="text-xs font-semibold text-slate-600">Items<select className={inp} value={f.item_type} onChange={(e) => setF({ ...f, item_type: e.target.value })}>{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label className="text-xs font-semibold text-slate-600">Remarks<input className={inp} value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} placeholder="e.g. month-end count" /></label>
        <div className="flex flex-wrap gap-3 items-center"><label className="text-sm"><input type="checkbox" checked={f.blind} onChange={(e) => setF({ ...f, blind: e.target.checked })} /> Blind count</label>
          <label className="text-sm" title="Also lists items of the chosen type that show zero stock in this store"><input type="checkbox" checked={f.include_zero} disabled={!f.item_type} onChange={(e) => setF({ ...f, include_zero: e.target.checked })} /> Include zero-stock items</label>
          <button className={btnPri} disabled={!f.store_id} onClick={create}>Create</button></div>
      </div>}
      <Table rows={rows} empty="No stock takes yet." cols={[
        ['Stock take', (r) => <button className="text-indigo-700 font-semibold" onClick={() => onOpen(r.id)}>{r.count_no}</button>],
        ['Store', (r) => r.store], ['Items', (r) => r.item_type || 'All'], ['Status', (r) => <Tag s={r.status} />],
        ['Counted', (r) => `${r.counted} / ${r.lines}`, 'text-right'], ['Differences', (r) => r.status === 'COUNTING' && r.blind ? 'hidden' : r.variances, 'text-right'],
        ['Created', (r) => String(r.created_at).slice(0, 10)],
      ]} />
    </div>
  );
}

function Count({ id, back }: { id: number; back: () => void }) {
  const [d, setD] = useState<any>(null);
  const [edit, setEdit] = useState<Record<number, { q?: string; r?: string }>>({});
  const [q, setQ] = useState('');
  const [view, setView] = useState<'all' | 'diff' | 'noreason'>('all');
  const load = () => api.get(`${BASE}/${id}`).then((r) => { setD(r.data); setEdit({}); }).catch(err);
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <div className="text-slate-500 p-4"><i className="fas fa-spinner fa-spin mr-2" />Loading…</div>;
  const c = d.count, counting = c.status === 'COUNTING', submitted = c.status === 'SUBMITTED', closed = !counting && !submitted;
  const val = (l: any) => edit[l.id]?.q ?? (l.counted_qty ?? '');
  const reason = (l: any) => edit[l.id]?.r ?? (l.reason ?? '');
  const set = (l: any, k: 'q' | 'r', v: string) => setEdit((e) => ({ ...e, [l.id]: { ...e[l.id], [k]: v } }));
  const dirty = Object.keys(edit).length;
  const save = async () => {
    const lines = Object.entries(edit).map(([lid, v]) => { const l = d.lines.find((x: any) => x.id === Number(lid));
      return { id: Number(lid), counted_qty: (v.q ?? l.counted_qty ?? '') === '' ? null : Number(v.q ?? l.counted_qty), reason: (v.r ?? l.reason) || null }; });
    if (!lines.length) return;
    try { await api.post(`${BASE}/${id}/count`, { lines }); toast.success('Saved'); load(); } catch (e) { err(e); }
  };
  const act = (path: string, body: any = {}, msg = '') => async () => {
    if (dirty) await save();
    try { const r = await api.post(`${BASE}/${id}/${path}`, body); toast.success(msg || (r.data.doc ? `Approved - posted ${r.data.doc} (${r.data.gains} gain, ${r.data.losses} loss)` : 'Done')); load(); } catch (e) { err(e); }
  };
  const submit = async () => {
    if (dirty) await save();
    const unc = d.lines.filter((l: any) => l.counted_qty == null && !(edit[l.id]?.q)).length;
    const zero = unc > 0 && confirm(`${unc} line(s) are not counted. Treat them as ZERO (not found in the store)?`);
    if (unc > 0 && !zero) return;
    try { await api.post(`${BASE}/${id}/submit`, { zero_uncounted: zero }); toast.success('Submitted for approval'); load(); } catch (e) { err(e); }
  };
  const recountDiffs = () => { const ids = d.lines.filter((l: any) => l.variance && Number(l.variance) !== 0).map((l: any) => l.id);
    if (!ids.length) return toast('No differences to recount'); return act('recount', { line_ids: ids }, `${ids.length} line(s) sent back for recount`)(); };
  const hasDiff = (l: any) => l.variance != null && Number(l.variance) !== 0;
  const noReason = (l: any) => hasDiff(l) && !(edit[l.id]?.r ?? l.reason);
  const nDiff = d.lines.filter(hasDiff).length, nNo = d.lines.filter(noReason).length;
  const lines = d.lines.filter((l: any) => (!q || `${l.item} ${l.item_code} ${l.batch_no} ${l.brand}`.toLowerCase().includes(q.toLowerCase()))
    && (view === 'all' || (view === 'diff' ? hasDiff(l) : noReason(l))));
  const diffTone = (v: any) => v == null || Number(v) === 0 ? '' : Number(v) > 0 ? 'text-emerald-700 font-bold' : 'text-rose-700 font-bold';
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <button className={btnSec} onClick={back}><i className="fas fa-arrow-left mr-1" />All stock takes</button>
        <b className="text-lg">{c.count_no}</b><Tag s={c.status} />
        <span className="text-sm text-slate-600">{c.store} · {c.item_type || 'All items'} · {c.blind ? 'blind count' : 'system qty shown'} · {d.summary.counted}/{d.summary.lines} counted
          {!(counting && c.blind) && ` · ${d.summary.with_variance} difference(s)`}</span>
        <div className="ml-auto flex gap-2">
          <button className={btnSec} onClick={() => sheet(id, 'count', 'xlsx', c.count_no)}><i className="fas fa-file-excel text-emerald-700 mr-1" />Count sheet</button>
          <button className={btnSec} onClick={() => sheet(id, 'count', 'pdf', c.count_no)}><i className="fas fa-print text-slate-700 mr-1" />Print</button>
          {!(counting && c.blind) && <button className={btnSec} onClick={() => sheet(id, 'variance', 'xlsx', c.count_no)}><i className="fas fa-file-excel text-emerald-700 mr-1" />Variance</button>}
          {!(counting && c.blind) && <button className={btnSec} onClick={() => sheet(id, 'variance', 'pdf', c.count_no)}><i className="fas fa-file-pdf text-rose-700 mr-1" />Variance PDF</button>}
        </div>
      </div>
      {c.remarks && <div className="text-xs text-slate-500">{c.remarks}</div>}
      {submitted && nNo > 0 && <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">{nNo} line(s) with a difference still need a reason before you can approve.
        <button className="underline ml-2 font-semibold" onClick={() => { setQ(''); setView('noreason'); }}>Show them</button></div>}
      <div className="flex flex-wrap gap-3 items-end">
        <input className={`${inp} max-w-sm`} placeholder="Search item / batch / brand…" value={q} onChange={(e) => setQ(e.target.value)} />
        {q && <button className={btnSec} onClick={() => setQ('')}>Clear search</button>}
        {!(counting && c.blind) && <div className="flex gap-1 text-xs">
          {([['all', `All (${d.lines.length})`], ['diff', `Differences (${nDiff})`], ['noreason', `Missing reason (${nNo})`]] as const).map(([k, l]) =>
            <button key={k} onClick={() => setView(k)} className={`px-2 py-1 rounded border ${view === k ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-300 text-slate-700'}`}>{l}</button>)}
        </div>}
        {counting && <AddItem id={id} onAdded={load} />}
      </div>
      {(counting || submitted) && <QuickCount id={id} lines={d.lines} onSaved={load} />}
      <Table rows={lines} empty="No stock lines." cols={[
        ['Item', (l) => <>{l.item}<div className="text-[11px] text-slate-500">{l.item_code} · {l.item_type}{l.brand && ` · ${l.brand}`}{l.batch_no && ` · batch ${l.batch_no}`}</div></>],
        ['Unit', (l) => l.unit],
        ...(c.blind && counting ? [] : [['System qty', (l: any) => fmt(l.system_qty), 'text-right'] as [string, (l: any) => any, string]]),
        ['Counted qty', (l) => closed ? fmt(l.counted_qty) : <input type="number" min="0" step="any" className={`${inp} w-28 text-right`} value={val(l)} onChange={(e) => set(l, 'q', e.target.value)} />, 'text-right'],
        ...(c.blind && counting ? [] : [['Difference', (l: any) => l.variance == null ? '' : <span className={diffTone(l.variance)}>{Number(l.variance) > 0 ? '+' : ''}{fmt(l.variance)}</span>, 'text-right'] as [string, (l: any) => any, string]]),
        ...(c.blind && counting ? [] : [['Reason', (l: any) => closed || Number(l.variance || 0) === 0 ? (l.reason || '') :
          <select className={inp} value={reason(l)} onChange={(e) => set(l, 'r', e.target.value)}><option value="">reason…</option>{d.reasons.map((r: string) => <option key={r}>{r}</option>)}</select>] as [string, (l: any) => any]]),
        ['Rechecks', (l) => l.recounts || '', 'text-right'],
      ]} />
      {!closed && <div className="flex flex-wrap gap-2 sticky bottom-0 bg-white/90 py-2">
        <button className={btnSec} disabled={!dirty} onClick={save}>Save counts{dirty ? ` (${dirty})` : ''}</button>
        {counting && <button className={btnPri} onClick={submit}>Submit for approval</button>}
        {submitted && <><button className={btnSec} onClick={recountDiffs}>Recount differences</button>
          <button className={btnPri} onClick={() => confirm('Approve and post all differences to the stock ledger? This changes stock.') && act('approve')()}>Approve &amp; post</button></>}
        <button className={`${btnSec} ml-auto text-rose-700`} onClick={() => confirm('Cancel this stock take? Nothing is posted.') && act('cancel', {}, 'Cancelled')()}>Cancel</button>
      </div>}
      {c.status === 'APPROVED' && <div className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded p-2">Approved by {c.approved_name} on {String(c.approved_at).slice(0, 16)} - posted as {c.post_doc}. See Department Stores → Stock Ledger.</div>}
    </div>
  );
}

// an item physically found in the store that is not on the sheet (e.g. system shows zero stock)
function AddItem({ id, onAdded }: { id: number; onAdded: () => void }) {
  const [p, setP] = useState<any>(null);
  const [qty, setQty] = useState('');
  const [batch, setBatch] = useState('');
  const add = () => api.post(`${BASE}/${id}/extra`, { product_id: p.id, batch_no: batch, counted_qty: Number(qty) })
    .then(() => { toast.success(`${p.name} added`); setP(null); setQty(''); setBatch(''); onAdded(); }).catch(err);
  return (
    <div className="flex flex-wrap gap-2 items-end bg-slate-50 border rounded-lg p-2">
      <div className="w-72 text-xs font-semibold text-slate-600">Add an item not on the sheet<ItemPicker value={p?.id} label={p?.name} onPick={setP} /></div>
      <label className="text-xs font-semibold text-slate-600">Batch<input className={`${inp} w-28`} value={batch} onChange={(e) => setBatch(e.target.value)} /></label>
      <label className="text-xs font-semibold text-slate-600">Counted qty<input type="number" min="0" step="any" className={`${inp} w-28 text-right`} value={qty} onChange={(e) => setQty(e.target.value)} /></label>
      <button className={btnSec} disabled={!p || qty === ''} onClick={add}>Add</button>
    </div>
  );
}

// one-by-one counting: type an item name / code / barcode, pick it, enter the quantity, press Enter - it is saved at once
function QuickCount({ id, lines, onSaved }: { id: number; lines: any[]; onSaved: () => void }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<any>(null);
  const [qty, setQty] = useState('');
  const sRef = useRef<HTMLInputElement>(null);
  const qRef = useRef<HTMLInputElement>(null);
  const t = q.trim().toLowerCase();
  const hits = t.length < 1 ? [] : lines.filter((l) => `${l.item} ${l.item_code} ${l.barcode || ''} ${l.batch_no} ${l.brand}`.toLowerCase().includes(t)).slice(0, 8);
  const pick = (l: any) => { setSel(l); setQty(l.counted_qty == null ? '' : String(l.counted_qty)); setTimeout(() => qRef.current?.select(), 0); };
  const save = async () => {
    if (!sel || qty === '') return;
    try {
      await api.post(`${BASE}/${id}/count`, { lines: [{ id: sel.id, counted_qty: Number(qty), reason: sel.reason || null }] });
      toast.success(`${sel.item}: ${qty} ${sel.unit} saved`);
      setSel(null); setQty(''); setQ(''); onSaved(); setTimeout(() => sRef.current?.focus(), 0);
    } catch (e) { err(e); }
  };
  return (
    <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3 relative">
      <div className="text-xs font-semibold text-indigo-900 mb-1"><i className="fas fa-barcode mr-1" />Quick count - one item at a time</div>
      {!sel ? (
        <>
          <input ref={sRef} className={`${inp} max-w-md`} placeholder="Type item name / code / barcode, then pick it…" value={q}
            onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && hits.length) pick(hits[0]); }} />
          {hits.length > 0 && <div className="absolute z-20 mt-1 w-full max-w-md bg-white border rounded-lg shadow-lg">
            {hits.map((l) => <button key={l.id} className="w-full text-left px-3 py-2 hover:bg-indigo-50 border-b last:border-0" onClick={() => pick(l)}>
              <div className="text-sm font-medium">{l.item}</div>
              <div className="text-[11px] text-slate-500">{l.item_code}{l.brand && ` · ${l.brand}`}{l.batch_no && ` · batch ${l.batch_no}`} · {l.counted_qty == null ? 'not counted' : `counted ${fmt(l.counted_qty)} ${l.unit}`}</div>
            </button>)}
          </div>}
          {t && hits.length === 0 && <div className="text-xs text-amber-700 mt-1">Not on this sheet. Use <b>Add an item not on the sheet</b> above.</div>}
        </>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <div className="text-sm"><b>{sel.item}</b><div className="text-[11px] text-slate-500">{sel.item_code}{sel.batch_no && ` · batch ${sel.batch_no}`}</div></div>
          <label className="text-xs font-semibold text-slate-600">Counted qty ({sel.unit})
            <input ref={qRef} type="number" min="0" step="any" className={`${inp} w-32 text-right`} value={qty} onChange={(e) => setQty(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setSel(null); setQ(''); } }} autoFocus /></label>
          <button className={btnPri} disabled={qty === ''} onClick={save}>Save &amp; next</button>
          <button className={btnSec} onClick={() => { setSel(null); setQ(''); }}>Cancel</button>
        </div>
      )}
    </div>
  );
}

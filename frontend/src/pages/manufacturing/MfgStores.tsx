import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import api from '../../api/axios';
import Modal from '../../components/ui/Modal';
import { ItemLedger, StockStatement } from './MfgStockReports';
import { Badge, ItemPicker, Table, Tabs, btnPri, btnSec, ctnText, err, printDoc, fmt, inp, useList } from './mfgShared';

const TABS = ['Store Stock', 'Transfers', 'Inward from Outlet', 'Item Ledger', 'Stock Statement', 'Stock Ledger', 'Opening Stock', 'Return / Dispose', 'Stores', 'Department Access'];

export default function MfgStores() {
  const [tab, setTab] = useState(TABS[0]);
  const [stores, loadStores] = useList<any>('/manufacturing/stores');
  const [brands] = useList<any>('/manufacturing/brands');
  const [allStores] = useList<any>('/manufacturing/stores', { for_pick: true });
  const [meList] = useList<any>('/manufacturing/store-access/me');
  const me: any = meList || {};
  const canAll = !!me.all;
  const tabs = me.admin ? TABS : TABS.filter((x) => x !== 'Department Access');
  return (
    <div className="p-4 w-full">
      <h1 className="text-xl font-bold text-slate-800 mb-1"><i className="fas fa-warehouse text-indigo-600 mr-2" />Department Stores & Stock</h1>
      <p className="text-xs text-slate-500 mb-4">Every movement between departments is posted to the stock ledger; posted rows are never edited — a correction is a reversal.</p>
      {!canAll && stores.length > 0 && <div className="mb-3 text-sm bg-indigo-50 border border-indigo-200 rounded p-2">Your departments: <b>{stores.map((s: any) => s.name).join(', ')}</b> - you see stock and movements of these only.</div>}
      {!canAll && stores.length === 0 && <div className="mb-3 text-sm bg-amber-50 border border-amber-200 rounded p-2">No department is assigned to you yet. Ask the administrator to give you your department.</div>}
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'Store Stock' && <Stock stores={stores} brands={brands} canAll={canAll} />}
      {tab === 'Transfers' && <Transfers stores={stores} allStores={allStores} brands={brands} />}
      {tab === 'Item Ledger' && <ItemLedger stores={stores} canAll={canAll} />}
      {tab === 'Stock Statement' && <StockStatement stores={stores} canAll={canAll} />}
      {tab === 'Stock Ledger' && <Ledger stores={stores} canAll={canAll} />}
      {tab === 'Opening Stock' && <Opening stores={stores} brands={brands} />}
      {tab === 'Inward from Outlet' && <Inward stores={stores} brands={brands} />}
      {tab === 'Return / Dispose' && <Dispose stores={stores} />}
      {tab === 'Department Access' && <Access stores={allStores} />}
      {tab === 'Stores' && <Stores stores={stores} reload={loadStores} />}
    </div>
  );
}

const StoreSelect = ({ stores, value, onChange, all }: any) => (
  <select className={inp} value={value || ''} onChange={(e) => onChange(Number(e.target.value) || null)}>
    <option value="">{all ? 'All stores' : 'Choose store…'}</option>
    {stores.filter((s: any) => s.is_active).map((s: any) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
  </select>
);

function Stock({ stores, brands, canAll }: any) {
  const [store, setStore] = useState<number | null>(null);
  const [brand, setBrand] = useState('');
  const [q, setQ] = useState('');
  const [rows] = useList<any>('/manufacturing/stock', { store_id: store || undefined, brand_id: brand || undefined, search: q });
  return (
    <>
      <div className="flex flex-wrap gap-2 mb-3">
        <div className="w-64"><StoreSelect stores={stores} value={store} onChange={setStore} all={canAll} /></div>
        <select className={`${inp} w-52`} value={brand} onChange={(e) => setBrand(e.target.value)}>
          <option value="">All brands</option><option value="0">General (no brand)</option>
          {brands.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <input className={`${inp} w-64`} placeholder="Search item / code / batch" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <Table rows={rows} empty="No stock in the selected store." cols={[
        ['Store', (r) => <span title={r.store}>{r.store_code}{!r.usable && <span className="ml-1 text-[10px] text-amber-700">{r.is_wip ? 'WIP' : 'not usable'}</span>}</span>],
        ['Item', (r) => <><span className="font-mono text-xs text-slate-500 mr-1">{r.item_code}</span>{r.item}</>],
        ['Batch', (r) => r.batch_no || '—'], ['Brand', (r) => r.brand || 'General'],
        ['Qty', (r) => <b>{fmt(r.qty)} {r.unit}</b>, 'text-right'],
        ['Cartons', (r) => r.units_per_carton > 1 ? `${r.cartons} ctn + ${fmt(r.loose)} loose` : '—', 'text-right'],
        ['Value', (r) => `₹${fmt(r.value)}`, 'text-right'],
      ]} />
    </>
  );
}

type Line = { product_id: number | null; name?: string; unit?: string; qty: string; entry_unit: string; batch_no: string; brand_id: number };
const newLine = (): Line => ({ product_id: null, qty: '', entry_unit: '', batch_no: '', brand_id: 0 });

function Lines({ lines, setLines, brands, avail }: { lines: Line[]; setLines: (l: Line[]) => void; brands: any[]; avail?: any[] }) {
  const upd = (i: number, v: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...v } : l)));
  return (
    <div className="space-y-2">
      {lines.map((l, i) => (
        <div key={i} className="grid grid-cols-12 gap-2 items-center">
          <div className="col-span-4"><ItemPicker value={l.product_id} label={l.name} onPick={(p) => upd(i, { product_id: p?.id ?? null, name: p?.name, unit: p?.unit })} /></div>
          <input type="number" className={`${inp} col-span-2`} placeholder="Qty" value={l.qty} onChange={(e) => upd(i, { qty: e.target.value })} />
          <input className={`${inp} col-span-1`} placeholder={l.unit || 'Unit'} title="Blank = base unit; CTN = cartons; any unit set in Item Units" value={l.entry_unit} onChange={(e) => upd(i, { entry_unit: e.target.value.toUpperCase() })} />
          <input className={`${inp} col-span-2`} placeholder="Batch (optional)" value={l.batch_no} onChange={(e) => upd(i, { batch_no: e.target.value })} />
          <select className={`${inp} col-span-2`} value={l.brand_id} onChange={(e) => upd(i, { brand_id: Number(e.target.value) })}>
            <option value={0}>General</option>{brands.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <button className="col-span-1 text-rose-600" onClick={() => setLines(lines.filter((_, j) => j !== i))}><i className="fas fa-trash" /></button>
          {avail && l.product_id && (() => {
            const rows = avail.filter((a) => a.product_id === l.product_id && (!l.batch_no.trim() || a.batch_no === l.batch_no.trim()) && (!l.brand_id || a.brand_id === l.brand_id));
            const have = rows.reduce((t, a) => t + Number(a.qty), 0), ct = ctnText(have, rows[0]?.units_per_carton);
            return <div className={`col-span-12 -mt-1 text-xs font-semibold ${have > 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
              {have > 0 ? `Available in this store: ${ct ? `${ct} (` : ''}${fmt(have)} ${l.unit || ''}${ct ? ')' : ''}` : 'No stock of this item in the selected store'}{have > 0 && Number(l.qty) > have && <span className="ml-2 text-rose-700">- more than available</span>}</div>;
          })()}
        </div>
      ))}
      <button className={btnSec} onClick={() => setLines([...lines, newLine()])}><i className="fas fa-plus mr-1" />Add line</button>
    </div>
  );
}

const linesBody = (lines: Line[]) => lines.filter((l) => l.product_id && Number(l.qty) > 0)
  .map((l) => ({ product_id: l.product_id, qty: Number(l.qty), unit: l.entry_unit || undefined, batch_no: l.batch_no.trim(), brand_id: l.brand_id }));

function Transfers({ stores, allStores, brands }: any) {
  const [status, setStatus] = useState('PENDING');
  const [rows, load] = useList<any>('/manufacturing/transfers', { status: status || undefined });
  const [f, setF] = useState<any>(null);
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [busy, setBusy] = useState(false);
  const [avail] = useList<any>(f?.from_store_id ? '/manufacturing/stock' : '', { store_id: f?.from_store_id || undefined });
  const inStock = avail.filter((a: any) => Number(a.qty) > 0);
  const addFromStock = (a: any) => setLines([...lines.filter((l) => l.product_id), { product_id: a.product_id, name: a.item, unit: a.unit, qty: String(a.qty), entry_unit: '', batch_no: a.batch_no || '', brand_id: a.brand_id || 0 }]);
  const create = async () => {
    setBusy(true);
    try {
      const r = await api.post('/manufacturing/transfers', { ...f, lines: linesBody(lines) });
      toast.success(`${r.data.transfer_no} sent for approval`); setF(null); setLines([newLine()]); load();
    } catch (e) { err(e); } finally { setBusy(false); }
  };
  const approve = (t: any) => api.post(`/manufacturing/transfers/${t.id}/approve`).then(() => { toast.success(`${t.transfer_no} approved & posted`); load(); }).catch(err);
  const print = (t: any) => printDoc(`Stock Transfer Note ${t.transfer_no}`,
    [['Transfer no', t.transfer_no], ['Date', t.requested], ['From (issuing store)', t.from_store], ['To (receiving store)', t.to_store], ['Status', t.status],
     ['Requested by', t.requested_by_name], ['Approved by', t.approved_by_name || '—'], ['Remarks', t.remarks || '—']],
    ['#', 'Item code', 'Item', 'Batch', 'Customer / brand', 'Cartons', 'Loose pcs', 'Total qty', 'Unit'],
    (t.lines || []).map((l: any, i: number) => { const u = Number(l.units_per_carton || 0); const c = u > 1 ? Math.floor(Number(l.qty) / u) : '';
      return [i + 1, l.item_code || '', l.item, l.batch_no || '', l.brand || '', c, u > 1 ? +(Number(l.qty) - Number(c) * u).toFixed(3) : '', fmt(l.qty), l.unit]; }),
    ['Issued by (sending store)', 'Approved by', 'Received by (receiving store)']);
  const reject = (t: any) => {
    const reason = prompt(`Reason for rejecting ${t.transfer_no}?`);
    if (reason) api.post(`/manufacturing/transfers/${t.id}/reject`, { reason }).then(() => { toast.success('Rejected'); load(); }).catch(err);
  };
  return (
    <>
      <div className="flex gap-2 mb-3">
        <select className={`${inp} w-44`} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All</option>{['PENDING', 'APPROVED', 'REJECTED'].map((s) => <option key={s}>{s}</option>)}
        </select>
        <div className="flex-1" />
        <button className={btnPri} onClick={() => setF({ from_store_id: null, to_store_id: null, remarks: '' })}><i className="fas fa-exchange-alt mr-1" />New Transfer</button>
      </div>
      <Table rows={rows} cols={[
        ['No.', (r) => <span className="font-mono">{r.transfer_no}</span>], ['Date', (r) => r.requested],
        ['From → To', (r) => `${r.from_store} → ${r.to_store}`],
        ['Items', (r) => r.lines?.map((l: any) => <div key={l.id} className="text-xs">{l.item}{l.batch_no && ` [${l.batch_no}]`}: <b>{fmt(l.qty)} {l.unit}</b>{l.brand && ` · ${l.brand}`}</div>)],
        ['Requested by', (r) => r.requested_by_name], ['Approved by', (r) => r.approved_by_name || '—'],
        ['Status', (r) => <><Badge s={r.status} />{r.reject_reason && <div className="text-xs text-rose-600">{r.reject_reason}</div>}</>],
        ['', (r) => <div className="flex gap-1 justify-end"><button className={btnSec} onClick={() => print(r)}><i className="fas fa-print mr-1" />Print</button>{r.status === 'PENDING' && <><button className={btnPri} onClick={() => approve(r)}>Approve</button><button className={btnSec} onClick={() => reject(r)}>Reject</button></>}</div>, 'text-right'],
      ]} />
      <Modal open={!!f} onClose={() => setF(null)} title="New department transfer" width="full">
        {f && <div className="space-y-3">
          <div className="grid md:grid-cols-2 gap-3">
            <label className="text-xs font-semibold text-slate-600">From store<StoreSelect stores={stores} value={f.from_store_id} onChange={(v: any) => setF({ ...f, from_store_id: v })} /></label>
            <label className="text-xs font-semibold text-slate-600">To store<StoreSelect stores={allStores} value={f.to_store_id} onChange={(v: any) => setF({ ...f, to_store_id: v })} /></label>
          </div>
          {f.from_store_id && <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
            <div className="text-sm font-semibold text-emerald-900 mb-2">In stock in this store ({inStock.length} item line{inStock.length === 1 ? '' : 's'}) - click Add to transfer</div>
            {inStock.length === 0 ? <div className="text-sm text-rose-700">This store has no stock to transfer.</div> :
              <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-2">{inStock.map((a: any) => <div key={`${a.product_id}-${a.batch_no}-${a.brand_id}`} className="flex items-center gap-2 bg-white border rounded p-2 text-xs">
                <div className="flex-1 min-w-0"><div className="font-medium truncate">{a.item}</div><div className="text-slate-500">{a.item_code}{a.batch_no && ` · ${a.batch_no}`}{a.brand && ` · ${a.brand}`}</div></div>
                <b className="text-emerald-700 whitespace-nowrap text-right">{ctnText(a.qty, a.units_per_carton) || `${fmt(a.qty)} ${a.unit}`}{ctnText(a.qty, a.units_per_carton) && <div className="font-normal text-slate-500">{fmt(a.qty)} {a.unit}</div>}</b><button className={btnSec} onClick={() => addFromStock(a)}>Add</button></div>)}</div>}
          </div>}
          <Lines lines={lines} setLines={setLines} brands={brands} avail={f.from_store_id ? avail : undefined} />
          <input className={inp} placeholder="Remarks" value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} />
          <p className="text-xs text-slate-500">Stock moves only when another user approves the transfer.</p>
          <div className="flex justify-end gap-2"><button className={btnSec} onClick={() => setF(null)}>Cancel</button><button className={btnPri} disabled={busy} onClick={create}>Send for approval</button></div>
        </div>}
      </Modal>
    </>
  );
}

function Ledger({ stores, canAll }: any) {
  const today = new Date().toISOString().slice(0, 10);
  const [p, setP] = useState<any>({ store_id: null, from_date: today.slice(0, 8) + '01', to_date: today, search: '' });
  const [rows, load] = useList<any>('/manufacturing/ledger', { ...p, store_id: p.store_id || undefined });
  const reverse = (r: any) => {
    const reason = prompt(`Reverse ${r.doc_no} (${fmt(r.qty)} ${r.unit} ${r.item})? Reason:`);
    if (reason) api.post(`/manufacturing/stock/txns/${r.id}/reverse`, { reason }).then((x) => { toast.success(`Reversed as ${x.data.doc_no}`); load(); }).catch(err);
  };
  return (
    <>
      <div className="flex flex-wrap gap-2 mb-3">
        <div className="w-64"><StoreSelect stores={stores} value={p.store_id} onChange={(v: any) => setP({ ...p, store_id: v })} all={canAll} /></div>
        <div className="w-44"><input type="date" className={`${inp} w-40`} value={p.from_date} onChange={(e) => setP({ ...p, from_date: e.target.value })} /></div>
        <div className="w-44"><input type="date" className={`${inp} w-40`} value={p.to_date} onChange={(e) => setP({ ...p, to_date: e.target.value })} /></div>
        <div className="w-72"><input className={`${inp} w-64`} placeholder="Doc / item / batch / ref" value={p.search} onChange={(e) => setP({ ...p, search: e.target.value })} /></div>
      </div>
      <Table rows={rows} empty="No movements in this period." cols={[
        ['Doc', (r) => <span className="font-mono text-xs">{r.doc_no}</span>], ['When', (r) => r.posted], ['Type', (r) => r.txn_type],
        ['Item', (r) => r.item], ['Batch', (r) => r.batch_no || '—'], ['Brand', (r) => r.brand || '—'],
        ['From', (r) => r.from_store || '—'], ['To', (r) => r.to_store || '—'],
        ['Qty', (r) => <b>{fmt(r.qty)} {r.unit}</b>, 'text-right'],
        ['Entered', (r) => r.unit_entered ? `${fmt(r.qty_entered)} ${r.unit_entered}` : '—'],
        ['Ref', (r) => r.ref_no || '—'], ['By', (r) => r.posted_by], ['Remarks', (r) => <span className="text-xs">{r.remarks}</span>],
        ['', (r) => r.reversed_by ? <span className="text-xs text-slate-500">reversed by {r.reversed_by}</span>
          : !r.reversal_of && <button className={btnSec} title="Post a reversal" onClick={() => reverse(r)}><i className="fas fa-undo" /></button>, 'text-right'],
      ]} />
    </>
  );
}

function Opening({ stores, brands }: any) {
  const [store, setStore] = useState<number | null>(null);
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [remarks, setRemarks] = useState('');
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const post = async () => {
    if (!store) return toast.error('Choose the store');
    setBusy(true);
    try {
      const r = await api.post('/manufacturing/stock/opening', { store_id: store, lines: linesBody(lines), remarks, request_key: key });
      toast.success(`Opening stock posted: ${r.data.doc_no}`); setLines([newLine()]); setRemarks(''); setKey(crypto.randomUUID());
    } catch (e) { err(e); } finally { setBusy(false); }
  };
  return (
    <div className="bg-white border rounded-lg p-4 space-y-3 max-w-5xl">
      <p className="text-sm text-slate-600">Stock already physically in a department when this module starts. Managers / administrators only.</p>
      <div className="w-72"><StoreSelect stores={stores} value={store} onChange={setStore} /></div>
      <Lines lines={lines} setLines={setLines} brands={brands} />
      <input className={inp} placeholder="Remarks (e.g. physical count 27-Oct)" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
      <div className="flex justify-end"><button className={btnPri} disabled={busy} onClick={post}>Post opening stock</button></div>
    </div>
  );
}

function Stores({ stores, reload }: any) {
  const [f, setF] = useState<any>(null);
  const save = () => api.put(`/manufacturing/stores/${f.id}`, f).then(() => { toast.success('Store saved'); setF(null); reload(); }).catch(err);
  return (
    <>
      <Table rows={stores} cols={[
        ['Code', (r) => <span className="font-mono">{r.code}</span>], ['Store', (r) => r.name], ['Kind', (r) => r.kind],
        ['Usable stock', (r) => r.is_wip ? 'Work in progress' : r.usable ? 'Yes' : 'No'],
        ['Items in stock', (r) => r.items, 'text-right'], ['Total qty', (r) => fmt(r.qty), 'text-right'],
        ['Active', (r) => r.is_active ? 'Yes' : 'No'],
        ['', (r) => <button className={btnSec} onClick={() => setF({ ...r })}>Edit</button>, 'text-right'],
      ]} />
      <Modal open={!!f} onClose={() => setF(null)} title={`Store ${f?.code}`}>
        {f && <div className="space-y-3">
          <input className={inp} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.usable} onChange={(e) => setF({ ...f, usable: e.target.checked })} />Stock here is usable (available for issue / sale)</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.is_active} onChange={(e) => setF({ ...f, is_active: e.target.checked })} />Active</label>
          <div className="flex justify-end gap-2"><button className={btnSec} onClick={() => setF(null)}>Cancel</button><button className={btnPri} onClick={save}>Save</button></div>
        </div>}
      </Modal>
    </>
  );
}

function Inward({ stores, brands }: any) {
  const [outlets, setOutlets] = useState<any[]>([]);
  const [f, setF] = useState<any>({ outlet_id: '', to_store_id: null, grn_ref: '', remarks: '' });
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [k, setK] = useState(() => crypto.randomUUID());
  useEffect(() => { api.get('/outlets').then((r) => setOutlets(r.data?.data || r.data || [])).catch(() => {}); }, []);
  const targets = stores.filter((s: any) => ['RAW', 'PACKAGING', 'PLAIN_TIN', 'PRINTED', 'QC'].includes(s.kind));
  const post = async () => {
    try {
      const r = await api.post('/manufacturing/stock/inward', { ...f, outlet_id: Number(f.outlet_id), lines: linesBody(lines), request_key: k });
      toast.success(r.data.doc_no ? `Received into plant: ${r.data.doc_no}` : 'Already posted'); setLines([newLine()]); setK(crypto.randomUUID());
    } catch (e) { err(e); }
  };
  return (
    <div className="bg-white border rounded-lg p-4 space-y-3 max-w-5xl">
      <p className="text-sm text-slate-600">Material purchased through PO / GRN lands in an outlet or warehouse. Move it into the plant here — it leaves that outlet's stock at the same moment, so it is never counted twice. Choose <b>QC / Quarantine</b> when it must be inspected first (then transfer to the store after inspection).</p>
      <div className="grid md:grid-cols-3 gap-3">
        <select className={inp} value={f.outlet_id} onChange={(e) => setF({ ...f, outlet_id: e.target.value })}>
          <option value="">From outlet / warehouse…</option>{outlets.map((o: any) => <option key={o.id} value={o.id}>{o.outlet_name || o.name}</option>)}</select>
        <StoreSelect stores={targets} value={f.to_store_id} onChange={(v: any) => setF({ ...f, to_store_id: v })} />
        <input className={inp} placeholder="GRN / supplier invoice ref" value={f.grn_ref} onChange={(e) => setF({ ...f, grn_ref: e.target.value })} />
      </div>
      <Lines lines={lines} setLines={setLines} brands={brands} />
      <input className={inp} placeholder="Remarks" value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} />
      <div className="flex justify-end"><button className={btnPri} onClick={post}>Receive into plant</button></div>
    </div>
  );
}

function Dispose({ stores }: any) {
  const kinds = stores.filter((s: any) => ['REJECTED', 'SCRAP'].includes(s.kind));
  const [store, setStore] = useState<number | null>(null);
  const [rows, load] = useList<any>('/manufacturing/stock', { store_id: store || -1 });
  const act = (r: any, action: string) => {
    const qty = prompt(`${action === 'RETURN_TO_VENDOR' ? 'Return to vendor' : 'Dispose as scrap'} — quantity (max ${fmt(r.qty)})`);
    const reason = qty && prompt('Reason / vendor debit note ref');
    if (!qty || !reason) return;
    api.post('/manufacturing/stock/dispose', { store_id: r.store_id, product_id: r.product_id, batch_no: r.batch_no, brand_id: r.brand_id, qty: Number(qty), action, reason })
      .then(() => { toast.success('Posted'); load(); }).catch(err);
  };
  return (
    <>
      <p className="text-xs text-slate-500 mb-2">Rejected and scrap stock leaves the plant only through this screen (manager / admin). To send rejected printed tins for reprinting, create a printing challan from the Rejected store.</p>
      <div className="w-72 mb-3"><StoreSelect stores={kinds} value={store} onChange={setStore} /></div>
      <Table rows={store ? rows : []} empty="Choose the Rejected or Scrap store." cols={[
        ['Item', (r) => r.item], ['Brand', (r) => r.brand || 'General'], ['Batch / job', (r) => r.batch_no || '—'], ['Qty', (r) => `${fmt(r.qty)} ${r.unit}`, 'text-right'],
        ['', (r) => <div className="flex gap-1 justify-end"><button className={btnSec} onClick={() => act(r, 'RETURN_TO_VENDOR')}>Return to vendor</button>
          <button className={btnSec} onClick={() => act(r, 'SCRAP_DISPOSAL')}>Dispose</button></div>, 'text-right'],
      ]} />
    </>
  );
}

function Access({ stores }: any) {
  const [users, load] = useList<any>('/manufacturing/store-access');
  const [f, setF] = useState<any>(null);
  const save = () => api.put(`/manufacturing/store-access/${f.id}`, { store_ids: f.store_ids }).then(() => { toast.success('Departments saved'); setF(null); load(); }).catch(err);
  const tog = (id: number) => setF({ ...f, store_ids: f.store_ids.includes(id) ? f.store_ids.filter((x: number) => x !== id) : [...f.store_ids, id] });
  return (
    <>
      <p className="text-sm text-slate-600 mb-3">Administrators see every department. Any other user sees stock, ledgers and transfers of the departments given here only, and can send stock out of those departments only.</p>
      <Table rows={users} cols={[
        ['User', (r) => <>{r.name}<div className="text-[11px] text-slate-500">{r.username}</div></>], ['Role', (r) => r.role],
        ['Departments', (r) => ['admin', 'superadmin', 'super_admin'].includes(r.role) ? <span className="text-emerald-700">All departments</span>
          : r.store_ids.length ? stores.filter((s: any) => r.store_ids.includes(s.id)).map((s: any) => s.name).join(', ') : <span className="text-rose-600">None - cannot see any stock</span>],
        ['', (r) => !['admin', 'superadmin', 'super_admin'].includes(r.role) && <button className={btnSec} onClick={() => setF({ id: r.id, name: r.name, store_ids: [...r.store_ids] })}>Set departments</button>, 'text-right'],
      ]} />
      <Modal open={!!f} onClose={() => setF(null)} title={`Departments for ${f?.name}`}>
        {f && <div className="space-y-2">
          {stores.map((s: any) => <label key={s.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.store_ids.includes(s.id)} onChange={() => tog(s.id)} />{s.code} - {s.name}</label>)}
          <div className="flex justify-end gap-2 pt-2"><button className={btnSec} onClick={() => setF(null)}>Cancel</button><button className={btnPri} onClick={save}>Save</button></div>
        </div>}
      </Modal>
    </>
  );
}

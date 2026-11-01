import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import api from '../../api/axios';
import Modal from '../../components/ui/Modal';
import { Badge, ItemPicker, Stat, Table, btnPri, btnSec, err, fmt, inp, key, printDoc, useList } from './mfgShared';

const L = ({ label, children }: { label: string; children: any }) => (
  <label className="block"><span className="block text-xs font-semibold text-slate-600 mb-1">{label}</span>{children}</label>
);

export default function MfgPrinting() {
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [rows, load] = useList<any>('/manufacturing/printing/jobs', { status: status || undefined, search: q });
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const pending = rows.filter((r) => ['ISSUED', 'PARTIAL'].includes(r.status));
  return (
    <div className="p-4 w-full">
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <h1 className="text-xl font-bold text-slate-800 flex-1"><i className="fas fa-print text-indigo-600 mr-2" />Printing Job Work</h1>
        <button className={btnPri} onClick={() => setCreating(true)}><i className="fas fa-plus mr-1" />New Printing Challan</button>
      </div>
      <p className="text-xs text-slate-500 mb-4">Plain tins sent to printing stay company stock in Printing WIP. Only inspected, accepted printed tins become usable. A job closes only when issued = accepted + rejected + damaged + lost + returned.</p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
        <Stat label="Awaiting approval" value={rows.filter((r) => r.status === 'PENDING_APPROVAL').length} tone="amber" onClick={() => setStatus('PENDING_APPROVAL')} />
        <Stat label="With printer (jobs)" value={pending.length} tone="blue" onClick={() => setStatus('ISSUED')} />
        <Stat label="Tins pending from printer" value={fmt(pending.reduce((s, r) => s + Number(r.pending), 0))} />
        <Stat label="Overdue jobs" value={rows.filter((r) => r.overdue).length} tone="red" />
      </div>
      <div className="flex flex-wrap gap-2 mb-3">
        <select className={`${inp} w-48`} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>{['PENDING_APPROVAL', 'ISSUED', 'PARTIAL', 'RECEIVED', 'CLOSED', 'REJECTED', 'CANCELLED'].map((s) => <option key={s}>{s}</option>)}
        </select>
        <input className={`${inp} w-72`} placeholder="Job / vendor / item / customer order" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <Table rows={rows} cols={[
        ['Job', (r) => <button className="font-mono text-indigo-700 hover:underline" onClick={() => setOpen(r.id)}>{r.job_no}</button>],
        ['Date', (r) => r.job_date], ['Printer', (r) => <>{r.vendor_name}<div className="text-[11px] text-slate-500">{r.vendor_type}</div></>],
        ['Customer / brand', (r) => <>{r.customer || 'Own'}<div className="text-[11px] text-slate-500">{r.brand}</div></>],
        ['Artwork', (r) => `${r.artwork_code} r${r.artwork_rev}`], ['Printed item', (r) => r.printed_item],
        ['Issued', (r) => fmt(r.qty_issued), 'text-right'], ['Accepted', (r) => fmt(r.accepted_qty), 'text-right'],
        ['Rej / dmg', (r) => `${fmt(r.rejected_qty)} / ${fmt(r.damaged_qty)}`, 'text-right'],
        ['Pending', (r) => <b className={Number(r.pending) ? 'text-amber-700' : ''}>{fmt(r.pending)}</b>, 'text-right'],
        ['Due', (r) => <span className={r.overdue ? 'text-rose-600 font-semibold' : ''}>{r.expected_return || '—'}</span>],
        ['Status', (r) => <Badge s={r.status} />],
      ]} />
      {creating && <NewJob onClose={() => setCreating(false)} onDone={(id) => { setCreating(false); load(); setOpen(id); }} />}
      {open && <JobDetail id={open} onClose={() => { setOpen(null); load(); }} />}
    </div>
  );
}

function NewJob({ onClose, onDone }: { onClose: () => void; onDone: (id: number) => void }) {
  const [specs] = useList<any>('/manufacturing/master/specs', { status: 'APPROVED' });
  const [arts] = useList<any>('/manufacturing/master/artworks', { status: 'APPROVED' });
  const [brands] = useList<any>('/manufacturing/brands');
  const [stores] = useList<any>('/manufacturing/stores', { for_pick: true });
  const [orders] = useList<any>('/manufacturing/sales-orders', { status: 'OPEN' });
  const [f, setF] = useState<any>({ vendor_type: 'INTERNAL', vendor_name: '', qty: '', unit: '', source_batch_no: '', source_brand_id: 0 });
  const [stock, setStock] = useState<any[]>([]);
  useEffect(() => {
    if (!f.plain_item_id) return setStock([]);
    api.get('/manufacturing/stock', { params: { search: '' } }).then((r) => setStock(r.data.filter((x: any) => x.product_id === f.plain_item_id && x.usable)));
  }, [f.plain_item_id]);
  const pickSpec = (id: number) => {
    const s = specs.find((x) => x.id === id);
    if (!s) return setF({ ...f, spec_id: null });
    setF({ ...f, spec_id: s.id, brand_id: s.brand_id, artwork_id: s.tin_artwork_id, printed_item_id: s.printed_tin_item_id, printed_name: s.printed_tin_name,
      tin_size: s.tin_size, printing_colour: s.printing_colour, cap_colour: s.cap_colour, art_file: s.tin_artwork_file });
  };
  const sources = stores.filter((s) => ['PLAIN_TIN', 'PACKAGING', 'REJECTED'].includes(s.kind));
  const art = arts.find((a) => a.id === f.artwork_id);
  const save = async () => {
    try {
      const body = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v === '' ? null : v]));
      const r = await api.post('/manufacturing/printing/jobs', { ...body, source_batch_no: f.source_batch_no || '', unit: f.unit || null });
      toast.success(`${r.data.job_no} created — a second person must approve it to issue the tins`); onDone(r.data.id);
    } catch (e) { err(e); }
  };
  return (
    <Modal open onClose={onClose} title="New printing issue challan" width="full">
      <div className="grid md:grid-cols-2 gap-3">
        <L label="Packaging spec (fills brand, artwork, printed item)">
          <select className={inp} value={f.spec_id || ''} onChange={(e) => pickSpec(Number(e.target.value))}>
            <option value="">—</option>{specs.map((s) => <option key={s.id} value={s.id}>{s.spec_code} r{s.revision} — {s.brand_name} · {s.product_name}</option>)}
          </select>
        </L>
        <L label="Customer order (optional)">
          <select className={inp} value={f.sales_order_id || ''} onChange={(e) => setF({ ...f, sales_order_id: Number(e.target.value) || null })}>
            <option value="">—</option>{orders.map((o) => <option key={o.id} value={o.id}>{o.so_no} — {o.customer || o.brand} · {fmt(o.ordered_qty)}</option>)}
          </select>
        </L>
        <L label="Brand"><select className={inp} value={f.brand_id || ''} onChange={(e) => setF({ ...f, brand_id: Number(e.target.value), artwork_id: null })}>
          <option value="">Choose…</option>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></L>
        <L label="Approved artwork (this brand only)">
          <select className={inp} value={f.artwork_id || ''} onChange={(e) => setF({ ...f, artwork_id: Number(e.target.value) })}>
            <option value="">Choose…</option>{arts.filter((a) => a.brand_id === f.brand_id).map((a) => <option key={a.id} value={a.id}>{a.code} r{a.revision} — {a.title} ({a.applies_to})</option>)}
          </select>
        </L>
        {art && <div className="md:col-span-2 text-xs bg-indigo-50 border border-indigo-200 rounded p-2">
          <b>{art.brand_name}</b> · artwork <b>{art.code} r{art.revision}</b> · colours {art.colours || '—'} {art.file_path && <a className="text-indigo-700 underline ml-2" href={art.file_path} target="_blank" rel="noreferrer">view design</a>}
        </div>}
        <L label="Plain item (issued)"><ItemPicker value={f.plain_item_id} label={f.plain_name} onPick={(p) => setF({ ...f, plain_item_id: p?.id ?? null, plain_name: p?.name })} /></L>
        <L label="Printed item (comes back)"><ItemPicker value={f.printed_item_id} label={f.printed_name} onPick={(p) => setF({ ...f, printed_item_id: p?.id ?? null, printed_name: p?.name })} /></L>
        <L label="Issue from store / batch">
          <select className={inp} value={`${f.source_store_id || ''}|${f.source_batch_no}|${f.source_brand_id}`}
            onChange={(e) => { const [s, b, br] = e.target.value.split('|'); setF({ ...f, source_store_id: Number(s) || null, source_batch_no: b, source_brand_id: Number(br) || 0 }); }}>
            <option value="||0">Choose…</option>
            {stock.filter((x) => sources.some((s) => s.id === x.store_id)).map((x) => (
              <option key={`${x.store_id}|${x.batch_no}|${x.brand_id}`} value={`${x.store_id}|${x.batch_no}|${x.brand_id}`}>
                {x.store} {x.batch_no && `· ${x.batch_no}`} {x.brand && `· ${x.brand}`} — available {fmt(x.qty)} {x.unit}</option>))}
          </select>
        </L>
        <L label="Quantity issued">
          <div className="flex gap-2"><input type="number" className={inp} value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} />
            <input className={`${inp} w-28`} placeholder="Unit (base)" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value.toUpperCase() })} /></div>
        </L>
        <L label="Printer"><div className="flex gap-2">
          <select className={`${inp} w-32`} value={f.vendor_type} onChange={(e) => setF({ ...f, vendor_type: e.target.value })}><option>INTERNAL</option><option>EXTERNAL</option></select>
          <input className={inp} placeholder="Department / vendor name" value={f.vendor_name} onChange={(e) => setF({ ...f, vendor_name: e.target.value })} /></div></L>
        <L label="Expected return"><input type="date" className={inp} value={f.expected_return || ''} onChange={(e) => setF({ ...f, expected_return: e.target.value })} /></L>
        <L label="Tin size"><input className={inp} value={f.tin_size || ''} onChange={(e) => setF({ ...f, tin_size: e.target.value })} /></L>
        <L label="Printing colour / cap colour"><div className="flex gap-2">
          <input className={inp} value={f.printing_colour || ''} onChange={(e) => setF({ ...f, printing_colour: e.target.value })} />
          <input className={inp} value={f.cap_colour || ''} onChange={(e) => setF({ ...f, cap_colour: e.target.value })} /></div></L>
        <L label="Vehicle / delivery ref"><input className={inp} value={f.vehicle_ref || ''} onChange={(e) => setF({ ...f, vehicle_ref: e.target.value })} /></L>
        <L label="Remarks"><input className={inp} value={f.remarks || ''} onChange={(e) => setF({ ...f, remarks: e.target.value })} /></L>
      </div>
      <div className="flex justify-end gap-2 pt-4"><button className={btnSec} onClick={onClose}>Cancel</button><button className={btnPri} onClick={save}>Save challan</button></div>
    </Modal>
  );
}

function JobDetail({ id, onClose }: { id: number; onClose: () => void }) {
  const [j, setJ] = useState<any>(null);
  const [rc, setRc] = useState<any>(null);
  const load = () => api.get(`/manufacturing/printing/jobs/${id}`).then((r) => setJ(r.data)).catch(err);
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!j) return null;
  const act = async (path: string, body?: any, msg = 'Done') => {
    try { await api.post(`/manufacturing/printing/jobs/${id}/${path}`, body); toast.success(msg); load(); } catch (e) { err(e); }
  };
  const ask = (path: string, label: string, withQty = false) => {
    const qty = withQty ? prompt(`${label}: quantity (pending ${fmt(j.pending)})`) : null;
    if (withQty && !qty) return;
    const reason = prompt(`${label}: reason`);
    if (reason) act(path, withQty ? { qty: Number(qty), reason } : { reason }, label);
  };
  const live = ['ISSUED', 'PARTIAL'].includes(j.status);
  const challan = () => printDoc(`Printing Issue Challan ${j.job_no}`, [['Date', j.job_date], ['Printer', `${j.vendor_name} (${j.vendor_type})`],
    ['Customer', j.customer || 'Own brand'], ['Brand', j.brand], ['Artwork', `${j.artwork_code} r${j.artwork_rev}`], ['Tin size', j.tin_size || '—'],
    ['Printing colour', j.printing_colour || '—'], ['Cap colour', j.cap_colour || '—'], ['Customer order', j.so_no || '—'], ['Expected return', j.expected_return || '—'],
    ['Vehicle', j.vehicle_ref || '—'], ['Prepared / approved', `${j.prepared_by_name || ''} / ${j.approved_by_name || 'pending'}`]],
    ['Item issued', 'Source store', 'Quantity', 'Printed item to return'], [[j.plain_item, j.source_store, fmt(j.qty_issued), j.printed_item]],
    ['Prepared by', 'Approved by', 'Received by printer']);
  return (
    <Modal open onClose={onClose} title={`Printing Job ${j.job_no}`} width="full">
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2 items-center"><Badge s={j.status} />
          <span className="text-sm">{j.vendor_name} · {j.customer || 'Own'} / <b>{j.brand}</b> · artwork <b>{j.artwork_code} r{j.artwork_rev}</b>
            {j.artwork_file && <a className="text-indigo-700 underline ml-2" href={j.artwork_file} target="_blank" rel="noreferrer">design</a>}</span>
          <div className="flex-1" /><button className={btnSec} onClick={challan}><i className="fas fa-print mr-1" />Challan</button>
        </div>
        <div className="grid grid-cols-3 md:grid-cols-7 gap-2">
          <Stat label="Issued" value={fmt(j.qty_issued)} /><Stat label="Accepted" value={fmt(j.accepted_qty)} tone="green" />
          <Stat label="Rejected" value={fmt(j.rejected_qty)} tone="red" /><Stat label="Damaged" value={fmt(j.damaged_qty)} tone="red" />
          <Stat label="Lost (approved)" value={fmt(j.lost_qty)} /><Stat label="Returned" value={fmt(j.returned_qty)} />
          <Stat label="Pending" value={fmt(j.pending)} tone={Number(j.pending) ? 'amber' : 'green'} />
        </div>
        <div className="text-xs text-slate-600">Reconciliation: {fmt(j.qty_issued)} = {fmt(j.accepted_qty)} + {fmt(j.rejected_qty)} + {fmt(j.damaged_qty)} + {fmt(j.lost_qty)} + {fmt(j.returned_qty)} + <b>{fmt(j.pending)} pending</b></div>
        <div className="flex flex-wrap gap-2">
          {j.status === 'PENDING_APPROVAL' && <>
            <button className={btnPri} onClick={() => act('approve', undefined, 'Approved — tins moved to Printing WIP')}>Approve & issue</button>
            <button className={btnSec} onClick={() => ask('reject', 'Reject')}>Reject</button>
            <button className={btnSec} onClick={() => ask('cancel', 'Cancel')}>Cancel</button></>}
          {live && <>
            <button className={btnPri} onClick={() => setRc({ accepted_qty: '', rejected_qty: '', damaged_qty: '', damage_reason: 'Printing Defect', artwork_ok: true, colour_ok: true, quality_status: 'OK', request_key: key() })}>Receive & inspect</button>
            <button className={btnSec} onClick={() => ask('return-unprinted', 'Return unprinted', true)}>Return unprinted</button>
            <button className={btnSec} onClick={() => ask('loss/approve', 'Approve loss (manager)', true)}>Approve loss</button></>}
          {j.status === 'RECEIVED' && <button className={btnPri} onClick={() => act('finalize', undefined, 'Job closed')}>Close job</button>}
        </div>
        {rc && <div className="border rounded-lg p-3 bg-slate-50 space-y-2">
          <div className="grid grid-cols-3 gap-2">
            {[['accepted_qty', 'Accepted'], ['rejected_qty', 'Rejected'], ['damaged_qty', 'Damaged']].map(([k, l]) => (
              <L key={k} label={l}><input type="number" className={inp} value={rc[k]} onChange={(e) => setRc({ ...rc, [k]: e.target.value })} /></L>))}
          </div>
          <div className="flex flex-wrap gap-4 text-sm items-center">
            <label className="flex gap-1 items-center"><input type="checkbox" checked={rc.artwork_ok} onChange={(e) => setRc({ ...rc, artwork_ok: e.target.checked })} />Artwork verified</label>
            <label className="flex gap-1 items-center"><input type="checkbox" checked={rc.colour_ok} onChange={(e) => setRc({ ...rc, colour_ok: e.target.checked })} />Colour verified</label>
            <select className={`${inp} w-40`} value={rc.quality_status} onChange={(e) => setRc({ ...rc, quality_status: e.target.value })}><option>OK</option><option>MINOR_DEFECTS</option><option>FAILED</option></select>
            <select className={`${inp} w-44`} value={rc.damage_reason} onChange={(e) => setRc({ ...rc, damage_reason: e.target.value })}><option>Printing Defect</option><option>Production Damage</option><option>Other Approved Reason</option></select>
          </div>
          <input className={inp} placeholder="QC remarks" value={rc.qc_remarks || ''} onChange={(e) => setRc({ ...rc, qc_remarks: e.target.value })} />
          <div className="text-xs text-slate-600">This receipt: {fmt(Number(rc.accepted_qty || 0) + Number(rc.rejected_qty || 0) + Number(rc.damaged_qty || 0))} of {fmt(j.pending)} pending</div>
          <div className="flex justify-end gap-2"><button className={btnSec} onClick={() => setRc(null)}>Cancel</button>
            <button className={btnPri} onClick={async () => { await act('receive', { ...rc, accepted_qty: Number(rc.accepted_qty || 0), rejected_qty: Number(rc.rejected_qty || 0), damaged_qty: Number(rc.damaged_qty || 0) }, 'Receipt posted'); setRc(null); }}>Post receipt</button></div>
        </div>}
        <h3 className="font-semibold text-sm">Receipts</h3>
        <Table rows={j.receipts} empty="No receipts yet." cols={[['Receipt', (r) => r.receipt_no], ['When', (r) => r.received], ['Accepted', (r) => fmt(r.accepted_qty)],
          ['Rejected', (r) => fmt(r.rejected_qty)], ['Damaged', (r) => fmt(r.damaged_qty)], ['Artwork / colour', (r) => `${r.artwork_ok ? '✔' : '✘'} / ${r.colour_ok ? '✔' : '✘'}`],
          ['Quality', (r) => r.quality_status], ['By', (r) => r.received_by_name], ['Remarks', (r) => r.qc_remarks]]} />
        <h3 className="font-semibold text-sm">Stock movements</h3>
        <Table rows={j.ledger} cols={[['Doc', (r) => r.doc_no], ['Type', (r) => r.txn_type], ['Item', (r) => r.item], ['From', (r) => r.from_store || '—'], ['To', (r) => r.to_store || '—'], ['Qty', (r) => fmt(r.qty)]]} />
        {j.damages.length > 0 && <Table rows={j.damages} cols={[['Damage', (r) => r.damage_no], ['Qty', (r) => fmt(r.qty)], ['Reason', (r) => r.reason], ['Status', (r) => <Badge s={r.status === 'PENDING' ? 'PENDING' : r.status} />]]} />}
      </div>
    </Modal>
  );
}

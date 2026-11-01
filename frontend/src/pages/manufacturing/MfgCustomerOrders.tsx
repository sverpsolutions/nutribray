import { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import api from '../../api/axios';
import Modal from '../../components/ui/Modal';
import CustomerLedger from './MfgCustomerLedger';
import { Badge, CartonQty, Stat, Table, Tabs, btnPri, btnSec, ctnText, err, fmt, inp, key, printDoc, useList } from './mfgShared';

const L = ({ label, children }: { label: string; children: any }) => (
  <label className="block"><span className="block text-xs font-semibold text-slate-600 mb-1">{label}</span>{children}</label>
);
const both = (units: any, upc: any) => <>{fmt(units)}<div className="text-[11px] text-slate-500">{ctnText(units, upc)}</div></>;

export default function MfgCustomerOrders() {
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [rows, load] = useList<any>('/manufacturing/sales-orders', { status: status || undefined, search: q });
  const [tab, setTab] = useState('Orders');
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [po, setPo] = useState<any>(null);
  const live = rows.filter((r) => ['OPEN', 'PARTIAL'].includes(r.status));
  return (
    <div className="p-4 w-full">
      <div className="flex items-center gap-2 mb-1">
        <h1 className="text-xl font-bold text-slate-800 flex-1"><i className="fas fa-file-signature text-indigo-600 mr-2" />Customer Orders & Dispatch</h1>
        <button className={btnPri} onClick={() => setCreating(true)}><i className="fas fa-plus mr-1" />New Customer Order</button>
      </div>
      <p className="text-xs text-slate-500 mb-4">Reserve approved finished goods (stock does not move) → issue to Billing / Dispatch → dispatch with invoice / challan. Dispatch is the only posting that takes goods out, so nothing is deducted twice.</p>
      <Tabs tabs={['Orders', 'Customer Ledger']} value={tab} onChange={setTab} />
      {tab === 'Customer Ledger' && <CustomerLedger />}
      {tab === 'Orders' && <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
        <Stat label="Waiting for approval" value={rows.filter((r) => r.status === 'PENDING_APPROVAL').length} tone="amber" onClick={() => setStatus('PENDING_APPROVAL')} />
        <Stat label="Open orders" value={live.length} tone="blue" />
        <Stat label="Ready for billing" value={live.filter((r) => r.ready_for_billing_qty > 0).length} tone="amber" sub="goods handed to dispatch, not yet dispatched" />
        <Stat label="Pending production" value={live.filter((r) => r.pending_production_qty > 0).length} />
        <Stat label="Overdue" value={live.filter((r) => r.delivery_date && r.delivery_date < new Date().toISOString().slice(0, 10)).length} tone="red" />
      </div>
      <div className="flex flex-wrap gap-2 mb-3">
        <select className={`${inp} w-44`} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>{['PENDING_APPROVAL', 'REJECTED', 'OPEN', 'PARTIAL', 'COMPLETED', 'CLOSED', 'CANCELLED'].map((s) => <option key={s}>{s}</option>)}
        </select>
        <input className={`${inp} w-72`} placeholder="Order / customer PO / customer / brand / product" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <Table rows={rows} cols={[
        ['Order', (r) => <button className="font-mono text-indigo-700 hover:underline" onClick={() => setOpen(r.id)}>{r.so_no}</button>],
        ['Customer / brand', (r) => <>{r.customer || 'Own brand'}<div className="text-[11px] text-slate-500">{r.brand}</div></>],
        ['Customer PO', (r) => (r.customer_po_no ? <button className="text-indigo-700 hover:underline" title="All items of this PO" onClick={() => setPo(r)}>{r.customer_po_no}{rows.filter((x) => x.customer_po_no === r.customer_po_no && x.customer_id === r.customer_id).length > 1 && <span className="ml-1 text-[11px] bg-indigo-100 text-indigo-700 rounded px-1">{rows.filter((x) => x.customer_po_no === r.customer_po_no && x.customer_id === r.customer_id).length} items</span>}</button> : '—')],
        ['Product', (r) => <>{r.product}<div className="text-[11px] text-slate-500">{r.units_per_carton}/carton {r.spec_code && `· ${r.spec_code}`}</div></>],
        ['Ordered', (r) => both(r.ordered_qty, r.units_per_carton), 'text-right'], ['QC approved', (r) => both(r.qc_approved_qty, r.units_per_carton), 'text-right'],
        ['Reserved', (r) => fmt(r.reserved_qty), 'text-right'], ['Issued', (r) => both(r.issued_qty, r.units_per_carton), 'text-right'],
        ['Dispatched', (r) => both(r.dispatched_qty, r.units_per_carton), 'text-right'], ['Pending', (r) => <b>{both(r.pending_qty, r.units_per_carton)}</b>, 'text-right'],
        ['Due', (r) => r.delivery_date || '—'], ['Priority', (r) => r.priority], ['Status', (r) => <Badge s={r.status === 'OPEN' ? 'APPROVED' : r.status === 'COMPLETED' ? 'APPROVED' : r.status} />],
      ]} />
      </>}
      {creating && <NewOrder onClose={() => setCreating(false)} onDone={(id) => { setCreating(false); load(); setOpen(id); }} />}
      {po && <PoView po={po} onClose={() => setPo(null)} onOpen={(id) => { setPo(null); setOpen(id); }} />}
      {open && <OrderDetail id={open} onClose={() => { setOpen(null); load(); }} />}
    </div>
  );
}

/** Pick the customer (type to search, arrow keys + Enter); their items then appear below ready for quantities. */
function CustomerPicker({ customers, value, onPick }: { customers: { name: string; n: number }[]; value: string; onPick: (n: string) => void }) {
  const [find, setFind] = useState('');
  const [hi, setHi] = useState(0);
  const [open, setOpen] = useState(!value);
  const words = find.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = customers.filter((c) => words.every((w) => c.name.toLowerCase().includes(w))).slice(0, 50);
  const pick = (n: string) => { onPick(n); setOpen(false); setFind(''); };
  if (value && !open) {
    return (
      <div className="flex items-center gap-2 text-sm bg-indigo-50 border border-indigo-200 rounded p-2">
        <i className="fas fa-building text-indigo-600" /><b className="flex-1">{value}</b>
        <button type="button" className={btnSec} onClick={() => setOpen(true)}>Change customer</button>
      </div>
    );
  }
  return (
    <div>
      <input className={inp} autoFocus placeholder="Type the customer name...  (↑ ↓ to move, Enter to choose)" value={find}
        onChange={(e) => { setFind(e.target.value); setHi(0); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const n = Math.min(Math.max(hi + (e.key === 'ArrowDown' ? 1 : -1), 0), Math.max(shown.length - 1, 0));
            setHi(n); e.currentTarget.parentElement?.querySelector(`#cust-opt-${n}`)?.scrollIntoView({ block: 'nearest' });
          } else if (e.key === 'Enter' && shown[hi]) { e.preventDefault(); pick(shown[hi].name); }
        }} />
      <div className="mt-1 max-h-56 overflow-y-auto border rounded bg-white divide-y">
        {shown.length === 0 && <div className="p-3 text-sm text-slate-500">No customer with an approved packaging spec matches "{find}".</div>}
        {shown.map((c, i) => <button key={c.name} id={`cust-opt-${i}`} type="button" onClick={() => pick(c.name)} onMouseEnter={() => setHi(i)}
          className={`w-full text-left px-3 py-2 text-sm ${i === hi ? 'bg-indigo-50' : ''}`}><b>{c.name}</b><span className="text-xs text-slate-500"> · {c.n} item{c.n === 1 ? '' : 's'}</span></button>)}
      </div>
    </div>
  );
}

function NewOrder({ onClose, onDone }: { onClose: () => void; onDone: (id: number) => void }) {
  const [specs] = useList<any>('/manufacturing/master/specs', { status: 'APPROVED' });
  const [f, setF] = useState<any>({ priority: 'NORMAL' });
  const [customer, setCustomer] = useState('');
  const [find, setFind] = useState('');
  const [qty, setQty] = useState<Record<number, { qty: string; unit: string }>>({});
  const [busy, setBusy] = useState(false);
  const who = (x: any) => x.customer_name || 'Own brand';
  const customers = useMemo(() => {
    const m = new Map<string, number>();
    specs.forEach((x) => m.set(who(x), (m.get(who(x)) || 0) + 1));
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, n]) => ({ name, n }));
  }, [specs]);
  const words = find.toLowerCase().split(/\s+/).filter(Boolean);
  const items = specs.filter((x) => who(x) === customer && words.every((w) => `${x.product_name} ${x.item_code} ${x.brand_name} ${x.spec_code} ${x.customer_item_code || ''}`.toLowerCase().includes(w)));
  const set = (id: number, p: any) => setQty((q) => ({ ...q, [id]: { ...{ qty: '', unit: 'CTN' }, ...(q[id] || {}), ...p } }));
  const chosen = specs.filter((x) => who(x) === customer && Number(qty[x.id]?.qty) > 0);
  const save = async () => {
    if (!chosen.length) return toast.error('Enter a quantity against at least one item');
    if (chosen.length > 1 && !(f.customer_po_no || '').trim()) return toast.error('Enter the customer PO number - it ties the items together');
    setBusy(true);
    try {
      const r = await api.post('/manufacturing/sales-orders/multi', { ...f, delivery_date: f.delivery_date || null,
        lines: chosen.map((x) => ({ spec_id: x.id, qty: Number(qty[x.id].qty), unit: qty[x.id].unit === 'CTN' ? 'CTN' : null })) });
      toast.success(`${r.data.so_nos.join(', ')} created`); onDone(r.data.ids[0]);
    } catch (e) { err(e); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="New customer order" width="full">
      <div className="mb-3"><div className="text-xs font-semibold text-slate-600 mb-1">1. Customer</div>
        <CustomerPicker customers={customers} value={customer} onPick={(n) => { setCustomer(n); setQty({}); setFind(''); }} /></div>
      {customer && <>
        <div className="grid md:grid-cols-4 gap-3 mb-3">
          <L label="Customer PO number (same for all items)"><input className={inp} value={f.customer_po_no || ''} onChange={(e) => setF({ ...f, customer_po_no: e.target.value })} /></L>
          <L label="Required delivery date"><input type="date" className={inp} value={f.delivery_date || ''} onChange={(e) => setF({ ...f, delivery_date: e.target.value })} /></L>
          <L label="Priority"><select className={inp} value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>{['LOW', 'NORMAL', 'HIGH', 'URGENT'].map((p) => <option key={p}>{p}</option>)}</select></L>
          <div />
          <L label="Billing requirement"><input className={inp} value={f.billing_requirement || ''} onChange={(e) => setF({ ...f, billing_requirement: e.target.value })} /></L>
          <L label="Dispatch instructions"><input className={inp} value={f.dispatch_instructions || ''} onChange={(e) => setF({ ...f, dispatch_instructions: e.target.value })} /></L>
        </div>
        <div className="flex items-center gap-3 mb-1">
          <div className="text-xs font-semibold text-slate-600">2. Enter the quantity against each item the customer ordered ({specs.filter((x) => who(x) === customer).length} items for this customer)</div>
          <input className={`${inp} w-64 ml-auto`} placeholder="Search these items..." value={find} onChange={(e) => setFind(e.target.value)} />
        </div>
        <Table rows={items} empty="This customer has no approved packaging spec - create one under Brands, Artwork & Specs first." cols={[
          ['Item', (x) => <>{x.product_name}<div className="text-[11px] text-slate-500">{x.item_code} · {x.brand_name} · {x.spec_code} r{x.revision}{x.customer_item_code && ` · customer code ${x.customer_item_code}`}</div></>],
          ['Per carton', (x) => x.units_per_carton, 'text-right'],
          ['Quantity', (x) => <div className="flex items-center gap-2 justify-end">
            <input type="number" min={0} className={`${inp} w-28 text-right`} value={qty[x.id]?.qty || ''} onChange={(e) => set(x.id, { qty: e.target.value })} />
            <select className={`${inp} w-28`} value={qty[x.id]?.unit || 'CTN'} onChange={(e) => set(x.id, { unit: e.target.value })}><option value="CTN">Cartons</option><option value="PCS">Pcs</option></select></div>, 'text-right'],
          ['= Pcs', (x) => { const q = Number(qty[x.id]?.qty || 0); return q > 0 ? <b>{fmt((qty[x.id]?.unit || 'CTN') === 'CTN' ? q * x.units_per_carton : q)}</b> : '—'; }, 'text-right'],
        ]} />
        <div className="flex items-center gap-2 pt-4">
          <div className="text-sm text-slate-600 flex-1">{chosen.length ? <>{chosen.length} item{chosen.length === 1 ? '' : 's'} on this order</> : 'Nothing entered yet'}</div>
          <button className={btnSec} onClick={onClose}>Cancel</button>
          <button className={btnPri} disabled={busy || !chosen.length} onClick={save}>{chosen.length > 1 ? `Create ${chosen.length} orders for this PO` : 'Create order'}</button>
        </div>
      </>}
    </Modal>
  );
}

function OrderDetail({ id, onClose }: { id: number; onClose: () => void }) {
  const [o, setO] = useState<any>(null);
  const [form, setForm] = useState<'' | 'handover' | 'dispatch'>('');
  const [h, setH] = useState<any>({ qty: '', unit: 'CTN', received_by: '' });
  const [d, setD] = useState<any>({ qty: '', unit: 'CTN' });
  const [outlets, setOutlets] = useState<any[]>([]);
  const load = () => api.get(`/manufacturing/sales-orders/${id}`).then((r) => setO(r.data)).catch(err);
  useEffect(() => { load(); api.get('/outlets').then((r) => setOutlets(r.data?.data || r.data || [])).catch(() => {}); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!o) return null;
  const upc = o.units_per_carton;
  const post = async (path: string, body?: any, msg = 'Done') => {
    try { const r = await api.post(`/manufacturing/sales-orders/${id}/${path}`, body); toast.success(msg); load(); return r.data; } catch (e) { err(e); }
  };
  const live = ['OPEN', 'PARTIAL'].includes(o.status);
  const meta: [string, any][] = [['Customer', o.customer || 'Own brand'], ['Brand', o.brand], ['Customer PO', o.customer_po_no || '—'], ['Product', o.product],
    ['Customer item code', o.customer_item_code || '—'], ['Internal code', o.item_code], ['Packaging', `${o.spec_code || '—'} · artwork ${o.artwork_code ? `${o.artwork_code} r${o.artwork_rev}` : '—'} · cap ${o.cap_colour || '—'}`],
    ['Ordered', `${fmt(o.ordered_qty)} (${ctnText(o.ordered_qty, upc) || '-'})`]];
  const printHandover = (r: any) => printDoc(`Store Handover Slip ${r.handover_no}`, [...meta, ['Issued', `${fmt(r.qty)} = ${ctnText(r.qty, upc) || fmt(r.qty)}`], ['Batch', r.batch_no], ['Issued on', r.issued],
    ['Received by', r.received_by || '—']], ['From', 'To', 'Batch', 'Units', 'Cartons + loose'], [['Finished Goods Store', 'Billing / Dispatch', r.batch_no, fmt(r.qty), ctnText(r.qty, upc)]],
    ['Issued by (FG store)', 'Checked by', 'Received by (billing)']);
  const printDispatch = (r: any) => printDoc(`Dispatch Note ${r.dispatch_no}`, [...meta, ['Dispatch date', r.dispatch_date], ['Invoice', r.invoice_no || '—'], ['Delivery challan', r.challan_no || '—'],
    ['E-way bill', r.eway_bill || '—'], ['Vehicle', r.vehicle_no || '—'], ['Transporter', r.transporter || '—'], ['LR no', r.lr_no || '—']],
    ['Product', 'Batch', 'Units', 'Cartons + loose'], [[o.product, r.batch_no, fmt(r.qty), ctnText(r.qty, upc)]], ['Dispatched by', 'Driver', 'Customer acknowledgement']);
  const printOrder = () => printDoc(`Customer Order ${o.so_no}`, [...meta, ['Order date', o.so_date], ['Due date', o.delivery_date || '—'], ['Status', o.status],
    ['Made / QC approved', `${fmt(o.finished_qty)} / ${fmt(o.qc_approved_qty)}`], ['Issued to dispatch', fmt(o.issued_qty)], ['Dispatched', `${fmt(o.dispatched_qty)} (${ctnText(o.dispatched_qty, upc) || '-'})`],
    ['Pending', `${fmt(o.pending_qty)} (${ctnText(o.pending_qty, upc) || '-'})`]],
    ['Document', 'No.', 'Date', 'Batch', 'Units', 'Cartons + loose', 'Reference'],
    [...(o.handovers || []).map((r: any) => ['Issued to dispatch', r.handover_no, r.issued, r.batch_no, fmt(r.qty), ctnText(r.qty, upc), `${r.issued_by_name || ''} -> ${r.received_by || ''}`]),
     ...(o.dispatches || []).map((r: any) => ['Dispatched', r.dispatch_no, r.dispatch_date, r.batch_no, fmt(r.qty), ctnText(r.qty, upc), `Inv ${r.invoice_no || '-'} / Challan ${r.challan_no || '-'} / Veh ${r.vehicle_no || '-'}`])],
    ['Prepared by', 'Checked by', 'Approved by']);
  const doHandover = async () => {
    const r = await post('handover', { ...h, unit: h.unit === 'CTN' ? 'CTN' : null, qty: Number(h.qty), request_key: key() }, 'Issued to Billing / Dispatch');
    if (!r?.handover_no) return;
    printDoc(`Store Handover Slip ${r.handover_no}`, [...meta, ['Issued now', `${fmt(r.qty)} = ${r.cartons} ctn + ${fmt(r.loose)} loose @ ${upc}`],
      ['Pending after this', fmt(r.pending_qty)], ['Received by', h.received_by]], ['From', 'To', 'Units', 'Cartons', 'Loose'],
      [['Finished Goods Store', 'Billing / Dispatch', fmt(r.qty), r.cartons, fmt(r.loose)]], ['Issued by (FG store)', 'Checked by', 'Received by (billing)']);
    setForm('');
  };
  const doDispatch = async () => {
    const r = await post('dispatch', { ...d, unit: d.unit === 'CTN' ? 'CTN' : null, qty: Number(d.qty), to_outlet_id: Number(d.to_outlet_id) || null, request_key: key() }, 'Dispatched');
    if (!r?.dispatch_no) return;
    const units = d.unit === 'CTN' ? Number(d.qty) * upc : Number(d.qty);
    printDoc(`Dispatch Note ${r.dispatch_no}`, [...meta, ['Invoice', d.invoice_no || '—'], ['Delivery challan', d.challan_no || '—'], ['E-way bill', d.eway_bill || '—'],
      ['Vehicle', d.vehicle_no || '—'], ['Transporter', d.transporter || '—'], ['LR no', d.lr_no || '—'], ['Pending after this', fmt(r.pending_qty)]],
      ['Product', 'Units', 'Cartons + loose'], [[o.product, fmt(units), ctnText(units, upc)]], ['Dispatched by', 'Driver', 'Customer acknowledgement']);
    setForm('');
  };
  return (
    <Modal open onClose={onClose} title={`Customer Order ${o.so_no} · ${o.customer || 'Own brand'} · ${o.product}`} width="full">
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2 items-center"><Badge s={o.status === 'OPEN' ? 'APPROVED' : o.status} />
          <button className={`${btnSec} order-last ml-auto`} onClick={printOrder}><i className="fas fa-print mr-1" />Print order</button>
          <span className="text-sm">{o.customer || 'Own brand'} / <b>{o.brand}</b> · {o.product} · <b>{upc} per carton</b> {o.customer_po_no && `· PO ${o.customer_po_no}`} {o.delivery_date && `· due ${o.delivery_date}`}</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 lg:grid-cols-9 gap-2">
          <Stat label="Ordered" value={fmt(o.ordered_qty)} sub={ctnText(o.ordered_qty, upc)} tone="blue" />
          <Stat label="In production" value={fmt(o.production_qty)} /><Stat label="Finished" value={fmt(o.finished_qty)} />
          <Stat label="QC approved" value={fmt(o.qc_approved_qty)} sub={ctnText(o.qc_approved_qty, upc)} tone="green" />
          <Stat label="Reserved" value={fmt(o.reserved_qty)} /><Stat label="Issued to dispatch" value={fmt(o.issued_qty)} sub={ctnText(o.issued_qty, upc)} />
          <Stat label="Billed" value={fmt(o.billed_qty)} /><Stat label="Dispatched" value={fmt(o.dispatched_qty)} sub={ctnText(o.dispatched_qty, upc)} tone="green" />
          <Stat label="Pending" value={fmt(o.pending_qty)} sub={ctnText(o.pending_qty, upc)} tone={o.pending_qty > 0 ? 'amber' : 'green'} />
        </div>
        {o.pending_production_qty > 0 && <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">Pending production: <b>{fmt(o.pending_production_qty)}</b> more units need to be produced and QC-approved for this order (create a production order for it under Production).</div>}
        {o.status === 'PENDING_APPROVAL' && <div className="flex flex-wrap items-center gap-2 text-sm bg-amber-50 border border-amber-300 rounded p-3">
          <i className="fas fa-hourglass-half text-amber-600" /><span className="flex-1">This order is <b>waiting for approval</b>. Reserve, production, issue to dispatch and billing start only after it is approved{o.customer_po_no && ' (all items of this PO are approved together)'}.</span>
          <button className={btnPri} onClick={() => post('approve', {}, 'Order approved')}><i className="fas fa-check mr-1" />Approve order</button>
          <button className={btnSec} onClick={() => { const r = prompt('Reason for rejecting'); if (r) post('reject', { reason: r }, 'Order rejected'); }}>Reject</button>
        </div>}
        {o.status === 'REJECTED' && <div className="text-sm bg-rose-50 border border-rose-200 text-rose-700 rounded p-3">Rejected{o.reject_reason && `: ${o.reject_reason}`}</div>}
        {live && <div className="flex flex-wrap gap-2">
          <button className={btnSec} onClick={() => post('reserve', {}, 'Reserved available finished goods')}>Reserve finished goods</button>
          {o.reserved_qty > 0 && <button className={btnSec} onClick={() => post('release', undefined, 'Reservations released')}>Release reservation</button>}
          <button className={btnPri} onClick={() => setForm('handover')}>Issue to billing / dispatch</button>
          <button className={btnSec} title="Stock already moved to Billing / Dispatch by a department transfer" onClick={() => { const by = prompt('Received by (billing person)'); if (by) post('link-dispatch-stock', { received_by: by }, 'Linked - ready to dispatch'); }}>Use stock already in Billing / Dispatch</button>
          {o.ready_for_billing_qty > 0 && <button className={btnPri} onClick={() => setForm('dispatch')}>Dispatch ({fmt(o.ready_for_billing_qty)} ready)</button>}
          {o.ready_for_billing_qty > 0 && <button className={btnSec} onClick={() => { const qty = prompt('Units to bring back to Finished Goods'); const reason = qty && prompt('Reason');
            if (qty && reason) post('return-from-dispatch', { qty: Number(qty), unit: null, reason }, 'Returned to Finished Goods'); }}>Return from dispatch</button>}
          <div className="flex-1" />
          {o.dispatched_qty > 0 ? <button className={btnSec} onClick={() => { const r = prompt('Short-close reason'); if (r) post('finalize', { reason: r }, 'Order closed'); }}>Short-close</button>
            : <button className={btnSec} onClick={() => { const r = prompt('Cancel reason'); if (r) post('cancel', { reason: r }, 'Order cancelled'); }}>Cancel order</button>}
        </div>}
        {form === 'handover' && <div className="border rounded-lg p-3 bg-slate-50 flex flex-wrap gap-3 items-end">
          <L label="Quantity to hand over"><CartonQty value={h.qty} unit={h.unit} upc={upc} onChange={(v, u) => setH({ ...h, qty: v, unit: u })} /></L>
          <L label="Received by (billing)"><input className={`${inp} w-48`} value={h.received_by} onChange={(e) => setH({ ...h, received_by: e.target.value })} /></L>
          <L label="Remarks"><input className={`${inp} w-56`} value={h.remarks || ''} onChange={(e) => setH({ ...h, remarks: e.target.value })} /></L>
          <span className="text-xs text-slate-500">Still to issue: {fmt(o.ordered_qty - o.issued_qty)} ({ctnText(o.ordered_qty - o.issued_qty, upc)})</span>
          <div className="flex-1" /><button className={btnSec} onClick={() => setForm('')}>Cancel</button><button className={btnPri} onClick={doHandover}>Post & print slip</button>
        </div>}
        {form === 'dispatch' && <div className="border rounded-lg p-3 bg-slate-50 grid md:grid-cols-4 gap-3">
          <div className="md:col-span-2"><L label={`Quantity (ready ${fmt(o.ready_for_billing_qty)})`}><CartonQty value={d.qty} unit={d.unit} upc={upc} onChange={(v, u) => setD({ ...d, qty: v, unit: u })} /></L></div>
          {[['invoice_no', 'Invoice no'], ['challan_no', 'Delivery challan'], ['eway_bill', 'E-way bill'], ['vehicle_no', 'Vehicle no'], ['transporter', 'Transporter'], ['lr_no', 'LR / consignment no']].map(([k, l]) => (
            <L key={k} label={l}><input className={inp} value={d[k] || ''} onChange={(e) => setD({ ...d, [k]: e.target.value })} /></L>))}
          {o.is_own_brand && <L label="Into retail outlet stock (own brand)"><select className={inp} value={d.to_outlet_id || ''} onChange={(e) => setD({ ...d, to_outlet_id: e.target.value })}>
            <option value="">— customer delivery —</option>{outlets.map((x: any) => <option key={x.id} value={x.id}>{x.outlet_name || x.name}</option>)}</select></L>}
          <L label="Remarks"><input className={inp} value={d.remarks || ''} onChange={(e) => setD({ ...d, remarks: e.target.value })} /></L>
          <div className="md:col-span-4 flex justify-end gap-2"><button className={btnSec} onClick={() => setForm('')}>Cancel</button><button className={btnPri} onClick={doDispatch}>Dispatch & print note</button></div>
        </div>}
        <h3 className="font-semibold text-sm">Approved finished goods of this brand (Finished Goods store)</h3>
        <Table rows={o.fg_stock} empty="No approved finished goods of this product & brand." cols={[['Batch', (r) => r.batch_no], ['Expiry', (r) => r.exp_date || '—'],
          ['Physical', (r) => both(r.qty, upc), 'text-right'], ['Free (unreserved)', (r) => both(r.free, upc), 'text-right']]} />
        <h3 className="font-semibold text-sm">Store issues to billing / dispatch</h3>
        <Table rows={o.handovers} empty="Nothing issued yet." cols={[['Issue no', (r) => r.handover_no], ['When', (r) => r.issued], ['Batch', (r) => r.batch_no],
          ['Issued', (r) => both(r.qty, upc), 'text-right'], ['Dispatched', (r) => fmt(r.dispatched_qty), 'text-right'], ['Returned', (r) => fmt(r.returned_qty), 'text-right'],
          ['By / received', (r) => `${r.issued_by_name || ''} → ${r.received_by || ''}`],
          ['', (r) => <button className={btnSec} onClick={() => printHandover(r)}><i className="fas fa-print mr-1" />Print</button>, 'text-right']]} />
        <h3 className="font-semibold text-sm">Dispatches</h3>
        <Table rows={o.dispatches} empty="Nothing dispatched yet." cols={[['Dispatch', (r) => r.dispatch_no], ['Date', (r) => r.dispatch_date], ['Batch', (r) => r.batch_no],
          ['Qty', (r) => both(r.qty, upc), 'text-right'], ['Invoice / challan', (r) => `${r.invoice_no || '—'} / ${r.challan_no || '—'}`], ['E-way', (r) => r.eway_bill || '—'],
          ['Vehicle / LR', (r) => `${r.vehicle_no || '—'} / ${r.lr_no || '—'}`], ['To outlet', (r) => r.outlet_name || '—'],
          ['Acknowledgement', (r) => r.ack_status === 'PENDING' ? <select className={`${inp} w-32`} defaultValue="" onChange={(e) => e.target.value &&
            api.put(`/manufacturing/sales-orders/dispatches/${r.dispatch_no}/ack`, { ack_status: e.target.value, ack_note: prompt('Note (optional)') || null }).then(load).catch(err)}>
            <option value="">Pending…</option><option>RECEIVED</option><option>SHORT</option><option>DAMAGED</option></select> : r.ack_status],
          ['', (r) => <button className={btnSec} onClick={() => printDispatch(r)}><i className="fas fa-print mr-1" />Print</button>, 'text-right']]} />
        {(o.production_orders.length > 0 || o.print_jobs.length > 0) && <div className="text-xs text-slate-600">
          Production: {o.production_orders.map((p: any) => `${p.order_no} (${fmt(p.planned_qty)} planned, ${fmt(p.approved_qty)} approved, ${p.status})`).join('; ') || '—'}<br />
          Printing: {o.print_jobs.map((p: any) => `${p.job_no} (${fmt(p.qty_issued)} issued, ${fmt(p.accepted_qty)} accepted, ${p.status})`).join('; ') || '—'}
        </div>}
      </div>
    </Modal>
  );
}

/** All items of one customer PO with progress, printable as one document. */
function PoView({ po, onClose, onOpen }: { po: any; onClose: () => void; onOpen: (id: number) => void }) {
  const [rows] = useList<any>('/manufacturing/sales-orders/po-group', { customer_po_no: po.customer_po_no, customer_id: po.customer_id || undefined });
  const sum = (k: string) => rows.reduce((t, r) => t + Number(r[k] || 0), 0);
  const print = () => printDoc(`Customer PO ${po.customer_po_no} - ${po.customer || 'Own brand'}`,
    [['Customer', po.customer || 'Own brand'], ['Customer PO', po.customer_po_no], ['Items', rows.length], ['Ordered', fmt(sum('ordered_qty'))], ['Dispatched', fmt(sum('dispatched_qty'))], ['Pending', fmt(sum('pending_qty'))]],
    ['Order', 'Item code', 'Item', 'Ordered', 'Cartons', 'Made / QC approved', 'Dispatched', 'Pending', 'Due', 'Status'],
    rows.map((r) => [r.so_no, r.item_code, r.product, fmt(r.ordered_qty), ctnText(r.ordered_qty, r.units_per_carton), `${fmt(r.finished_qty)} / ${fmt(r.qc_approved_qty)}`, fmt(r.dispatched_qty), fmt(r.pending_qty), r.delivery_date || '', r.status]),
    ['Prepared by', 'Checked by', 'Approved by']);
  return (
    <Modal open onClose={onClose} title={`Customer PO ${po.customer_po_no} · ${po.customer || 'Own brand'}`} width="full">
      <div className="flex items-center gap-2 mb-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 flex-1">
          <Stat label="Items on PO" value={rows.length} tone="blue" /><Stat label="Ordered" value={fmt(sum('ordered_qty'))} />
          <Stat label="Dispatched" value={fmt(sum('dispatched_qty'))} tone="green" /><Stat label="Pending" value={fmt(sum('pending_qty'))} tone={sum('pending_qty') > 0 ? 'amber' : 'green'} />
        </div>
        <button className={btnSec} onClick={print}><i className="fas fa-print mr-1" />Print PO</button>
      </div>
      <Table rows={rows} cols={[
        ['Order', (r) => <button className="font-mono text-indigo-700 hover:underline" onClick={() => onOpen(r.id)}>{r.so_no}</button>],
        ['Item', (r) => <>{r.product}<div className="text-[11px] text-slate-500">{r.item_code} · {r.units_per_carton}/carton</div></>],
        ['Ordered', (r) => both(r.ordered_qty, r.units_per_carton), 'text-right'], ['QC approved', (r) => both(r.qc_approved_qty, r.units_per_carton), 'text-right'],
        ['Issued', (r) => fmt(r.issued_qty), 'text-right'], ['Dispatched', (r) => both(r.dispatched_qty, r.units_per_carton), 'text-right'],
        ['Pending', (r) => <b>{both(r.pending_qty, r.units_per_carton)}</b>, 'text-right'], ['Due', (r) => r.delivery_date || '—'],
        ['Status', (r) => <Badge s={r.status === 'OPEN' ? 'APPROVED' : r.status === 'COMPLETED' ? 'APPROVED' : r.status} />],
      ]} />
    </Modal>
  );
}

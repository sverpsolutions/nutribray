import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import api from '../../api/axios';
import Modal from '../../components/ui/Modal';
import { Badge, CartonQty, ItemPicker, Stat, Table, Tabs, btnPri, btnSec, ctnText, err, fmt, inp, key, printDoc, useList } from './mfgShared';

const TABS = ['Production Orders', 'Damage Approvals', 'Damage Tolerances'];
const REASONS = ['Production Damage', 'Printing Defect', 'Cap Damage', 'Label Damage', 'Filling Loss', 'Spillage', 'Rejected Finished Product',
  'Quality Rejection', 'Missing / Loss', 'Other Approved Reason'];
const today = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const L = ({ label, children }: { label: string; children: any }) => (
  <label className="block"><span className="block text-xs font-semibold text-slate-600 mb-1">{label}</span>{children}</label>
);

export default function MfgProduction() {
  const [tab, setTab] = useState(TABS[0]);
  return (
    <div className="p-4 w-full">
      <h1 className="text-xl font-bold text-slate-800 mb-1"><i className="fas fa-industry text-indigo-600 mr-2" />Production (Department Stores)</h1>
      <p className="text-xs text-slate-500 mb-4">BOM + brand + packaging spec → reserve → issue → report consumption / damage / returns / output → finished-goods QC → complete when every issued unit is explained.</p>
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      {tab === TABS[0] && <Orders />}
      {tab === TABS[1] && <Damages />}
      {tab === TABS[2] && <Tolerances />}
    </div>
  );
}

function Orders() {
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [rows, load] = useList<any>('/manufacturing/prod/orders', { status: status || undefined, search: q });
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  return (
    <>
      <div className="flex flex-wrap gap-2 mb-3">
        <select className={`${inp} w-52`} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>{['DRAFT', 'APPROVED', 'MATERIAL_SHORTAGE', 'READY', 'IN_PRODUCTION', 'AWAITING_QC', 'PARTIALLY_COMPLETED', 'COMPLETED', 'CANCELLED'].map((s) => <option key={s}>{s}</option>)}
        </select>
        <input className={`${inp} w-72`} placeholder="Order / product / brand / customer order" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="flex-1" /><button className={btnPri} onClick={() => setCreating(true)}><i className="fas fa-plus mr-1" />New Production Order</button>
      </div>
      <Table rows={rows} cols={[
        ['Order', (r) => <button className="font-mono text-indigo-700 hover:underline" onClick={() => setOpen(r.id)}>{r.order_no}</button>],
        ['Customer / brand', (r) => <>{r.customer || (r.is_own_brand ? 'Own brand' : '—')}<div className="text-[11px] text-slate-500">{r.brand}</div></>],
        ['Customer order', (r) => r.so_no || '—'], ['Product', (r) => r.product],
        ['Planned', (r) => <>{fmt(r.planned_qty)}<div className="text-[11px] text-slate-500">{ctnText(r.planned_qty, r.units_per_carton)}</div></>, 'text-right'],
        ['Good', (r) => fmt(r.completed_qty), 'text-right'], ['QC approved', (r) => fmt(r.approved_qty), 'text-right'],
        ['Due', (r) => r.planned_end_date], ['Alerts', (r) => r.pending_damages > 0 ? <span className="text-amber-700 text-xs">{r.pending_damages} damage pending</span> : ''],
        ['Status', (r) => <Badge s={r.status} />],
      ]} />
      {creating && <NewOrder onClose={() => setCreating(false)} onDone={(id) => { setCreating(false); load(); setOpen(id); }} />}
      {open && <OrderDetail id={open} onClose={() => { setOpen(null); load(); }} onOpen={setOpen} />}
    </>
  );
}

function NewOrder({ onClose, onDone, preset }: { onClose: () => void; onDone: (id: number) => void; preset?: any }) {
  const [boms] = useList<any>('/manufacturing/boms');
  const [specs] = useList<any>('/manufacturing/master/specs', { status: 'APPROVED' });
  const [brands] = useList<any>('/manufacturing/brands');
  const [orders] = useList<any>('/manufacturing/sales-orders');
  const [f, setF] = useState<any>({ qty: '', unit: 'CTN', planned_start_date: today(), planned_end_date: today(), ...preset });
  const spec = specs.find((s) => s.id === f.spec_id);
  const bom = boms.find((b) => b.id === f.bom_id);
  const upc = spec?.units_per_carton || 1;
  const pickSO = (id: number) => {
    const o = orders.find((x) => x.id === id);
    setF({ ...f, sales_order_id: id || null, ...(o ? { brand_id: o.brand_id, spec_id: o.spec_id, qty: String(Math.max(o.ordered_qty - o.qc_approved_qty, 0)), unit: 'PCS', customer_po_no: o.customer_po_no } : {}) });
  };
  const save = async () => {
    try {
      const r = await api.post('/manufacturing/prod/orders', { ...f, planned_qty: Number(f.qty), unit: f.unit === 'CTN' ? 'CTN' : null });
      toast.success(`${r.data.order_no} created — another person approves it`); onDone(r.data.id);
    } catch (e) { err(e); }
  };
  return (
    <Modal open onClose={onClose} title="New production order" width="full">
      <div className="grid md:grid-cols-2 gap-3">
        <L label="Customer order (optional)"><select className={inp} value={f.sales_order_id || ''} onChange={(e) => pickSO(Number(e.target.value))}>
          <option value="">— own stock / no order —</option>{orders.filter((o) => ['OPEN', 'PARTIAL'].includes(o.status)).map((o) => <option key={o.id} value={o.id}>{o.so_no} — {o.customer || o.brand} · {o.product} · {fmt(o.ordered_qty)}</option>)}
        </select></L>
        <L label="Brand"><select className={inp} value={f.brand_id || ''} onChange={(e) => setF({ ...f, brand_id: Number(e.target.value), spec_id: null })}>
          <option value="">Choose…</option>{brands.filter((b) => b.is_active).map((b) => <option key={b.id} value={b.id}>{b.name} — {b.is_own_brand ? 'Own' : b.customer_name}</option>)}
        </select></L>
        <L label="Packaging spec"><select className={inp} value={f.spec_id || ''} onChange={(e) => setF({ ...f, spec_id: Number(e.target.value) || null })}>
          <option value="">—</option>{specs.filter((s) => s.brand_id === f.brand_id).map((s) => <option key={s.id} value={s.id}>{s.spec_code} r{s.revision} — {s.product_name} · {s.units_per_carton}/ctn</option>)}
        </select></L>
        <L label="Approved BOM"><select className={inp} value={f.bom_id || ''} onChange={(e) => setF({ ...f, bom_id: Number(e.target.value) })}>
          <option value="">Choose…</option>{boms.filter((b) => b.status === 'APPROVED' && (!spec || b.product_id === spec.product_id)).map((b) => <option key={b.id} value={b.id}>{b.bom_no} r{b.revision} — {b.product_name}</option>)}
        </select></L>
        {spec && <div className="md:col-span-2 text-xs bg-indigo-50 border border-indigo-200 rounded p-2">
          <b>{spec.brand_name}</b> · tin {spec.tin_size || '—'} · cap {spec.cap_colour || '—'} · printing {spec.printing_colour || '—'} · tin artwork <b>{spec.tin_artwork || '—'}</b> · printed tin {spec.printed_tin_name || '—'} · {spec.units_per_carton}/carton
        </div>}
        <L label="Planned quantity"><CartonQty value={f.qty} unit={f.unit} upc={upc} base={bom?.batch_unit || 'PCS'} onChange={(v, u) => setF({ ...f, qty: v, unit: u })} /></L>
        <L label="Customer PO no"><input className={inp} value={f.customer_po_no || ''} onChange={(e) => setF({ ...f, customer_po_no: e.target.value })} /></L>
        <L label="Planned start"><input type="date" className={inp} value={f.planned_start_date} onChange={(e) => setF({ ...f, planned_start_date: e.target.value })} /></L>
        <L label="Planned completion"><input type="date" className={inp} value={f.planned_end_date} onChange={(e) => setF({ ...f, planned_end_date: e.target.value })} /></L>
        <L label="Supervisor"><input className={inp} value={f.supervisor_name || ''} onChange={(e) => setF({ ...f, supervisor_name: e.target.value })} /></L>
        <L label="Quality requirements"><input className={inp} value={f.quality_requirements || ''} onChange={(e) => setF({ ...f, quality_requirements: e.target.value })} /></L>
        <div className="md:col-span-2"><L label="Remarks"><input className={inp} value={f.notes || ''} onChange={(e) => setF({ ...f, notes: e.target.value })} /></L></div>
      </div>
      <div className="flex justify-end gap-2 pt-4"><button className={btnSec} onClick={onClose}>Cancel</button><button className={btnPri} onClick={save}>Create order</button></div>
    </Modal>
  );
}

function OrderDetail({ id, onClose, onOpen }: { id: number; onClose: () => void; onOpen: (id: number) => void }) {
  const [o, setO] = useState<any>(null);
  const [mode, setMode] = useState<'' | 'issue' | 'report'>('');
  const [qc, setQc] = useState<any>(null);
  const load = () => api.get(`/manufacturing/prod/orders/${id}`).then((r) => setO(r.data)).catch(err);
  useEffect(() => { setMode(''); load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!o) return null;
  const post = async (path: string, body?: any, msg = 'Done') => {
    try { const r = await api.post(`/manufacturing/prod/${path}`, body); toast.success(msg); load(); return r.data; } catch (e) { err(e); }
  };
  const upc = o.units_per_carton || 1;
  const active = !['COMPLETED', 'CANCELLED', 'DRAFT'].includes(o.status);
  const sheet = () => printDoc(`Production Sheet ${o.order_no}`, [['Customer', o.customer || 'Own brand'], ['Brand', o.brand], ['Product', o.product],
    ['Customer order', o.so_no || '—'], ['Spec', o.spec_code ? `${o.spec_code} r${o.spec_rev}` : '—'], ['Tin / cap', `${o.tin_size || '—'} / ${o.cap_colour || '—'}`],
    ['Planned', `${fmt(o.planned_qty)} ${o.unit} (${ctnText(o.planned_qty, upc) || '-'})`], ['Dates', `${o.planned_start_date} → ${o.planned_end_date}`],
    ['Supervisor', o.supervisor_name || '—'], ['Quality', o.quality_requirements || '—']],
    ['Material', 'Brand', 'Required', 'Issued', 'Consumed', 'Damaged', 'Returned', 'In process'],
    o.items.map((i: any) => [i.item, i.brand || 'General', fmt(i.required_qty), fmt(i.issued_qty), fmt(i.consumed_qty), fmt(i.damaged_qty), fmt(i.returned_qty), fmt(i.in_process)]),
    ['Production supervisor', 'QC', 'Store']);
  return (
    <Modal open onClose={onClose} title={`Production Order ${o.order_no} · ${o.customer || 'Own brand'} · ${o.product} · ${fmt(o.planned_qty)} ${o.unit || ''}`} width="full">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2"><Badge s={o.status} />
          <span className="text-sm"><b>{o.product}</b> · {o.customer || 'Own brand'} / <b>{o.brand}</b> {o.so_no && `· order ${o.so_no}`} {o.spec_code && `· spec ${o.spec_code} r${o.spec_rev}`}
            {o.parent_order_no && ` · supplementary to ${o.parent_order_no}`}</span>
          <div className="flex-1" /><button className={btnSec} onClick={sheet}><i className="fas fa-print mr-1" />Production sheet</button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
          <Stat label="Planned" value={fmt(o.planned_qty)} sub={ctnText(o.planned_qty, upc)} />
          <Stat label="Good produced" value={fmt(o.completed_qty)} sub={ctnText(o.completed_qty, upc)} tone="green" />
          <Stat label="QC approved" value={fmt(o.approved_qty)} tone="green" /><Stat label="Rejected" value={fmt(o.rejected_qty)} tone="red" />
          <Stat label="Shortfall" value={fmt(o.shortfall)} tone={o.shortfall > 0 ? 'amber' : 'slate'} />
          <Stat label="Unexplained material" value={o.unexplained ? 'Yes' : 'No'} tone={o.unexplained ? 'amber' : 'green'} />
        </div>
        <div className="flex flex-wrap gap-2">
          {o.status === 'DRAFT' && <><button className={btnPri} onClick={() => post(`orders/${id}/approve`, undefined, 'Approved')}>Approve</button>
            <button className={btnSec} onClick={() => { const r = prompt('Cancel reason'); if (r) post(`orders/${id}/cancel`, { reason: r }, 'Cancelled'); }}>Cancel</button></>}
          {['APPROVED', 'MATERIAL_SHORTAGE', 'READY', 'IN_PRODUCTION'].includes(o.status) && <button className={btnSec} onClick={async () => {
            const r = await post(`orders/${id}/reserve`, undefined, 'Reservation updated'); if (r?.shortages?.length) toast.error(`${r.shortages.length} material(s) short`); }}>Reserve materials</button>}
          {active && !o.released_at && <button className={btnPri} onClick={async () => {
            try {
              const r = (await api.get(`/manufacturing/prod/orders/${id}/readiness`)).data;
              if (r.ready) { if (confirm('All materials are available. Release this order for production?')) await post(`orders/${id}/production-release`, {}, 'Released for production'); return; }
              const why = prompt(`NOT READY:\n- ${r.problems.join('\n- ')}\n\nTo release anyway (needs the override permission) give the reason:`);
              if (why) await post(`orders/${id}/production-release`, { override_reason: why }, 'Released with override');
            } catch (e) { err(e); }
          }}><i className="fas fa-flag-checkered mr-1" />Release for production</button>}
          {o.released_at && <span className="text-xs text-emerald-700 self-center"><i className="fas fa-check mr-1" />Released{o.release_override_reason ? ` (override: ${o.release_override_reason})` : ''}</span>}
          {active && o.released_at && <button className={btnPri} onClick={() => setMode('issue')}>Issue material</button>}
          {['IN_PRODUCTION', 'AWAITING_QC', 'PARTIALLY_COMPLETED'].includes(o.status) && <button className={btnPri} onClick={() => setMode('report')}>Report production</button>}
          {active && o.status !== 'APPROVED' && <button className={btnSec} onClick={() => {
            const v = o.unexplained ? prompt('Material still unexplained in production. Variance reason (manager) — leave blank to cancel') : '';
            if (o.unexplained && !v) return; post(`orders/${id}/finalize`, { variance_reason: v || null }, 'Order completed'); }}>Complete order</button>}
          {o.shortfall > 0 && ['COMPLETED', 'PARTIALLY_COMPLETED', 'AWAITING_QC'].includes(o.status) && <button className={btnSec} onClick={async () => {
            const r = await post(`orders/${id}/supplementary`, {}, 'Supplementary order created'); if (r?.id) onOpen(r.id); }}>Supplementary order ({fmt(o.shortfall)})</button>}
          {o.children?.map((c: any) => <button key={c.id} className="text-xs text-indigo-700 underline" onClick={() => onOpen(c.id)}>{c.order_no} ({fmt(c.planned_qty)}, {c.status})</button>)}
        </div>
        {mode === 'issue' && <IssueForm o={o} onDone={() => { setMode(''); load(); }} />}
        {mode === 'report' && <ReportForm o={o} onDone={() => { setMode(''); load(); }} />}
        <h3 className="font-semibold text-sm">Materials (issued = consumed + damaged + returned + written off + in process)</h3>
        <Table rows={o.items} cols={[
          ['Material', (i) => <>{i.item}<div className="text-[11px] text-slate-500">{i.brand ? `${i.brand} only` : 'General'}</div></>],
          ['Required', (i) => fmt(i.required_qty), 'text-right'], ['Reserved', (i) => fmt(i.reserved_qty), 'text-right'],
          ['Free stock', (i) => fmt(i.free), 'text-right'], ['Shortage', (i) => i.shortage > 0 ? <b className="text-rose-600">{fmt(i.shortage)}</b> : '—', 'text-right'],
          ['Issued', (i) => fmt(i.issued_qty), 'text-right'], ['Consumed', (i) => fmt(i.consumed_qty), 'text-right'],
          ['Std for output', (i) => i.std_consumption == null ? '—' : fmt(i.std_consumption), 'text-right'],
          ['Damaged', (i) => fmt(i.damaged_qty), 'text-right'], ['Returned', (i) => fmt(i.returned_qty), 'text-right'],
          ['In process', (i) => <b className={Number(i.in_process) ? 'text-amber-700' : ''}>{fmt(i.in_process)}</b>, 'text-right'],
          ['Where', (i) => <span className="text-[11px]">{i.locations.map((l: any) => `${l.code}${l.batch_no ? `/${l.batch_no}` : ''}: ${fmt(l.qty)}`).join(', ') || '—'}</span>],
          ['Variance reason', (i) => <button className="text-[11px] text-indigo-700 underline text-left" onClick={() => {
            const r = prompt(`Reason for excess consumption / wastage of ${i.item}`, i.variance_reason || '');
            if (r !== null) api.put(`/manufacturing/prod/orders/${id}/variance-reasons`, [{ order_item_id: i.id, reason: r }]).then(() => { toast.success('Saved'); load(); }).catch(err);
          }}>{i.variance_reason || 'add'}</button>],
        ]} />
        <h3 className="font-semibold text-sm">Output & finished-goods QC</h3>
        <Table rows={o.outputs} empty="No output reported yet." cols={[
          ['Output', (x) => x.output_no], ['Batch', (x) => x.batch_no], ['Mfg / exp', (x) => `${x.mfg_date}${x.exp_date ? ` / ${x.exp_date}` : ''}`],
          ['Good', (x) => <>{fmt(x.good_qty)}<div className="text-[11px] text-slate-500">{ctnText(x.good_qty, upc)}</div></>, 'text-right'],
          ['Rejected at line', (x) => fmt(x.rejected_qty), 'text-right'], ['QC approved', (x) => fmt(x.approved_qty), 'text-right'],
          ['QC rejected', (x) => fmt(x.qc_rejected_qty), 'text-right'], ['On hold', (x) => fmt(x.qc_pending), 'text-right'], ['QC', (x) => <Badge s={x.qc_status} />],
          ['', (x) => Number(x.qc_pending) > 0 && <button className={btnPri} onClick={() => setQc({ id: x.id, approved_qty: String(x.qc_pending), rejected_qty: '0', rework: false, max: x.qc_pending })}>QC decision</button>],
        ]} />
        {qc && <div className="border rounded-lg p-3 bg-slate-50 flex flex-wrap items-end gap-2">
          <L label={`Approve (of ${fmt(qc.max)})`}><input type="number" className={`${inp} w-28`} value={qc.approved_qty} onChange={(e) => setQc({ ...qc, approved_qty: e.target.value })} /></L>
          <L label="Reject"><input type="number" className={`${inp} w-28`} value={qc.rejected_qty} onChange={(e) => setQc({ ...qc, rejected_qty: e.target.value })} /></L>
          <label className="text-sm flex gap-1 items-center mb-2"><input type="checkbox" checked={qc.rework} onChange={(e) => setQc({ ...qc, rework: e.target.checked })} />Rest needs rework</label>
          <input className={`${inp} flex-1`} placeholder="QC remarks" value={qc.remarks || ''} onChange={(e) => setQc({ ...qc, remarks: e.target.value })} />
          <button className={btnSec} onClick={() => setQc(null)}>Cancel</button>
          <button className={btnPri} onClick={async () => { await post(`outputs/${qc.id}/qc/approve`, { approved_qty: Number(qc.approved_qty || 0), rejected_qty: Number(qc.rejected_qty || 0), rework: qc.rework, remarks: qc.remarks }, 'QC recorded'); setQc(null); }}>Save QC</button>
        </div>}
        {o.damages.length > 0 && <><h3 className="font-semibold text-sm">Damage</h3>
          <Table rows={o.damages} cols={[['No', (d) => d.damage_no], ['Item', (d) => d.item], ['Qty', (d) => fmt(d.qty)], ['Reason', (d) => d.reason],
            ['%', (d) => d.damage_pct == null ? '—' : <span className={d.over_tolerance ? 'text-rose-600 font-bold' : ''}>{d.damage_pct}% (tol {d.tolerance_pct}%)</span>],
            ['Status', (d) => <Badge s={d.status} />]]} /></>}
      </div>
    </Modal>
  );
}

function IssueForm({ o, onDone }: { o: any; onDone: () => void }) {
  const [lines, setLines] = useState<any[]>(o.items.map((i: any) => {
    const loc = i.locations[0];
    return { order_item_id: i.id, item: i.item, left: Math.max(i.required_qty - i.issued_qty, 0), loc: loc ? `${loc.store_id}|${loc.batch_no}` : '', qty: '', locations: i.locations };
  }));
  const [receivedBy, setReceivedBy] = useState('');
  const [k] = useState(key);
  const upd = (n: number, v: any) => setLines(lines.map((l, i) => (i === n ? { ...l, ...v } : l)));
  const save = async () => {
    const body = lines.filter((l) => Number(l.qty) > 0).map((l) => { const [s, b] = l.loc.split('|'); return { order_item_id: l.order_item_id, from_store_id: Number(s), batch_no: b || '', qty: Number(l.qty) }; });
    if (!body.length) return toast.error('Enter at least one quantity');
    try {
      const r = await api.post(`/manufacturing/prod/orders/${o.id}/issue`, { lines: body, received_by: receivedBy, request_key: k });
      toast.success(`Issue slip ${r.data.issue_no || ''} posted`);
      printDoc(`Material Issue Slip ${r.data.issue_no || ''}`, [['Production order', o.order_no], ['Brand', o.brand], ['Product', o.product], ['Received by', receivedBy || '—']],
        ['Material', 'From', 'Batch', 'Qty'], body.map((b) => { const l = lines.find((x) => x.order_item_id === b.order_item_id); const loc = l.locations.find((x: any) => x.store_id === b.from_store_id);
          return [l.item, loc?.name || b.from_store_id, b.batch_no || '—', fmt(b.qty)]; }), ['Issued by', 'Supervisor', 'Received by']);
      onDone();
    } catch (e) { err(e); }
  };
  return (
    <div className="border rounded-lg p-3 bg-slate-50 space-y-2">
      <div className="text-sm font-semibold">Issue to Production WIP (only usable stock of the right brand is offered)</div>
      {lines.map((l, n) => (
        <div key={l.order_item_id} className="grid grid-cols-12 gap-2 items-center text-sm">
          <div className="col-span-4">{l.item} <span className="text-xs text-slate-500">still required {fmt(l.left)}</span></div>
          <select className={`${inp} col-span-5`} value={l.loc} onChange={(e) => upd(n, { loc: e.target.value })}>
            <option value="">No stock</option>{l.locations.map((x: any) => <option key={`${x.store_id}|${x.batch_no}`} value={`${x.store_id}|${x.batch_no}`}>{x.name}{x.batch_no && ` · ${x.batch_no}`} — available {fmt(x.qty)}</option>)}
          </select>
          <input type="number" className={`${inp} col-span-2`} placeholder="Qty" value={l.qty} onChange={(e) => upd(n, { qty: e.target.value })} />
          <button className="col-span-1 text-xs text-indigo-700" onClick={() => upd(n, { qty: String(Math.min(l.left, Number(l.locations.find((x: any) => `${x.store_id}|${x.batch_no}` === l.loc)?.qty || 0))) })}>max</button>
        </div>
      ))}
      <div className="flex gap-2 items-center"><input className={`${inp} w-64`} placeholder="Received by" value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} />
        <div className="flex-1" /><button className={btnSec} onClick={onDone}>Cancel</button><button className={btnPri} onClick={save}>Post issue slip</button></div>
    </div>
  );
}

function ReportForm({ o, onDone }: { o: any; onDone: () => void }) {
  const [stores] = useList<any>('/manufacturing/stores', { for_pick: true });
  const [f, setF] = useState<any>({ good_qty: '', rejected_qty: '', batch_no: '', mfg_date: today(), exp_date: '', supervisor_name: o.supervisor_name || '', request_key: key() });
  const [m, setM] = useState<any[]>(o.items.filter((i: any) => Number(i.in_process) > 0).map((i: any) => ({ order_item_id: i.id, item: i.item, in_process: Number(i.in_process),
    issued: Number(i.issued_qty), consumed: '', returned: '', return_store_id: '', damages: [] as any[] })));
  const usable = stores.filter((s) => s.usable && !s.is_wip && s.is_active);
  const upd = (n: number, v: any) => setM(m.map((x, i) => (i === n ? { ...x, ...v } : x)));
  const fill = () => {   // consumption at BOM standard for the good + rejected output
    const out = Number(f.good_qty || 0) + Number(f.rejected_qty || 0);
    setM(m.map((x) => { const it = o.items.find((i: any) => i.id === x.order_item_id); const per = it.required_qty / o.planned_qty;
      return { ...x, consumed: String(Math.min(+(per * out).toFixed(4), x.in_process)) }; }));
  };
  const save = async () => {
    try {
      const r = await api.post(`/manufacturing/prod/orders/${o.id}/report`, { ...f, good_qty: Number(f.good_qty || 0), rejected_qty: Number(f.rejected_qty || 0),
        exp_date: f.exp_date || null, batch_no: f.batch_no || null,
        materials: m.map((x) => ({ order_item_id: x.order_item_id, consumed: Number(x.consumed || 0), returned: Number(x.returned || 0),
          return_store_id: Number(x.return_store_id) || null, damages: x.damages.filter((d: any) => Number(d.qty) > 0).map((d: any) => ({ ...d, qty: Number(d.qty) })) }))
          .filter((x) => x.consumed || x.returned || x.damages.length) });
      toast.success(`Production reported (${r.data.report_no || ''})`);
      r.data.alerts?.forEach((a: string) => toast.error(a, { duration: 8000 }));
      onDone();
    } catch (e) { err(e); }
  };
  return (
    <div className="border rounded-lg p-3 bg-slate-50 space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
        <L label="Good output"><input type="number" className={inp} value={f.good_qty} onChange={(e) => setF({ ...f, good_qty: e.target.value })} /></L>
        <L label="Rejected output"><input type="number" className={inp} value={f.rejected_qty} onChange={(e) => setF({ ...f, rejected_qty: e.target.value })} /></L>
        <L label="FG batch (blank = auto)"><input className={inp} value={f.batch_no} onChange={(e) => setF({ ...f, batch_no: e.target.value })} /></L>
        <L label="Mfg date"><input type="date" className={inp} value={f.mfg_date} onChange={(e) => setF({ ...f, mfg_date: e.target.value })} /></L>
        <L label="Expiry"><input type="date" className={inp} value={f.exp_date} onChange={(e) => setF({ ...f, exp_date: e.target.value })} /></L>
        <L label="Supervisor"><input className={inp} value={f.supervisor_name} onChange={(e) => setF({ ...f, supervisor_name: e.target.value })} /></L>
      </div>
      {f.good_qty && <div className="text-xs text-slate-600">Good {fmt(f.good_qty)} = {ctnText(f.good_qty, o.units_per_carton) || '—'}; order shortfall after this: {fmt(Math.max(o.planned_qty - o.completed_qty - Number(f.good_qty), 0))}</div>}
      <div className="flex items-center gap-2"><span className="text-sm font-semibold flex-1">Material used (classify every unit — missing material is not assumed to be damage)</span>
        <button className={btnSec} onClick={fill}>Fill consumption at BOM standard</button></div>
      {m.map((x, n) => {
        const dmg = x.damages.reduce((s: number, d: any) => s + Number(d.qty || 0), 0);
        const left = x.in_process - Number(x.consumed || 0) - Number(x.returned || 0) - dmg;
        return (
          <div key={x.order_item_id} className="bg-white border rounded p-2 space-y-1">
            <div className="grid grid-cols-12 gap-2 items-center text-sm">
              <div className="col-span-3"><b>{x.item}</b><div className="text-xs text-slate-500">in production {fmt(x.in_process)}</div></div>
              <input type="number" className={`${inp} col-span-2`} placeholder="Consumed" value={x.consumed} onChange={(e) => upd(n, { consumed: e.target.value })} />
              <input type="number" className={`${inp} col-span-2`} placeholder="Unused returned" value={x.returned} onChange={(e) => upd(n, { returned: e.target.value })} />
              <select className={`${inp} col-span-2`} value={x.return_store_id} onChange={(e) => upd(n, { return_store_id: e.target.value })}>
                <option value="">Return to…</option>{usable.map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}</select>
              <button className="col-span-1 text-xs text-rose-700" onClick={() => upd(n, { damages: [...x.damages, { qty: '', reason: 'Production Damage', stage: '', operator: '' }] })}>+ damage</button>
              <div className={`col-span-2 text-xs text-right ${left < 0 ? 'text-rose-600 font-bold' : 'text-slate-600'}`}>still in process: {fmt(left)}{x.issued ? ` · damage ${(dmg / x.issued * 100).toFixed(2)}%` : ''}</div>
            </div>
            {x.damages.map((d: any, di: number) => (
              <div key={di} className="grid grid-cols-12 gap-2 pl-6">
                <input type="number" className={`${inp} col-span-2`} placeholder="Damaged qty" value={d.qty} onChange={(e) => upd(n, { damages: x.damages.map((y: any, j: number) => j === di ? { ...y, qty: e.target.value } : y) })} />
                <select className={`${inp} col-span-3`} value={d.reason} onChange={(e) => upd(n, { damages: x.damages.map((y: any, j: number) => j === di ? { ...y, reason: e.target.value } : y) })}>
                  {REASONS.map((r) => <option key={r}>{r}</option>)}</select>
                <input className={`${inp} col-span-2`} placeholder="Stage" value={d.stage} onChange={(e) => upd(n, { damages: x.damages.map((y: any, j: number) => j === di ? { ...y, stage: e.target.value } : y) })} />
                <input className={`${inp} col-span-2`} placeholder="Operator" value={d.operator} onChange={(e) => upd(n, { damages: x.damages.map((y: any, j: number) => j === di ? { ...y, operator: e.target.value } : y) })} />
                <input className={`${inp} col-span-3`} placeholder="Remarks" value={d.remarks || ''} onChange={(e) => upd(n, { damages: x.damages.map((y: any, j: number) => j === di ? { ...y, remarks: e.target.value } : y) })} />
              </div>
            ))}
          </div>
        );
      })}
      <div className="flex justify-end gap-2"><button className={btnSec} onClick={onDone}>Cancel</button><button className={btnPri} onClick={save}>Post production report</button></div>
    </div>
  );
}

function Damages() {
  const [status, setStatus] = useState('PENDING');
  const [rows, load] = useList<any>('/manufacturing/damages', { status: status || undefined });
  const decide = (d: any, how: 'approve' | 'reject') => {
    const note = prompt(how === 'approve' ? `Approve ${d.damage_no} (${fmt(d.qty)} ${d.item})? Note:` : `Reject ${d.damage_no}? The material goes back to production for re-classification. Reason:`);
    if (note === null) return;
    api.post(`/manufacturing/damages/${d.id}/${how}`, { note }).then(() => { toast.success(how === 'approve' ? 'Approved' : 'Rejected'); load(); }).catch(err);
  };
  return (
    <>
      <select className={`${inp} w-44 mb-3`} value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="">All</option><option>PENDING</option><option>APPROVED</option><option>REJECTED</option>
      </select>
      <Table rows={rows} empty="No damage entries." cols={[
        ['No', (d) => d.damage_no], ['When', (d) => d.recorded_at], ['Source', (d) => d.source], ['Order / job', (d) => d.order_no || d.job_no || '—'],
        ['Item', (d) => d.item], ['Brand', (d) => d.brand || 'General'], ['Qty', (d) => fmt(d.qty), 'text-right'], ['Reason', (d) => d.reason],
        ['Damage %', (d) => d.damage_pct == null ? '—' : <span className={d.over_tolerance ? 'text-rose-600 font-bold' : ''}>{d.damage_pct}% / tol {d.tolerance_pct}%</span>],
        ['Operator', (d) => d.operator || '—'], ['By', (d) => d.recorded_by], ['Status', (d) => <Badge s={d.status} />],
        ['', (d) => d.status === 'PENDING' && <div className="flex gap-1 justify-end"><button className={btnPri} onClick={() => decide(d, 'approve')}>Approve</button>
          {d.source !== 'PRINTING' && <button className={btnSec} onClick={() => decide(d, 'reject')}>Reject</button>}</div>, 'text-right'],
      ]} />
    </>
  );
}

function Tolerances() {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => { api.get('/manufacturing/tolerances').then((r) => setRows(r.data)).catch(err); }, []);
  const upd = (n: number, v: any) => setRows(rows.map((r, i) => (i === n ? { ...r, ...v } : r)));
  const save = () => api.put('/manufacturing/tolerances', rows.map((r) => ({ ...r, tolerance_pct: Number(r.tolerance_pct) }))).then(() => toast.success('Saved')).catch(err);
  return (
    <div className="bg-white border rounded-lg p-3 space-y-2 max-w-5xl">
      <p className="text-xs text-slate-500">Allowed damage % before an alert. The most specific matching rule wins; blank = any. A row with everything blank is the default.</p>
      {rows.map((r, n) => (
        <div key={n} className="grid grid-cols-12 gap-2 items-center">
          <div className="col-span-3"><ItemPicker value={r.product_id} label={r.product ? `Product: ${r.product}` : undefined} onPick={(p) => upd(n, { product_id: p?.id ?? null, product: p?.name })} /></div>
          <div className="col-span-3"><ItemPicker value={r.material_id} label={r.material ? `Material: ${r.material}` : undefined} onPick={(p) => upd(n, { material_id: p?.id ?? null, material: p?.name })} /></div>
          <input className={`${inp} col-span-2`} placeholder="Department" value={r.department || ''} onChange={(e) => upd(n, { department: e.target.value })} />
          <input className={`${inp} col-span-2`} placeholder="Process / stage" value={r.process || ''} onChange={(e) => upd(n, { process: e.target.value })} />
          <input type="number" className={`${inp} col-span-1`} value={r.tolerance_pct} onChange={(e) => upd(n, { tolerance_pct: e.target.value })} />
          <button className="col-span-1 text-rose-600" onClick={() => setRows(rows.filter((_, i) => i !== n))}><i className="fas fa-trash" /></button>
        </div>
      ))}
      <div className="flex gap-2"><button className={btnSec} onClick={() => setRows([...rows, { tolerance_pct: 1, is_active: true }])}>Add rule</button>
        <button className={btnPri} onClick={save}>Save tolerances</button></div>
    </div>
  );
}

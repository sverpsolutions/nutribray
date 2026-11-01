import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import api from '../../api/axios';
import { masters_api } from '../../api/masters';
import Modal from '../../components/ui/Modal';
import { useMyAccess } from '../../hooks/useMyAccess';
import { Badge, Table, btnPri, btnSec, err, inp } from '../manufacturing/mfgShared';

/** GSTIN check beside the supplier's GST field: format + checksum always; taxpayer details when an authorised GST API is configured. */
export function GstCheck({ gstin, supplierId, onFill }: { gstin: string; supplierId?: number; onFill?: (d: { name?: string; address?: string }) => void }) {
  const [r, setR] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const check = () => { setBusy(true); api.get('/suppliers/gst/lookup', { params: { gstin } }).then((x) => setR(x.data)).catch(err).finally(() => setBusy(false)); };
  const save = (manual: boolean) => api.post(`/suppliers/${supplierId}/gst-verify`, manual ? { gstin, manual: true, legal_name: r?.legal_name } : { gstin })
    .then((x) => toast.success(x.data.status === 'VERIFIED' ? 'Vendor GSTIN verified' : x.data.status === 'MANUAL' ? 'Saved as manually entered (not verified)' : x.data.message || x.data.status)).catch(err);
  const tone = r?.status === 'VERIFIED' ? 'border-emerald-300 bg-emerald-50' : r?.status === 'INVALID' || r?.status === 'NOT_FOUND' ? 'border-rose-300 bg-rose-50' : 'border-amber-300 bg-amber-50';
  return (
    <div className="col-span-2 space-y-2">
      <button type="button" className={btnSec} disabled={busy || (gstin || '').length !== 15} onClick={check}><i className="fas fa-search mr-1" />Check GSTIN</button>
      {r && <div className={`border rounded p-2 text-xs space-y-1 ${tone}`}>
        <div><b>{r.status}</b> {r.message && `— ${r.message}`} {r.source && `(source: ${r.source})`}</div>
        {r.format_ok && <div>State: {r.state} · PAN: {r.pan}</div>}
        {r.legal_name && <div>Legal name: <b>{r.legal_name}</b>{r.trade_name && ` · Trade name: ${r.trade_name}`} · Status: {r.reg_status} · {r.taxpayer_type}<br />{r.address}</div>}
        {r.existing?.filter((e: any) => e.id !== supplierId).length > 0 && <div className="text-rose-700 font-semibold">Already in the Supplier Master: {r.existing.filter((e: any) => e.id !== supplierId)
          .map((e: any) => `${e.name} (${e.supplier_code || e.id})`).join(', ')} — do not create a duplicate vendor.</div>}
        <div className="flex gap-2">
          {r.legal_name && onFill && <button type="button" className={btnSec} onClick={() => onFill({ name: r.legal_name, address: r.address })}>Use these details</button>}
          {supplierId && r.status === 'VERIFIED' && <button type="button" className={btnPri} onClick={() => save(false)}>Save as verified</button>}
          {supplierId && r.format_ok && r.status !== 'VERIFIED' && <button type="button" className={btnSec} onClick={() => save(true)}>Save as manually entered</button>}
        </div>
      </div>}
    </div>
  );
}

/** "Create New Item" from a PO / GRN: duplicate-checked, approved centrally, then created for all stores — never with stock. */
export function NewItemRequest({ purchaseRef, supplierId, onClose }: { purchaseRef?: string; supplierId?: number; onClose: () => void }) {
  const [cats, setCats] = useState<any[]>([]);
  const [f, setF] = useState<any>({ purchase_ref: purchaseRef || '', name: '', barcode: '', category_id: '', hsn_code: '', gst_percent: '', unit: 'PCS',
    basic_cost: '', cost_price: '', mrp: '', selling_price: '', wsp: '', has_batch_tracking: false, shelf_life_days: '', reason: 'New item needed for this purchase' });
  useEffect(() => { masters_api.get_item_categories().then((r) => setCats(r.data || [])).catch(() => {}); }, []);
  const set = (k: string, v: any) => setF({ ...f, [k]: v });
  const save = async () => {
    const product: any = { name: f.name.trim(), category_id: Number(f.category_id) || null, unit: f.unit, supplier_id: supplierId || null,
      has_batch_tracking: f.has_batch_tracking, is_batch_required: f.has_batch_tracking };
    for (const k of ['barcode', 'hsn_code']) if (f[k]) product[k] = f[k].trim();
    for (const k of ['gst_percent', 'basic_cost', 'cost_price', 'mrp', 'selling_price', 'wsp', 'shelf_life_days']) if (f[k] !== '') product[k] = Number(f[k]);
    try {
      const r = await api.post('/item-requests', { purchase_ref: f.purchase_ref, reason: f.reason, product });
      toast.success(r.data.status === 'APPROVED' ? `Item created: ${r.data.posted_ref}` : `Request ${r.data.request_no} sent for approval`); onClose();
    } catch (e) { err(e); }
  };
  const I = (k: string, l: string, type = 'text') => <label className="text-xs font-semibold text-slate-600">{l}<input type={type} className={inp} value={f[k]} onChange={(e) => set(k, e.target.value)} /></label>;
  return (
    <Modal open onClose={onClose} title="Create new item (through Purchase ID)" width="max-w-3xl">
      <div className="grid md:grid-cols-3 gap-3 text-sm">
        {I('purchase_ref', 'Purchase ID (PO / GRN no)')}
        <div className="md:col-span-2">{I('name', 'Item name')}</div>
        {I('barcode', 'Barcode / EAN')}
        <label className="text-xs font-semibold text-slate-600">Category<select className={inp} value={f.category_id} onChange={(e) => set('category_id', e.target.value)}>
          <option value="">Choose…</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        {I('unit', 'Unit')}{I('hsn_code', 'HSN')}{I('gst_percent', 'GST %', 'number')}{I('basic_cost', 'Basic cost', 'number')}
        {I('cost_price', 'CP (cost price)', 'number')}{I('mrp', 'MRP', 'number')}{I('selling_price', 'SP (selling price)', 'number')}{I('wsp', 'WSP', 'number')}
        {I('shelf_life_days', 'Shelf life (days)', 'number')}
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={f.has_batch_tracking} onChange={(e) => set('has_batch_tracking', e.target.checked)} />Batch & expiry tracking</label>
        <div className="md:col-span-3">{I('reason', 'Reason')}</div>
      </div>
      <p className="text-xs text-slate-500 mt-2">Checked for duplicate code / barcode / name. Created only after approval and available to all stores; stock comes only through GRN.</p>
      <div className="flex justify-end gap-2 pt-3"><button className={btnSec} onClick={onClose}>Cancel</button><button className={btnPri} onClick={save}>Submit</button></div>
    </Modal>
  );
}

/** Vendor e-mail status on the PO screen. 'Sent' = accepted by Outlook, not a delivery receipt. */
export function PoEmailPanel({ poId, approved }: { poId: number; approved: boolean }) {
  const me = useMyAccess();
  const [d, setD] = useState<any>(null);
  const load = () => api.get(`/purchases/po-email/${poId}`).then((r) => setD(r.data)).catch(() => {});
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [poId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return null;
  const send = () => confirm(d.rows.some((r: any) => r.status === 'SENT') ? 'This PO was already e-mailed. Send it again?' : 'E-mail this PO to the vendor now?') &&
    api.post(`/purchases/po-email/${poId}/send`).then(() => { toast.success('Queued'); setTimeout(load, 2000); }).catch(err);
  const retry = (id: number) => api.post(`/purchases/po-email/retry/${id}`).then(() => { toast.success('Retrying'); setTimeout(load, 2000); }).catch(err);
  const label: Record<string, string> = { SENT: 'Sent (accepted by Outlook)', QUEUED: 'Queued', SENDING: 'Sending', RETRY: 'Retry required', FAILED: 'Failed', PENDING: 'Pending' };
  return (
    <div className="bg-white border rounded-xl p-4 space-y-2">
      <div className="flex items-center gap-2">
        <h3 className="font-bold text-sm flex-1"><i className="fas fa-envelope mr-2 text-indigo-600" />Vendor e-mail</h3>
        {!d.configured && <span className="text-xs text-amber-700">Outlook not configured on the server</span>}
        {approved && me.can('purchase_order.email') && <button className={btnSec} onClick={send}><i className="fas fa-paper-plane mr-1" />{d.rows.length ? 'Resend' : 'Send'} PO</button>}
      </div>
      <Table rows={d.rows} empty={approved ? 'Not e-mailed yet.' : 'The PO is e-mailed after approval.'} cols={[
        ['Queued', (r) => r.queued], ['To', (r) => r.to_email], ['Trigger', (r) => r.trigger],
        ['Status', (r) => <><Badge s={r.status === 'SENT' ? 'APPROVED' : r.status === 'FAILED' ? 'REJECTED' : 'PENDING'} /> <span className="text-xs">{label[r.status]}</span></>],
        ['Sent', (r) => r.sent || '—'], ['Attempts', (r) => r.attempts], ['Error', (r) => <span className="text-xs text-rose-700">{r.last_error || ''}</span>],
        ['', (r) => r.status === 'FAILED' && me.can('purchase_order.email') && <button className={btnSec} onClick={() => retry(r.id)}>Retry</button>],
      ]} />
    </div>
  );
}

export function PoEmailSettings() {
  const [s, setS] = useState<any>(null);
  useEffect(() => { api.get('/purchases/po-email/settings').then((r) => setS(r.data)).catch(err); }, []);
  if (!s) return null;
  return (
    <div className="p-4 max-w-2xl mx-auto space-y-3">
      <h1 className="text-xl font-bold text-slate-800"><i className="fas fa-envelope text-indigo-600 mr-2" />PO e-mail (Outlook)</h1>
      <div className={`text-sm border rounded p-2 ${s.outlook_configured ? 'border-emerald-300 bg-emerald-50' : 'border-amber-300 bg-amber-50'}`}>
        {s.outlook_configured ? <>Outlook connected — mails go from <b>{s.sender}</b>.</> : <>Outlook is not configured. The administrator adds MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET and MS_SENDER to the server settings (Microsoft 365 app with the Mail.Send permission).</>}
      </div>
      <div className="bg-white border rounded-lg p-3 space-y-2 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={s.auto_send} onChange={(e) => setS({ ...s, auto_send: e.target.checked })} />Send the PO PDF to the vendor automatically when it is approved</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={s.send_unapproved} onChange={(e) => setS({ ...s, send_unapproved: e.target.checked })} />Allow e-mailing unapproved POs (administrator only — not recommended)</label>
        <label className="block text-xs font-semibold">CC (comma separated)<input className={inp} value={s.cc || ''} onChange={(e) => setS({ ...s, cc: e.target.value })} /></label>
        <label className="block text-xs font-semibold">Reply-to<input className={inp} value={s.reply_to || ''} onChange={(e) => setS({ ...s, reply_to: e.target.value })} /></label>
        <label className="block text-xs font-semibold">Retry attempts before failing<input type="number" className={inp} value={s.max_attempts} onChange={(e) => setS({ ...s, max_attempts: Number(e.target.value) })} /></label>
        <label className="block text-xs font-semibold">Signature<textarea className={inp} rows={2} value={s.signature || ''} onChange={(e) => setS({ ...s, signature: e.target.value })} /></label>
        <button className={btnPri} onClick={() => api.put('/purchases/po-email/settings', s).then(() => toast.success('Saved')).catch(err)}>Save</button>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import api from '../../api/axios';
import Modal from '../../components/ui/Modal';
import { useMyAccess } from '../../hooks/useMyAccess';
import { Badge, Stat, Table, Tabs, btnPri, btnSec, err, inp, useList } from '../manufacturing/mfgShared';

const show = (v: any) => (v == null ? '—' : typeof v === 'object' ? Object.entries(v).map(([k, x]) => `${k}: ${x ?? '—'}`).join(' · ') : String(v));

export default function Approvals() {
  const me = useMyAccess();
  const tabs = ['Pending', 'My Requests', 'All', ...(me.can('approvals.edit') ? ['Approval Rules'] : [])];
  const [tab, setTab] = useState('Pending');
  return (
    <div className="p-4 max-w-7xl mx-auto">
      <h1 className="text-xl font-bold text-slate-800 mb-1"><i className="fas fa-check-double text-indigo-600 mr-2" />Approvals</h1>
      <p className="text-xs text-slate-500 mb-4">Expired stock removal, batch / expiry corrections, price changes, high discounts, item creation, day-end reopening and loyalty adjustments. You only see stores you are assigned to; you cannot approve your own request.</p>
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'Approval Rules' ? <Policies /> : <Inbox mode={tab} />}
    </div>
  );
}

function Inbox({ mode }: { mode: string }) {
  const me = useMyAccess();
  const [type, setType] = useState('');
  const [store, setStore] = useState('');
  const [q, setQ] = useState('');
  const params = { status: mode === 'Pending' ? 'PENDING' : '', mine: mode === 'My Requests', request_type: type || undefined, outlet_id: store || undefined, search: q };
  const [rows, load] = useList<any>('/approvals', params);
  const [pols] = useList<any>('/approvals/policies');
  const [sum] = useList<any>('/approvals/summary');
  const [open, setOpen] = useState<any>(null);
  return (
    <>
      {mode === 'Pending' && <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-3">
        {sum.map((s) => <Stat key={s.request_type} label={s.label} value={s.pending} tone="amber" onClick={() => setType(s.request_type)} />)}
        {!sum.length && <Stat label="Pending" value={0} tone="green" />}
      </div>}
      <div className="flex flex-wrap gap-2 mb-3">
        <select className={`${inp} w-56`} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All request types</option>{pols.map((p) => <option key={p.request_type} value={p.request_type}>{p.label}</option>)}
        </select>
        <select className={`${inp} w-56`} value={store} onChange={(e) => setStore(e.target.value)}>
          <option value="">All my stores</option>{me.stores.map((s) => <option key={s.id} value={s.id}>{s.outlet_name}</option>)}
        </select>
        <input className={`${inp} w-64`} placeholder="Request no / item / bill" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <Table rows={rows} empty="Nothing here." cols={[
        ['Request', (r) => <button className="font-mono text-indigo-700 hover:underline" onClick={() => setOpen(r)}>{r.request_no}</button>],
        ['When', (r) => r.requested], ['Type', (r) => r.label], ['Store', (r) => r.store || 'Head Office'],
        ['What', (r) => <span className="text-xs">{r.summary}</span>], ['By', (r) => r.requested_by_name],
        ['Reason', (r) => <span className="text-xs">{r.reason}</span>], ['Status', (r) => <Badge s={r.status} />],
        ['', (r) => r.status === 'PENDING' && (r.can_decide ? <button className={btnPri} onClick={() => setOpen(r)}>Review</button>
          : <span className="text-[11px] text-slate-400" title={r.cannot_reason}>{r.cannot_reason?.slice(0, 40)}</span>), 'text-right'],
      ]} />
      {open && <Review r={open} onClose={() => { setOpen(null); load(); }} />}
    </>
  );
}

function Review({ r, onClose }: { r: any; onClose: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const act = async (path: string, body: any, msg: string) => {
    setBusy(true);
    try { const x = await api.post(`/approvals/${r.id}/${path}`, body); toast.success(`${msg}${x.data.posted_ref ? ` — ${x.data.posted_ref}` : ''}`); onClose(); }
    catch (e) { err(e); } finally { setBusy(false); }
  };
  const mine = r.status === 'RETURNED' || r.status === 'PENDING';
  return (
    <Modal open onClose={onClose} title={`${r.request_no} — ${r.label}`} width="max-w-2xl">
      <div className="space-y-3 text-sm">
        <div className="grid grid-cols-2 gap-2">
          <div><b>Store:</b> {r.store || 'Head Office'}</div><div><b>Requested:</b> {r.requested} by {r.requested_by_name}</div>
          <div className="col-span-2"><b>What:</b> {r.summary}</div>
          <div><b>Current value:</b> {show(r.old_value)}</div><div><b>Proposed value:</b> {show(r.new_value)}</div>
          <div className="col-span-2"><b>Reason:</b> {r.reason}</div>
          {r.ref_no && <div><b>Reference:</b> {r.ref_no}</div>}
          {r.attachment && <div><a className="text-indigo-700 underline" href={r.attachment} target="_blank" rel="noreferrer">Supporting document</a></div>}
          <div><b>Status:</b> <Badge s={r.status} /></div>
          {r.decided_by_name && <div><b>Decided by:</b> {r.decided_by_name} — {r.decision_note}</div>}
          {r.posted_ref && <div><b>Posted:</b> {r.posted_ref}</div>}
        </div>
        {r.status === 'PENDING' && r.can_decide && <>
          <textarea className={inp} rows={2} placeholder="Comment (required to reject or return)" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex justify-end gap-2">
            <button className={btnSec} disabled={busy} onClick={() => act('reject', { note, return_for_correction: true }, 'Returned for correction')}>Return for correction</button>
            <button className={`${btnSec} text-rose-700`} disabled={busy} onClick={() => act('reject', { note }, 'Rejected')}>Reject</button>
            <button className={btnPri} disabled={busy} onClick={() => act('approve', { note }, 'Approved & posted')}>Approve</button>
          </div></>}
        {r.status === 'RETURNED' && <Resubmit r={r} onDone={onClose} />}
        {mine && <div className="text-right"><button className="text-xs text-slate-500 underline" onClick={() => api.post(`/approvals/cancel/${r.id}`).then(() => { toast.success('Withdrawn'); onClose(); }).catch(err)}>Withdraw my request</button></div>}
      </div>
    </Modal>
  );
}

function Resubmit({ r, onDone }: { r: any; onDone: () => void }) {
  const [reason, setReason] = useState(r.reason);
  const [qty, setQty] = useState(r.payload?.qty ?? '');
  return (
    <div className="border rounded p-2 bg-amber-50 space-y-2">
      <div className="text-xs">Returned: correct it and send again.</div>
      {r.payload?.qty !== undefined && <input type="number" className={`${inp} w-32`} value={qty} onChange={(e) => setQty(e.target.value)} />}
      <input className={inp} value={reason} onChange={(e) => setReason(e.target.value)} />
      <button className={btnPri} onClick={() => api.post(`/approvals/resubmit/${r.id}`, { reason, payload: r.payload?.qty !== undefined ? { qty: String(qty) } : null })
        .then(() => { toast.success('Sent again'); onDone(); }).catch(err)}>Resubmit</button>
    </div>
  );
}

function Policies() {
  const [rows, setRows] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  useEffect(() => {
    api.get('/approvals/policies').then((r) => setRows(r.data)).catch(err);
    api.get('/access/catalog').then((r) => setRoles(r.data.roles)).catch(() => {});
  }, []);
  const upd = (i: number, v: any) => setRows(rows.map((x, j) => (j === i ? { ...x, ...v } : x)));
  const save = () => api.put('/approvals/policies', rows.map((r) => ({ ...r, threshold: r.threshold === '' ? null : r.threshold }))).then(() => toast.success('Approval rules saved')).catch(err);
  return (
    <div className="bg-white border rounded-lg p-3 space-y-3">
      <p className="text-xs text-slate-500">Which roles may approve each request type. Approvers also need the Approvals → approve permission and the store in their scope. Administrators can always approve.</p>
      {rows.map((r, i) => (
        <div key={r.request_type} className="border-b pb-2">
          <div className="flex flex-wrap items-center gap-3">
            <b className="w-64 text-sm">{r.label}</b>
            <label className="text-xs flex items-center gap-1"><input type="checkbox" checked={r.enabled} disabled={r.request_type === 'EXPIRY_CORRECTION'}
              onChange={(e) => upd(i, { enabled: e.target.checked })} />Needs approval</label>
            <label className="text-xs flex items-center gap-1"><input type="checkbox" checked={r.allow_self} onChange={(e) => upd(i, { allow_self: e.target.checked })} />Requester may self-approve</label>
            <label className="text-xs flex items-center gap-1">Admin-only above <input type="number" className={`${inp} w-28`} value={r.threshold ?? ''} onChange={(e) => upd(i, { threshold: e.target.value })} /></label>
          </div>
          <div className="flex flex-wrap gap-3 mt-1 ml-1">
            {roles.filter((x) => !['admin', 'superadmin'].includes(x.slug)).map((x) => (
              <label key={x.slug} className="text-xs flex items-center gap-1"><input type="checkbox" checked={r.approver_roles.includes(x.slug)}
                onChange={(e) => upd(i, { approver_roles: e.target.checked ? [...r.approver_roles, x.slug] : r.approver_roles.filter((y: string) => y !== x.slug) })} />{x.name}</label>
            ))}
          </div>
        </div>
      ))}
      <button className={btnPri} onClick={save}>Save approval rules</button>
    </div>
  );
}

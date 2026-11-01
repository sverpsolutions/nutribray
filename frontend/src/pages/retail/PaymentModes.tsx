import { useState } from 'react';
import { toast } from 'react-hot-toast';
import api from '../../api/axios';
import Modal from '../../components/ui/Modal';
import { useMyAccess } from '../../hooks/useMyAccess';
import { Table, btnPri, btnSec, err, inp, useList } from '../manufacturing/mfgShared';

const TYPES = ['CASH', 'UPI', 'CARD', 'BANK', 'CHEQUE', 'CREDIT', 'WALLET', 'VOUCHER', 'OTHER'];
const APPLIES = ['SALE', 'PURCHASE', 'EXPENSE', 'RECEIPT', 'PAYMENT'];

export default function PaymentModes() {
  const me = useMyAccess();
  const [rows, load] = useList<any>('/payment-modes');
  const [f, setF] = useState<any>(null);
  const save = async () => {
    try {
      const body = { ...f, outlet_ids: f.all_stores ? null : f.outlet_ids, sort: Number(f.sort || 0) };
      if (f.id) await api.put(`/payment-modes/${f.id}`, body); else await api.post('/payment-modes', body);
      toast.success('Saved'); setF(null); load();
    } catch (e) { err(e); }
  };
  const toggle = (r: any) => confirm(`${r.is_active ? 'Deactivate' : 'Activate'} ${r.name}? (Modes are never deleted — bills refer to them.)`) &&
    api.delete(`/payment-modes/${r.id}`).then(() => { toast.success('Updated'); load(); }).catch(err);
  return (
    <div className="p-4 max-w-6xl mx-auto">
      <div className="flex items-center mb-1">
        <h1 className="text-xl font-bold text-slate-800 flex-1"><i className="fas fa-wallet text-indigo-600 mr-2" />Payment Mode Master</h1>
        {me.can('payment_modes.create') && <button className={btnPri} onClick={() => setF({ code: '', name: '', mode_type: 'OTHER', applies_to: ['SALE'], all_stores: true, outlet_ids: [], sort: 50 })}>
          <i className="fas fa-plus mr-1" />New Mode</button>}
      </div>
      <p className="text-xs text-slate-500 mb-4">Used by billing and the day-end closing report. A deactivated mode cannot be used on new bills; history keeps it.</p>
      <Table rows={rows} cols={[
        ['Code', (r) => <span className="font-mono">{r.code}</span>], ['Name', (r) => r.name], ['Type', (r) => r.mode_type],
        ['Used for', (r) => r.applies_to.join(', ')], ['Stores', (r) => r.outlet_ids ? `${r.outlet_ids.length} store(s)` : 'All'],
        ['Reconcile', (r) => r.reconciliation_required ? 'Yes' : '—'], ['Approval', (r) => r.approval_required ? 'Yes' : '—'],
        ['Ledger', (r) => r.ledger_account || '—'], ['Bills', (r) => r.used_in, 'text-right'], ['Active', (r) => r.is_active ? 'Yes' : <span className="text-rose-600">No</span>],
        ['', (r) => <div className="flex gap-1 justify-end">
          {me.can('payment_modes.edit') && <button className={btnSec} onClick={() => setF({ ...r, all_stores: !r.outlet_ids, outlet_ids: r.outlet_ids || [] })}>Edit</button>}
          {me.can('payment_modes.delete') && <button className={btnSec} onClick={() => toggle(r)}>{r.is_active ? 'Deactivate' : 'Activate'}</button>}</div>, 'text-right'],
      ]} />
      <Modal open={!!f} onClose={() => setF(null)} title={f?.id ? `Edit ${f.name}` : 'New payment mode'} width="max-w-xl">
        {f && <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-2">
            <input className={inp} placeholder="Code (e.g. paytm)" value={f.code} disabled={!!f.id && f.used_in > 0} onChange={(e) => setF({ ...f, code: e.target.value })} />
            <input className={inp} placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
            <select className={inp} value={f.mode_type} onChange={(e) => setF({ ...f, mode_type: e.target.value })}>{TYPES.map((t) => <option key={t}>{t}</option>)}</select>
            <input className={inp} placeholder="Ledger / account (optional)" value={f.ledger_account || ''} onChange={(e) => setF({ ...f, ledger_account: e.target.value })} />
            <input type="number" className={inp} placeholder="Display order" value={f.sort} onChange={(e) => setF({ ...f, sort: e.target.value })} />
          </div>
          <div className="flex flex-wrap gap-3">{APPLIES.map((a) => <label key={a} className="flex items-center gap-1"><input type="checkbox" checked={f.applies_to.includes(a)}
            onChange={(e) => setF({ ...f, applies_to: e.target.checked ? [...f.applies_to, a] : f.applies_to.filter((x: string) => x !== a) })} />{a}</label>)}</div>
          <label className="flex items-center gap-1"><input type="checkbox" checked={f.reconciliation_required} onChange={(e) => setF({ ...f, reconciliation_required: e.target.checked })} />Needs reconciliation (bank / settlement)</label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={f.approval_required} onChange={(e) => setF({ ...f, approval_required: e.target.checked })} />Needs approval</label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={f.all_stores} onChange={(e) => setF({ ...f, all_stores: e.target.checked })} />All stores</label>
          {!f.all_stores && <div className="max-h-40 overflow-auto border rounded p-2 grid grid-cols-2 gap-1">{me.stores.map((s) => <label key={s.id} className="flex items-center gap-1 text-xs">
            <input type="checkbox" checked={f.outlet_ids.includes(s.id)} onChange={(e) => setF({ ...f, outlet_ids: e.target.checked ? [...f.outlet_ids, s.id] : f.outlet_ids.filter((x: number) => x !== s.id) })} />{s.outlet_name}</label>)}</div>}
          <div className="flex justify-end gap-2"><button className={btnSec} onClick={() => setF(null)}>Cancel</button><button className={btnPri} onClick={save}>Save</button></div>
        </div>}
      </Modal>
    </div>
  );
}

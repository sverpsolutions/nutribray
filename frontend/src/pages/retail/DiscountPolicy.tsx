import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import api from '../../api/axios';
import { useMyAccess } from '../../hooks/useMyAccess';
import { btnPri, err, inp } from '../manufacturing/mfgShared';

const TYPES = [['item_allowed', 'Item discount'], ['bill_allowed', 'Bill discount (cash discount %)'], ['scheme_allowed', 'Schemes / promotions'],
  ['loyalty_allowed', 'Loyalty point redemption']];
const COMBOS = [['item_with_bill', 'Item + bill discount'], ['item_with_scheme', 'Item discount + scheme'], ['bill_with_scheme', 'Bill discount + scheme'],
  ['loyalty_with_discount', 'Loyalty redemption on a discounted bill']];

export default function DiscountPolicy() {
  const me = useMyAccess();
  const [p, setP] = useState<any>(null);
  const [roles, setRoles] = useState<any[]>([]);
  useEffect(() => {
    api.get('/discount-policy').then((r) => setP(r.data)).catch(err);
    api.get('/access/catalog').then((r) => setRoles(r.data.roles)).catch(() => {});
  }, []);
  if (!p) return null;
  const edit = me.can('discounts.edit');
  const box = (k: string, label: string) => <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={!edit} checked={p[k]}
    onChange={(e) => setP({ ...p, [k]: e.target.checked })} />{label}</label>;
  const save = () => api.put('/discount-policy', { ...p, max_discount_pct: Number(p.max_discount_pct),
    approval_above_pct: p.approval_above_pct === '' || p.approval_above_pct == null ? null : Number(p.approval_above_pct) }).then(() => toast.success('Discount policy saved')).catch(err);
  return (
    <div className="p-4 max-w-3xl mx-auto space-y-4">
      <h1 className="text-xl font-bold text-slate-800"><i className="fas fa-percent text-indigo-600 mr-2" />Discount Control</h1>
      <p className="text-xs text-slate-500">Checked on the server for every bill. Above the approval limit the cashier needs an approved High Discount request number (each one works for one bill).</p>
      <div className="bg-white border rounded-lg p-4 space-y-2"><h3 className="font-semibold text-sm">Allowed discount types</h3>{TYPES.map(([k, l]) => box(k, l))}</div>
      <div className="bg-white border rounded-lg p-4 space-y-2"><h3 className="font-semibold text-sm">Allowed combinations on one bill</h3>{COMBOS.map(([k, l]) => box(k, l))}</div>
      <div className="bg-white border rounded-lg p-4 grid grid-cols-2 gap-3">
        <label className="text-xs font-semibold">Maximum total discount %<input type="number" className={inp} disabled={!edit} value={p.max_discount_pct}
          onChange={(e) => setP({ ...p, max_discount_pct: e.target.value })} /></label>
        <label className="text-xs font-semibold">Approval needed above % (blank = never)<input type="number" className={inp} disabled={!edit} value={p.approval_above_pct ?? ''}
          onChange={(e) => setP({ ...p, approval_above_pct: e.target.value })} /></label>
        <div className="col-span-2"><div className="text-xs font-semibold mb-1">Roles that may override these rules</div>
          <div className="flex flex-wrap gap-3">{roles.map((r) => <label key={r.slug} className="text-xs flex items-center gap-1"><input type="checkbox" disabled={!edit}
            checked={p.override_roles.includes(r.slug)} onChange={(e) => setP({ ...p, override_roles: e.target.checked ? [...p.override_roles, r.slug] : p.override_roles.filter((x: string) => x !== r.slug) })} />{r.name}</label>)}</div></div>
      </div>
      {edit && <button className={btnPri} onClick={save}>Save policy</button>}
    </div>
  );
}

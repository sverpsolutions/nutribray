import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import api from '../../api/axios';
import { useMyAccess } from '../../hooks/useMyAccess';
import { Stat, Table, btnPri, btnSec, err, fmt, inp } from '../manufacturing/mfgShared';

const today = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const TONE: Record<string, string> = { Approved: 'bg-emerald-100 text-emerald-800', Submitted: 'bg-sky-100 text-sky-800', Rejected: 'bg-rose-100 text-rose-700',
  Reopened: 'bg-amber-100 text-amber-800', 'Closing In Progress': 'bg-amber-100 text-amber-800', Open: 'bg-slate-100 text-slate-700', 'Not opened': 'bg-slate-100 text-slate-500' };

export default function HeadOffice() {
  const me = useMyAccess();
  const nav = useNavigate();
  const [f, setF] = useState({ business_date: today(), outlet_id: '', region_id: '' });
  const [regions, setRegions] = useState<any[]>([]);
  const [d, setD] = useState<any>(null);
  const load = () => api.get('/ho-dashboard', { params: { business_date: f.business_date, outlet_id: f.outlet_id || undefined, region_id: f.region_id || undefined } })
    .then((r) => setD(r.data)).catch(err);
  useEffect(() => { load(); }, [f]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { api.get('/outlets/regions').then((r) => setRegions(r.data || [])).catch(() => {}); }, []);
  const review = (s: any, action: 'approve' | 'reject') => {
    const note = action === 'reject' ? prompt(`Reject the closing of ${s.store}? Reason:`) : prompt(`Approve the closing of ${s.store}? Note (optional):`) ?? null;
    if (note === null || (action === 'reject' && !note)) return;
    api.post(`/shifts/day/${s.day_id}/${action}`, { note }).then(() => { toast.success(action === 'approve' ? 'Closing approved' : 'Closing rejected'); load(); }).catch(err);
  };
  const settings = (s: any) => {
    const t = prompt(`Closing time for ${s.store} (HH:MM, blank = none)`, s.closing_time || '22:00');
    if (t === null) return;
    const rev = confirm('Should closings of this store be reviewed (approved) by an area manager / head office?');
    api.put(`/shifts/closing-settings/${s.outlet_id}`, { closing_time: t || null, closing_review: rev }).then(() => { toast.success('Saved'); load(); }).catch(err);
  };
  if (!d) return <div className="p-8 text-slate-500"><i className="fas fa-spinner fa-spin mr-2" />Loading…</div>;
  const c = d.cards;
  return (
    <div className="p-4 max-w-7xl mx-auto space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold text-slate-800 flex-1"><i className="fas fa-building text-indigo-600 mr-2" />Head Office Dashboard</h1>
        <input type="date" className={`${inp} w-40`} value={f.business_date} onChange={(e) => setF({ ...f, business_date: e.target.value })} />
        <select className={`${inp} w-48`} value={f.region_id} onChange={(e) => setF({ ...f, region_id: e.target.value })}>
          <option value="">All areas</option>{regions.map((r) => <option key={r.id} value={r.id}>{r.name || r.region_name}</option>)}
        </select>
        <select className={`${inp} w-56`} value={f.outlet_id} onChange={(e) => setF({ ...f, outlet_id: e.target.value })}>
          <option value="">All my stores</option>{me.stores.map((s) => <option key={s.id} value={s.id}>{s.outlet_name}</option>)}
        </select>
        <button className={btnSec} onClick={load}><i className="fas fa-sync" /></button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
        <Stat label="Active stores" value={c.active_stores} />
        <Stat label="Closed" value={c.closed} tone="green" />
        <Stat label="Pending closing" value={c.pending_closing} tone={c.pending_closing ? 'amber' : 'green'} sub={c.overdue_closing ? `${c.overdue_closing} past closing time` : undefined} />
        <Stat label="Sales" value={`₹${fmt(c.sales)}`} sub={`${c.bills} bills`} tone="blue" />
        <Stat label="Stock value" value={`₹${fmt(c.stock_value)}`} />
        <Stat label="POs awaiting approval" value={c.po_pending_approval} sub={`${c.po_open} open POs`} onClick={() => nav('/purchases/po')} />
        <Stat label="Draft GRNs" value={c.grn_draft} onClick={() => nav('/purchases')} />
        <Stat label="Near-expiry batches" value={c.near_expiry_batches} tone="amber" onClick={() => nav('/reports/r/exp_near_expiry')} />
        <Stat label="Expired stock" value={c.expired_batches} sub={`₹${fmt(c.expired_value)}`} tone="red" onClick={() => nav('/reports/r/exp_expired')} />
        <Stat label="Expiry removals pending" value={c.approvals_expired_removal} tone={c.approvals_expired_removal ? 'amber' : 'slate'} onClick={() => nav('/approvals')} />
        <Stat label="Batch corrections pending" value={c.approvals_batch_correction} onClick={() => nav('/approvals')} />
        <Stat label="Price changes pending" value={c.approvals_price_change} onClick={() => nav('/approvals')} />
        <Stat label="All approvals pending" value={c.approvals_total} tone={c.approvals_total ? 'amber' : 'slate'} onClick={() => nav('/approvals')} />
        <Stat label="Failed PO emails" value={c.failed_po_emails ?? '—'} tone={c.failed_po_emails ? 'red' : 'slate'} />
        <Stat label="Loyalty members" value={c.loyalty_members} sub={`${fmt(c.loyalty_outstanding)} pts outstanding`} onClick={() => nav('/loyalty')} />
        <Stat label="Points earned (30 days)" value={fmt(c.loyalty_earned_30d)} />
      </div>
      <h2 className="text-sm font-bold text-slate-600 uppercase">Store closing — {f.business_date}</h2>
      <Table rows={d.stores} cols={[
        ['Store', (s) => <span className={s.overdue ? 'font-bold text-rose-700' : s.not_closed ? 'font-semibold text-amber-800' : ''}>{s.store}{s.overdue && ' ⚠'}</span>],
        ['Business date', (s) => s.business_date || '—'], ['Cashier(s)', (s) => s.cashiers || '—'],
        ['Expected cash', (s) => `₹${fmt(s.expected_cash)}`, 'text-right'], ['Actual cash', (s) => `₹${fmt(s.actual_cash)}`, 'text-right'],
        ['Difference', (s) => <b className={s.difference < 0 ? 'text-rose-600' : s.difference > 0 ? 'text-amber-700' : ''}>₹{fmt(s.difference)}</b>, 'text-right'],
        ['Collections', (s) => s.mode_totals ? <span className="text-[11px]">{Object.entries(s.mode_totals).map(([k, v]) => `${k}: ₹${fmt(v)}`).join(' · ')}</span> : `₹${fmt(s.total_collected)}`],
        ['Status', (s) => <><span className={`px-2 py-0.5 rounded text-[11px] font-bold ${TONE[s.status_label]}`}>{s.status_label}</span>
          {s.review_note && <div className="text-[11px] text-slate-500">{s.review_note}</div>}</>],
        ['Closes at', (s) => s.closing_time || '—'],
        ['', (s) => <div className="flex gap-1 justify-end">
          {s.status_label === 'Submitted' && me.can('day_shift.approve') && <><button className={btnPri} onClick={() => review(s, 'approve')}>Approve</button>
            <button className={btnSec} onClick={() => review(s, 'reject')}>Reject</button></>}
          {me.can('day_shift.approve') && <button className={btnSec} title="Closing time / review" onClick={() => settings(s)}><i className="fas fa-clock" /></button>}
        </div>, 'text-right'],
      ]} />
      <h2 className="text-sm font-bold text-slate-600 uppercase">Store-wise sales</h2>
      <Table rows={d.sales} cols={[['Store', (s) => s.store], ['Bills', (s) => s.bills, 'text-right'], ['Sales', (s) => `₹${fmt(s.sales)}`, 'text-right']]} />
    </div>
  );
}

import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import api from '../../api/axios';
import { useMyAccess } from '../../hooks/useMyAccess';
import { Stat, Table, Tabs, btnPri, btnSec, err, fmt, inp } from '../manufacturing/mfgShared';

export default function Loyalty() {
  const me = useMyAccess();
  const tabs = ['Customers', ...(me.can('loyalty.edit') ? ['Programme Settings'] : [])];
  const [tab, setTab] = useState('Customers');
  const [sum, setSum] = useState<any>(null);
  useEffect(() => { api.get('/loyalty/summary').then((r) => setSum(r.data)).catch(() => {}); }, []);
  return (
    <div className="p-4 max-w-6xl mx-auto">
      <h1 className="text-xl font-bold text-slate-800 mb-3"><i className="fas fa-gift text-indigo-600 mr-2" />Loyalty Programme</h1>
      {sum && <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-4">
        <Stat label="Members" value={sum.members} /><Stat label="Points outstanding" value={fmt(sum.outstanding)} tone="blue" />
        <Stat label="Earned" value={fmt(sum.earned)} tone="green" /><Stat label="Redeemed" value={fmt(sum.redeemed)} /><Stat label="Expired" value={fmt(sum.expired)} />
      </div>}
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'Customers' ? <Customers /> : <Settings />}
    </div>
  );
}

function Customers() {
  const me = useMyAccess();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [c, setC] = useState<any>(null);
  useEffect(() => {
    if (q.trim().length < 2) return setRows([]);
    const t = setTimeout(() => api.get('/loyalty/customers', { params: { search: q } }).then((r) => setRows(r.data)).catch(err), 250);
    return () => clearTimeout(t);
  }, [q]);
  const open = (id: number) => api.get(`/loyalty/customers/${id}`).then((r) => setC(r.data)).catch(err);
  const enroll = (status: string) => {
    const no = status === 'ACTIVE' ? prompt('Loyalty number (blank = mobile number)', c.loyalty_no || '') : c.loyalty_no;
    if (no === null) return;
    api.post(`/loyalty/customers/${c.id}/enroll`, { loyalty_no: no || null, status }).then(() => { toast.success('Saved'); open(c.id); }).catch(err);
  };
  const adjust = () => {
    const pts = prompt('Points to add (use minus to deduct)'); const why = pts && prompt('Reason (required)');
    if (!pts || !why) return;
    api.post('/loyalty/adjust', { customer_id: c.id, points: Number(pts), reason: why }).then((r) => toast.success(`Request ${r.data.request_no} sent for approval`)).catch(err);
  };
  return (
    <div className="grid md:grid-cols-3 gap-4">
      <div className="space-y-2">
        <input className={inp} placeholder="Name / mobile / loyalty no" value={q} onChange={(e) => setQ(e.target.value)} />
        {rows.map((r) => <button key={r.id} onClick={() => open(r.id)} className="block w-full text-left bg-white border rounded px-3 py-2 hover:bg-indigo-50 text-sm">
          <b>{r.name}</b> <span className="text-slate-500">{r.phone}</span><div className="text-xs">{r.loyalty_status === 'ACTIVE' ? `${r.loyalty_no} · ${fmt(r.points)} pts` : 'Not enrolled'}</div></button>)}
      </div>
      <div className="md:col-span-2">
        {c && <div className="bg-white border rounded-lg p-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex-1"><b className="text-lg">{c.name}</b> <span className="text-slate-500">{c.phone}</span>
              <div className="text-xs">Loyalty no {c.loyalty_no || '—'} · status <b>{c.loyalty_status}</b>{c.loyalty_joined && ` · since ${c.loyalty_joined}`}</div></div>
            {me.can('loyalty.create') && (c.loyalty_status === 'ACTIVE'
              ? <button className={btnSec} onClick={() => enroll('BLOCKED')}>Block</button> : <button className={btnPri} onClick={() => enroll('ACTIVE')}>Enroll</button>)}
            {me.can('loyalty.edit') && c.loyalty_status === 'ACTIVE' && <button className={btnSec} onClick={adjust}>Adjust points…</button>}
          </div>
          {c.balance && <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            <Stat label="Current" value={fmt(c.balance.current)} sub={`= ₹${fmt(c.balance.current * c.balance.point_value)}`} tone="blue" />
            <Stat label="Earned" value={fmt(c.balance.earned)} /><Stat label="Redeemed" value={fmt(c.balance.redeemed)} />
            <Stat label="Expired" value={fmt(c.balance.expired)} /><Stat label="Next expiry" value={c.balance.next_expiry || '—'} />
          </div>}
          <Table rows={c.ledger} empty="No point transactions." cols={[['When', (l) => l.at], ['Type', (l) => l.txn_type],
            ['Points', (l) => <b className={l.points < 0 ? 'text-rose-600' : 'text-emerald-700'}>{l.points > 0 ? '+' : ''}{fmt(l.points)}</b>, 'text-right'],
            ['Bill / ref', (l) => l.reference || '—'], ['Store', (l) => l.store || '—'], ['Expires', (l) => l.expires_on || '—'], ['Note', (l) => l.reason || '—'], ['By', (l) => l.by_user || '—']]} />
        </div>}
      </div>
    </div>
  );
}

function Settings() {
  const [cfg, setCfg] = useState<any>(null);
  const [rules, setRules] = useState<any[]>([]);
  useEffect(() => { api.get('/loyalty/config').then((r) => { setCfg(r.data.config); setRules(r.data.rules); }).catch(err); }, []);
  if (!cfg) return null;
  const num = (v: any) => (v === '' || v == null ? null : Number(v));
  const save = async () => {
    try {
      await api.put('/loyalty/config', { ...cfg, point_value: Number(cfg.point_value), min_redeem_points: Number(cfg.min_redeem_points), max_redeem_pct: Number(cfg.max_redeem_pct),
        max_redeem_points: num(cfg.max_redeem_points), approval_above_points: num(cfg.approval_above_points) });
      await api.put('/loyalty/rules', rules.map((r) => ({ ...r, spend_per_point: Number(r.spend_per_point), multiplier: Number(r.multiplier), min_bill: Number(r.min_bill || 0),
        max_points: num(r.max_points), expiry_days: num(r.expiry_days), valid_from: r.valid_from || null, valid_to: r.valid_to || null })));
      toast.success('Loyalty settings saved');
    } catch (e) { err(e); }
  };
  const F = (k: string, label: string) => (
    <label className="text-xs font-semibold text-slate-600">{label}<input type="number" className={inp} value={cfg[k] ?? ''} onChange={(e) => setCfg({ ...cfg, [k]: e.target.value })} /></label>);
  const R = (i: number, k: string, v: any) => setRules(rules.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <div className="space-y-4">
      <div className="bg-white border rounded-lg p-3 grid md:grid-cols-4 gap-3">
        <label className="flex items-center gap-2 text-sm font-bold md:col-span-4"><input type="checkbox" checked={cfg.enabled} onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })} />Programme switched on</label>
        {F('point_value', '₹ value of 1 point')}{F('min_redeem_points', 'Minimum points to redeem')}
        {F('max_redeem_pct', 'Max % of a bill paid by points')}{F('max_redeem_points', 'Max points per bill (blank = no limit)')}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={cfg.consolidated} onChange={(e) => setCfg({ ...cfg, consolidated: e.target.checked })} />Points usable at every store</label>
      </div>
      <h3 className="font-semibold text-sm">Earning rules (a campaign beats the standard rule while it runs)</h3>
      {rules.map((r, i) => (
        <div key={i} className="bg-white border rounded-lg p-3 grid md:grid-cols-6 gap-2 text-xs">
          <input className={`${inp} md:col-span-2`} value={r.name} onChange={(e) => R(i, 'name', e.target.value)} />
          <label>₹ spend per point<input type="number" className={inp} value={r.spend_per_point} onChange={(e) => R(i, 'spend_per_point', e.target.value)} /></label>
          <label>Multiplier<input type="number" className={inp} value={r.multiplier} onChange={(e) => R(i, 'multiplier', e.target.value)} /></label>
          <label>Min bill ₹<input type="number" className={inp} value={r.min_bill} onChange={(e) => R(i, 'min_bill', e.target.value)} /></label>
          <label>Max points / bill<input type="number" className={inp} value={r.max_points ?? ''} onChange={(e) => R(i, 'max_points', e.target.value)} /></label>
          <label>Points expire after (days)<input type="number" className={inp} value={r.expiry_days ?? ''} onChange={(e) => R(i, 'expiry_days', e.target.value)} /></label>
          <label>From<input type="date" className={inp} value={r.valid_from || ''} onChange={(e) => R(i, 'valid_from', e.target.value)} /></label>
          <label>To<input type="date" className={inp} value={r.valid_to || ''} onChange={(e) => R(i, 'valid_to', e.target.value)} /></label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={r.is_campaign} onChange={(e) => R(i, 'is_campaign', e.target.checked)} />Campaign</label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={r.is_active} onChange={(e) => R(i, 'is_active', e.target.checked)} />Active</label>
          <label className="md:col-span-2">Excluded item ids (comma)<input className={inp} value={(r.excluded_product_ids || []).join(',')}
            onChange={(e) => R(i, 'excluded_product_ids', e.target.value ? e.target.value.split(',').map(Number).filter(Boolean) : null)} /></label>
        </div>
      ))}
      <div className="flex gap-2"><button className={btnSec} onClick={() => setRules([...rules, { name: 'Campaign', is_active: true, is_campaign: true, spend_per_point: 100, multiplier: 2, min_bill: 0 }])}>Add rule</button>
        <button className={btnPri} onClick={save}>Save settings</button></div>
    </div>
  );
}

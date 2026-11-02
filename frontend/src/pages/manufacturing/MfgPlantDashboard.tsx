import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/axios';
import { err, fmt, btnPri, btnSec } from './mfgShared';

type Tone = 'ok' | 'warn' | 'bad' | 'info';
type Row = { label: string; value: any; tone?: Tone; kind?: 'rm' | 'pm' | 'fg'; to?: string; sub?: string };

// Colour code (index.css): green ready · amber short/waiting · red blocked/overdue · blue running · grey none.
// Material kind: teal raw · violet packing · plum finished goods. A zero is always a plain grey 0.
const KIND_DOT: Record<string, string> = { rm: 'var(--kind-rm)', pm: 'var(--kind-pm)', fg: 'var(--kind-fg)' };

export default function MfgPlantDashboard() {
  const [d, setD] = useState<any>(null);
  const [at, setAt] = useState<Date | null>(null);
  const nav = useNavigate();
  const load = (quiet: boolean) => api.get('/manufacturing/plant-dashboard').then((r) => { setD(r.data); setAt(new Date()); }).catch((e) => !quiet && err(e));
  useEffect(() => {
    load(false);
    const t = setInterval(() => load(true), 60000);   // the 60s refresh stays silent if a request blips
    return () => clearInterval(t);
  }, []);
  if (!d) return <div className="p-8 text-slate-500"><i className="fas fa-spinner fa-spin mr-2" />Loading plant dashboard…</div>;

  const c = d.cards || {}, a = d.approvals || {}, p = d.planning;
  const waiting = ['customer_orders', 'print_jobs', 'transfers', 'damages', 'production_orders', 'fg_qc'].reduce((n, k) => n + Number(a[k] || 0), 0);
  const warn = (n: any): Tone | undefined => (Number(n) ? 'warn' : undefined);
  const bad = (n: any): Tone | undefined => (Number(n) ? 'bad' : undefined);

  // The one finding, in words, from the same numbers the figures below show.
  const found: string[] = [];
  if (p?.with_shortage) found.push(`${p.with_shortage} of ${p.open_orders} open orders are short of material`);
  if (p?.blocked) found.push(`${p.blocked} blocked`);
  if (c.orders_overdue) found.push(`${c.orders_overdue} customer orders overdue`);
  if (waiting) found.push(`${waiting} waiting for approval`);
  const finding = found.length ? found.join(' · ') : 'Nothing is short, overdue or waiting.';

  const attention: { label: string; value: any; tone?: Tone; to: string; note: string }[] = [
    { label: 'Orders short of material', value: p?.with_shortage ?? 0, tone: warn(p?.with_shortage), to: '/manufacturing/material-planning', note: `of ${p?.open_orders ?? 0} open` },
    { label: 'Blocked by shortage', value: p?.blocked ?? 0, tone: bad(p?.blocked), to: '/manufacturing/material-planning', note: 'cannot start' },
    { label: 'Customer orders overdue', value: c.orders_overdue ?? 0, tone: bad(c.orders_overdue), to: '/reports/r/mfg_pending_orders', note: `${c.orders_pending ?? 0} pending in all` },
    { label: 'Waiting for approval', value: waiting, tone: warn(waiting), to: '/approvals', note: 'orders, challans, transfers' },
  ];

  const groups: { title: string; to?: string; rows: Row[] }[] = [
    ...(p ? [{ title: 'Material planning', to: '/manufacturing/material-planning', rows: [
      { label: 'Open production orders', value: p.open_orders, to: '/manufacturing/material-planning' },
      { label: 'Ready for production', value: p.ready, tone: p.ready ? 'ok' : undefined, to: '/manufacturing/material-planning' },
      { label: 'Orders with shortages', value: p.with_shortage, tone: warn(p.with_shortage), to: '/reports/r/mfg_shortage' },
      { label: 'Blocked by shortage', value: p.blocked, tone: bad(p.blocked), to: '/manufacturing/material-planning' },
      { label: 'Raw materials short', value: p.rm_short, kind: 'rm', tone: bad(p.rm_short), to: '/reports/r/mfg_shortage' },
      { label: 'Packing materials short', value: p.pm_short, kind: 'pm', tone: bad(p.pm_short), to: '/reports/r/mfg_shortage' },
      { label: 'Awaiting purchase', value: p.awaiting_purchase, to: '/manufacturing/material-planning' },
      { label: 'Awaiting transfer', value: p.awaiting_transfer, to: '/manufacturing/material-planning' },
      { label: 'Low-stock materials', value: p.low_stock, tone: warn(p.low_stock) },
      { label: 'Pending goods received (GRN)', value: p.pending_grn, to: '/purchases' },
      { label: 'Pending material transfers', value: p.pending_transfers, to: '/manufacturing/stores' },
    ] as Row[] }] : []),
    { title: 'Production', to: '/manufacturing/production', rows: [
      { label: 'Orders pending', value: c.production_pending, to: '/manufacturing/production' },
      { label: 'In progress', value: c.production_in_progress, tone: c.production_in_progress ? 'info' : undefined, to: '/manufacturing/production' },
      { label: 'Material shortages', value: c.material_shortages, tone: bad(c.material_shortages), to: '/reports/r/mfg_material_req' },
      { label: 'Work in progress', value: fmt(c.production_wip) },
      { label: "Today's good output", value: fmt(c.today_good), tone: Number(c.today_good) ? 'ok' : undefined, to: '/reports/r/mfg_output' },
      { label: "Today's efficiency", value: c.today_efficiency == null ? '–' : `${c.today_efficiency}%`, sub: `rejected ${fmt(c.today_rejected)} · damage ${fmt(c.today_damage)}` },
      { label: "Today's damage", value: fmt(c.today_damage), tone: bad(c.today_over_tolerance), sub: c.today_over_tolerance ? `${c.today_over_tolerance} over tolerance` : undefined, to: '/reports/r/mfg_damage_register' },
      { label: 'Rejected / scrap stock', value: `${fmt(c.rejected)} / ${fmt(c.scrap)}` },
    ] },
    { title: 'Customer orders', to: '/manufacturing/customer-orders', rows: [
      { label: 'Orders pending', value: c.orders_pending, to: '/manufacturing/customer-orders' },
      { label: 'Ready for billing', value: c.orders_ready_billing, tone: warn(c.orders_ready_billing), to: '/manufacturing/customer-orders' },
      { label: 'With billing / dispatch', value: fmt(c.dispatch_store) },
      { label: 'Overdue orders', value: c.orders_overdue, tone: bad(c.orders_overdue), to: '/reports/r/mfg_pending_orders' },
    ] },
    { title: 'Stores', to: '/manufacturing/stores', rows: [
      { label: 'Raw material', value: fmt(c.raw_material), kind: 'rm', to: '/manufacturing/stores' },
      { label: 'Packaging material', value: fmt(c.packaging), kind: 'pm', to: '/manufacturing/stores' },
      { label: 'Plain tin', value: fmt(c.plain_tin), kind: 'pm', to: '/manufacturing/stores' },
      { label: 'Printed tin (accepted)', value: fmt(c.printed_tin), kind: 'pm', to: '/manufacturing/stores' },
      { label: 'Finished goods', value: fmt(c.finished_goods), kind: 'fg', to: '/reports/r/mfg_fg_stock' },
      { label: 'QC / quarantine', value: fmt(c.qc_pending), tone: warn(c.qc_pending) },
    ] },
    { title: 'Printing', to: '/manufacturing/printing', rows: [
      { label: 'Printing jobs open', value: c.printing_jobs_open, tone: c.printing_jobs_open ? 'info' : undefined, to: '/manufacturing/printing' },
      { label: 'Printing WIP (tins)', value: fmt(c.printing_wip), to: '/reports/r/mfg_wip' },
      { label: 'Pending from printer', value: fmt(c.printing_pending), to: '/reports/r/mfg_print_pending' },
      { label: 'Overdue printing', value: a.overdue_printing, tone: bad(a.overdue_printing), to: '/reports/r/mfg_print_pending' },
    ] },
    { title: 'Waiting for approval', rows: [
      { label: 'Customer orders', value: a.customer_orders, tone: warn(a.customer_orders), to: '/manufacturing/customer-orders' },
      { label: 'Printing challans', value: a.print_jobs, tone: warn(a.print_jobs), to: '/manufacturing/printing' },
      { label: 'Store transfers', value: a.transfers, tone: warn(a.transfers), to: '/manufacturing/stores' },
      { label: 'Damage entries', value: a.damages, tone: warn(a.damages), to: '/manufacturing/production' },
      { label: 'Production orders', value: a.production_orders, tone: warn(a.production_orders), to: '/manufacturing/production' },
      { label: 'Finished goods QC', value: a.fg_qc, tone: warn(a.fg_qc), to: '/manufacturing/production' },
    ] },
  ];

  const isZero = (v: any) => v === 0 || v === '0' || v === '0 / 0';
  return (
    <div className="p-4 md:p-6 w-full max-w-[1680px]">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Plant dashboard</h1>
          <p className="text-sm text-slate-600 mt-1">{finding}</p>
        </div>
        <div className="flex items-center gap-2">
          {at && <span className="text-xs text-slate-500 hidden sm:inline">Updated {at.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>}
          <button className={btnSec} onClick={() => load(false)} aria-label="Refresh"><i className="fas fa-sync-alt" /></button>
          <button className={btnPri} onClick={() => nav('/manufacturing/material-planning')}>Check material</button>
        </div>
      </div>

      {/* Needs you now: one container, equal columns, 1px dividers */}
      <section aria-label="Needs attention" className="grid grid-cols-2 lg:grid-cols-4 bg-white border border-slate-200 rounded-xl mb-5 overflow-hidden">
        {attention.map((k, i) => (
          <button key={k.label} onClick={() => nav(k.to)}
            className={`text-left px-5 py-4 hover:bg-[var(--color-bg-row-hover)] transition-colors border-slate-200 ${i % 2 ? 'border-l' : ''} ${i > 1 ? 'border-t lg:border-t-0' : ''} ${i > 0 ? 'lg:border-l' : ''}`}>
            <div className="text-sm text-slate-600">{k.label}</div>
            <div className="text-4xl font-semibold leading-tight num mt-1" style={{ color: k.tone && !isZero(k.value) ? `var(--st-${k.tone})` : 'var(--st-none)' }}>{fmt(k.value)}</div>
            <div className="text-xs text-slate-500 mt-1">{k.note}</div>
          </button>
        ))}
      </section>

      {/* Colour key: the same meanings on every screen */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-slate-600 mb-4" aria-label="Colour key">
        <span className="st st-ok">Ready or done</span><span className="st st-warn">Short or waiting</span><span className="st st-bad">Blocked or overdue</span><span className="st st-info">Running</span>
        <span className="hidden md:inline text-slate-300">|</span>
        <span className="kind kind-rm">Raw material</span><span className="kind kind-pm">Packing material</span><span className="kind kind-fg">Finished goods</span>
      </div>

      <div className="columns-1 md:columns-2 xl:columns-3 gap-4">
        {groups.map((g) => (
          <section key={g.title} className="break-inside-avoid mb-4 bg-white border border-slate-200 rounded-xl">
            <header className="flex items-center justify-between px-4 pt-3 pb-2">
              <h2 className="text-base font-semibold text-slate-900">{g.title}</h2>
              {g.to && <button onClick={() => nav(g.to!)} className="text-xs font-medium text-primary hover:underline">Open</button>}
            </header>
            <ul>
              {g.rows.map((r) => {
                const zero = isZero(r.value);
                const inner = (<>
                  <span className="flex items-center gap-2 min-w-0">
                    {r.kind ? <span aria-hidden className="w-2 h-2 rounded-sm shrink-0" style={{ background: KIND_DOT[r.kind] }} /> : <span aria-hidden className="w-2 shrink-0" />}
                    <span className="truncate text-sm text-slate-700">{r.label}</span>
                  </span>
                  <span className="text-right shrink-0">
                    <span className="text-base num font-semibold" style={{ color: zero ? 'var(--st-none)' : r.tone ? `var(--st-${r.tone})` : 'var(--color-text-primary)' }}>{r.value ?? '–'}</span>
                    {r.sub && <span className="block text-xs text-slate-500 -mt-0.5">{r.sub}</span>}
                  </span>
                </>);
                return (
                  <li key={r.label} className="border-t border-slate-100">
                    {r.to
                      ? <button onClick={() => nav(r.to!)} className="w-full flex items-center justify-between gap-3 px-4 py-2 hover:bg-[var(--color-bg-row-hover)] text-left">{inner}</button>
                      : <div className="flex items-center justify-between gap-3 px-4 py-2">{inner}</div>}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

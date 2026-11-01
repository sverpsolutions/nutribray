import { cloneElement, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/axios';
import { Stat, err, fmt } from './mfgShared';

export default function MfgPlantDashboard() {
  const [d, setD] = useState<any>(null);
  const nav = useNavigate();
  useEffect(() => {
    const load = (quiet: boolean) => api.get('/manufacturing/plant-dashboard').then((r) => setD(r.data)).catch((e) => !quiet && err(e));   // the 60s refresh stays silent if a request blips
    load(false);
    const t = setInterval(() => load(true), 60000);
    return () => clearInterval(t);
  }, []);
  if (!d) return <div className="p-8 text-slate-500"><i className="fas fa-spinner fa-spin mr-2" />Loading plant dashboard…</div>;
  const c = d.cards, a = d.approvals;
  const go = (to: string) => () => nav(to);
  const SEC: Record<string, [string, string, string]> = {   // title -> [stat tone, heading colour, icon]
    'Material planning': ['blue', 'text-indigo-700 border-indigo-500', 'fa-clipboard-list'], 'Stores': ['teal', 'text-teal-700 border-teal-500', 'fa-warehouse'],
    'Printing': ['violet', 'text-violet-700 border-violet-500', 'fa-print'], 'Production': ['sky', 'text-sky-700 border-sky-500', 'fa-industry'],
    'Customer orders': ['green', 'text-emerald-700 border-emerald-500', 'fa-truck-fast'], 'Waiting for approval': ['amber', 'text-amber-700 border-amber-500', 'fa-hourglass-half'],
  };
  const section = (title: string, cards: any[]) => {
    const [tone, head, icon] = SEC[title] || ['slate', 'text-slate-700 border-slate-400', 'fa-circle'];
    return (
      <div><h2 className={`flex items-center gap-2 text-sm font-semibold mb-2.5 pl-2.5 border-l-4 ${head}`}><i className={`fas ${icon} text-xs`} />{title}</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">{cards.map((c) => cloneElement(c, { tone: !c.props.tone || c.props.tone === 'slate' ? tone : c.props.tone }))}</div></div>
    );
  };
  return (
    <div className="p-4 w-full space-y-5">
      <h1 className="text-2xl font-semibold text-slate-800 tracking-tight"><i className="fas fa-gauge-high text-indigo-600 mr-2" />Plant Dashboard</h1>
      {d.planning && section('Material planning', [
        <Stat key="1" label="Open production orders" value={d.planning.open_orders} onClick={go('/manufacturing/material-planning')} />,
        <Stat key="2" label="Ready for production" value={d.planning.ready} tone="green" onClick={go('/manufacturing/material-planning')} />,
        <Stat key="3" label="Orders with shortages" value={d.planning.with_shortage} tone={d.planning.with_shortage ? 'amber' : 'slate'} onClick={go('/reports/r/mfg_shortage')} />,
        <Stat key="4" label="Blocked by shortage" value={d.planning.blocked} tone={d.planning.blocked ? 'red' : 'slate'} onClick={go('/manufacturing/material-planning')} />,
        <Stat key="5" label="Raw materials short" value={d.planning.rm_short} tone={d.planning.rm_short ? 'red' : 'slate'} onClick={go('/reports/r/mfg_shortage')} />,
        <Stat key="6" label="Packing materials short" value={d.planning.pm_short} tone={d.planning.pm_short ? 'red' : 'slate'} onClick={go('/reports/r/mfg_shortage')} />,
        <Stat key="7" label="Awaiting purchase" value={d.planning.awaiting_purchase} onClick={go('/manufacturing/material-planning')} />,
        <Stat key="8" label="Awaiting transfer" value={d.planning.awaiting_transfer} onClick={go('/manufacturing/material-planning')} />,
        <Stat key="9" label="Low-stock materials" value={d.planning.low_stock} tone={d.planning.low_stock ? 'amber' : 'slate'} />,
        <Stat key="10" label="Pending GRNs" value={d.planning.pending_grn} onClick={go('/purchases')} />,
        <Stat key="11" label="Pending material transfers" value={d.planning.pending_transfers} onClick={go('/manufacturing/stores')} />,
      ])}
      {section('Stores', [
        <Stat key="1" label="Raw material" value={fmt(c.raw_material)} onClick={go('/manufacturing/stores')} />,
        <Stat key="2" label="Packaging material" value={fmt(c.packaging)} onClick={go('/manufacturing/stores')} />,
        <Stat key="3" label="Plain tin" value={fmt(c.plain_tin)} onClick={go('/manufacturing/stores')} />,
        <Stat key="4" label="Printed tin (accepted)" value={fmt(c.printed_tin)} tone="green" onClick={go('/manufacturing/stores')} />,
        <Stat key="5" label="Finished goods" value={fmt(c.finished_goods)} tone="green" onClick={go('/reports/r/mfg_fg_stock')} />,
        <Stat key="6" label="QC / quarantine" value={fmt(c.qc_pending)} tone="amber" />,
      ])}
      {section('Printing', [
        <Stat key="1" label="Printing jobs open" value={c.printing_jobs_open} tone="blue" onClick={go('/manufacturing/printing')} />,
        <Stat key="2" label="Printing WIP (tins)" value={fmt(c.printing_wip)} onClick={go('/reports/r/mfg_wip')} />,
        <Stat key="3" label="Pending from printer" value={fmt(c.printing_pending)} onClick={go('/reports/r/mfg_print_pending')} />,
        <Stat key="4" label="Overdue printing" value={a.overdue_printing} tone={a.overdue_printing ? 'red' : 'slate'} onClick={go('/reports/r/mfg_print_pending')} />,
      ])}
      {section('Production', [
        <Stat key="1" label="Orders pending" value={c.production_pending} onClick={go('/manufacturing/production')} />,
        <Stat key="2" label="In progress" value={c.production_in_progress} tone="blue" onClick={go('/manufacturing/production')} />,
        <Stat key="3" label="Material shortages" value={c.material_shortages} tone={c.material_shortages ? 'red' : 'slate'} onClick={go('/reports/r/mfg_material_req')} />,
        <Stat key="4" label="Production WIP" value={fmt(c.production_wip)} />,
        <Stat key="5" label="Today's good output" value={fmt(c.today_good)} tone="green" onClick={go('/reports/r/mfg_output')} />,
        <Stat key="6" label="Today's efficiency" value={c.today_efficiency == null ? '—' : `${c.today_efficiency}%`} sub={`rejected ${fmt(c.today_rejected)} · damage ${fmt(c.today_damage)}`} />,
        <Stat key="7" label="Today's damage" value={fmt(c.today_damage)} sub={c.today_over_tolerance ? `${c.today_over_tolerance} over tolerance` : undefined}
          tone={c.today_over_tolerance ? 'red' : 'slate'} onClick={go('/reports/r/mfg_damage_register')} />,
        <Stat key="8" label="Rejected / scrap stock" value={`${fmt(c.rejected)} / ${fmt(c.scrap)}`} />,
      ])}
      {section('Customer orders', [
        <Stat key="1" label="Orders pending" value={c.orders_pending} tone="blue" onClick={go('/manufacturing/customer-orders')} />,
        <Stat key="2" label="Ready for billing" value={c.orders_ready_billing} tone="amber" onClick={go('/manufacturing/customer-orders')} />,
        <Stat key="3" label="With billing / dispatch" value={fmt(c.dispatch_store)} />,
        <Stat key="4" label="Overdue orders" value={c.orders_overdue} tone={c.orders_overdue ? 'red' : 'slate'} onClick={go('/reports/r/mfg_pending_orders')} />,
      ])}
      {section('Waiting for approval', [
        <Stat key="0" label="Customer orders" value={a.customer_orders} tone={a.customer_orders ? 'amber' : 'slate'} onClick={go('/manufacturing/customer-orders')} />,
        <Stat key="1" label="Printing challans" value={a.print_jobs} tone={a.print_jobs ? 'amber' : 'slate'} onClick={go('/manufacturing/printing')} />,
        <Stat key="2" label="Store transfers" value={a.transfers} tone={a.transfers ? 'amber' : 'slate'} onClick={go('/manufacturing/stores')} />,
        <Stat key="3" label="Damage entries" value={a.damages} tone={a.damages ? 'amber' : 'slate'} onClick={go('/manufacturing/production')} />,
        <Stat key="4" label="Production orders" value={a.production_orders} tone={a.production_orders ? 'amber' : 'slate'} onClick={go('/manufacturing/production')} />,
        <Stat key="5" label="Finished goods QC" value={a.fg_qc} tone={a.fg_qc ? 'amber' : 'slate'} onClick={go('/manufacturing/production')} />,
      ])}
    </div>
  );
}

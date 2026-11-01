import { useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import { Stat, Table, btnSec, ctnText, fmt, inp, printDoc, useList } from './mfgShared';
import { xlsx } from './MfgStockReports';

const q = (n: any, upc: any) => (ctnText(n, upc) ? `${fmt(n)} (${ctnText(n, upc)})` : fmt(n));
const sum = (rows: any[], k: string) => rows.reduce((t, r) => t + Number(r[k] || 0), 0);

/** Customer-wise ledger: ordered -> made -> lost (and where) -> handed to dispatch -> dispatched -> pending, for every order of a customer. */
export default function CustomerLedger() {
  const [p, setP] = useState<any>({ customer_id: '', from_date: '', to_date: '' });
  const [d] = useList<any>('/manufacturing/sales-orders/customer-ledger', { customer_id: p.customer_id || undefined, from_date: p.from_date || undefined, to_date: p.to_date || undefined });
  const [all] = useList<any>('/manufacturing/sales-orders/customer-ledger');
  const orders: any[] = (d as any)?.orders ?? [];
  const damages: any[] = (d as any)?.damages ?? [];
  const disp: any[] = (d as any)?.dispatches ?? [];
  const customers = useMemo(() => {
    const m = new Map<number, string>();
    ((all as any)?.orders ?? []).forEach((o: any) => o.customer_id && m.set(o.customer_id, o.customer));
    return [...m.entries()];
  }, [all]);
  const groups = useMemo(() => {
    const g = new Map<string, any[]>();
    orders.forEach((o) => g.set(o.customer || 'Own stock', [...(g.get(o.customer || 'Own stock') || []), o]));
    return [...g.entries()];
  }, [orders]);

  const head = ['Customer', 'Order', 'Date', 'Item', 'Ordered', 'Made', 'QC approved', 'Lost / damaged', 'Issued to dispatch', 'Dispatched', 'Pending', 'Status', 'Where is the difference'];
  const body = () => orders.map((o) => [o.customer || 'Own stock', o.so_no, o.so_date, `${o.item_code} ${o.product}`, q(o.ordered_qty, o.units_per_carton), q(o.made_qty, o.units_per_carton),
    q(o.qc_approved_qty, o.units_per_carton), fmt(o.lost_qty), q(o.handed_qty, o.units_per_carton), q(o.dispatched_qty, o.units_per_carton), q(o.pending_qty, o.units_per_carton), o.status, o.why.join('; ')]);
  const title = `Customer Ledger${p.customer_id ? ' - ' + (customers.find(([id]) => String(id) === String(p.customer_id))?.[1] || '') : ' - all customers'}`;

  return (
    <>
      <div className="flex flex-wrap items-end gap-2 mb-3">
        <label className="text-xs font-semibold text-slate-600">Customer
          <select className={`${inp} w-80`} value={p.customer_id} onChange={(e) => setP({ ...p, customer_id: e.target.value })}>
            <option value="">All customers</option>{customers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label className="text-xs font-semibold text-slate-600">Order date from<input type="date" className={`${inp} w-40`} value={p.from_date} onChange={(e) => setP({ ...p, from_date: e.target.value })} /></label>
        <label className="text-xs font-semibold text-slate-600">to<input type="date" className={`${inp} w-40`} value={p.to_date} onChange={(e) => setP({ ...p, to_date: e.target.value })} /></label>
        <button className={btnSec} onClick={() => (orders.length ? printDoc(title, [['Customers', groups.length], ['Orders', orders.length], ['Ordered', fmt(sum(orders, 'ordered_qty'))], ['Dispatched', fmt(sum(orders, 'dispatched_qty'))],
          ['Pending', fmt(sum(orders, 'pending_qty'))], ['Lost / damaged', fmt(sum(orders, 'lost_qty'))]], head.slice(1), body().map((r) => r.slice(1)), ['Prepared by', 'Checked by']) : toast('Nothing to print'))}><i className="fas fa-print mr-1" />Print</button>
        <button className={btnSec} onClick={() => (orders.length ? xlsx('customer_ledger.xlsx', title, [['Customers', groups.length], ['Orders', orders.length], ['Ordered', fmt(sum(orders, 'ordered_qty'))], ['Dispatched', fmt(sum(orders, 'dispatched_qty'))],
          ['Pending', fmt(sum(orders, 'pending_qty'))], ['Lost / damaged', fmt(sum(orders, 'lost_qty'))]], head, body()) : toast('Nothing to export'))}><i className="fas fa-file-excel text-emerald-700 mr-1" />Excel</button>
      </div>
      {orders.length === 0 && <div className="text-sm text-slate-500 bg-white border rounded p-6 text-center">No customer orders found.</div>}
      {groups.map(([customer, rows]) => (
        <div key={customer} className="mb-6">
          <div className="text-base font-bold text-slate-800 mb-2"><i className="fas fa-building text-indigo-600 mr-2" />{customer}</div>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2 mb-2">
            <Stat label="Ordered" value={fmt(sum(rows, 'ordered_qty'))} tone="blue" /><Stat label="Made" value={fmt(sum(rows, 'made_qty'))} />
            <Stat label="Lost / damaged" value={fmt(sum(rows, 'lost_qty'))} tone={sum(rows, 'lost_qty') > 0 ? 'red' : undefined} />
            <Stat label="Issued to dispatch" value={fmt(sum(rows, 'handed_qty'))} /><Stat label="Dispatched" value={fmt(sum(rows, 'dispatched_qty'))} tone="green" />
            <Stat label="Pending" value={fmt(sum(rows, 'pending_qty'))} tone={sum(rows, 'pending_qty') > 0 ? 'amber' : 'green'} />
          </div>
          <Table rows={rows} cols={[
            ['Order', (o) => <><span className="font-mono text-xs">{o.so_no}</span><div className="text-[11px] text-slate-500">{o.so_date}{o.delivery_date && ` · due ${o.delivery_date}`}</div></>],
            ['Item', (o) => <>{o.product}<div className="text-[11px] text-slate-500">{o.item_code} · {o.units_per_carton} per carton{o.production_orders && ` · ${o.production_orders}`}</div></>],
            ['Ordered', (o) => q(o.ordered_qty, o.units_per_carton), 'text-right'], ['Made', (o) => fmt(o.made_qty), 'text-right'],
            ['QC approved', (o) => fmt(o.qc_approved_qty), 'text-right'],
            ['Lost', (o) => (o.lost_qty > 0 ? <b className="text-rose-700">{fmt(o.lost_qty)}</b> : '—'), 'text-right'],
            ['Issued to dispatch', (o) => fmt(o.handed_qty), 'text-right'], ['Dispatched', (o) => <b className="text-emerald-700">{fmt(o.dispatched_qty)}</b>, 'text-right'],
            ['Pending', (o) => (o.pending_qty > 0 ? <b className="text-amber-700">{q(o.pending_qty, o.units_per_carton)}</b> : '—'), 'text-right'], ['Status', (o) => o.status],
            ['Where is the difference', (o) => (o.why.length ? <ul className="text-xs text-rose-700 list-disc ml-4">{o.why.map((w: string, i: number) => <li key={i}>{w}</li>)}</ul> : <span className="text-xs text-emerald-700">Fully accounted</span>)],
          ]} />
          {disp.some((x) => rows.some((o) => o.id === x.sales_order_id)) && <Table rows={disp.filter((x) => rows.some((o) => o.id === x.sales_order_id))} cols={[
            ['Dispatch', (x) => <span className="font-mono text-xs">{x.dispatch_no}</span>], ['Order', (x) => rows.find((o) => o.id === x.sales_order_id)?.so_no], ['Date', (x) => x.dispatch_date],
            ['Qty', (x) => fmt(x.qty), 'text-right'], ['Invoice / challan', (x) => x.invoice_no || x.challan_no || '—'], ['E-way', (x) => x.eway_bill || '—'],
            ['Vehicle', (x) => x.vehicle_no || '—'], ['Transporter', (x) => x.transporter || '—'], ['Received', (x) => x.ack_status || 'Awaiting acknowledgement'],
          ]} />}
          {damages.some((x) => rows.some((o) => o.id === x.sales_order_id)) && <Table rows={damages.filter((x) => rows.some((o) => o.id === x.sales_order_id))} cols={[
            ['Damage', (x) => <span className="font-mono text-xs">{x.damage_no}</span>], ['Order', (x) => rows.find((o) => o.id === x.sales_order_id)?.so_no], ['Where', (x) => x.stage || x.department || '—'],
            ['Reason', (x) => x.reason || '—'], ['Qty', (x) => fmt(x.qty), 'text-right'], ['Batch', (x) => x.batch_no || '—'], ['When', (x) => x.recorded], ['Status', (x) => x.status],
          ]} />}
        </div>
      ))}
    </>
  );
}

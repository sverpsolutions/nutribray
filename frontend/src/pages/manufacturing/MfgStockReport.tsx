import { useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import { Stat, Table, btnSec, ctnText, fmt, inp, printDoc, useList } from './mfgShared';
import Modal from '../../components/ui/Modal';
import { ItemLedger, xlsx } from './MfgStockReports';

const TYPES: Record<string, string> = { FG: 'Finished goods', RM: 'Raw material', PM: 'Packing material' };
const TYPE_COLS = ['FG', 'RM', 'PM'];

/** Stock held in every department, split by item type, with item-level detail and what is out at printers. */
export default function MfgStockReport() {
  const [stores] = useList<any>('/manufacturing/stores');
  const [me] = useList<any>('/manufacturing/store-access/me');
  const canAll = !!(me as any)?.all;
  const [p, setP] = useState<any>({ store_id: '', item_type: '', search: '' });
  const [view, setView] = useState<any>(null);   // item whose ledger is open
  const [d] = useList<any>('/manufacturing/stock-report', { store_id: p.store_id || undefined, item_type: p.item_type || undefined, search: p.search || undefined });
  const matrix: any[] = (d as any)?.matrix ?? [];
  const rows: any[] = (d as any)?.rows ?? [];
  const printer: any[] = (d as any)?.printer ?? [];
  const groups = useMemo(() => {
    const g = new Map<string, any[]>();
    rows.forEach((r) => g.set(r.store, [...(g.get(r.store) || []), r]));
    return [...g.entries()];
  }, [rows]);
  const scope = stores.find((s: any) => String(s.id) === String(p.store_id))?.name || (canAll ? 'All departments' : 'My departments');
  const head = ['Department', 'Type', 'Code', 'Item', 'Customer', 'Batch', 'Brand', 'Quantity', 'Unit', 'Cartons + loose'];
  const body = () => rows.map((r) => [r.store, TYPES[r.item_type] || r.item_type, r.item_code, r.item, r.customer || '', r.batch_no || '', r.brand || '', r.qty, r.unit, ctnText(r.qty, r.units_per_carton) || '']);
  const meta = (): [string, any][] => [['Department', scope], ['Item type', p.item_type ? TYPES[p.item_type] : 'All'], ['Departments with stock', matrix.length], ['Stock lines', rows.length],
    ...(printer.length ? [['Out at printers', `${printer.length} job(s)`] as [string, any]] : [])];
  const title = 'Department-wise Stock Report';
  const total = (t: string) => matrix.reduce((s, m) => s + (m.types[t]?.items || 0), 0);

  return (
    <div className="p-4 w-full">
      <h1 className="text-xl font-bold text-slate-800 mb-1"><i className="fas fa-chart-pie text-indigo-600 mr-2" />Stock Report - Department & Item Type</h1>
      <p className="text-xs text-slate-500 mb-4">What is in each department right now: finished goods, raw material and packing material, with batch and carton detail. Material out at a printer is listed separately.</p>
      <div className="flex flex-wrap items-end gap-2 mb-3">
        <label className="text-xs font-semibold text-slate-600">Department
          <select className={`${inp} w-64`} value={p.store_id} onChange={(e) => setP({ ...p, store_id: e.target.value })}>
            {canAll && <option value="">All departments</option>}{stores.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label className="text-xs font-semibold text-slate-600">Item type
          <select className={`${inp} w-48`} value={p.item_type} onChange={(e) => setP({ ...p, item_type: e.target.value })}>
            <option value="">All types</option>{Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="text-xs font-semibold text-slate-600">Search<input className={`${inp} w-64`} placeholder="Item / code / batch / customer" value={p.search} onChange={(e) => setP({ ...p, search: e.target.value })} /></label>
        <button className={btnSec} onClick={() => (rows.length ? printDoc(title, meta(), head.slice(0, 1).concat(head.slice(1)), body(), ['Prepared by', 'Checked by']) : toast('Nothing to print'))}><i className="fas fa-print mr-1" />Print</button>
        <button className={btnSec} onClick={() => (rows.length ? xlsx('department_stock_report.xlsx', title, meta(), head, body()) : toast('Nothing to export'))}><i className="fas fa-file-excel text-emerald-700 mr-1" />Excel</button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-4">
        <Stat label="Departments with stock" value={matrix.length} tone="blue" />
        <Stat label="Finished goods items" value={total('FG')} /><Stat label="Raw material items" value={total('RM')} /><Stat label="Packing material items" value={total('PM')} />
        <Stat label="Out at printers" value={printer.length} tone={printer.length ? 'amber' : undefined} sub="open printing jobs" />
      </div>

      <h3 className="font-semibold text-sm mb-1">Stock by department and item type</h3>
      <Table rows={matrix} empty="No stock in the selected department." cols={[
        ['Department', (m) => <b>{m.store}</b>],
        ...TYPE_COLS.map((t): [string, (m: any) => any, string] => [TYPES[t], (m) => (m.types[t] ? <>{fmt(m.types[t].qty)}<div className="text-[11px] text-slate-500">{m.types[t].items} item{m.types[t].items === 1 ? '' : 's'}</div></> : '—'), 'text-right']),
        ['Total items', (m) => m.items, 'text-right'], ['Value', (m) => `₹${fmt(m.value)}`, 'text-right'],
      ]} />

      {printer.length > 0 && <>
        <h3 className="font-semibold text-sm mt-5 mb-1"><i className="fas fa-print text-amber-600 mr-1" />At the printer (job work, not yet returned)</h3>
        <Table rows={printer} cols={[['Job', (j) => <span className="font-mono text-xs">{j.job_no}</span>], ['Printer', (j) => <>{j.vendor_name}<div className="text-[11px] text-slate-500">{j.vendor_type}</div></>],
          ['Item', (j) => <>{j.item}<div className="text-[11px] text-slate-500">{j.item_code}{j.brand && ` · ${j.brand}`}</div></>], ['Issued on', (j) => j.job_date],
          ['Expected back', (j) => j.expected_return || '—'], ['Pending at printer', (j) => <b className="text-amber-700">{fmt(j.pending)}</b>, 'text-right'], ['Status', (j) => j.status]]} />
      </>}

      {groups.map(([store, list]) => (
        <div key={store} className="mt-5">
          <h3 className="font-semibold text-sm mb-1"><i className="fas fa-warehouse text-indigo-600 mr-1" />{store}</h3>
          <Table rows={list} cols={[['Type', (r) => TYPES[r.item_type] || r.item_type], ['Code', (r) => <span className="font-mono text-xs">{r.item_code}</span>],
            ['Item', (r) => <button className="text-left text-indigo-700 hover:underline" title="Open the ledger of this item" onClick={() => setView(r)}>{r.item}{r.customer && <div className="text-[11px] text-slate-500 no-underline">{r.customer}</div>}</button>], ['Batch', (r) => r.batch_no || '—'], ['Brand', (r) => r.brand || '—'],
            ['Quantity', (r) => <b>{fmt(r.qty)} {r.unit}</b>, 'text-right'], ['Cartons + loose', (r) => ctnText(r.qty, r.units_per_carton) || '—', 'text-right'],
            ['Value', (r) => `₹${fmt(r.value)}`, 'text-right']]} />
        </div>
      ))}
      <Modal open={!!view} onClose={() => setView(null)} title={view ? `Ledger - ${view.item_code} ${view.item}` : ''} width="full">
        {view && <ItemLedger stores={stores} canAll={canAll} initial={{ id: view.product_id, name: view.item, store_id: p.store_id ? Number(p.store_id) : null }} />}
      </Modal>
    </div>
  );
}

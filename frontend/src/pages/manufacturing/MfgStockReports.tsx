import { useState } from 'react';
import { toast } from 'react-hot-toast';
import { saveAs } from 'file-saver';
import api from '../../api/axios';
import { ItemPicker, Table, btnSec, ctnText, fmt, inp, printDoc, useList } from './mfgShared';

const today = new Date().toISOString().slice(0, 10);
const monthStart = today.slice(0, 8) + '01';
const TYPES: Record<string, string> = { FG: 'Finished goods', RM: 'Raw material', PM: 'Packing material' };

const qtyTxt = (q: any, upc: any, unit: string) => (ctnText(q, upc) ? `${ctnText(q, upc)} (${fmt(q)} ${unit})` : `${fmt(q)} ${unit}`);

/** Excel file with the company logo + name + address heading, built by the server. */
export async function xlsx(file: string, title: string, meta: [string, any][], head: string[], rows: any[][]) {
  try {
    const r = await api.post('/manufacturing/export/xlsx', { title, meta: meta.map(([k, v]) => [k, String(v ?? '')]), cols: head, rows }, { responseType: 'blob' });
    saveAs(r.data, file);
  } catch { toast.error('Could not create the Excel file'); }
}

function Filters({ stores, p, setP, children, canAll = true }: any) {
  return (
    <div className="flex flex-wrap items-end gap-2 mb-3">
      <label className="text-xs font-semibold text-slate-600">Store
        <select className={`${inp} w-60`} value={p.store_id ?? (canAll ? '' : stores[0]?.id ?? '')} onChange={(e) => setP({ ...p, store_id: e.target.value ? Number(e.target.value) : null })}>
          {canAll && <option value="">All stores (whole plant)</option>}{stores.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select></label>
      <label className="text-xs font-semibold text-slate-600">From<input type="date" className={`${inp} w-40`} value={p.from_date} onChange={(e) => setP({ ...p, from_date: e.target.value })} /></label>
      <label className="text-xs font-semibold text-slate-600">To<input type="date" className={`${inp} w-40`} value={p.to_date} onChange={(e) => setP({ ...p, to_date: e.target.value })} /></label>
      {children}
    </div>
  );
}

export function ItemLedger({ stores, canAll, initial }: { stores: any[]; canAll: boolean; initial?: { id: number; name: string; store_id?: number | null } }) {
  const [p, setP] = useState<any>({ store_id: initial?.store_id ?? null, from_date: monthStart, to_date: today });
  const [item, setItem] = useState<any>(initial ? { id: initial.id, name: initial.name } : null);
  const [d] = useList<any>(item ? '/manufacturing/ledger/item' : '', { product_id: item?.id, store_id: p.store_id || undefined, from_date: p.from_date, to_date: p.to_date });
  const L = d as any;
  const rows: any[] = L?.rows ?? [];
  const it = L?.item;
  const scope = stores.find((s) => s.id === p.store_id)?.name || 'All stores (whole plant)';
  const q = (v: any) => qtyTxt(v, it?.units_per_carton, it?.unit || 'PCS');
  const head = ['Date', 'Doc no', 'What happened', 'From', 'To', 'Batch', 'Ref', 'In', 'Out', 'Balance'];
  const body = () => rows.map((r) => [r.posted, r.doc_no, r.story, r.from_store || '-', r.to_store || '-', r.batch_no || '', r.ref_no || '',
    r.in ? q(r.in) : '', r.out ? q(r.out) : '', q(r.balance)]);
  const meta = (): [string, any][] => [['Item', `${it.item_code} - ${it.name}`], ['Customer', it.customer || '-'], ['Store', scope], ['Period', `${p.from_date} to ${p.to_date}`],
    ['Opening balance', q(L.opening)], ['Total received', q(L.total_in)], ['Total issued', q(L.total_out)], ['Closing balance', q(L.closing)]];
  return (
    <>
      <Filters stores={stores} p={p} setP={setP} canAll={canAll}>
        <div className="w-96"><div className="text-xs font-semibold text-slate-600">Item</div><ItemPicker value={item?.id} label={item?.name} onPick={setItem} /></div>
        {it && <>
          <button className={btnSec} onClick={() => printDoc(`Item Ledger - ${it.item_code}`, meta(), head, body(), ['Prepared by', 'Checked by'])}><i className="fas fa-print mr-1" />Print</button>
          <button className={btnSec} onClick={() => xlsx(`item_ledger_${it.item_code}.xlsx`, `Item Ledger - ${it.item_code}`, meta(), head, body())}><i className="fas fa-file-excel text-emerald-700 mr-1" />Excel</button>
        </>}
      </Filters>
      {!item ? <div className="text-sm text-slate-500 bg-white border rounded p-6 text-center">Search and pick an item (finished good, raw or packing material) to see its full ledger.</div> : it && <>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
          {[['Opening', L.opening, 'text-slate-800'], ['Received', L.total_in, 'text-emerald-700'], ['Issued', L.total_out, 'text-rose-700'], ['Closing', L.closing, 'text-indigo-700']].map(([k, v, c]: any) =>
            <div key={k} className="bg-white border rounded-lg p-3"><div className="text-xs text-slate-500">{k}</div><div className={`text-lg font-bold ${c}`}>{q(v)}</div></div>)}
        </div>
        <div className="text-sm font-semibold text-slate-700 mb-1">{it.item_code} · {it.name}{it.customer && <span className="font-normal text-slate-500"> · {it.customer}</span>}{it.units_per_carton > 1 && <span className="font-normal text-slate-500"> · {it.units_per_carton} pcs / carton</span>}</div>
        {(L.orders?.length > 0) && <><div className="text-sm font-bold text-slate-700 mt-2 mb-1">Customer orders and production of this item</div>
          <Table rows={L.orders} cols={[['Customer', (r) => r.customer || 'Own stock'], ['Customer order', (r) => r.so_no || '—'], ['Ordered', (r) => (r.ordered_qty ? qtyTxt(r.ordered_qty, it.units_per_carton, it.unit) : '—'), 'text-right'],
            ['Due', (r) => r.delivery_date || '—'], ['Production order', (r) => <span className="font-mono text-xs">{r.order_no}</span>], ['Planned', (r) => fmt(r.planned_qty), 'text-right'],
            ['Made', (r) => fmt(r.completed_qty), 'text-right'], ['Status', (r) => r.status]]} /></>}
        {(L.used_in?.length > 0) && <><div className="text-sm font-bold text-slate-700 mt-3 mb-1">Where this material was used</div>
          <Table rows={L.used_in} cols={[['Production order', (r) => <span className="font-mono text-xs">{r.order_no}</span>], ['Making', (r) => r.making], ['Customer', (r) => r.customer || 'Own stock'],
            ['Customer order', (r) => r.so_no || '—'], ['Issued', (r) => qtyTxt(r.issued, it.units_per_carton, it.unit), 'text-right'], ['Consumed', (r) => qtyTxt(r.consumed, it.units_per_carton, it.unit), 'text-right']]} /></>}
        <div className="text-sm font-bold text-slate-700 mt-3 mb-1">Movement ledger</div>
        <Table rows={[{ id: 'open', opening: true }, ...rows]} empty="No movements." cols={[
          ['Date', (r) => (r.opening ? <b>Opening balance</b> : r.posted)], ['Doc', (r) => r.doc_no && <span className="font-mono text-xs">{r.doc_no}</span>], ['What happened', (r) => <span className="text-xs">{r.story}</span>],
          ['From → To', (r) => (r.opening ? '' : `${r.from_store || 'Outside'} → ${r.to_store || 'Outside'}`)], ['Batch', (r) => r.batch_no], ['Ref', (r) => r.ref_no],
          ['In', (r) => r.in > 0 && <span className="text-emerald-700">{q(r.in)}</span>, 'text-right'], ['Out', (r) => r.out > 0 && <span className="text-rose-700">{q(r.out)}</span>, 'text-right'],
          ['Balance', (r) => <b>{q(r.opening ? L.opening : r.balance)}</b>, 'text-right'],
        ]} />
      </>}
    </>
  );
}

export function StockStatement({ stores, canAll }: { stores: any[]; canAll: boolean }) {
  const [p, setP] = useState<any>({ store_id: null, from_date: monthStart, to_date: today, item_type: '', search: '' });
  const [rows] = useList<any>('/manufacturing/stock-summary', { ...p, store_id: p.store_id || undefined, item_type: p.item_type || undefined, search: p.search || undefined });
  const scope = stores.find((s) => s.id === p.store_id)?.name || 'All stores (whole plant)';
  const head = ['Code', 'Item', 'Type', 'Customer', 'Pcs / ctn', 'Opening', 'Received', 'Issued', 'Closing (pcs)', 'Closing (cartons)'];
  const body = () => rows.map((r: any) => [r.item_code, r.item, r.item_type, r.customer || '', r.units_per_carton, fmt(r.opening), fmt(r.received), fmt(r.issued), fmt(r.closing), ctnText(r.closing, r.units_per_carton) || '']);
  const tot = (k: string) => rows.reduce((t: number, r: any) => t + Number(r[k] || 0), 0);
  return (
    <>
      <Filters stores={stores} p={p} setP={setP} canAll={canAll}>
        <label className="text-xs font-semibold text-slate-600">Type
          <select className={`${inp} w-44`} value={p.item_type} onChange={(e) => setP({ ...p, item_type: e.target.value })}>
            <option value="">All</option>{Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></label>
        <label className="text-xs font-semibold text-slate-600">Search<input className={`${inp} w-56`} placeholder="Item / code / customer" value={p.search} onChange={(e) => setP({ ...p, search: e.target.value })} /></label>
        <button className={btnSec} onClick={() => (rows.length ? printDoc(`Stock Statement${p.item_type ? ' - ' + TYPES[p.item_type] : ''}`, [['Store', scope], ['Period', `${p.from_date} to ${p.to_date}`], ['Items', rows.length]], head, body(), ['Prepared by', 'Checked by']) : toast('Nothing to print'))}><i className="fas fa-print mr-1" />Print</button>
        <button className={btnSec} onClick={() => (rows.length ? xlsx('stock_statement.xlsx', `Stock Statement${p.item_type ? ' - ' + TYPES[p.item_type] : ''}`, [['Store', scope], ['Period', `${p.from_date} to ${p.to_date}`], ['Items', rows.length]], head, body()) : toast('Nothing to export'))}><i className="fas fa-file-excel text-emerald-700 mr-1" />Excel</button>
      </Filters>
      <Table rows={rows} empty="No stock movement in this period." cols={[
        ['Code', (r) => <span className="font-mono text-xs">{r.item_code}</span>], ['Item', (r) => <>{r.item}{r.customer && <div className="text-[11px] text-slate-500">{r.customer}</div>}</>], ['Type', (r) => r.item_type],
        ['Pcs / ctn', (r) => (r.units_per_carton > 1 ? r.units_per_carton : '—'), 'text-right'],
        ['Opening', (r) => fmt(r.opening), 'text-right'], ['Received', (r) => <span className="text-emerald-700">{fmt(r.received)}</span>, 'text-right'],
        ['Issued', (r) => <span className="text-rose-700">{fmt(r.issued)}</span>, 'text-right'],
        ['Closing', (r) => <b>{fmt(r.closing)} {r.unit}</b>, 'text-right'], ['Closing cartons', (r) => ctnText(r.closing, r.units_per_carton) || '—', 'text-right'],
      ]} />
      {rows.length > 0 && <div className="text-xs text-slate-500 mt-2">{rows.length} items · received {fmt(tot('received'))} · issued {fmt(tot('issued'))} · closing {fmt(tot('closing'))}</div>}
    </>
  );
}

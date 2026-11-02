import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import api from '../../api/axios';
import { products_api, type product_search_item } from '../../api/products';

export const err = (e: any) => toast.error(e?.response?.data?.detail?.toString?.() || 'Something went wrong');
export const inp = 'w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm bg-white focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20';
export const btn = 'px-3 py-1.5 rounded-md text-xs font-semibold';
export const btnPri = `${btn} bg-primary text-white hover:bg-primary-hover disabled:opacity-50`;
export const btnSec = `${btn} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`;

export function Tabs({ tabs, value, onChange }: { tabs: string[]; value: string; onChange: (t: string) => void }) {
  return (
    <div className="flex gap-1 border-b border-slate-200 mb-4 overflow-x-auto">
      {tabs.map((t) => (
        <button key={t} onClick={() => onChange(t)}
          className={`px-4 py-2 text-sm font-semibold whitespace-nowrap border-b-2 -mb-px ${value === t ? 'border-primary text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
          {t}
        </button>
      ))}
    </div>
  );
}

const STATUS: Record<string, string> = {   // one meaning per colour, see index.css: green ready/done · amber waiting/short · red blocked/rejected · blue running · grey none
  DRAFT: 'st-warn', APPROVED: 'st-ok', SUPERSEDED: 'st-none', INACTIVE: 'st-bad', PENDING: 'st-warn', REJECTED: 'st-bad', CANCELLED: 'st-none',
  COMPLETED: 'st-ok', IN_PRODUCTION: 'st-info', OPEN: 'st-info', READY: 'st-ok', SHORT: 'st-warn', BLOCKED: 'st-bad',
};
export const Badge = ({ s }: { s: string }) => <span className={`st ${STATUS[s] || 'st-none'}`}>{s.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase())}</span>;

export function Table({ cols, rows, empty = 'Nothing here yet.' }: { cols: [string, (r: any) => any, string?][]; rows: any[]; empty?: string }) {
  return (
    <div className="overflow-x-auto bg-white border border-slate-200 rounded-lg">
      <table className="w-full text-sm tabular-nums">
        <thead className="text-slate-500 text-xs border-b border-slate-200">
          <tr>{cols.map(([h, , cls]) => <th key={h} className={`px-3 py-2 text-left font-semibold ${cls || ''}`}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={cols.length} className="px-3 py-6 text-center text-slate-400">{empty}</td></tr>}
          {rows.map((r, i) => (
            <tr key={r.id ?? i} className="border-t border-slate-100 hover:bg-[var(--color-bg-row-hover)]">
              {cols.map(([h, f, cls]) => <td key={h} className={`px-3 py-2 ${cls || ''}`}>{f(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Type-ahead item picker over /products/search. */
export function ItemPicker({ value, label, onPick }: { value?: number | null; label?: string; onPick: (p: product_search_item | null) => void }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<product_search_item[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) return setRes([]);
    const t = setTimeout(() => products_api.search(q, 15).then((r) => setRes(r.data)).catch(() => setRes([])), 250);
    return () => clearTimeout(t);
  }, [q]);
  if (value) return (
    <div className="flex items-center gap-2 border border-slate-300 rounded-md px-2 py-1.5 text-sm bg-slate-50">
      <span className="flex-1 truncate">{label || `Item #${value}`}</span>
      <button type="button" className="text-slate-400 hover:text-rose-600" onClick={() => onPick(null)}><i className="fas fa-times" /></button>
    </div>
  );
  return (
    <div className="relative">
      <input className={inp} placeholder="Search item name / code…" value={q} onChange={(e) => setQ(e.target.value)} />
      {res.length > 0 && (
        <div className="absolute z-30 mt-1 w-full max-h-60 overflow-auto bg-white border border-slate-200 rounded-md shadow-lg">
          {res.map((p) => (
            <button type="button" key={p.id} className="block w-full text-left px-3 py-1.5 text-sm hover:bg-indigo-50"
              onClick={() => { onPick(p); setQ(''); setRes([]); }}>
              <span className="font-mono text-xs text-slate-500 mr-2">{p.item_code || p.id}</span>{p.name} <span className="text-slate-400">({p.unit})</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export const useList = <T,>(url: string, params?: any): [T[], () => void] => {
  const [rows, setRows] = useState<T[]>([]);
  const key = JSON.stringify(params || {});
  const load = () => { if (!url) return setRows([]); api.get(url, { params }).then((r) => setRows(r.data)).catch(err); };
  useEffect(load, [url, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return [rows, load];
};

export const fmt = (n: any) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });

export const ctn = (units: any, upc: any) => {
  const u = Number(units || 0), p = Math.max(Number(upc || 1), 1), c = Math.floor(u / p);
  return { cartons: c, loose: +(u - c * p).toFixed(4) };
};
export const ctnText = (units: any, upc: any) => {
  if (!upc || Number(upc) <= 1) return '';
  const { cartons, loose } = ctn(units, upc);
  return `${cartons} ctn${loose ? ` + ${fmt(loose)} loose` : ''}`;
};

/** Quantity box with a Cartons / Units switch and the live conversion beside it — users never multiply by hand. */
export function CartonQty({ value, unit, upc, base = 'PCS', onChange }: { value: string; unit: string; upc: number; base?: string;
  onChange: (v: string, unit: string) => void }) {
  const units = unit === 'CTN' ? Number(value || 0) * upc : Number(value || 0);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input type="number" min={0} className={`${inp} w-28`} value={value} onChange={(e) => onChange(e.target.value, unit)} />
      <select className={`${inp} w-28`} value={unit} onChange={(e) => onChange(value, e.target.value)}>
        <option value="CTN">Cartons</option><option value={base}>{base}</option>
      </select>
      {value && <span className="text-sm text-slate-600">= <b>{fmt(units)} {base}</b>{upc > 1 && unit !== 'CTN' && ` (${ctnText(units, upc)})`}
        {upc > 1 && unit === 'CTN' && ` @ ${upc}/carton`}</span>}
    </div>
  );
}

export function Stat({ label, value, sub, tone = 'slate', onClick }: { label: string; value: any; sub?: string; tone?: string; onClick?: () => void }) {
  // colour only where it means something: green ready · amber waiting/short · red blocked/overdue · blue running; every other tone stays neutral
  const code: Record<string, string> = { green: 'ok', amber: 'warn', red: 'bad', blue: 'info' };
  const isZero = value === 0 || value === '0';
  const c = isZero ? undefined : code[tone];
  return (
    <div onClick={onClick} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter') onClick(); } : undefined}
      className={`rounded-lg border px-3.5 py-2.5 ${c ? 'border-transparent' : 'border-slate-200 bg-white'} ${onClick ? 'cursor-pointer hover:border-slate-400 transition-colors' : ''}`}
      style={c ? { background: `var(--st-${c}-bg)` } : undefined}>
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="text-2xl font-semibold leading-tight tabular-nums" style={{ color: c ? `var(--st-${c})` : 'var(--color-text-primary)' }}>{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

const esc = (v: any) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

/** Printable document (challan, issue slip, production sheet, QC form, handover slip, dispatch note) in a new window. */
export function printDoc(title: string, meta: [string, any][], cols: string[], rows: any[][], signs = ['Prepared by', 'Checked by', 'Received by']) {
  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) return toast.error('Allow pop-ups to print');
  w.document.write('<p style="font:14px sans-serif;margin:24px">Preparing print…</p>');
  api.get('/company/settings').catch(() => ({ data: {} })).then(({ data: c }: any) => {
  const logo = c.logo_path ? (String(c.logo_path).startsWith('http') ? c.logo_path : location.origin + c.logo_path) : '';
  const addr = [c.reg_address || c.ho_address, c.reg_city, c.ho_phone && `Ph: ${c.ho_phone}`, c.gstin && `GSTIN: ${c.gstin}`].filter(Boolean).join(' · ');
  w.document.open();
  w.document.write(`<!doctype html><html><head><title>${esc(title)}</title><style>
    body{font:13px Inter,Segoe UI,Arial,sans-serif;margin:24px;color:#111}h1{font-size:18px;margin:0 0 4px}
    .meta{display:grid;grid-template-columns:repeat(2,1fr);gap:4px 24px;margin:12px 0}.meta div{border-bottom:1px dotted #bbb;padding:2px 0}
    table{width:100%;border-collapse:collapse;margin-top:10px}th,td{border:1px solid #999;padding:5px 6px;text-align:left}th{background:#eee}
    .sig{display:flex;justify-content:space-between;margin-top:56px}.sig div{border-top:1px solid #333;width:28%;text-align:center;padding-top:4px}
    @media print{button{display:none}}
    .hd{display:flex;align-items:center;gap:14px;border-bottom:2px solid #333;padding-bottom:8px;margin-bottom:12px}.co{font-size:20px;font-weight:700}.ad{font-size:11px;color:#444}h1{text-transform:uppercase;letter-spacing:.5px;text-align:center}</style></head><body>
    <button onclick="print()" style="float:right">Print</button>
    <div class="hd">${logo ? `<img src="${esc(logo)}" style="height:54px">` : ''}<div><div class="co">${esc(c.legal_name || c.brand_name || '')}</div><div class="ad">${esc(addr)}</div></div></div>
    <h1>${esc(title)}</h1>
    <div class="meta">${meta.map(([k, v]) => `<div><b>${esc(k)}:</b> ${esc(v)}</div>`).join('')}</div>
    <table><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>
    <div class="sig">${signs.map((s) => `<div>${esc(s)}</div>`).join('')}</div></body></html>`);
  w.document.close();
  });
}

export const key = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());

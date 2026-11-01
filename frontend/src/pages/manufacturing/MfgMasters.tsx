import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import api from '../../api/axios';
import { customers_api } from '../../api/customers';
import Modal from '../../components/ui/Modal';
import { Badge, ItemPicker, Table, Tabs, btnPri, btnSec, err, fmt, inp, useList } from './mfgShared';

const TABS = ['Customer Brands', 'Artwork', 'Packaging Specs', 'Item Units'];

export default function MfgMasters() {
  const [tab, setTab] = useState(TABS[0]);
  return (
    <div className="p-4 w-full">
      <h1 className="text-xl font-bold text-slate-800 mb-1"><i className="fas fa-palette text-indigo-600 mr-2" />Customer Packaging Masters</h1>
      <p className="text-xs text-slate-500 mb-4">Brands per customer, approved artwork and packaging specifications (revisioned — old versions are kept), and item unit conversions.</p>
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      {tab === TABS[0] && <Brands />}
      {tab === TABS[1] && <Versioned kind="artworks" />}
      {tab === TABS[2] && <Versioned kind="specs" />}
      {tab === TABS[3] && <ItemUnits />}
    </div>
  );
}

const Field = ({ label, children, wide }: { label: string; children: any; wide?: boolean }) => (
  <label className={`block ${wide ? 'md:col-span-2' : ''}`}><span className="block text-xs font-semibold text-slate-600 mb-1">{label}</span>{children}</label>
);

// ── brands ───────────────────────────────────────────────────────────────────
function CustomerPicker({ value, label, onPick }: { value?: number | null; label?: string; onPick: (id: number | null, name?: string) => void }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<any[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) return setRes([]);
    const t = setTimeout(() => customers_api.list({ search: q, per_page: 20 }).then((r) => setRes(r.data.data)).catch(() => setRes([])), 250);
    return () => clearTimeout(t);
  }, [q]);
  if (value) return (
    <div className="flex items-center gap-2 border border-slate-300 rounded-md px-2 py-1.5 text-sm bg-slate-50">
      <span className="flex-1">{label || `Customer #${value}`}</span>
      <button type="button" className="text-slate-400 hover:text-rose-600" onClick={() => onPick(null)}><i className="fas fa-times" /></button>
    </div>
  );
  return (
    <div className="relative">
      <input className={inp} placeholder="Search customer…" value={q} onChange={(e) => setQ(e.target.value)} />
      {res.length > 0 && (
        <div className="absolute z-30 mt-1 w-full max-h-60 overflow-auto bg-white border rounded-md shadow-lg">
          {res.map((c) => <button type="button" key={c.id} className="block w-full text-left px-3 py-1.5 text-sm hover:bg-indigo-50"
            onClick={() => { onPick(c.id, c.name); setQ(''); setRes([]); }}>{c.name} <span className="text-slate-400">{c.phone}</span></button>)}
        </div>
      )}
    </div>
  );
}

function Brands() {
  const [rows, load] = useList<any>('/manufacturing/brands');
  const [f, setF] = useState<any>(null);
  const save = async () => {
    try {
      if (f.id) await api.put(`/manufacturing/brands/${f.id}`, f); else await api.post('/manufacturing/brands', f);
      toast.success('Brand saved'); setF(null); load();
    } catch (e) { err(e); }
  };
  return (
    <>
      <div className="flex justify-end gap-2 mb-3">
        <ItemListImport onDone={load} />
        <button className={btnPri} onClick={() => setF({ code: '', name: '', is_own_brand: false, is_active: true })}><i className="fas fa-plus mr-1" />New Brand</button>
      </div>
      <Table rows={rows} cols={[
        ['Code', (r) => <span className="font-mono">{r.code}</span>],
        ['Brand', (r) => r.name],
        ['Customer', (r) => r.is_own_brand ? <span className="text-indigo-700 font-semibold">Own brand</span> : r.customer_name],
        ['GSTIN', (r) => r.gst_number || '—'],
        ['Approved specs', (r) => r.specs, 'text-right'],
        ['Approved artwork', (r) => r.artworks, 'text-right'],
        ['Status', (r) => r.is_active ? 'Active' : <span className="text-rose-600">Inactive</span>],
        ['', (r) => <button className={btnSec} onClick={() => setF({ ...r })}>Edit</button>, 'text-right'],
      ]} />
      <Modal open={!!f} onClose={() => setF(null)} title={f?.id ? `Edit brand ${f.code}` : 'New brand'} width="max-w-lg">
        {f && <div className="space-y-3">
          <Field label="Brand code"><input className={inp} disabled={!!f.id} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} /></Field>
          <Field label="Brand name"><input className={inp} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.is_own_brand} onChange={(e) => setF({ ...f, is_own_brand: e.target.checked })} />Our own brand (not a job-work customer)</label>
          {!f.is_own_brand && <Field label="Customer"><CustomerPicker value={f.customer_id} label={f.customer_name} onPick={(id, name) => setF({ ...f, customer_id: id, customer_name: name })} /></Field>}
          <Field label="Notes"><textarea className={inp} rows={2} value={f.notes || ''} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.is_active} onChange={(e) => setF({ ...f, is_active: e.target.checked })} />Active</label>
          <div className="flex justify-end gap-2 pt-2"><button className={btnSec} onClick={() => setF(null)}>Cancel</button><button className={btnPri} onClick={save}>Save</button></div>
        </div>}
      </Modal>
    </>
  );
}

// ── customer-wise item list (company row, then Brand Name | SIZE | PACKING TYPE) → brands + finished-goods items ──
function ItemListImport({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [hsn, setHsn] = useState('19011010');
  const [mrp, setMrp] = useState('300');
  const [createMissing, setCreateMissing] = useState(true);
  const [p, setP] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const send = async (commit: boolean) => {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    setBusy(true);
    try {
      const r = await api.post('/manufacturing/import/customer-items', fd, { params: { hsn, mrp, commit, create_missing: createMissing }, headers: { 'Content-Type': 'multipart/form-data' } });
      setP(r.data);
      if (commit) {
        const x = r.data.result;
        toast.success(`${x.items} items, ${x.brands} brands, ${x.customers} customers created`);
        onDone();
      }
    } catch (e) { err(e); } finally { setBusy(false); }
  };
  const s = p?.summary;
  const problems = p ? p.companies.flatMap((g: any) => g.items.filter((i: any) => i.problem && i.status === 'new').map((i: any) => ({ ...i, company: g.company }))) : [];
  return (
    <>
      <button className={btnSec} onClick={() => { setOpen(true); setP(null); setFile(null); }}><i className="fas fa-file-excel mr-1" />Import item list</button>
      <Modal open={open} onClose={() => setOpen(false)} title="Import item list (plant inventory)" width="full">
        <div className="space-y-3 text-sm">
          <p className="text-xs text-slate-500">Excel with a company name row, then <b>Brand Name | SIZE | PACKING TYPE</b> rows. SIZE “36 x 200” = 36 units of 200 g per carton.
            Each company becomes a customer brand with a short code; items get codes like AHL-001. One HSN and MRP for all — change per item later. Items already imported are skipped.<br />
            Packing material list: columns <b>CATEGORY | ITEM NAME</b> → Packing Material items coded by category (PM-CAP-001…), no MRP.</p>
          <div className="grid sm:grid-cols-4 gap-3 items-end">
            <label className="sm:col-span-2 block"><span className="text-xs text-slate-600">Excel file</span>
              <input className={inp} type="file" accept=".xlsx" onChange={e => { setFile(e.target.files?.[0] || null); setP(null); }} /></label>
            <label className="block"><span className="text-xs text-slate-600">HSN for all items (optional for packing material)</span><input className={inp} value={hsn} onChange={e => { setHsn(e.target.value.replace(/\D/g, '')); setP(null); }} /></label>
            <label className="block"><span className="text-xs text-slate-600">MRP for all items</span><input className={inp} type="number" min={0} value={mrp} onChange={e => { setMrp(e.target.value); setP(null); }} /></label>
          </div>
          <label className="flex items-center gap-2"><input type="checkbox" checked={createMissing} onChange={e => setCreateMissing(e.target.checked)} />Create customers that are not in the software yet</label>
          <div className="flex justify-end"><button className={btnSec} disabled={!file || busy} onClick={() => send(false)}>{busy && !p ? 'Reading…' : 'Preview'}</button></div>
          {p && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-center">
                {[['Companies', s.companies], ['Matched customers', s.matched], ['New customers', s.unmatched], ['New items', s.new], ['Already there', s.exists], ['Check size', s.check]].map(([k, v]) => (
                  <div key={k as string} className="border border-slate-200 rounded p-2"><div className="text-[11px] text-slate-500">{k}</div><div className="text-lg font-semibold">{v}</div></div>
                ))}
              </div>
              {p.gst_percent === null && p.hsn && <p className="text-amber-700 text-xs"><i className="fas fa-exclamation-triangle mr-1" />HSN {p.hsn} is not in the HSN master — items get GST 0% until you set it.</p>}
              <div className="max-h-72 overflow-y-auto">
                <Table rows={p.companies} cols={[
                  ['Company (customer)', (g: any) => <>{g.company}{g.customer_name && g.match === 'close' && <div className="text-xs text-amber-700">matched to {g.customer_name}</div>}</>],
                  ['Customer', (g: any) => g.match === 'packing material' ? 'Packing material' : g.match === 'own brand' ? 'Own brand' : g.customer_id ? 'Found' : createMissing ? <span className="text-indigo-700">New</span> : <span className="text-rose-600">Skipped</span>],
                  ['Code', (g: any) => <span className="font-mono">{g.brand_code}{g.new_brand && <span className="text-indigo-600 text-[10px] ml-1">new</span>}</span>],
                  ['Items', (g: any) => g.items.length, 'text-right'],
                  ['New', (g: any) => g.items.filter((i: any) => i.status === 'new').length, 'text-right'],
                  ['First item', (g: any) => g.items[0] ? <span className="text-xs">{g.items[0].item_code || '—'} · {g.items[0].name} · {g.items[0].units_per_carton}/ctn</span> : '—'],
                ]} />
              </div>
              {problems.length > 0 && (
                <details className="text-xs"><summary className="cursor-pointer text-amber-700">{problems.length} items need a size check after import</summary>
                  <ul className="list-disc ml-5 mt-1">{problems.map((i: any) => <li key={i.row}>Row {i.row} · {i.company} · {i.brand_name}: {i.problem}</li>)}</ul></details>
              )}
              <div className="flex justify-end gap-2">
                <button className={btnSec} onClick={() => setOpen(false)}>Close</button>
                <button className={btnPri} disabled={busy || !s.new} onClick={() => confirm(`Create ${s.new} items now?`) && send(true)}>Import {s.new} items</button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </>
  );
}

// ── artwork & packaging specs ─────────────────────────────────────────────────
async function upload(file: File): Promise<string | null> {
  const fd = new FormData();
  fd.append('file', file);
  try { return (await api.post('/manufacturing/master/file', fd, { headers: { 'Content-Type': 'multipart/form-data' } })).data.path; }
  catch (e) { err(e); return null; }
}

const fileLink = (p?: string) => p ? <a href={p} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline"><i className="fas fa-paperclip mr-1" />file</a> : '—';

function Versioned({ kind }: { kind: 'artworks' | 'specs' }) {
  const [brand, setBrand] = useState('');
  const [status, setStatus] = useState('');
  const [rows, load] = useList<any>(`/manufacturing/master/${kind}`, { brand_id: brand || undefined, status: status || undefined });
  const [brands] = useList<any>('/manufacturing/brands');
  const [f, setF] = useState<any>(null);
  const isArt = kind === 'artworks';
  const act = async (url: string, msg: string, method: 'post' | 'put' = 'post') => {
    try { await api[method](url); toast.success(msg); load(); } catch (e) { err(e); }
  };
  const save = async () => {
    try {
      const body = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v === '' ? null : v]));
      if (f.id) await api.put(`/manufacturing/master/${kind}/${f.id}`, body); else await api.post(`/manufacturing/master/${kind}`, body);
      toast.success('Saved as draft — approve it to put it in force'); setF(null); load();
    } catch (e) { err(e); }
  };
  const blank = isArt ? { code: '', title: '', applies_to: 'TIN' } : { spec_code: '', units_per_carton: 24, photos: [] };
  const cols: [string, (r: any) => any, string?][] = isArt ? [
    ['Code', (r) => <span className="font-mono">{r.code}</span>], ['Rev', (r) => `r${r.revision}`], ['Brand', (r) => r.brand_name],
    ['Customer', (r) => r.customer_name || 'Own'], ['Title', (r) => r.title], ['For', (r) => r.applies_to], ['Colours', (r) => r.colours || '—'],
    ['File', (r) => fileLink(r.file_path)], ['Effective', (r) => r.effective_from ? `${r.effective_from}${r.effective_to ? ' → ' + r.effective_to : ''}` : '—'],
    ['Status', (r) => <Badge s={r.status} />],
  ] : [
    ['Spec', (r) => <span className="font-mono">{r.spec_code}</span>], ['Rev', (r) => `r${r.revision}`], ['Brand', (r) => r.brand_name],
    ['Customer', (r) => r.customer_name || 'Own'], ['Product', (r) => r.product_name], ['Tin', (r) => [r.tin_size, r.tin_type].filter(Boolean).join(' · ') || '—'],
    ['Cap', (r) => [r.cap_type, r.cap_colour].filter(Boolean).join(' · ') || '—'], ['Per carton', (r) => r.units_per_carton, 'text-right'],
    ['Tin artwork', (r) => r.tin_artwork || '—'], ['Status', (r) => <Badge s={r.status} />],
  ];
  cols.push(['', (r) => (
    <div className="flex gap-1 justify-end whitespace-nowrap">
      {r.status === 'DRAFT' && <button className={btnSec} onClick={() => setF({ ...r })}>Edit</button>}
      {r.status === 'DRAFT' && <button className={btnPri} onClick={() => act(`/manufacturing/master/${kind}/${r.id}/approve`, 'Approved')}>Approve</button>}
      {r.status === 'APPROVED' && <button className={btnSec} onClick={() => act(`/manufacturing/master/${kind}/${r.id}/revise`, 'New draft revision created')}>New revision</button>}
      {(r.status === 'APPROVED' || r.status === 'DRAFT') && <button className={btnSec} title="Set inactive"
        onClick={() => confirm('Set this inactive? It stays in history.') && act(`/manufacturing/master/${kind}/${r.id}/deactivate`, 'Set inactive', 'put')}><i className="fas fa-ban" /></button>}
    </div>
  ), 'text-right']);
  return (
    <>
      <div className="flex flex-wrap gap-2 mb-3 items-center">
        <select className={`${inp} w-56`} value={brand} onChange={(e) => setBrand(e.target.value)}>
          <option value="">All brands</option>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <select className={`${inp} w-40`} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>{['DRAFT', 'APPROVED', 'SUPERSEDED', 'INACTIVE'].map((s) => <option key={s}>{s}</option>)}
        </select>
        <div className="flex-1" />
        <button className={btnPri} onClick={() => setF(blank)}><i className="fas fa-plus mr-1" />New {isArt ? 'Artwork' : 'Packaging Spec'}</button>
      </div>
      <Table rows={rows} cols={cols} />
      <Modal open={!!f} onClose={() => setF(null)} title={f?.id ? `Edit draft r${f.revision}` : `New ${isArt ? 'artwork' : 'packaging spec'}`} width="full">
        {f && (isArt ? <ArtworkForm f={f} setF={setF} brands={brands} /> : <SpecForm f={f} setF={setF} brands={brands} />)}
        {f && <div className="flex justify-end gap-2 pt-4"><button className={btnSec} onClick={() => setF(null)}>Cancel</button><button className={btnPri} onClick={save}>Save draft</button></div>}
      </Modal>
    </>
  );
}

const BrandSelect = ({ f, setF, brands }: any) => (
  <select className={inp} value={f.brand_id || ''} onChange={(e) => setF({ ...f, brand_id: Number(e.target.value) || null })}>
    <option value="">Choose brand…</option>{brands.filter((b: any) => b.is_active).map((b: any) => <option key={b.id} value={b.id}>{b.name} — {b.is_own_brand ? 'Own' : b.customer_name}</option>)}
  </select>
);

function ArtworkForm({ f, setF, brands }: any) {
  const t = (k: string) => ({ value: f[k] ?? '', onChange: (e: any) => setF({ ...f, [k]: e.target.value }) });
  return (
    <div className="grid md:grid-cols-2 gap-3">
      <Field label="Artwork code"><input className={inp} disabled={!!f.id} {...t('code')} /></Field>
      <Field label="Brand"><BrandSelect f={f} setF={setF} brands={brands} /></Field>
      <Field label="Title"><input className={inp} {...t('title')} /></Field>
      <Field label="Used on"><select className={inp} {...t('applies_to')}>{['TIN', 'CAP', 'LABEL', 'CARTON', 'POUCH', 'OTHER'].map((x) => <option key={x}>{x}</option>)}</select></Field>
      <Field label="Colours"><input className={inp} {...t('colours')} /></Field>
      <Field label="Effective from (blank = approval date)"><input type="date" className={inp} {...t('effective_from')} /></Field>
      <Field label="Description" wide><textarea className={inp} rows={2} {...t('description')} /></Field>
      <Field label="Artwork file (PDF / image / AI / CDR)" wide>
        <div className="flex items-center gap-3">
          <input type="file" onChange={async (e) => { const p = e.target.files?.[0] && await upload(e.target.files[0]); if (p) setF({ ...f, file_path: p }); }} />
          {fileLink(f.file_path)}
        </div>
      </Field>
    </div>
  );
}

function SpecForm({ f, setF, brands }: any) {
  const [arts] = useList<any>('/manufacturing/master/artworks', { brand_id: f.brand_id || 0 });
  const t = (k: string) => ({ value: f[k] ?? '', onChange: (e: any) => setF({ ...f, [k]: e.target.value }) });
  const art = (k: string, type: string) => (
    <select className={inp} value={f[k] || ''} onChange={(e) => setF({ ...f, [k]: Number(e.target.value) || null })}>
      <option value="">—</option>{arts.filter((a) => a.applies_to === type && a.status !== 'INACTIVE' && a.status !== 'SUPERSEDED')
        .map((a) => <option key={a.id} value={a.id}>{a.code} r{a.revision} — {a.title} ({a.status})</option>)}
    </select>
  );
  const pick = (k: string, lk: string) => <ItemPicker value={f[k]} label={f[lk]} onPick={(p) => setF({ ...f, [k]: p?.id ?? null, [lk]: p?.name })} />;
  return (
    <div className="grid md:grid-cols-2 gap-3">
      <Field label="Spec code"><input className={inp} disabled={!!f.id} {...t('spec_code')} /></Field>
      <Field label="Brand / customer"><BrandSelect f={f} setF={(v: any) => setF({ ...v, tin_artwork_id: null, cap_artwork_id: null, label_artwork_id: null, carton_artwork_id: null })} brands={brands} /></Field>
      <Field label="Finished product"><ItemPicker value={f.product_id} label={f.product_name} onPick={(p) => setF({ ...f, product_id: p?.id ?? null, product_name: p?.name })} /></Field>
      <Field label="Customer's item code"><input className={inp} {...t('customer_item_code')} /></Field>
      <Field label="Tin size"><input className={inp} placeholder="e.g. 400 g / 73×110" {...t('tin_size')} /></Field>
      <Field label="Tin type"><input className={inp} placeholder="e.g. Round, easy-open" {...t('tin_type')} /></Field>
      <Field label="Cap type"><input className={inp} {...t('cap_type')} /></Field>
      <Field label="Cap colour"><input className={inp} {...t('cap_colour')} /></Field>
      <Field label="Printing colour"><input className={inp} {...t('printing_colour')} /></Field>
      <Field label="Units per carton"><input type="number" min={1} className={inp} {...t('units_per_carton')} /></Field>
      <Field label="Standard pack quantity"><input type="number" className={inp} {...t('std_pack_qty')} /></Field>
      <Field label="Effective from"><input type="date" className={inp} {...t('effective_from')} /></Field>
      <Field label="Tin artwork">{art('tin_artwork_id', 'TIN')}</Field>
      <Field label="Cap artwork">{art('cap_artwork_id', 'CAP')}</Field>
      <Field label="Label artwork">{art('label_artwork_id', 'LABEL')}</Field>
      <Field label="Carton artwork">{art('carton_artwork_id', 'CARTON')}</Field>
      <Field label="Printed tin item">{pick('printed_tin_item_id', 'printed_tin_name')}</Field>
      <Field label="Cap item">{pick('cap_item_id', 'cap_name')}</Field>
      <Field label="Label item">{pick('label_item_id', 'label_name')}</Field>
      <Field label="Carton item">{pick('carton_item_id', 'carton_name')}</Field>
      <Field label="Product specification" wide><textarea className={inp} rows={2} {...t('product_spec')} /></Field>
      <Field label="Packaging instructions" wide><textarea className={inp} rows={2} {...t('packaging_instructions')} /></Field>
      <Field label="Quality requirements" wide><textarea className={inp} rows={2} {...t('quality_requirements')} /></Field>
      <Field label="Reference photos" wide>
        <div className="flex flex-wrap items-center gap-2">
          {(f.photos || []).map((p: string) => (
            <span key={p} className="relative"><a href={p} target="_blank" rel="noreferrer"><img src={p} className="h-14 w-14 object-cover rounded border" /></a>
              <button type="button" className="absolute -top-1 -right-1 bg-white rounded-full text-rose-600 text-xs" onClick={() => setF({ ...f, photos: f.photos.filter((x: string) => x !== p) })}><i className="fas fa-times-circle" /></button></span>
          ))}
          <input type="file" accept="image/*" onChange={async (e) => { const p = e.target.files?.[0] && await upload(e.target.files[0]); if (p) setF({ ...f, photos: [...(f.photos || []), p] }); }} />
        </div>
      </Field>
    </div>
  );
}

// ── item units ────────────────────────────────────────────────────────────────
function ItemUnits() {
  const [pid, setPid] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [data, setData] = useState<any>(null);
  const [conv, setConv] = useState<any>({ qty: '', unit: '' });
  const [out, setOut] = useState<any>(null);
  useEffect(() => { setOut(null); if (pid) api.get(`/manufacturing/items/${pid}/units`).then((r) => setData(r.data)).catch(err); else setData(null); }, [pid]);
  const FLAGS = [['for_purchase', 'Purchase'], ['for_stock', 'Stock'], ['for_production', 'Production'], ['for_packing', 'Packing'], ['for_sales', 'Sales']];
  const upd = (i: number, k: string, v: any) => setData({ ...data, units: data.units.map((u: any, j: number) => j === i ? { ...u, [k]: v } : u) });
  const save = async () => {
    try { await api.put(`/manufacturing/items/${pid}/units`, data.units.map((u: any) => ({ ...u, factor: Number(u.factor) }))); toast.success('Units saved'); }
    catch (e) { err(e); }
  };
  const convert = () => api.get('/manufacturing/convert', { params: { product_id: pid, qty: conv.qty, unit: conv.unit || undefined } }).then((r) => setOut(r.data)).catch(err);
  return (
    <div className="space-y-4">
      <div className="max-w-md"><ItemPicker value={pid} label={name} onPick={(p) => { setPid(p?.id ?? null); setName(p?.name || ''); }} /></div>
      {data && <>
        <div className="text-sm text-slate-600">Base (stock) unit: <b>{data.item.unit}</b> · Units per carton (packaging master): <b>{data.item.units_per_carton}</b></div>
        <div className="bg-white border rounded-lg p-3 space-y-2">
          <div className="text-xs text-slate-500">1 <i>unit</i> = <i>factor</i> × {data.item.unit}. Example: 1 KG = 1000 GM, 1 BOX = 100 PCS.</div>
          {data.units.map((u: any, i: number) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <input className={`${inp} w-28`} placeholder="Unit" value={u.unit} onChange={(e) => upd(i, 'unit', e.target.value.toUpperCase())} />
              <span className="text-sm">=</span>
              <input type="number" className={`${inp} w-32`} placeholder="Factor" value={u.factor} onChange={(e) => upd(i, 'factor', e.target.value)} />
              <span className="text-sm text-slate-500">{data.item.unit}</span>
              {FLAGS.map(([k, l]) => <label key={k} className="text-xs flex items-center gap-1"><input type="checkbox" checked={!!u[k]} onChange={(e) => upd(i, k, e.target.checked)} />{l}</label>)}
              <button className="text-rose-600 text-sm" onClick={() => setData({ ...data, units: data.units.filter((_: any, j: number) => j !== i) })}><i className="fas fa-trash" /></button>
            </div>
          ))}
          <div className="flex gap-2 pt-2">
            <button className={btnSec} onClick={() => setData({ ...data, units: [...data.units, { unit: '', factor: '' }] })}><i className="fas fa-plus mr-1" />Add unit</button>
            <button className={btnPri} onClick={save}>Save units</button>
          </div>
        </div>
        <div className="bg-white border rounded-lg p-3 flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">Converter</span>
          <input type="number" className={`${inp} w-28`} placeholder="Qty" value={conv.qty} onChange={(e) => setConv({ ...conv, qty: e.target.value })} />
          <input className={`${inp} w-28`} placeholder={`Unit (${data.item.unit})`} value={conv.unit} onChange={(e) => setConv({ ...conv, unit: e.target.value.toUpperCase() })} />
          <button className={btnSec} onClick={convert}>Convert</button>
          {out && <span className="text-sm">= <b>{fmt(out.base_qty)} {out.base_unit}</b> → {out.cartons} carton(s) + {fmt(out.loose)} loose @ {out.units_per_carton}/carton</span>}
        </div>
      </>}
    </div>
  );
}

import { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import { manufacturingApi, type MfgBom, type MfgBomItem } from '../../api/manufacturing';
import { products_api, type product_search_item } from '../../api/products';
import api from '../../api/axios';
import Modal from '../../components/ui/Modal';

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  editingBom?: MfgBom | null;
}

export default function BomEditorModal({ open, onClose, onSuccess, editingBom }: Props) {
  const [bomNo, setBomNo] = useState('');
  const [bomName, setBomName] = useState('');
  const [productId, setProductId] = useState<number>(0);
  const [productName, setProductName] = useState('');
  const [batchSize, setBatchSize] = useState<number>(100);
  const [batchUnit, setBatchUnit] = useState<string>('PCS');
  const [expectedYieldPct, setExpectedYieldPct] = useState<number>(98);
  const [tolerancePct, setTolerancePct] = useState<number>(2);
  const [expectedWastagePct, setExpectedWastagePct] = useState<number>(2);
  const [laborCost, setLaborCost] = useState<number>(500);
  const [overheadCost, setOverheadCost] = useState<number>(300);
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<MfgBomItem[]>([]);

  // Search state for FG
  const [fgSearch, setFgSearch] = useState('');
  const [fgAll, setFgAll] = useState<any[]>([]);
  const [cust, setCust] = useState('');
  useEffect(() => { api.get('/manufacturing/fg-by-customer').then((r) => setFgAll(r.data)).catch(() => setFgAll([])); }, []);
  const custNames = Array.from(new Set(fgAll.map((x) => x.customer).filter(Boolean))).sort() as string[];
  const custItems = cust ? fgAll.filter((x) => (cust === '__none' ? !x.customer : x.customer === cust)) : [];
  const pickFg = (p: any) => { setProductId(p.id); setProductName(p.name); setBomName(`${p.name} Standard Recipe`); setBatchUnit(p.unit || 'PCS'); setFgSearch(''); setFgResults([]); };
  const [fgResults, setFgResults] = useState<product_search_item[]>([]);
  const [searchingFg, setSearchingFg] = useState(false);

  // Search state for Item Row
  const [fgHi, setFgHi] = useState(0);
  const arrows = (e: React.KeyboardEvent, hi: number, setHi: (n: number) => void, list: any[], pick: (p: any) => void) => {
    if (!list.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = Math.min(Math.max(hi + (e.key === 'ArrowDown' ? 1 : -1), 0), list.length - 1);
      setHi(n); e.currentTarget.parentElement?.querySelector(`[data-hi="${n}"]`)?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') { e.preventDefault(); pick(list[hi] ?? list[0]); }
  };
  const [sq, setSq] = useState({ RAW: '', PACK: '' });
  const [sr, setSr] = useState<{ RAW: product_search_item[]; PACK: product_search_item[] }>({ RAW: [], PACK: [] });
  const [shi, setShi] = useState({ RAW: 0, PACK: 0 });
  const searchMat = (kind: 'RAW' | 'PACK', q: string) => {
    setSq((v) => ({ ...v, [kind]: q }));
    if (q.trim().length < 2) return setSr((v) => ({ ...v, [kind]: [] }));
    products_api.search(q, 25).then((res) => {
      const ok = (x: any) => (kind === 'PACK' ? x.item_type === 'PM' : x.item_type !== 'FG' && x.item_type !== 'PM');
      setSr((v) => ({ ...v, [kind]: res.data.filter(ok) })); setShi((v) => ({ ...v, [kind]: 0 }));
    }).catch(() => setSr((v) => ({ ...v, [kind]: [] })));
  };

  useEffect(() => {
    if (editingBom) {
      setBomNo(editingBom.bom_no);
      setBomName(editingBom.bom_name);
      setProductId(editingBom.product_id);
      setProductName(editingBom.product_name || `Product #${editingBom.product_id}`);
      setBatchSize(Number(editingBom.batch_size));
      setBatchUnit(editingBom.batch_unit);
      setExpectedYieldPct(Number(editingBom.expected_yield_pct));
      setTolerancePct(Number(editingBom.tolerance_pct));
      setExpectedWastagePct(Number(editingBom.expected_wastage_pct));
      setLaborCost(Number(editingBom.labor_cost));
      setOverheadCost(Number(editingBom.overhead_cost));
      setNotes(editingBom.notes || '');
      setItems((editingBom.items || []).map((it: any) => ({
        ...it, quantity: Number(it.quantity || 0), wastage_pct: Number(it.wastage_pct || 0), cost_per_unit: Number(it.cost_per_unit || 0), total_cost: Number(it.total_cost || 0),
      })));
    } else {
      setBomNo('');
      setBomName('');
      setProductId(0);
      setProductName('');
      setBatchSize(100);
      setBatchUnit('PCS');
      setExpectedYieldPct(98);
      setTolerancePct(2);
      setExpectedWastagePct(2);
      setLaborCost(500);
      setOverheadCost(300);
      setNotes('');
      setItems([]);
    }
  }, [editingBom, open]);

  // Handle FG search
  useEffect(() => {
    if (fgSearch.trim().length >= 2) {
      setSearchingFg(true);
      products_api
        .search(fgSearch, 10)
        .then((res) => { setFgResults(res.data); setFgHi(0); })
        .catch(() => setFgResults([]))
        .finally(() => setSearchingFg(false));
    } else {
      setFgResults([]);
    }
  }, [fgSearch]);


  const addItemRow = (p: product_search_item, kind: 'RAW' | 'PACK') => {
    const isPack = kind === 'PACK';
    const _unused =
      (p as any).item_type === 'PM' ||
      (p as any).category?.toLowerCase().includes('pack') ||
      p.name?.toLowerCase().includes('pouch') ||
      p.name?.toLowerCase().includes('box') ||
      p.name?.toLowerCase().includes('carton');

    const newItem: MfgBomItem = {
      product_id: p.id,
      product_name: p.name,
      item_code: p.item_code || '',
      material_type: isPack ? 'PACKAGING' : 'RAW_MATERIAL',
      quantity: 1,
      unit: p.unit || (isPack ? 'PCS' : 'KG'),
      wastage_pct: 1.0,
      cost_per_unit: Number(p.cost_price || p.purchase_price || 100),
      total_cost: Number(p.cost_price || p.purchase_price || 100),
      is_critical: true,
      round_up: isPack,          // packing material is issued in whole units per order (21 cartons, not 20.83)
      stage: isPack ? 'Packaging' : 'Mixing',
      sequence: items.length + 1,
      needs_printing: !!(p as any).needs_printing,
    } as MfgBomItem;
    setItems((prev) => [...prev, newItem]);
    setSq((v) => ({ ...v, [kind]: '' }));
    setSr((v) => ({ ...v, [kind]: [] }));
  };

  const updateItem = (index: number, key: keyof MfgBomItem, val: any) => {
    setItems((prev) => {
      const copy = [...prev];
      const it = { ...copy[index], [key]: val };
      if (key === 'quantity' || key === 'cost_per_unit') {
        it.total_cost = Number(it.quantity || 0) * Number(it.cost_per_unit || 0);
      }
      copy[index] = it;
      return copy;
    });
  };

  const removeItem = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  const materialCost = items.reduce((acc, it) => acc + (it.total_cost || 0), 0);
  const totalStandardCost = materialCost + Number(laborCost || 0) + Number(overheadCost || 0);
  const costPerUnit = batchSize > 0 ? totalStandardCost / batchSize : 0;

  const handleSubmit = async () => {
    if (!productId) {
      toast.error('Please select a finished product');
      return;
    }
    if (!bomName.trim()) {
      toast.error('BOM Name is required');
      return;
    }
    if (items.length === 0) {
      toast.error('Please add at least one raw material or packaging item');
      return;
    }

    const bad = items.find((it) => !(Number(it.quantity) > 0));
    if (bad) { toast.error(`Enter a quantity greater than 0 for ${bad.product_name}`); return; }

    const payload = {
      bom_no: bomNo.trim() || undefined,
      bom_name: bomName.trim(),
      product_id: productId,
      batch_size: batchSize,
      batch_unit: batchUnit,
      expected_yield_pct: expectedYieldPct,
      tolerance_pct: tolerancePct,
      expected_wastage_pct: expectedWastagePct,
      labor_cost: laborCost,
      overhead_cost: overheadCost,
      notes: notes.trim() || undefined,
      items: items.map((it, idx) => ({
        product_id: it.product_id,
        material_type: it.material_type,
        quantity: it.quantity,
        unit: it.unit,
        wastage_pct: it.wastage_pct,
        cost_per_unit: it.cost_per_unit,
        is_critical: it.is_critical,
        round_up: !!(it as any).round_up,
        stage: it.stage,
        sequence: idx + 1,
      })),
    };

    try {
      if (editingBom) {
        await manufacturingApi.updateBom(editingBom.id, payload);
        toast.success('BOM updated successfully');
      } else {
        await manufacturingApi.createBom(payload);
        toast.success('BOM created successfully in Draft status');
      }
      onSuccess();
      onClose();
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Failed to save BOM');
    }
  };

  const ro = !!editingBom && !['DRAFT', 'REJECTED'].includes(editingBom.status);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editingBom ? `${ro ? 'BOM' : 'Edit BOM'}: ${editingBom.bom_no}` : 'Create Bill of Materials (BOM)'}
      width="full"
    >
      <div className="space-y-5 text-xs">
        {ro && <div className="px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 font-semibold">This BOM is {editingBom!.status.toLowerCase()} and is view only. To change it, close this and click Revise to make a new version.</div>}
        <fieldset disabled={ro} className="space-y-5 min-w-0">
        {/* Header Details */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
          <div className="md:col-span-2">
            <label className="block font-semibold text-slate-700 mb-1">
              Finished Product / Recipe SKU <span className="text-red-500">*</span>
            </label>
            {productId ? (
              <div className="flex items-center justify-between p-2 bg-indigo-50 border border-indigo-200 rounded-lg">
                <div>
                  <span className="font-bold text-indigo-900">{productName}</span>
                  <span className="text-[10px] text-indigo-600 block">Product ID: {productId}</span>
                </div>
                {!editingBom && (
                  <button
                    onClick={() => {
                      setProductId(0);
                      setProductName('');
                    }}
                    className="text-xs text-rose-600 hover:underline font-semibold"
                  >
                    Change
                  </button>
                )}
              </div>
            ) : (
              <div className="relative">
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <select value={cust} onChange={(e) => setCust(e.target.value)} className="px-2 py-1.5 border border-slate-300 rounded-lg">
                    <option value="">1. Select customer...</option>
                    {custNames.map((n) => <option key={n} value={n}>{n}</option>)}
                    <option value="__none">Own / no customer</option>
                  </select>
                  <select disabled={!cust} value="" onChange={(e) => { const p = custItems.find((x) => String(x.id) === e.target.value); if (p) pickFg(p); }} className="px-2 py-1.5 border border-slate-300 rounded-lg">
                    <option value="">{cust ? `2. Select item (${custItems.length})...` : '2. Select item...'}</option>
                    {custItems.map((x) => <option key={x.id} value={x.id}>{x.item_code} - {x.name}</option>)}
                  </select>
                </div>
                <input
                  type="text"
                  placeholder="...or type to search any finished product"
                  value={fgSearch}
                  onChange={(e) => setFgSearch(e.target.value)}
                  onKeyDown={(e) => arrows(e, fgHi, setFgHi, fgResults, pickFg)}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg focus:ring-1 focus:ring-indigo-500"
                />
                {searchingFg && (
                  <span className="absolute right-3 top-2 text-slate-400">
                    <i className="fas fa-spinner fa-spin" />
                  </span>
                )}
                {fgResults.length > 0 && (
                  <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {fgResults.map((p, i) => (
                      <div
                        key={p.id} data-hi={i}
                        onClick={() => {
                          setProductId(p.id);
                          setProductName(p.name);
                          setBomName(`${p.name} Standard Recipe`);
                          setBatchUnit(p.unit || 'PCS');
                          setFgSearch('');
                          setFgResults([]);
                        }}
                        className={`p-2 hover:bg-indigo-50 cursor-pointer border-b border-slate-100 flex items-center justify-between ${i === fgHi ? 'bg-indigo-100' : ''}`}
                      >
                        <div>
                          <div className="font-semibold text-slate-800">{p.name}</div>
                          <div className="text-[10px] text-slate-400 font-mono">{p.item_code}</div>
                        </div>
                        <span className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-600">
                          {p.unit}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              BOM Formula Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={bomName}
              onChange={(e) => setBomName(e.target.value)}
              placeholder="e.g., Granola 400g Production Formula"
              className="w-full px-3 py-1.5 border border-slate-300 rounded-lg focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Standard Batch Size</label>
            <div className="flex gap-2">
              <input
                type="number"
                min="0.1"
                step="any"
                value={batchSize}
                onChange={(e) => setBatchSize(Number(e.target.value))}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg focus:ring-1 focus:ring-indigo-500 font-mono"
              />
              <input
                type="text"
                value={batchUnit}
                onChange={(e) => setBatchUnit(e.target.value.toUpperCase())}
                placeholder="Unit"
                className="w-20 px-2 py-1.5 border border-slate-300 rounded-lg uppercase text-center font-bold"
              />
            </div>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Expected Yield (%)</label>
            <input
              type="number"
              min="1"
              max="100"
              step="0.1"
              value={expectedYieldPct}
              onChange={(e) => setExpectedYieldPct(Number(e.target.value))}
              className="w-full px-3 py-1.5 border border-slate-300 rounded-lg focus:ring-1 focus:ring-indigo-500 font-mono"
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Tolerance (± %)</label>
            <input
              type="number"
              min="0"
              max="20"
              step="0.1"
              value={tolerancePct}
              onChange={(e) => setTolerancePct(Number(e.target.value))}
              className="w-full px-3 py-1.5 border border-slate-300 rounded-lg focus:ring-1 focus:ring-indigo-500 font-mono"
            />
          </div>
        </div>

        {/* Formulation Material Table */}
        <div className="space-y-2">
          {(['RAW', 'PACK'] as const).map((kind) => {
            const pack = kind === 'PACK';
            const grp = items.map((it, idx) => ({ it, idx })).filter(({ it }) => (it.material_type === 'PACKAGING') === pack);
            const results = sr[kind];
            return (
              <div key={kind} className={`space-y-2 ${pack ? 'pt-3 border-t-2 border-slate-200' : ''}`}>
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-slate-800 text-xs flex items-center gap-2">
                    <i className={`fas ${pack ? 'fa-box text-amber-600' : 'fa-cubes text-indigo-600'}`} />
                    {pack ? 'Packing Material (tin, cap, label, carton...)' : 'Raw Material & Ingredients'}
                  </h3>
                  <span className="text-slate-500 font-medium">{grp.length} item{grp.length === 1 ? '' : 's'}</span>
                </div>
                {!ro && <div className="relative">
                  <input type="text" placeholder={pack ? 'Search Packing Material by name or SKU...' : 'Search Raw Material / Ingredient by name or SKU...'}
                    value={sq[kind]} onChange={(e) => searchMat(kind, e.target.value)}
                    onKeyDown={(e) => arrows(e, shi[kind], (n) => setShi((h) => ({ ...h, [kind]: n })), results, (x) => addItemRow(x, kind))}
                    className="w-full px-3 py-2 border border-indigo-200 bg-indigo-50/30 rounded-lg focus:ring-1 focus:ring-indigo-500 text-xs" />
                  {results.length > 0 && (
                    <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-xl max-h-48 overflow-y-auto">
                      {results.map((x, i) => (
                        <div key={x.id} data-hi={i} onClick={() => addItemRow(x, kind)}
                          className={`p-2 hover:bg-indigo-50 cursor-pointer border-b border-slate-100 flex items-center justify-between ${i === shi[kind] ? 'bg-indigo-100' : ''}`}>
                          <div><div className="font-semibold text-slate-800">{x.name}</div><div className="text-[10px] text-slate-400 font-mono">{x.item_code}</div></div>
                          <div className="text-right"><div className="text-[11px] font-bold text-slate-700">₹{x.cost_price || x.purchase_price}</div>
                            <span className="text-[10px] bg-slate-100 px-1 py-0.5 rounded text-slate-600 font-bold">{x.unit}</span></div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>}
          <div className="border border-slate-200 rounded-lg overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 text-slate-500 font-bold text-[10px] border-b border-slate-200">
                  <th className="p-2 w-8">#</th>
                  <th className="p-2">Material / SKU</th>
                  <th className="p-2 w-28">Type</th>
                  <th className="p-2 w-24 text-right">Qty / Batch</th>
                  <th className="p-2 w-16">Unit</th>
                  <th className="p-2 w-12 text-center" title="Round up to whole units per order (cartons, tins)">Whole</th>
                  <th className="p-2 w-20 text-right">Waste %</th>
                  <th className="p-2 w-24 text-right">Cost / Unit</th>
                  <th className="p-2 w-24 text-right">Total Cost</th>
                  <th className="p-2 w-24">Stage</th>
                  <th className="p-2 w-8 text-center"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {grp.length === 0 ? (
                  <tr><td colSpan={10} className="p-4 text-center text-slate-400">{pack ? 'No packing material added yet.' : 'No raw material added yet.'}</td></tr>
                ) : (
                  grp.map(({ it, idx }, n) => (
                    <tr key={idx} className="hover:bg-slate-50">
                      <td className="p-2 text-slate-400 font-mono">{n + 1}</td>
                      <td className="p-2">
                        <div className="font-semibold text-slate-800">{it.product_name}</div>
                        <div className="text-[10px] text-slate-400 font-mono">{it.item_code}{(it as any).needs_printing && <span className="ml-2 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-sans font-semibold"><i className="fas fa-print mr-1" />Printing item</span>}</div>
                      </td>
                      <td className="p-2">
                        <select
                          value={it.material_type}
                          onChange={(e) => updateItem(idx, 'material_type', e.target.value)}
                          className="w-full px-1 py-1 border border-slate-200 rounded text-[11px]"
                        >
                          {pack ? <option value="PACKAGING">Packaging</option> : <>
                            <option value="RAW_MATERIAL">Raw Material</option>
                            <option value="PREMIX">Premix</option>
                            <option value="CONSUMABLE">Consumable</option></>}
                        </select>
                      </td>
                      <td className="p-2 text-right">
                        <input
                          type="number"
                          step="any"
                          value={it.quantity}
                          onChange={(e) => updateItem(idx, 'quantity', Number(e.target.value))}
                          className="w-full px-1.5 py-1 border border-slate-200 rounded text-right font-mono"
                        />
                      </td>
                      <td className="p-2 font-bold text-slate-600">{it.unit}</td>
                      <td className="p-2 text-center"><input type="checkbox" checked={!!(it as any).round_up} title="Round up to whole units per order"
                        onChange={(e) => updateItem(idx, 'round_up' as any, e.target.checked as any)} /></td>
                      <td className="p-2 text-right">
                        <input
                          type="number"
                          step="0.1"
                          value={it.wastage_pct}
                          onChange={(e) => updateItem(idx, 'wastage_pct', Number(e.target.value))}
                          className="w-full px-1.5 py-1 border border-slate-200 rounded text-right font-mono"
                        />
                      </td>
                      <td className="p-2 text-right">
                        <input
                          type="number"
                          step="0.01"
                          value={it.cost_per_unit}
                          onChange={(e) => updateItem(idx, 'cost_per_unit', Number(e.target.value))}
                          className="w-full px-1.5 py-1 border border-slate-200 rounded text-right font-mono"
                        />
                      </td>
                      <td className="p-2 text-right font-bold font-mono text-slate-800">
                        ₹{Number(it.total_cost || 0).toFixed(2)}
                      </td>
                      <td className="p-2">
                        <input
                          type="text"
                          value={it.stage || ''}
                          onChange={(e) => updateItem(idx, 'stage', e.target.value)}
                          placeholder="e.g. Baking"
                          className="w-full px-1.5 py-1 border border-slate-200 rounded text-[11px]"
                        />
                      </td>
                      <td className="p-2 text-center">
                        {!ro && <button
                          onClick={() => removeItem(idx)}
                          className="text-slate-400 hover:text-rose-600 p-1"
                        >
                          <i className="fas fa-trash-alt" />
                        </button>}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
              </div>
            );
          })}
        </div>

        {/* Costing Summary & Notes */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-3 bg-slate-50 rounded-lg border border-slate-200">
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Standard Formulation Notes</label>
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Process instructions, critical control points, mixing times..."
              className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs"
            />
          </div>

          <div className="space-y-1.5 bg-white p-3 rounded-lg border border-slate-200">
            <div className="flex justify-between text-slate-600">
              <span>Raw & Packaging Material Cost:</span>
              <span className="font-mono font-bold">₹{materialCost.toFixed(2)}</span>
            </div>
            <div className="flex justify-between items-center text-slate-600">
              <span>Labor Cost:</span>
              <input
                type="number"
                value={laborCost}
                onChange={(e) => setLaborCost(Number(e.target.value))}
                className="w-24 px-1.5 py-0.5 border border-slate-200 rounded text-right font-mono"
              />
            </div>
            <div className="flex justify-between items-center text-slate-600">
              <span>Overhead Cost:</span>
              <input
                type="number"
                value={overheadCost}
                onChange={(e) => setOverheadCost(Number(e.target.value))}
                className="w-24 px-1.5 py-0.5 border border-slate-200 rounded text-right font-mono"
              />
            </div>
            <div className="border-t border-slate-200 pt-1.5 flex justify-between font-bold text-slate-800 text-sm">
              <span>Total Standard Batch Cost:</span>
              <span className="text-indigo-700 font-mono">₹{totalStandardCost.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-[11px] text-slate-500 font-medium">
              <span>Estimated Cost / {batchUnit}:</span>
              <span className="font-mono font-bold text-slate-700">₹{costPerUnit.toFixed(2)}</span>
            </div>
          </div>
        </div>

        </fieldset>
        {/* Footer Actions */}
        <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-slate-300 rounded-lg font-semibold text-slate-700 hover:bg-slate-100 transition"
          >
            {ro ? 'Close' : 'Cancel'}
          </button>
          {!ro && <button
            onClick={handleSubmit}
            className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold shadow-sm transition"
          >
            {editingBom ? 'Update BOM Formula' : 'Save BOM Formulation'}
          </button>}
        </div>
      </div>
    </Modal>
  );
}

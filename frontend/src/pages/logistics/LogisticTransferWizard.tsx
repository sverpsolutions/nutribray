import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { 
  Truck, Package, Box, User, Printer, CheckCircle, 
  ChevronRight, ChevronLeft, Search, Plus, Trash2, 
  AlertCircle, Barcode, QrCode, FileSearch, ShieldCheck, FileText
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { masters_api } from '../../api/masters';
import { products_api } from '../../api/products';
import { 
  createLogisticTransfer, getLogisticTransfer, updateLogisticItems, 
  createLogisticBox, updateDispatchDetails, confirmDispatch, markBoxPrinted,
  lookupSourceTransfers, getSourceTransferDetails
} from '../../api/logistic';
import BarcodeComponent from 'react-barcode';
import { QRCodeSVG } from 'qrcode.react';
import { LogisticPrintModal } from '../../components/logistics/LogisticPrintModal';

const STEPS = [
  { id: 1, title: 'Transfer Details', icon: Truck },
  { id: 2, title: 'Select Items', icon: Package },
  { id: 3, title: 'Pack Boxes', icon: Box },
  { id: 4, title: 'Vehicle & Driver', icon: User },
  { id: 5, title: 'Print Labels', icon: Printer },
  { id: 6, title: 'Dispatch', icon: CheckCircle },
];

const LogisticTransferWizard = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [transfer, setTransfer] = useState<any>(null);
  const [printModalOpen, setPrintModalOpen] = useState(false);
  const [printModalTab, setPrintModalTab] = useState<'challan' | 'labels' | 'gatepass'>('challan');

  const openPrintModal = (tab: 'challan' | 'labels' | 'gatepass' = 'challan') => {
    setPrintModalTab(tab);
    setPrintModalOpen(true);
  };
  
  // Form States
  const [outlets, setOutlets] = useState<any[]>([]);
  const [sourceId, setSourceId] = useState('');
  const [destId, setDestId] = useState('');
  const [priority, setPriority] = useState('Normal');
  const [notes, setNotes] = useState('');
  const [sourceTransferId, setSourceTransferId] = useState<number | null>(null);
  const [sourceTransferSearch, setSourceTransferSearch] = useState('');
  const [sourceTransferResults, setSourceTransferResults] = useState<any[]>([]);

  // Step 2 State
  const [selectedItems, setSelectedItems] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [highlighted, setHighlighted] = useState(0);
  // scoped to this wizard: other open tabs keep their own copy mounted
  const itemsRef = useRef<HTMLDivElement>(null);
  const focusQty = (productId: number) => setTimeout(() => {
    const el = itemsRef.current?.querySelector<HTMLInputElement>(`[data-qty="${productId}"]`);
    el?.focus(); el?.select();
  }, 0);
  const focusSearch = () => itemsRef.current?.querySelector<HTMLInputElement>('[data-item-search]')?.focus();

  // Step 3 State
  const [boxes, setBoxes] = useState<any[]>([]);
  const [currentBox, setCurrentBox] = useState<any>({
    box_number: '',
    weight_kg: '',
    length_cm: '',
    width_cm: '',
    height_cm: '',
    seal_number: '',
    box_type: 'Cardboard',
    items: []
  });

  // Step 4 State
  const [dispatchInfo, setDispatchInfo] = useState({
    vehicle_reg_no: '',
    vehicle_type: '',
    gps_tracking_id: '',
    eta: '',
    driver_name: '',
    driver_mobile: '',
    driver_license_no: '',
    helper_name: ''
  });

  useEffect(() => {
    fetchOutlets();
    if (id) {
      loadTransfer(parseInt(id));
    }
  }, [id]);

  const fetchOutlets = async () => {
    try {
      const res = await masters_api.get_outlets();
      setOutlets(res.data || []);
    } catch (err) {
      toast.error('Failed to load outlets');
    }
  };

  const loadTransfer = async (transferId: number) => {
    setLoading(true);
    try {
      const res = await getLogisticTransfer(transferId);
      setTransfer(res);
      setSourceId(res.source_location_id.toString());
      setDestId(res.destination_location_id.toString());
      setPriority(res.priority);
      setNotes(res.notes || '');
      setSourceTransferId(res.source_transfer_id);
      setSelectedItems((res.items || []).map((i: any) => ({ ...i, quantity: parseFloat(i.quantity) })));
      setBoxes(res.boxes || []);
      if (res.dispatch_details) {
        setDispatchInfo(res.dispatch_details);
      }
      
      // Determine step based on status
      // DRAFT: header is already saved, resume at item selection
      if (res.status === 'DRAFT') setCurrentStep(2);
      else if (res.status === 'PACKING') setCurrentStep(3);
      else if (res.status === 'PACKED') setCurrentStep(4);
      else if (res.status === 'DISPATCHED') setCurrentStep(6);
    } catch (err) {
      toast.error('Failed to load transfer');
    } finally {
      setLoading(false);
    }
  };

  const handleSourceTransferSearch = async (q: string) => {
    setSourceTransferSearch(q);
    if (q.length < 3) return setSourceTransferResults([]);
    try {
      const res = await lookupSourceTransfers(q);
      setSourceTransferResults(res || []);
    } catch (err) {}
  };

  const selectSourceTransfer = async (trf: any) => {
    setLoading(true);
    try {
      const details = await getSourceTransferDetails(trf.id);
      setSourceId(details.from_outlet_id.toString());
      setDestId(details.to_outlet_id.toString());
      setNotes(details.remarks || '');
      setSourceTransferId(details.id);
      setSourceTransferSearch(details.transfer_no);
      setSourceTransferResults([]);
      
      // Map items for step 2
      setSelectedItems(details.items.map((i: any) => ({
        ...i,
        quantity: parseFloat(i.quantity)
      })));
      
      toast.success(`Loaded items from ${details.transfer_no}`);
    } catch (err) {
      toast.error('Failed to load transfer details');
    } finally {
      setLoading(false);
    }
  };

  const handleNext = async () => {
    if (currentStep === 1) {
      if (!sourceId || !destId) return toast.error('Please select locations');
      // Already created (reopened or came Back): don't create a duplicate
      if (transfer) return setCurrentStep(2);
      setLoading(true);
      try {
        const data = {
          source_location_id: parseInt(sourceId),
          destination_location_id: parseInt(destId),
          priority,
          notes,
          source_transfer_id: sourceTransferId,
          items: selectedItems // Pass pre-filled items
        };
        const res = await createLogisticTransfer(data);
        setTransfer(res);
        navigate(`/logistics/transfer/${res.id}`);
        setCurrentStep(2);
      } catch (err) {
        toast.error('Failed to create transfer');
      } finally {
        setLoading(false);
      }
    } else if (currentStep === 2) {
      if (selectedItems.length === 0) return toast.error('Please select at least one item');
      setLoading(true);
      try {
        await updateLogisticItems(transfer.id, selectedItems.map(i => ({ 
          product_id: i.product_id || i.id, 
          quantity: i.quantity 
        })));
        setCurrentStep(3);
      } catch (err) {
        toast.error('Failed to update items');
      } finally {
        setLoading(false);
      }
    } else if (currentStep === 3) {
      if (boxes.length === 0) return toast.error('Please pack at least one box');
      setCurrentStep(4);
    } else if (currentStep === 4) {
      if (!dispatchInfo.vehicle_reg_no || !dispatchInfo.driver_name) return toast.error('Please fill vehicle and driver details');
      setLoading(true);
      try {
        await updateDispatchDetails(transfer.id, dispatchInfo);
        setCurrentStep(5);
      } catch (err) {
        toast.error('Failed to update dispatch details');
      } finally {
        setLoading(false);
      }
    } else if (currentStep === 5) {
      setCurrentStep(6);
    }
  };

  const handleBack = () => {
    if (currentStep > 1) setCurrentStep(currentStep - 1);
  };

  // --- Step 2 Helpers ---
  // query the visible results belong to; keystroke responses can arrive out of order
  const latestQuery = useRef('');
  const resultsFor = useRef('');
  const fetchItems = (q: string) => products_api.search(q, 20, sourceId ? parseInt(sourceId) : undefined).then(r => r.data || []);
  const searchItems = async (q: string) => {
    latestQuery.current = q;
    if (q.length < 2) { resultsFor.current = ''; return setSearchResults([]); }
    try {
      const data = await fetchItems(q);
      if (latestQuery.current !== q) return;  // stale
      resultsFor.current = q;
      setSearchResults(data);
      setHighlighted(0);
    } catch (err) {}
  };

  const addItem = (product: any) => {
    latestQuery.current = '';  // drop any search still in flight
    resultsFor.current = '';
    setSearchResults([]);
    setSearchQuery('');
    // scanning an item already in the list just jumps to its qty
    if (!selectedItems.some(i => i.product_id === product.id)) {
      setSelectedItems([...selectedItems, { ...product, product_id: product.id, quantity: 1 }]);
    }
    focusQty(product.id);
  };

  const removeItem = (id: number) => {
    setSelectedItems(selectedItems.filter(i => i.id !== id && i.product_id !== id));
  };

  // --- Step 3 Helpers ---
  const addBox = async () => {
    if (!currentBox.box_number) return toast.error('Box number is required');
    if (currentBox.items.length === 0) return toast.error('Box cannot be empty');
    
    setLoading(true);
    try {
      const res = await createLogisticBox(transfer.id, currentBox);
      setBoxes([...boxes, res]);
      setCurrentBox({
        box_number: '',
        weight_kg: '',
        length_cm: '',
        width_cm: '',
        height_cm: '',
        seal_number: '',
        box_type: 'Cardboard',
        items: []
      });
      toast.success('Box created');
    } catch (err) {
      toast.error('Failed to create box');
    } finally {
      setLoading(false);
    }
  };

  const handleDispatchConfirm = async () => {
    setLoading(true);
    try {
      await confirmDispatch(transfer.id);
      toast.success('Transfer Dispatched Successfully!');
      loadTransfer(transfer.id);
    } catch (err) {
      toast.error('Dispatch confirmation failed');
    } finally {
      setLoading(false);
    }
  };

  // --- Renderers ---
  const renderStepHeader = () => (
    <div className="flex justify-between items-center bg-white p-6 border-b border-slate-200 no-print">
      <div className="flex gap-4">
        {STEPS.map((step) => {
          const Icon = step.icon;
          const isActive = currentStep === step.id;
          const isCompleted = currentStep > step.id;
          // Step is clickable if transfer is already saved/loaded, or if step is <= currentStep or if boxes already exist
          const isClickable = Boolean(id || transfer?.id || step.id <= Math.max(currentStep, boxes.length ? 5 : 2));

          return (
            <button
              key={step.id}
              type="button"
              disabled={!isClickable}
              onClick={() => {
                if (isClickable) setCurrentStep(step.id);
              }}
              title={isClickable ? `Jump to Step ${step.id}: ${step.title}` : `Complete previous steps to unlock`}
              className={`flex flex-col items-center gap-2 group transition-all text-center focus:outline-none ${
                isClickable ? 'cursor-pointer hover:opacity-90' : 'cursor-not-allowed opacity-50'
              }`}
            >
              <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
                isActive ? 'bg-primary text-white scale-110 shadow-lg ring-4 ring-primary/20' : 
                isCompleted ? 'bg-green-500 text-white group-hover:scale-105' : 'bg-slate-100 text-slate-400 group-hover:bg-slate-200'
              }`}>
                {isCompleted ? <CheckCircle size={20} /> : <Icon size={20} />}
              </div>
              <span className={`text-[10px] font-bold uppercase tracking-wider transition-colors ${
                isActive ? 'text-primary font-black' : isCompleted ? 'text-slate-700' : 'text-slate-400'
              }`}>
                {step.title}
              </span>
            </button>
          );
        })}
      </div>
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-slate-800">Logistic Transfer</h1>
          {transfer?.status && (
            <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
              transfer.status === 'DISPATCHED' ? 'bg-emerald-100 text-emerald-700 border border-emerald-300' :
              transfer.status === 'DELIVERED' ? 'bg-green-100 text-green-700' :
              transfer.status === 'PACKED' ? 'bg-indigo-100 text-indigo-700' :
              'bg-blue-100 text-blue-700'
            }`}>
              {transfer.status}
            </span>
          )}
        </div>
        <p className="text-slate-500 text-xs mt-0.5">
          {transfer?.transfer_number ? <span className="font-mono font-bold text-slate-700 mr-2">{transfer.transfer_number}</span> : null}
          Step {currentStep} of 6 — {STEPS[currentStep-1].title}
        </p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {renderStepHeader()}

      <div className="flex-1 overflow-auto p-8 max-w-5xl mx-auto w-full">
        {currentStep === 1 && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8">
            <h2 className="text-lg font-bold mb-6 flex items-center gap-2">
              <Truck className="text-primary" /> Transfer Details
            </h2>
            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className="form-label">Source Warehouse</label>
                <select className="form-input" value={sourceId} onChange={e => setSourceId(e.target.value)}>
                  <option value="">Select Source</option>
                  {outlets.map(o => <option key={o.id} value={o.id}>{o.outlet_name}</option>)}
                </select>
              </div>
              <div>
                <label className="form-label">Destination Outlet</label>
                <select className="form-input" value={destId} onChange={e => setDestId(e.target.value)}>
                  <option value="">Select Destination</option>
                  {outlets.map(o => <option key={o.id} value={o.id}>{o.outlet_name}</option>)}
                </select>
              </div>
              <div>
                <label className="form-label">Priority Level</label>
                <select className="form-input" value={priority} onChange={e => setPriority(e.target.value)}>
                  <option value="Normal">Normal</option>
                  <option value="Urgent">Urgent</option>
                  <option value="Express">Express</option>
                </select>
              </div>
              <div>
                <label className="form-label">Transfer Date</label>
                <input type="date" className="form-input" defaultValue={new Date().toISOString().split('T')[0]} />
              </div>
              <div className="col-span-2">
                <label className="form-label">Internal Notes</label>
                <textarea className="form-input h-24" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Add any specific instructions for logistics team..." />
              </div>
              
              <div className="col-span-2 mt-4 bg-primary/5 p-6 rounded-xl border border-primary/10">
                <h3 className="text-sm font-bold text-primary mb-4 flex items-center gap-2">
                  <FileSearch size={18} /> Link to Existing Transfer Out (Optional)
                </h3>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Search size={16} className="text-slate-400" />
                  </div>
                  <input 
                    type="text" 
                    className="form-input pl-10 h-11" 
                    placeholder="Search Transfer Out Number (e.g. TRF-2026-0001)..."
                    value={sourceTransferSearch}
                    onChange={e => handleSourceTransferSearch(e.target.value)}
                  />
                  
                  {sourceTransferResults.length > 0 && (
                    <div className="absolute z-20 w-full bg-white mt-1 rounded-lg shadow-xl border border-slate-200 max-h-48 overflow-auto">
                      {sourceTransferResults.map(trf => (
                        <button 
                          key={trf.id}
                          onClick={() => selectSourceTransfer(trf)}
                          className="w-full text-left px-4 py-3 hover:bg-slate-50 flex justify-between items-center border-b border-slate-100 last:border-0"
                        >
                          <div>
                            <div className="font-bold text-slate-800">{trf.transfer_no}</div>
                            <div className="text-[10px] text-slate-400">Date: {trf.transfer_date}</div>
                          </div>
                          <ChevronRight size={16} className="text-primary" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <p className="text-[10px] text-slate-500 mt-2 italic">Selecting an existing transfer will automatically fill locations and items.</p>
              </div>
            </div>
          </div>
        )}

        {currentStep === 2 && (
          <div ref={itemsRef} className="bg-white rounded-xl shadow-sm border border-slate-200 p-8">
            <h2 className="text-lg font-bold mb-6 flex items-center gap-2">
              <Package className="text-primary" /> Select Items
            </h2>
            
            <div className="relative mb-6">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search size={18} className="text-slate-400" />
              </div>
              <input 
                type="text" 
                className="form-input pl-10 h-12 text-base" 
                placeholder="Search items by name, SKU or scan barcode..."
                value={searchQuery}
                onChange={e => {
                  setSearchQuery(e.target.value);
                  searchItems(e.target.value);
                }}
                data-item-search
                onKeyDown={async e => {
                  // scanner sends barcode + Enter faster than the debounced search returns
                  // read the DOM value: a scanner's Enter can arrive before state re-renders
                  const typed = e.currentTarget.value;
                  if (e.key === 'Enter' && typed.trim() && resultsFor.current !== typed) {
                    e.preventDefault();
                    const q = typed;
                    latestQuery.current = q;
                    let data: any[];
                    try { data = await fetchItems(q.trim()); } catch { return toast.error('Item search failed'); }
                    if (latestQuery.current !== q) return;
                    if (data.length) addItem(data[0]); else toast.error('Item not found');
                    return;
                  }
                  if (!searchResults.length) return;
                  if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted(h => Math.min(h + 1, searchResults.length - 1)); }
                  else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlighted(h => Math.max(h - 1, 0)); }
                  else if (e.key === 'Enter') { e.preventDefault(); addItem(searchResults[highlighted]); }
                  else if (e.key === 'Escape') setSearchResults([]);
                }}
              />
              
              {searchResults.length > 0 && (
                <div className="absolute z-10 w-full bg-white mt-1 rounded-lg shadow-xl border border-slate-200 max-h-60 overflow-auto">
                  {searchResults.map((p, idx) => (
                    <button 
                      key={p.id}
                      ref={el => { if (idx === highlighted) el?.scrollIntoView({ block: 'nearest' }); }}
                      onClick={() => addItem(p)}
                      onMouseEnter={() => setHighlighted(idx)}
                      className={`w-full text-left px-4 py-2.5 flex items-center gap-4 border-b border-slate-100 last:border-0 ${idx === highlighted ? 'bg-primary-light' : 'hover:bg-slate-50'}`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-slate-800 truncate">{p.name}</div>
                        <div className="text-[11px] text-slate-500 font-mono">{p.item_code} · {p.barcode}</div>
                      </div>
                      <div className="grid grid-cols-3 gap-4 text-right text-[12px] font-mono shrink-0 w-[260px]">
                        <div><div className="text-[10px] text-slate-400 font-sans">Stock</div><span className={Number(p.stock_qty) > 0 ? 'text-emerald-700 font-semibold' : 'text-red-600'}>{p.stock_qty != null ? Number(p.stock_qty) : '—'}</span></div>
                        <div><div className="text-[10px] text-slate-400 font-sans">MRP</div>₹{Number(p.mrp || 0).toFixed(2)}</div>
                        <div><div className="text-[10px] text-slate-400 font-sans">SP</div>₹{Number(p.selling_price || 0).toFixed(2)}</div>
                      </div>
                      <div className="text-primary"><Plus size={18} /></div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <table className="ent-table rounded-lg overflow-hidden border border-slate-200">
              <thead>
                <tr>
                  <th>Product Details</th>
                  <th className="text-right">Stock</th>
                  <th className="text-right">MRP</th>
                  <th className="text-right">SP</th>
                  <th>Quantity</th>
                  <th className="w-20">Action</th>
                </tr>
              </thead>
              <tbody>
                {selectedItems.map(item => (
                  <tr key={item.id || item.product_id}>
                    <td>
                      <div className="font-bold">{item.name}</div>
                      <div className="text-[10px] text-slate-400 font-mono">{item.item_code}</div>
                      {item.batch_no && (
                        <div className="mt-1">
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono bg-amber-50 text-amber-850 border border-amber-300 font-medium">
                            Batch: {item.batch_no} {item.expiry_date ? `(Exp: ${item.expiry_date})` : ''}
                          </span>
                        </div>
                      )}
                    </td>
                    <td className="text-right font-mono">{item.stock_qty != null ? Number(item.stock_qty) : '—'}</td>
                    <td className="text-right font-mono">{item.mrp != null ? `₹${Number(item.mrp).toFixed(2)}` : '—'}</td>
                    <td className="text-right font-mono">{item.selling_price != null ? `₹${Number(item.selling_price).toFixed(2)}` : '—'}</td>
                    <td>
                      <input 
                        type="number" 
                        className="form-input w-24" 
                        data-qty={item.product_id}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); focusSearch(); } }}
                        value={item.quantity} 
                        onChange={e => {
                          const val = parseFloat(e.target.value);
                          setSelectedItems(selectedItems.map(i => (i.id === item.id || i.product_id === item.product_id) ? { ...i, quantity: val } : i));
                        }}
                      />
                    </td>
                    <td className="text-center">
                      <button onClick={() => removeItem(item.id || item.product_id)} className="text-red-500 hover:text-red-700">
                        <Trash2 size={18} />
                      </button>
                    </td>
                  </tr>
                ))}
                {selectedItems.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center py-12 text-slate-400">
                      <Package size={48} className="mx-auto mb-4 opacity-20" />
                      No items selected yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {currentStep === 3 && (
          <div className="grid grid-cols-3 gap-8">
            <div className="col-span-1 bg-white rounded-xl shadow-sm border border-slate-200 p-6 h-fit sticky top-8">
              <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
                <Box className="text-primary" /> Create Box
              </h2>
              <div className="space-y-4">
                <div>
                  <label className="form-label">Box Number / ID</label>
                  <input type="text" className="form-input" placeholder="e.g. BOX-001" value={currentBox.box_number} onChange={e => setCurrentBox({...currentBox, box_number: e.target.value})} />
                </div>
                <div>
                  <label className="form-label">Weight (KG)</label>
                  <input type="number" className="form-input" placeholder="0.00" value={currentBox.weight_kg} onChange={e => setCurrentBox({...currentBox, weight_kg: e.target.value})} />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="form-label">L (cm)</label>
                    <input type="number" className="form-input" value={currentBox.length_cm} onChange={e => setCurrentBox({...currentBox, length_cm: e.target.value})} />
                  </div>
                  <div>
                    <label className="form-label">W (cm)</label>
                    <input type="number" className="form-input" value={currentBox.width_cm} onChange={e => setCurrentBox({...currentBox, width_cm: e.target.value})} />
                  </div>
                  <div>
                    <label className="form-label">H (cm)</label>
                    <input type="number" className="form-input" value={currentBox.height_cm} onChange={e => setCurrentBox({...currentBox, height_cm: e.target.value})} />
                  </div>
                </div>
                <div>
                  <label className="form-label">Seal Number</label>
                  <input type="text" className="form-input" value={currentBox.seal_number} onChange={e => setCurrentBox({...currentBox, seal_number: e.target.value})} />
                </div>
                <div>
                  <label className="form-label">Box Type</label>
                  <select className="form-input" value={currentBox.box_type} onChange={e => setCurrentBox({...currentBox, box_type: e.target.value})}>
                    <option value="Cardboard">Cardboard Box</option>
                    <option value="Wooden Crate">Wooden Crate</option>
                    <option value="Plastic Bin">Plastic Bin</option>
                    <option value="Pallet">Pallet</option>
                  </select>
                </div>
                <div className="pt-4">
                  <h3 className="text-xs font-bold uppercase mb-2">Assign Items to this Box</h3>
                  <div className="max-h-40 overflow-auto border rounded-lg p-2 bg-slate-50">
                    {selectedItems.map(item => {
                      const packedQty = boxes.reduce((sum, b) => sum + (b.items.find((i: any) => i.product_id === (item.product_id || item.id))?.quantity || 0), 0);
                      const remaining = item.quantity - packedQty;
                      const inCurrent = currentBox.items.find((i: any) => i.product_id === (item.product_id || item.id))?.quantity || 0;
                      
                      return (
                        <div key={item.id || item.product_id} className="flex items-center justify-between py-2 border-b last:border-0">
                          <div className="flex-1 min-w-0">
                            <div className="text-[11px] font-bold truncate">{item.name}</div>
                            <div className="text-[10px] text-slate-400">Rem: {remaining} {item.unit}</div>
                          </div>
                          <input 
                            type="number" 
                            className="form-input w-16 h-7 text-[11px] p-1" 
                            max={remaining + inCurrent}
                            min={0}
                            value={inCurrent || ''}
                            onChange={e => {
                              const val = parseFloat(e.target.value) || 0;
                              if (val > (remaining + inCurrent)) return;
                              const newItems = [...currentBox.items];
                              const idx = newItems.findIndex((i: any) => i.product_id === (item.product_id || item.id));
                              if (idx >= 0) {
                                if (val === 0) newItems.splice(idx, 1);
                                else newItems[idx].quantity = val;
                              } else if (val > 0) {
                                newItems.push({ product_id: item.product_id || item.id, name: item.name, quantity: val });
                              }
                              setCurrentBox({ ...currentBox, items: newItems });
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
                <button onClick={addBox} className="btn btn-primary w-full h-10 mt-2">
                  <Plus size={16} /> Save Box
                </button>
              </div>
            </div>

            <div className="col-span-2 space-y-4">
              <h2 className="text-lg font-bold flex items-center gap-2">
                Packed Boxes ({boxes.length})
              </h2>
              {boxes.length === 0 && (
                <div className="bg-white rounded-xl border-2 border-dashed border-slate-200 p-12 text-center text-slate-400">
                  No boxes created yet. Use the form on the left to start packing.
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                {boxes.map((box, idx) => (
                  <div key={idx} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="bg-slate-800 p-3 flex justify-between items-center">
                      <span className="text-white font-bold text-sm">#{box.box_number}</span>
                      <span className="bg-primary/20 text-primary text-[10px] px-2 py-0.5 rounded uppercase font-bold">{box.box_type}</span>
                    </div>
                    <div className="p-4">
                      <div className="grid grid-cols-2 text-[10px] text-slate-500 mb-3 uppercase tracking-wider font-bold">
                        <div>Weight: <span className="text-slate-800">{box.weight_kg} KG</span></div>
                        <div>Seal: <span className="text-slate-800">{box.seal_number || 'N/A'}</span></div>
                      </div>
                      <div className="bg-slate-50 rounded-lg p-2">
                        <table className="w-full text-[11px]">
                          <tbody>
                            {box.items.map((item: any, iidx: number) => (
                              <tr key={iidx} className="border-b last:border-0">
                                <td className="py-1">{item.name || 'Product'}</td>
                                <td className="py-1 text-right font-bold">{item.quantity}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {currentStep === 4 && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8">
            <h2 className="text-lg font-bold mb-6 flex items-center gap-2">
              <User className="text-primary" /> Vehicle & Driver Details
            </h2>
            <div className="grid grid-cols-2 gap-8">
              <div className="space-y-4">
                <h3 className="text-sm font-bold uppercase text-slate-400 border-b pb-2">Vehicle Information</h3>
                <div>
                  <label className="form-label">Registration Number</label>
                  <input type="text" className="form-input" placeholder="DL 01 AB 1234" value={dispatchInfo.vehicle_reg_no} onChange={e => setDispatchInfo({...dispatchInfo, vehicle_reg_no: e.target.value})} />
                </div>
                <div>
                  <label className="form-label">Vehicle Type</label>
                  <input type="text" className="form-input" placeholder="Tata Ace / Eicher 14ft / etc." value={dispatchInfo.vehicle_type} onChange={e => setDispatchInfo({...dispatchInfo, vehicle_type: e.target.value})} />
                </div>
                <div>
                  <label className="form-label">GPS Tracking ID</label>
                  <input type="text" className="form-input" placeholder="SIM/Device ID" value={dispatchInfo.gps_tracking_id} onChange={e => setDispatchInfo({...dispatchInfo, gps_tracking_id: e.target.value})} />
                </div>
                <div>
                  <label className="form-label">Estimated Time of Arrival (ETA)</label>
                  <input type="datetime-local" className="form-input" value={dispatchInfo.eta} onChange={e => setDispatchInfo({...dispatchInfo, eta: e.target.value})} />
                </div>
              </div>
              <div className="space-y-4">
                <h3 className="text-sm font-bold uppercase text-slate-400 border-b pb-2">Driver & Helper</h3>
                <div>
                  <label className="form-label">Driver Full Name</label>
                  <input type="text" className="form-input" value={dispatchInfo.driver_name} onChange={e => setDispatchInfo({...dispatchInfo, driver_name: e.target.value})} />
                </div>
                <div>
                  <label className="form-label">Driver Mobile</label>
                  <input type="text" className="form-input" value={dispatchInfo.driver_mobile} onChange={e => setDispatchInfo({...dispatchInfo, driver_mobile: e.target.value})} />
                </div>
                <div>
                  <label className="form-label">Driving License No.</label>
                  <input type="text" className="form-input" value={dispatchInfo.driver_license_no} onChange={e => setDispatchInfo({...dispatchInfo, driver_license_no: e.target.value})} />
                </div>
                <div>
                  <label className="form-label">Helper Name (Optional)</label>
                  <input type="text" className="form-input" value={dispatchInfo.helper_name} onChange={e => setDispatchInfo({...dispatchInfo, helper_name: e.target.value})} />
                </div>
              </div>
            </div>
          </div>
        )}

        {currentStep === 5 && (
          <div className="space-y-6">
            <div className="flex justify-between items-center bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
              <div>
                <h2 className="text-lg font-bold flex items-center gap-2 text-slate-900">
                  <Printer className="text-primary" /> Print Box & Shipping Labels
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Total {boxes.length} packed carton(s) ready with barcodes and QR codes
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button 
                  onClick={() => openPrintModal('labels')} 
                  className="btn btn-secondary text-xs h-10 px-4 flex items-center gap-1.5"
                >
                  <Box size={15} /> Label Print Center
                </button>
                <button 
                  onClick={() => openPrintModal('challan')} 
                  className="btn btn-secondary text-xs h-10 px-4 flex items-center gap-1.5"
                >
                  <FileText size={15} /> Delivery Challan
                </button>
                <button 
                  onClick={() => openPrintModal('labels')} 
                  className="btn btn-primary text-xs h-10 px-5 flex items-center gap-1.5 shadow-sm"
                >
                  <Printer size={15} /> Print All Labels
                </button>
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-6">
              {boxes.map((box, idx) => (
                <div key={idx} className="bg-white p-6 border border-slate-200 rounded-xl flex gap-6 label-print-area shadow-2xs">
                  <div className="flex-1">
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <h4 className="text-[10px] uppercase font-bold text-slate-400">Box ID</h4>
                        <p className="text-xl font-black text-slate-900 font-mono">{box.box_number}</p>
                      </div>
                      <div className="text-right">
                        <h4 className="text-[10px] uppercase font-bold text-slate-400">Transfer ID</h4>
                        <p className="text-xs font-bold text-slate-700 font-mono">{transfer?.transfer_number}</p>
                      </div>
                    </div>
                    
                    <div className="space-y-2 mb-4">
                      <div className="flex justify-between text-[10px]">
                        <span className="text-slate-400 uppercase font-bold">From:</span>
                        <span className="font-bold text-slate-800">{outlets.find(o => o.id.toString() === sourceId)?.outlet_name}</span>
                      </div>
                      <div className="flex justify-between text-[10px]">
                        <span className="text-slate-400 uppercase font-bold">To:</span>
                        <span className="font-bold text-primary">{outlets.find(o => o.id.toString() === destId)?.outlet_name}</span>
                      </div>
                      <div className="flex justify-between text-[10px]">
                        <span className="text-slate-400 uppercase font-bold">Weight:</span>
                        <span className="font-bold text-slate-900">{box.weight_kg ? `${box.weight_kg} KG` : 'N/A'}</span>
                      </div>
                    </div>

                    <div className="border-t border-slate-100 pt-2 mt-2">
                      <div className="flex justify-between items-center">
                        <span className="text-[9px] uppercase text-slate-400 font-bold">Seal Number:</span>
                        <span className="text-[10px] font-bold font-mono text-slate-800">{box.seal_number || 'N/A'}</span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="w-32 flex flex-col items-center gap-3 justify-center border-l border-slate-100 pl-6">
                    <QRCodeSVG value={`${transfer?.transfer_number}-${box.box_number}`} size={64} />
                    <div className="scale-[0.6] origin-top">
                      <BarcodeComponent value={box.box_number} height={40} fontSize={14} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {currentStep === 6 && (
          <div className="space-y-8">
            {/* Dispatch Status Header */}
            {transfer?.status === 'DISPATCHED' ? (
              <div className="bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-700 rounded-2xl p-6 text-white shadow-xl flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-md flex items-center justify-center shrink-0 shadow-inner">
                    <CheckCircle className="text-white" size={32} />
                  </div>
                  <div>
                    <span className="text-xs font-black uppercase tracking-widest px-2.5 py-0.5 rounded-full bg-white/20 text-white inline-block mb-1">
                      Shipment Dispatched
                    </span>
                    <h2 className="text-2xl font-black tracking-tight">
                      Transfer Ref: {transfer?.transfer_number}
                    </h2>
                    <p className="text-emerald-100 text-xs mt-0.5">
                      This shipment has been confirmed and dispatched. Delivery Challan, Box Labels, and Gate Pass are ready below for printing.
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => navigate('/logistics/list')}
                  className="px-5 py-2.5 bg-white text-emerald-800 hover:bg-emerald-50 font-bold rounded-xl text-xs transition-all shadow-md shrink-0"
                >
                  Back to Shipments List
                </button>
              </div>
            ) : (
              <div className="bg-green-50 border border-green-200 rounded-xl p-6 text-center">
                <CheckCircle className="mx-auto text-green-500 mb-2" size={48} />
                <h2 className="text-2xl font-black text-green-800">Ready for Dispatch</h2>
                <p className="text-green-600 mt-1 text-sm">
                  All steps completed. Print your Delivery Challan & Labels below, then confirm dispatch.
                </p>
              </div>
            )}

            {/* DEDICATED PRINT & DOCUMENTATION HUB */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
              <div className="flex justify-between items-center mb-5 pb-3 border-b border-slate-100">
                <div>
                  <h3 className="font-black text-base text-slate-800 flex items-center gap-2">
                    <Printer className="text-primary" size={20} /> Print & Documentation Hub
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Authorized GST Delivery Challan, Box Shipping Barcodes, and Security Gate Pass
                  </p>
                </div>
                <button
                  onClick={() => openPrintModal('challan')}
                  className="text-xs font-bold text-primary hover:underline flex items-center gap-1"
                >
                  Open Print Preview & Options →
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                {/* 1. Delivery Challan */}
                <div className="p-5 rounded-xl border border-slate-200 hover:border-primary/50 bg-slate-50/70 hover:bg-white transition-all flex flex-col justify-between group shadow-2xs">
                  <div>
                    <div className="w-10 h-10 rounded-xl bg-purple-100 text-[#8c2785] flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                      <FileText size={20} />
                    </div>
                    <h4 className="font-bold text-slate-900 text-sm">Delivery Challan & Dispatch Note</h4>
                    <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
                      Rule 55 CGST stock transfer note with NUTRIBRAY official letterhead, item manifest, HSN, barcodes & signature blocks.
                    </p>
                  </div>
                  <button
                    onClick={() => openPrintModal('challan')}
                    className="mt-5 w-full py-2.5 px-3 bg-[#8c2785] hover:bg-[#721f6d] text-white rounded-lg font-bold text-xs flex items-center justify-center gap-2 shadow-xs transition-colors"
                  >
                    <Printer size={15} /> Print Delivery Challan
                  </button>
                </div>

                {/* 2. Shipping & Box Labels */}
                <div className="p-5 rounded-xl border border-slate-200 hover:border-primary/50 bg-slate-50/70 hover:bg-white transition-all flex flex-col justify-between group shadow-2xs">
                  <div>
                    <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                      <Box size={20} />
                    </div>
                    <h4 className="font-bold text-slate-900 text-sm">Shipping & Box Labels</h4>
                    <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
                      {boxes.length} carton label(s) with QR codes, Code 128 barcodes, seal numbers, route, and weight for thermal/A4 printing.
                    </p>
                  </div>
                  <div className="flex gap-2 mt-5">
                    <button
                      onClick={() => openPrintModal('labels')}
                      className="flex-1 py-2.5 px-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold text-xs flex items-center justify-center gap-1.5 shadow-xs transition-colors"
                    >
                      <Printer size={15} /> Print Labels ({boxes.length})
                    </button>
                    <button
                      onClick={() => setCurrentStep(5)}
                      title="Edit or view labels in Step 5"
                      className="py-2.5 px-3 border border-slate-300 hover:bg-slate-100 text-slate-700 rounded-lg font-bold text-xs transition-colors"
                    >
                      Step 5
                    </button>
                  </div>
                </div>

                {/* 3. Security Gate Pass */}
                <div className="p-5 rounded-xl border border-slate-200 hover:border-primary/50 bg-slate-50/70 hover:bg-white transition-all flex flex-col justify-between group shadow-2xs">
                  <div>
                    <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                      <ShieldCheck size={20} />
                    </div>
                    <h4 className="font-bold text-slate-900 text-sm">Security Gate Pass (Outward)</h4>
                    <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
                      Official security exit pass for main gate verification, vehicle license plate check, seal check & guard sign.
                    </p>
                  </div>
                  <button
                    onClick={() => openPrintModal('gatepass')}
                    className="mt-5 w-full py-2.5 px-3 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg font-bold text-xs flex items-center justify-center gap-2 shadow-xs transition-colors"
                  >
                    <Printer size={15} /> Print Gate Pass
                  </button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-8">
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                <h3 className="font-bold uppercase text-xs text-slate-400 mb-4 border-b pb-2">Shipment Summary</h3>
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Transfer No:</span>
                    <span className="font-bold font-mono text-slate-900">{transfer?.transfer_number}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Total Items:</span>
                    <span className="font-bold text-slate-900">{selectedItems.length} Products</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Total Boxes:</span>
                    <span className="font-bold text-slate-900">{boxes.length} Packed</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Destination:</span>
                    <span className="font-bold text-primary">{outlets.find(o => o.id.toString() === destId)?.outlet_name}</span>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                <h3 className="font-bold uppercase text-xs text-slate-400 mb-4 border-b pb-2">Vehicle & Driver</h3>
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Reg No:</span>
                    <span className="font-bold font-mono text-slate-900">{dispatchInfo.vehicle_reg_no || 'N/A'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Driver:</span>
                    <span className="font-bold text-slate-900">{dispatchInfo.driver_name || 'N/A'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Mobile:</span>
                    <span className="font-bold font-mono text-slate-900">{dispatchInfo.driver_mobile || 'N/A'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">ETA:</span>
                    <span className="font-bold text-slate-900">{dispatchInfo.eta ? new Date(dispatchInfo.eta).toLocaleString() : 'N/A'}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
              <h3 className="font-bold uppercase text-xs text-slate-400 mb-4 border-b pb-2">Shipment Timeline</h3>
              <div className="space-y-6 pl-4 relative before:absolute before:left-0 before:top-0 before:bottom-0 before:w-0.5 before:bg-slate-100">
                {transfer?.timeline?.map((event: any, idx: number) => (
                  <div key={idx} className="relative pl-6">
                    <div className="absolute left-[-5px] top-1.5 w-2.5 h-2.5 rounded-full bg-primary ring-4 ring-white"></div>
                    <div className="flex justify-between items-center">
                      <span className="font-bold text-slate-800">{event.event}</span>
                      <span className="text-[10px] text-slate-400">{new Date(event.created_at).toLocaleString()}</span>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">{event.description}</p>
                  </div>
                ))}
              </div>
            </div>

            {transfer?.status !== 'DISPATCHED' && (
              <button 
                onClick={handleDispatchConfirm}
                className="w-full bg-primary hover:bg-primary-hover text-white py-4 rounded-xl font-black text-xl shadow-lg transition-all transform hover:scale-[1.01] active:scale-[0.99] flex items-center justify-center gap-3"
              >
                <Truck size={24} /> CONFIRM & DISPATCH SHIPMENT
              </button>
            )}
          </div>
        )}
      </div>

      {/* BOTTOM ACTION BAR */}
      <div className="h-20 bg-white border-t border-slate-200 flex items-center justify-between px-12 shrink-0 no-print">
        <button 
          onClick={handleBack} 
          disabled={currentStep === 1 || loading}
          className="btn btn-secondary h-12 px-8 flex items-center gap-2 disabled:opacity-30"
        >
          <ChevronLeft size={18} /> Back
        </button>

        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/logistics/list')} className="btn btn-secondary h-12 px-5">
            {transfer?.status === 'DISPATCHED' ? 'Back to List' : 'Save as Draft'}
          </button>

          {/* Quick Print buttons available on Step 5 and Step 6 */}
          {(currentStep === 5 || currentStep === 6) && (
            <>
              <button 
                onClick={() => openPrintModal('challan')}
                className="btn btn-secondary h-12 px-5 flex items-center gap-2 border-primary/30 text-primary hover:bg-primary/5"
              >
                <FileText size={16} /> Delivery Challan
              </button>
              <button 
                onClick={() => openPrintModal('labels')}
                className="btn btn-secondary h-12 px-5 flex items-center gap-2"
              >
                <Printer size={16} /> Labels ({boxes.length})
              </button>
              <button 
                onClick={() => openPrintModal('gatepass')}
                className="btn btn-secondary h-12 px-4 flex items-center gap-2 text-emerald-700"
              >
                <ShieldCheck size={16} /> Gate Pass
              </button>
            </>
          )}

          {currentStep < 6 && (
            <button 
              onClick={handleNext} 
              disabled={loading}
              className="btn btn-primary h-12 px-12 flex items-center gap-2 min-w-[160px]"
            >
              {loading ? 'Processing...' : (
                <>Next Step <ChevronRight size={18} /></>
              )}
            </button>
          )}

          {currentStep === 6 && transfer?.status !== 'DISPATCHED' && (
            <button
              onClick={handleDispatchConfirm}
              disabled={loading}
              className="btn btn-primary h-12 px-8 flex items-center gap-2 font-bold shadow-lg"
            >
              <Truck size={18} /> Confirm & Dispatch
            </button>
          )}
        </div>
      </div>

      {/* Logistic Print Modal */}
      <LogisticPrintModal
        isOpen={printModalOpen}
        onClose={() => setPrintModalOpen(false)}
        transfer={transfer}
        outlets={outlets}
        boxes={boxes}
        items={selectedItems}
        dispatchInfo={dispatchInfo}
        defaultTab={printModalTab}
      />

      <style>{`
        @media print {
          .no-print {
            display: none !important;
          }
          body, html {
            background: white !important;
            padding: 0 !important;
            margin: 0 !important;
          }
          .label-print-area {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
            margin-bottom: 20px !important;
            border: 2px solid #000 !important;
          }
        }
      `}</style>
    </div>
  );
};

export default LogisticTransferWizard;

import React, { useState, useEffect, useRef } from 'react';
import { inventory_api } from '../../api/inventory';
import { products_api } from '../../api/products';
import { batches_api } from '../../api/batches';
import { audit_api } from '../../api/audit';
import { useAuthStore } from '../../store/authStore';
import { toast } from 'react-hot-toast';
import { getCompanySettings } from '../../api/company';
import { printTransferOut } from '../../utils/printTransferOut';
import { lookupSourceTransfers } from '../../api/logistic';

interface BranchInfo {
  id: number;
  unit_code: string;
  outlet_name: string;
  state?: string;
  city?: string;
  is_active: boolean;
}

interface ScannedItem {
  id: number;
  name: string;
  barcode: string;
  qty: number;
  branch_ids: number[];
  is_batch_required?: boolean;
  batch_id?: number | null;
  batch_no?: string | null;
  mfg_date?: string | null;
  expiry_date?: string | null;
  available_batch_qty?: number | null;
}

const MultiBranchTransfer = () => {
  const user = useAuthStore(s => s.user);
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [selectedBranches, setSelectedBranches] = useState<number[]>([]);
  const [sourceId, setSourceId] = useState<number | null>(null);
  const targets = branches.filter(b => b.id !== sourceId);
  const [scannedItems, setScannedItems] = useState<ScannedItem[]>([]);
  
  // Search & Scanning State
  const [barcode, setBarcode] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [pendingProduct, setPendingProduct] = useState<any | null>(null);
  const [qty, setQty] = useState<number | string>('');
  const [remarks, setRemarks] = useState('');

  // Batch states
  const [availableBatches, setAvailableBatches] = useState<any[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState<string>('');
  const [manualBatchNo, setManualBatchNo] = useState<string>('');
  const [manualExpDate, setManualExpDate] = useState<string>('');
  const [loadingBatches, setLoadingBatches] = useState<boolean>(false);
  
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [sessionStatus, setSessionStatus] = useState<'DRAFT' | 'CONFIRMED' | 'NEW'>('NEW');
  const [lastTrfs, setLastTrfs] = useState<string[]>([]);
  const [lastTrfIds, setLastTrfIds] = useState<number[]>([]);
  
  const barcodeRef = useRef<HTMLInputElement>(null);
  const qtyRef = useRef<HTMLInputElement>(null);
  const batchRef = useRef<HTMLSelectElement | HTMLInputElement>(null);

  useEffect(() => {
    loadBranches();
    focusScanner();
  }, []);

  // Search Logic
  useEffect(() => {
    const timer = setTimeout(async () => {
      // Only search if barcode is long enough AND we haven't already locked in a product
      if (barcode.length > 2 && !pendingProduct) {
        try {
          const res = await products_api.search(barcode);
          setSearchResults(res.data);
          setSelectedIndex(0);
        } catch (err) {
          setSearchResults([]);
        }
      } else if (barcode.length <= 2) {
        setSearchResults([]);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [barcode, pendingProduct]);

  const handleSourceChange = (newId: number | null) => {
    setSourceId(newId);
    if (newId) {
      setSelectedBranches(prev => prev.filter(bId => bId !== newId));
    }
  };

  const loadBranches = async () => {
    try {
      const data = await inventory_api.getBranches();
      setBranches(data);
      // Determine default source:
      // 1. User's assigned outlet (if active in branch list)
      // 2. Head Office / Mohan Cooperative / Flagship / Warehouse
      // 3. First available branch in the list
      const defaultSource =
        (user?.outlet_id && data.some((b: BranchInfo) => b.id === user.outlet_id))
          ? user.outlet_id
          : data.find((b: BranchInfo) => /ho|head\s*office|central|warehouse|flagship|mohan/i.test(b.outlet_name))?.id ??
            data[0]?.id ??
            null;
      setSourceId(prev => prev ?? defaultSource);
    } catch (err) {
      toast.error("Failed to load branches");
    }
  };

  // Re-fetch batches when source location changes
  useEffect(() => {
    if (pendingProduct?.id && sourceId) {
      batches_api.get_available(pendingProduct.id, sourceId)
        .then(bRes => {
          const bList = Array.isArray(bRes.data) ? bRes.data : [];
          setAvailableBatches(bList);
          if (bList.length > 0 && (!selectedBatchId || selectedBatchId === 'manual')) {
            setSelectedBatchId(String(bList[0].batch_id));
          }
        })
        .catch(() => {});
    }
  }, [sourceId, pendingProduct?.id]);

  const focusScanner = () => {
    if (barcodeRef.current) barcodeRef.current.focus();
  };

  const toggleBranch = (id: number) => {
    if (sessionStatus === 'CONFIRMED') return;
    setSelectedBranches(prev => 
      prev.includes(id) ? prev.filter(b => b !== id) : [...prev, id]
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (searchResults.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(prev => (prev < searchResults.length - 1 ? prev + 1 : prev));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(prev => (prev > 0 ? prev - 1 : prev));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (selectedIndex >= 0) {
          selectProduct(searchResults[selectedIndex]);
        }
      }
    } else if (e.key === 'Enter' && barcode.trim()) {
      e.preventDefault();
      // If we already have a pending product, Enter in scan box might mean "move to qty"
      if (pendingProduct) {
         if (qtyRef.current) qtyRef.current.focus();
      } else {
         identifyProduct();
      }
    }
  };

  const identifyProduct = async () => {
    if (!barcode.trim()) return;
    if (selectedBranches.length === 0) {
      toast.error("Please select at least one branch first");
      return;
    }

    try {
      setIsLoading(true);
      let product: any = null;
      try {
        // Try direct barcode lookup
        const res = await products_api.lookup_barcode(barcode);
        product = res.data;
      } catch {
        // Try search as fallback
        const res = await products_api.search(barcode);
        if (res.data.length > 0) product = res.data[0];
      }

      if (product) {
        selectProduct(product);
      } else {
        toast.error("Product not found");
      }
    } catch (err) {
      toast.error("Error identifying product");
    } finally {
      setIsLoading(false);
    }
  };

  const selectProduct = async (product: any) => {
    try {
      setIsLoading(true);
      // Fetch full details to get latest pricing, stock, and Item Master batch requirement
      const res = await products_api.get(product.id);
      const fullProduct = res.data;
      
      const productName = fullProduct.name || fullProduct.print_name || 'Unnamed Product';
      const productCode = fullProduct.barcode || fullProduct.item_code || 'N/A';
      const isBatchReq = Boolean(fullProduct.is_batch_required || fullProduct.has_batch_tracking);

      setPendingProduct({
        ...fullProduct,
        name: productName,
        barcode: productCode,
        is_batch_required: isBatchReq,
      });
      setBarcode(productName);
      setSearchResults([]);
      setSelectedIndex(-1);
      
      // Fetch available batches for this product
      setLoadingBatches(true);
      let batches: any[] = [];
      try {
        const bRes = await batches_api.get_available(fullProduct.id, sourceId || undefined);
        batches = Array.isArray(bRes.data) ? bRes.data : [];
      } catch (bErr) {
        console.warn("Could not load batches", bErr);
      } finally {
        setLoadingBatches(false);
      }

      setAvailableBatches(batches);
      if (batches.length > 0) {
        // Default to FEFO first batch
        setSelectedBatchId(String(batches[0].batch_id));
        setManualBatchNo('');
        setManualExpDate('');
      } else if (isBatchReq) {
        setSelectedBatchId('manual');
        setManualBatchNo('');
        setManualExpDate(fullProduct.expiry_date || '');
      } else {
        setSelectedBatchId('');
        setManualBatchNo('');
        setManualExpDate('');
      }

      // Auto focus quantity
      if (qtyRef.current) qtyRef.current.focus();
    } catch (err) {
      toast.error("Failed to load product details");
    } finally {
      setIsLoading(false);
    }
  };

  const addItemToTable = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!pendingProduct) {
      identifyProduct();
      return;
    }

    const isBatchReq = Boolean(pendingProduct.is_batch_required || pendingProduct.has_batch_tracking);
    let finalBatchId: number | null = null;
    let finalBatchNo: string | null = null;
    let finalExpDate: string | null = null;
    let finalMfgDate: string | null = null;
    let availQty: number | null = null;

    if (selectedBatchId && selectedBatchId !== 'manual') {
      const bObj = availableBatches.find(b => String(b.batch_id) === String(selectedBatchId));
      if (bObj) {
        finalBatchId = bObj.batch_id;
        finalBatchNo = bObj.batch_no;
        finalExpDate = bObj.exp_date || null;
        finalMfgDate = bObj.mfg_date || null;
        availQty = bObj.available_qty ?? null;
      }
    } else if (selectedBatchId === 'manual' || manualBatchNo.trim()) {
      finalBatchNo = manualBatchNo.trim().toUpperCase();
      finalExpDate = manualExpDate || null;
    }

    // STRICT VALIDATION: If Item Master has Batch Required, prevent adding without a batch
    if (isBatchReq && !finalBatchNo) {
      toast.error(`Batch is REQUIRED for "${pendingProduct.name}" as configured in Item Master. Please select or enter a batch.`);
      return;
    }

    const finalQty = Number(qty) || 1;
    const newItem: ScannedItem = {
      id: pendingProduct.id,
      name: pendingProduct.name,
      barcode: pendingProduct.barcode || pendingProduct.item_code || 'N/A',
      qty: finalQty,
      branch_ids: [...selectedBranches],
      is_batch_required: isBatchReq,
      batch_id: finalBatchId,
      batch_no: finalBatchNo,
      expiry_date: finalExpDate,
      mfg_date: finalMfgDate,
      available_batch_qty: availQty,
    };

    setScannedItems(prev => [...prev, newItem]);
    setBarcode('');
    setQty('');
    setPendingProduct(null);
    setAvailableBatches([]);
    setSelectedBatchId('');
    setManualBatchNo('');
    setManualExpDate('');
    setSearchResults([]);
    focusScanner();
    toast.success(`Added ${pendingProduct.name}${finalBatchNo ? ` (Batch: ${finalBatchNo})` : ''}`);
  };

  const removeItem = (index: number) => {
    setScannedItems(prev => prev.filter((_, idx) => idx !== index));
  };

  const handleSaveDraft = async () => {
    if (scannedItems.length === 0) {
      toast.error("No items to save");
      return;
    }
    if (!sourceId) {
      toast.error("Select a source location");
      return;
    }

    // Check if any item requires batch but is missing it
    const missingBatch = scannedItems.find(i => i.is_batch_required && !i.batch_no);
    if (missingBatch) {
      toast.error(`Item "${missingBatch.name}" requires batch selection as configured in Item Master.`);
      return;
    }
    
    try {
      setIsSaving(true);
      const payload = {
        from_location_id: sourceId,
        remarks,
        branch_ids: selectedBranches,
        items: scannedItems.map(i => ({
          product_id: i.id,
          barcode: i.barcode,
          qty_per_branch: i.qty,
          batch_id: i.batch_id || undefined,
          batch_no: i.batch_no || undefined,
          mfg_date: i.mfg_date || undefined,
          expiry_date: i.expiry_date || undefined,
        }))
      };
      
      const res = await inventory_api.saveDraft(payload);
      setSessionStatus('DRAFT');
      toast.success(`Draft saved: ${res.draft_ref_number}`);
      
      audit_api.log({
        action: 'CREATE_DRAFT',
        module: 'Multi-Branch Transfer',
        details: `Saved multi-branch transfer draft ${res.draft_ref_number}`
      });
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to save draft");
    } finally {
      setIsSaving(false);
    }
  };

  const handleFinalConfirm = async () => {
    if (selectedBranches.length === 0 || scannedItems.length === 0) {
      toast.error("Select branches and add items before confirming");
      return;
    }
    if (!sourceId) {
      toast.error("Select a source location");
      return;
    }

    // Validate batch requirements
    const missingBatch = scannedItems.find(i => i.is_batch_required && !i.batch_no);
    if (missingBatch) {
      toast.error(`Item "${missingBatch.name}" requires batch selection as configured in Item Master.`);
      return;
    }

    if (!window.confirm(`Are you sure you want to generate transfers for ${selectedBranches.length} branches?`)) return;

    try {
      setIsSaving(true);
      // Save draft with batch fields
      const payload = {
        from_location_id: sourceId,
        remarks,
        branch_ids: selectedBranches,
        items: scannedItems.map(i => ({
          product_id: i.id,
          barcode: i.barcode,
          qty_per_branch: i.qty,
          batch_id: i.batch_id || undefined,
          batch_no: i.batch_no || undefined,
          mfg_date: i.mfg_date || undefined,
          expiry_date: i.expiry_date || undefined,
        }))
      };
      
      const session = await inventory_api.saveDraft(payload);
      const res = await inventory_api.confirmSession(session.id);
      
      setSessionStatus('CONFIRMED');
      setLastTrfs(res.data || []);
      setLastTrfIds(res.ids || []);
      toast.success(res.message);
      
      audit_api.log({
        action: 'CONFIRM_TRANSFER',
        module: 'Multi-Branch Transfer',
        details: `Generated ${(res.data || []).length} transfers from multi-branch session`
      });
      printTransfers(res.ids || []);
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Confirmation failed");
    } finally {
      setIsSaving(false);
    }
  };

  const [reprintNo, setReprintNo] = useState('');
  const reprint = async () => {
    const no = reprintNo.trim().toUpperCase();
    if (!no) return;
    try {
      const hit = (await lookupSourceTransfers(no) as any[]).find(t => t.transfer_no.toUpperCase() === no);
      if (!hit) return toast.error(`Transfer ${no} not found`);
      printTransfers([hit.id]);
    } catch {
      toast.error('Transfer lookup failed');
    }
  };

  const printTransfers = async (ids: number[]) => {
    if (!ids.length) return;
    try {
      const company = await getCompanySettings();
      const payloads = await Promise.all(ids.map(id => inventory_api.getTransferPrint(id)));
      printTransferOut(payloads, company);
    } catch (e: any) {
      toast.error('Could not prepare print: ' + (e.message || 'network'));
    }
  };

  const totalUnits = scannedItems.reduce((acc, curr) => acc + (curr.qty * selectedBranches.length), 0);

  return (
    <div className="p-6 max-w-[1600px] mx-auto space-y-6">
      
      {/* ── BRANCH SELECTION SECTION ── */}
      <div className="bg-white dark:bg-[#1a1a2e] p-6 rounded-xl border border-border shadow-sm space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
           <div>
              <div className="flex items-center gap-3">
                <h2 className="text-sm font-bold text-text-primary uppercase tracking-wider flex items-center gap-2">
                  <i className="fas fa-store text-primary"></i> 1. Select Target Branches
                </h2>
                {sourceId && (
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 text-blue-700 dark:text-blue-300 font-bold inline-flex items-center gap-1.5">
                    <i className="fas fa-arrow-circle-right text-[11px] text-blue-500"></i>
                    Dispatching From: <strong>{branches.find(b => b.id === sourceId)?.outlet_name || `Outlet #${sourceId}`}</strong>
                  </span>
                )}
              </div>
              <p className="text-xs text-text-muted mt-0.5">Select the branches that will receive this stock transfer</p>
           </div>
           <div className="flex items-center gap-2">
             <button 
                type="button" 
                onClick={() => setSelectedBranches(targets.map(b => b.id))}
                className="text-[10px] font-bold text-primary hover:underline uppercase"
                disabled={sessionStatus === 'CONFIRMED'}
             >
               Select All
             </button>
             <span className="text-border">|</span>
             <button 
                type="button" 
                onClick={() => setSelectedBranches([])}
                className="text-[10px] font-bold text-text-muted hover:underline uppercase"
                disabled={sessionStatus === 'CONFIRMED'}
             >
               Clear
             </button>
           </div>
        </div>

        {/* Branch Cards Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {targets.map(branch => {
            const isSelected = selectedBranches.includes(branch.id);
            return (
              <div
                key={branch.id}
                onClick={() => toggleBranch(branch.id)}
                className={`p-3.5 rounded-xl border-2 transition-all cursor-pointer flex items-start gap-3 relative overflow-hidden select-none ${
                  isSelected 
                    ? 'border-primary shadow-sm' 
                    : 'border-border hover:border-border-dark opacity-75 hover:opacity-100'
                }`}
                style={{ 
                  backgroundColor: isSelected ? 'var(--color-primary)' : 'var(--color-bg-card)' 
                }}
              >
                <div className={`mt-0.5 w-5 h-5 rounded border-2 flex items-center justify-center transition-all shrink-0 ${
                  isSelected ? 'bg-white border-white text-primary' : 'border-text-muted bg-bg-app'
                }`}>
                  {isSelected && <i className="fas fa-check text-[10px]"></i>}
                </div>
                <div className="min-w-0 flex-1">
                  <div className={`text-sm font-black leading-tight truncate ${isSelected ? 'text-white' : 'text-text-primary'}`}>
                    {branch.outlet_name}
                  </div>
                  <div className={`text-[10px] font-mono mt-1 uppercase tracking-wider ${isSelected ? 'text-white/80' : 'text-text-muted'}`}>
                    {branch.unit_code}
                  </div>
                  
                  {/* Location Info */}
                  <div className={`flex items-center gap-1.5 mt-2.5 text-[10px] font-bold ${isSelected ? 'text-white/90' : 'text-text-secondary'}`}>
                    <i className={`fas fa-map-marker-alt ${isSelected ? 'text-white/70' : 'text-primary/70'}`}></i>
                    <span className="truncate">
                      {branch.city || branch.state 
                        ? `${branch.city || ''}${branch.city && branch.state ? ', ' : ''}${branch.state || ''}`
                        : 'Location Pending'
                      }
                    </span>
                  </div>
                </div>
                
                {/* Visual indicator for selection */}
                {isSelected && (
                  <div className="absolute top-2 right-2">
                    <div className="w-2.5 h-2.5 rounded-full bg-[#22C55E] border-2 border-white shadow-[0_0_10px_rgba(34,197,94,0.5)]"></div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        
        <div className="bg-bg-app p-3 rounded-lg border border-border flex items-center gap-3">
           <i className="fas fa-info-circle text-primary"></i>
           <p className="text-[11px] font-medium text-text-secondary">
             <span className="font-bold text-primary">{selectedBranches.length} branches selected</span> — each item scanned will be sent to all selected branches with the same qty.
           </p>
        </div>
      </div>

      {/* ── TOP BAR — UNIFIED SEARCH & BATCH SELECTION ── */}
      <div className="bg-slate-900 dark:bg-[#0f3460] rounded-xl border border-slate-700 p-4 sticky top-0 z-40 shadow-lg mb-6">
        <div className="flex items-center gap-3 flex-wrap lg:flex-nowrap">

          {/* Icon & Source Selector */}
          <div className="flex items-center gap-3 pr-4 border-r border-slate-700 shrink-0">
            <div className="bg-blue-600 text-white w-10 h-10 rounded-lg flex items-center justify-center shrink-0 shadow-lg shadow-blue-900/20">
              <i className="fas fa-warehouse text-base"></i>
            </div>
            <div className="min-w-[170px] max-w-[220px]">
              <label htmlFor="source-location-select" className="text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-none mb-1 block">
                Source Location
              </label>
              <select
                id="source-location-select"
                value={sourceId ?? ''}
                onChange={(e) => handleSourceChange(e.target.value ? Number(e.target.value) : null)}
                disabled={sessionStatus === 'CONFIRMED'}
                className="w-full bg-slate-950 border border-slate-700 hover:border-blue-500 text-white text-xs font-bold rounded-lg px-2.5 py-1.5 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none cursor-pointer truncate"
              >
                <option value="" disabled>-- Select Source --</option>
                {branches.map(b => (
                  <option key={b.id} value={b.id} className="bg-slate-900 text-white">
                    {b.unit_code} - {b.outlet_name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Unified search input */}
          <div className="flex-1 relative min-w-[280px]">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 italic">
              📷 Scan EAN / UPC &nbsp;·&nbsp; 🔍 Search by Name, Code or Barcode — <kbd className="bg-slate-700 text-slate-300 rounded px-1 text-[9px]">↑↓</kbd> Navigate &nbsp; <kbd className="bg-slate-700 text-slate-300 rounded px-1 text-[9px]">Enter</kbd> Select
            </p>
            <div className="flex items-center bg-slate-950 border border-slate-700 rounded-lg focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/30 transition-all">
              {/* Search icon */}
              <span className="pl-4 text-slate-500 shrink-0">
                {isLoading
                  ? <i className="fas fa-spinner fa-spin text-blue-400"></i>
                  : <i className="fas fa-search text-slate-500"></i>
                }
              </span>
              <input
                ref={barcodeRef}
                type="text"
                autoComplete="off"
                value={barcode}
                onChange={e => {
                   setBarcode(e.target.value);
                   if (pendingProduct) setPendingProduct(null);
                }}
                onKeyDown={handleKeyDown}
                className="flex-1 bg-transparent text-white text-base px-3 py-2.5 outline-none placeholder-slate-600 font-mono"
                placeholder="Scan barcode OR type name / item code…"
                disabled={sessionStatus === 'CONFIRMED'}
              />
              {/* Hint when typing */}
              {barcode && searchResults.length > 0 && (
                <span className="text-slate-500 text-[10px] pr-2 shrink-0 hidden sm:block">
                  {selectedIndex >= 0 ? `${selectedIndex + 1}/${searchResults.length}` : `${searchResults.length} found`}
                </span>
              )}
              {/* Clear button */}
              {barcode && (
                <button type="button"
                  onClick={() => { setBarcode(''); setSearchResults([]); setSelectedIndex(-1); setPendingProduct(null); focusScanner(); }}
                  className="pr-3 text-slate-500 hover:text-white transition-colors shrink-0">
                  <i className="fas fa-times-circle"></i>
                </button>
              )}
            </div>

            {/* Dropdown results */}
            {(searchResults.length > 0 && !pendingProduct) && (
              <div
                className="absolute top-full left-0 right-0 mt-1 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl z-50 max-h-80 overflow-y-auto"
              >
                {searchResults.map((item, idx) => (
                  <button
                    key={item.id}
                    type="button"
                    onMouseEnter={() => setSelectedIndex(idx)}
                    onClick={() => selectProduct(item)}
                    className={`w-full text-left px-4 py-3 transition-colors border-b border-slate-800 last:border-0 flex items-center justify-between gap-2 ${
                      selectedIndex === idx ? 'bg-blue-600/30 border-blue-700/30' : 'hover:bg-slate-800'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {selectedIndex === idx && (
                        <i className="fas fa-arrow-right text-blue-400 text-xs shrink-0"></i>
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-white text-sm font-semibold leading-tight truncate">{item.name || item.print_name || item.bill_print_name}</p>
                          {(item.is_batch_required || item.has_batch_tracking) && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-400/30 shrink-0">
                              Batch Req
                            </span>
                          )}
                        </div>
                        <p className="text-slate-400 text-xs mt-0.5">{item.item_code} · {item.category || 'Product'}</p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-green-400 text-sm font-mono font-bold">₹{item.mrp || item.selling_price || '0.00'}</p>
                      <p className={`text-[10px] font-bold ${item.is_active !== false ? 'text-green-500' : 'text-rose-500'}`}>
                        {item.is_active !== false ? 'Active' : 'Inactive'}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="w-28 shrink-0">
             <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 italic">Quantity</p>
             <input 
                ref={qtyRef}
                type="number" 
                value={qty}
                onChange={(e) => setQty(e.target.value as any)}
                onFocus={(e) => e.target.select()}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        addItemToTable();
                    }
                }}
                min="1"
                placeholder="Qty"
                className="w-full h-11 px-4 bg-slate-950 border border-slate-700 rounded-lg text-white font-bold text-center focus:ring-2 focus:ring-blue-500 outline-none"
                disabled={sessionStatus === 'CONFIRMED'}
             />
          </div>

          <button 
            type="button"
            onClick={addItemToTable}
            className="shrink-0 bg-blue-600 hover:bg-blue-700 text-white px-6 h-11 rounded-lg font-black text-sm flex items-center gap-2 shadow-lg transition-all disabled:opacity-50 mt-4 lg:mt-0"
            disabled={sessionStatus === 'CONFIRMED' || isLoading}
          >
            {isLoading ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-plus-circle"></i>}
            <span>ADD ITEM</span>
          </button>
        </div>

        {/* ── BATCH SELECTOR (IF PRODUCT HAS BATCHES OR BATCH REQUIRED IN ITEM MASTER) ── */}
        {pendingProduct && (
          <div className="mt-3 pt-3 border-t border-slate-800 space-y-2">
            <div className="flex items-center gap-3 px-3 py-2 bg-blue-600/15 border border-blue-500/20 rounded-xl">
              <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white text-sm font-bold shadow-sm shrink-0">
                <i className="fas fa-check"></i>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-black text-blue-100 uppercase truncate tracking-wide flex items-center gap-2">
                  <span>Identified: {pendingProduct.name}</span>
                  {(pendingProduct.is_batch_required || pendingProduct.has_batch_tracking) && (
                    <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-amber-500 text-slate-950 border border-amber-300">
                      ★ BATCH REQUIRED IN ITEM MASTER
                    </span>
                  )}
                </div>
                <div className="text-[10px] font-bold text-blue-300/80 mt-0.5">
                  CODE: {pendingProduct.item_code} · BARCODE: {pendingProduct.barcode} · MRP: ₹{pendingProduct.mrp}
                </div>
              </div>
            </div>

            {/* Batch Selection Controls */}
            {(pendingProduct.is_batch_required || pendingProduct.has_batch_tracking || availableBatches.length > 0) && (
              <div className="bg-slate-950/80 border border-amber-500/40 rounded-xl p-3 flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-amber-500 text-slate-950 flex items-center gap-1 shadow-sm">
                    <i className="fas fa-barcode"></i> Select Batch
                  </span>
                  <span className="text-xs text-amber-200/90 font-medium hidden sm:inline">
                    Choose dispatch batch or enter batch number:
                  </span>
                </div>

                <div className="flex items-center gap-3 flex-wrap flex-1 justify-end">
                  {loadingBatches ? (
                    <span className="text-xs text-amber-400 flex items-center gap-1">
                      <i className="fas fa-spinner fa-spin"></i> Loading batches…
                    </span>
                  ) : availableBatches.length > 0 ? (
                    <div className="min-w-[280px]">
                      <select
                        ref={batchRef as any}
                        value={selectedBatchId}
                        onChange={(e) => {
                          setSelectedBatchId(e.target.value);
                          if (e.target.value !== 'manual') {
                            setManualBatchNo('');
                            setManualExpDate('');
                          }
                        }}
                        className="w-full h-9 bg-slate-900 border border-amber-500/50 rounded-lg text-amber-300 font-mono text-xs px-3 focus:border-amber-400 focus:ring-1 focus:ring-amber-400 outline-none"
                      >
                        {availableBatches.map(b => (
                          <option key={b.batch_id} value={String(b.batch_id)}>
                            Batch: {b.batch_no} | Exp: {b.exp_date || 'N/A'} (Avail: {b.available_qty} units) {b.mrp ? `| MRP: ₹${b.mrp}` : ''}
                          </option>
                        ))}
                        <option value="manual">+ Enter New / Other Batch Number</option>
                      </select>
                    </div>
                  ) : null}

                  {(selectedBatchId === 'manual' || availableBatches.length === 0) && (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder="Batch Number *"
                        value={manualBatchNo}
                        onChange={(e) => setManualBatchNo(e.target.value)}
                        className="h-9 px-3 bg-slate-900 border border-amber-500 rounded-lg text-white font-mono font-bold text-xs w-36 outline-none focus:ring-1 focus:ring-amber-400 placeholder:text-slate-500"
                      />
                      <input
                        type="date"
                        placeholder="Expiry Date"
                        value={manualExpDate}
                        onChange={(e) => setManualExpDate(e.target.value)}
                        className="h-9 px-2 bg-slate-900 border border-slate-700 rounded-lg text-white font-mono text-xs outline-none focus:ring-1 focus:ring-amber-400"
                      />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── SCANNED ITEMS TABLE ── */}
      <div className="border border-border rounded-lg overflow-hidden bg-white dark:bg-[#1a1a2e] shadow-sm">
        <table className="w-full text-left text-xs">
          <thead className="bg-bg-app border-b border-border">
             <tr>
               <th className="px-4 py-3 text-text-muted font-bold uppercase tracking-wider">#</th>
               <th className="px-4 py-3 text-text-muted font-bold uppercase tracking-wider">Item Details</th>
               <th className="px-4 py-3 text-text-muted font-bold uppercase tracking-wider text-center">Barcode</th>
               <th className="px-4 py-3 text-text-muted font-bold uppercase tracking-wider">Batch & Expiry</th>
               <th className="px-4 py-3 text-text-muted font-bold uppercase tracking-wider text-center">Qty per Branch</th>
               <th className="px-4 py-3 text-text-muted font-bold uppercase tracking-wider">Target Branches</th>
               <th className="px-4 py-3 text-text-muted font-bold uppercase tracking-wider text-center">Action</th>
             </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {scannedItems.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-text-muted italic bg-slate-50/30">
                  No items scanned yet. Start by selecting branches and scanning products.
                </td>
              </tr>
            ) : (
              scannedItems.map((item, idx) => (
                <tr key={idx} className="hover:bg-bg-app/50 transition-colors">
                  <td className="px-4 py-4 text-text-muted font-mono">{idx + 1}</td>
                  <td className="px-4 py-4">
                     <div className="font-bold text-text-primary text-sm flex items-center gap-2">
                       <span>{item.name}</span>
                       {item.is_batch_required && (
                         <span className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider bg-amber-100 text-amber-800 border border-amber-200 shrink-0">
                           BATCH REQ
                         </span>
                       )}
                     </div>
                     <div className="text-[10px] text-text-muted mt-0.5">Product ID: {item.id}</div>
                  </td>
                  <td className="px-4 py-4 text-center font-mono font-medium">{item.barcode}</td>

                  {/* Batch & Expiry Column */}
                  <td className="px-4 py-4">
                    {item.batch_no ? (
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono font-black text-slate-800 bg-slate-100 dark:bg-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-700 px-2 py-0.5 rounded text-xs shadow-xs">
                            Batch: {item.batch_no}
                          </span>
                        </div>
                        <div className="text-[10px] text-text-muted mt-1 flex items-center gap-1.5">
                          <span>Exp: <strong className="text-text-primary">{item.expiry_date || '—'}</strong></span>
                          {item.available_batch_qty != null && (
                            <span className="text-emerald-600 font-bold">(Avail: {item.available_batch_qty})</span>
                          )}
                        </div>
                      </div>
                    ) : item.is_batch_required ? (
                      <div className="inline-flex items-center gap-1 text-rose-600 font-bold text-xs bg-rose-50 border border-rose-200 rounded px-2 py-1">
                        <i className="fas fa-exclamation-triangle"></i>
                        <span>Batch Required!</span>
                      </div>
                    ) : (
                      <span className="text-text-muted text-xs italic">Standard (Non-Batch)</span>
                    )}
                  </td>

                  <td className="px-4 py-4 text-center">
                     <span className="bg-white dark:bg-slate-800 px-3 py-1 rounded-md border border-border font-black text-primary shadow-sm">
                       {item.qty}
                     </span>
                  </td>
                  <td className="px-4 py-4">
                     <div className="flex flex-wrap gap-1">
                        {item.branch_ids.map(bid => {
                          const b = branches.find(x => x.id === bid);
                          return (
                            <span key={bid} className="px-2 py-0.5 bg-blue-50 text-blue-600 border border-blue-100 rounded text-[9px] font-bold">
                              {b?.unit_code || bid}
                            </span>
                          );
                        })}
                     </div>
                  </td>
                  <td className="px-4 py-4 text-center">
                     <button 
                      onClick={() => removeItem(idx)}
                      className="w-8 h-8 rounded-lg text-red-500 hover:bg-red-50 transition-colors"
                      disabled={sessionStatus === 'CONFIRMED'}
                      title="Remove item"
                     >
                       <i className="fas fa-trash-alt text-xs"></i>
                     </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Summary Footer */}
      <div className="flex items-center gap-8 py-2 px-4 bg-bg-app/50 rounded-lg border border-border text-[11px] font-bold text-text-secondary uppercase">
         <div className="flex items-center gap-2"><i className="fas fa-boxes text-primary"></i> {scannedItems.length} items</div>
         <div className="flex items-center gap-2"><i className="fas fa-store text-primary"></i> {selectedBranches.length} branches</div>
         <div className="flex items-center gap-2 text-primary font-black"><i className="fas fa-truck-loading"></i> {totalUnits} units total dispatch</div>
      </div>

      {sessionStatus !== 'NEW' || lastTrfs.length > 0 ? (
        <div className="bg-white p-6 rounded-xl border border-border shadow-sm space-y-4">
          <h3 className="text-xs font-bold text-text-secondary uppercase flex items-center gap-2">
            <i className="fas fa-file-invoice"></i> Transfer Numbers on Save (Auto-generated per branch)
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
             {selectedBranches.map((bid, i) => {
               const b = branches.find(x => x.id === bid);
               return (
                 <div key={bid} className="p-3 border border-border rounded-lg bg-bg-app/30">
                    <div className="text-[10px] font-bold text-text-muted">{b?.outlet_name} · {b?.unit_code}</div>
                    <div className="flex items-center justify-between gap-2 mt-1">
                      <span className="text-sm font-black text-primary">
                        {lastTrfs[i] || `TRF-2026-${String(41 + i).padStart(4, '0')}`}
                      </span>
                      {lastTrfIds[i] && (
                        <button type="button" onClick={() => printTransfers([lastTrfIds[i]])}
                          className="btn btn-secondary h-8 px-3 text-[12px]" aria-label={`Print ${lastTrfs[i]}`}>
                          <i className="fas fa-print"></i> Print
                        </button>
                      )}
                    </div>
                 </div>
               );
             })}
          </div>
          {sessionStatus !== 'CONFIRMED' && (
            <div className="flex items-center gap-3 p-3 bg-amber-50 rounded-lg border border-amber-100">
               <i className="fas fa-exclamation-triangle text-amber-500 text-xs"></i>
               <p className="text-[10px] font-bold text-amber-700">Numbers shown are previews. Final numbers lock on Save. Draft keeps same number until saved.</p>
            </div>
          )}
        </div>
      ) : null}

      {/* Remarks & Actions */}
      <div className="bg-white dark:bg-[#1a1a2e] p-6 rounded-xl border border-border shadow-sm space-y-4">
        <h3 className="text-xs font-bold text-text-secondary uppercase">Remarks (optional)</h3>
        <textarea 
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          placeholder="e.g. Weekly stock replenishment — Maggi promo packs"
          className="w-full h-20 p-4 bg-bg-app border border-border rounded-lg text-sm font-medium focus:ring-2 focus:ring-primary transition-all resize-none"
          disabled={sessionStatus === 'CONFIRMED'}
        />

        <div className="flex justify-end gap-3 pt-2">
           <button 
             onClick={handleSaveDraft}
             disabled={sessionStatus === 'CONFIRMED' || isSaving}
             className="px-6 py-3 bg-white dark:bg-slate-800 border-2 border-border text-text-primary font-black rounded-xl hover:bg-bg-app transition-all flex items-center gap-2 disabled:opacity-50"
           >
             <i className="fas fa-save"></i> Save Draft
           </button>
           <button 
             onClick={handleFinalConfirm}
             disabled={sessionStatus === 'CONFIRMED' || isSaving}
             className="px-8 py-3 bg-primary text-white font-black rounded-xl shadow-lg hover:shadow-primary/20 transition-all flex items-center gap-2 disabled:opacity-50"
           >
             {isSaving ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-check-circle"></i>}
             Save & Generate Transfers
           </button>
           
           {sessionStatus === 'CONFIRMED' && lastTrfIds.length > 0 && (
             <button
               onClick={() => printTransfers(lastTrfIds)}
               className="px-6 py-3 bg-white border-2 border-primary text-primary font-black rounded-xl transition-all flex items-center gap-2"
             >
               <i className="fas fa-print"></i> Print {lastTrfIds.length > 1 ? 'All' : 'Transfer'}
             </button>
           )}
           {sessionStatus === 'CONFIRMED' && (
             <button 
               onClick={() => window.location.reload()}
               className="px-8 py-3 bg-green-600 text-white font-black rounded-xl shadow-lg transition-all flex items-center gap-2"
             >
               <i className="fas fa-plus"></i> New Multi-Branch Transfer
             </button>
           )}
        </div>
      </div>
    </div>
  );
};

export default MultiBranchTransfer;

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { batches_api, ProductBatch, BatchKPIs, BatchExpiryReportSummary } from '../../api/batches';
import { masters_api } from '../../api/masters';
import { suppliers_api, supplier_list_item } from '../../api/suppliers';
import CompanyReportHeader from '../../components/common/CompanyReportHeader';

export default function ExpiryDashboard() {
  const navigate = useNavigate();

  const [kpis, setKpis] = useState<BatchKPIs>({
    total_batches: 0,
    active_batches: 0,
    near_expiry_5d: 0,
    near_expiry_15d: 0,
    near_expiry_7d: 0,
    near_expiry_30d: 0,
    near_expiry_60d: 0,
    near_expiry_90d: 0,
    expired_batches: 0,
    quarantined_batches: 0,
    stock_value_at_risk: 0,
    value_at_risk_cost: 0,
    value_at_risk_mrp: 0,
  });

  const [batches, setBatches] = useState<ProductBatch[]>([]);
  const [total, setTotal] = useState(0);
  const [reportSummary, setReportSummary] = useState<BatchExpiryReportSummary | null>(null);
  const [page, setPage] = useState(1);
  const perPage = 25;
  const [loading, setLoading] = useState(true);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [expiryWindow, setExpiryWindow] = useState<string>('all'); // 'all', 'expired', '5', '15', '30', '45', '60', '90', 'custom'
  const [customDays, setCustomDays] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [outlets, setOutlets] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<supplier_list_item[]>([]);
  const [selectedSupplierId, setSelectedSupplierId] = useState<number | ''>('');
  const [selectedLocationId, setSelectedLocationId] = useState<number | undefined>(undefined);
  const [hasStockOnly, setHasStockOnly] = useState<boolean>(false);

  // Status Change Modal
  const [statusModal, setStatusModal] = useState<{
    open: boolean;
    batch: ProductBatch | null;
    newStatus: string;
    reason: string;
  }>({
    open: false,
    batch: null,
    newStatus: 'Quarantined',
    reason: '',
  });

  // Legacy Migration Dialog
  const [migrating, setMigrating] = useState(false);
  const [exporting, setExporting] = useState(false);

  const loadKpis = () => {
    batches_api.get_kpis(selectedLocationId)
      .then(res => setKpis(res.data))
      .catch(err => console.error('Failed to load batch KPIs', err));
  };

  const loadBatches = () => {
    setLoading(true);
    batches_api.get_expiry_report({
      window: expiryWindow,
      custom_days: expiryWindow === 'custom' && customDays ? Number(customDays) : undefined,
      supplier_id: selectedSupplierId ? Number(selectedSupplierId) : undefined,
      location_id: selectedLocationId,
      has_stock_only: hasStockOnly,
      search: searchQuery || undefined,
      page,
      limit: perPage,
    })
      .then(res => {
        setBatches(res.data.data || []);
        setTotal(res.data.total || 0);
        setReportSummary(res.data.summary);
      })
      .catch(err => {
        console.error('Failed to load batches', err);
        toast.error('Failed to fetch batch expiry report');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    // Load outlets
    masters_api.get_outlets()
      .then(r => setOutlets(r.data || []))
      .catch(() => {});

    // Load suppliers for filter
    suppliers_api.list({ per_page: 500 })
      .then(r => setSuppliers(r.data.data || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadKpis();
  }, [selectedLocationId]);

  useEffect(() => {
    loadBatches();
  }, [page, expiryWindow, customDays, selectedSupplierId, selectedLocationId, hasStockOnly]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    loadBatches();
  };

  const handleUpdateStatus = async () => {
    if (!statusModal.batch) return;
    try {
      await batches_api.update_status(statusModal.batch.id, statusModal.newStatus, statusModal.reason);
      toast.success(`Batch ${statusModal.batch.batch_no} marked as ${statusModal.newStatus}`);
      setStatusModal({ open: false, batch: null, newStatus: 'Quarantined', reason: '' });
      loadBatches();
      loadKpis();
    } catch (err: any) {
      console.error('Failed to update status', err);
      toast.error(err.response?.data?.detail || 'Failed to update batch status');
    }
  };

  const handleLegacyMigration = async (dryRun: boolean) => {
    setMigrating(true);
    try {
      const res = await batches_api.migrate_legacy(dryRun);
      if (dryRun) {
        toast.success(`Simulation complete: ${res.data.migrated_batches_created} items ready for batch assignment.`);
      } else {
        toast.success(`Migration completed! Created initial batches for legacy stock.`);
        loadKpis();
        loadBatches();
      }
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Migration failed');
    } finally {
      setMigrating(false);
    }
  };

  // Export to Excel / CSV with Vendor details
  const handleExportCSV = async () => {
    setExporting(true);
    try {
      toast.loading('Preparing complete batch report…', { id: 'csv-export' });
      const res = await batches_api.get_expiry_report({
        window: expiryWindow,
        custom_days: expiryWindow === 'custom' && customDays ? Number(customDays) : undefined,
        supplier_id: selectedSupplierId ? Number(selectedSupplierId) : undefined,
        location_id: selectedLocationId,
        has_stock_only: hasStockOnly,
        search: searchQuery || undefined,
        page: 1,
        limit: 5000,
      });
      toast.dismiss('csv-export');

      const rows = res.data.data || [];
      if (rows.length === 0) {
        toast.error('No batch records found to export');
        return;
      }

      const headers = [
        'Batch No',
        'Supplier Lot',
        'Item Code',
        'Product Name',
        'Category',
        'Brand',
        'Mfg Date',
        'Expiry Date',
        'Days Left',
        'Available Qty',
        'Cost Rate (INR)',
        'MRP (INR)',
        'Value At Risk Cost (INR)',
        'Value At Risk MRP (INR)',
        'Vendor Code',
        'Vendor Name',
        'Vendor Mobile',
        'Vendor Contact Person',
        'Vendor Email',
        'Status'
      ];

      const csvRows = [
        headers.join(','),
        ...rows.map(r => [
          `"${(r.batch_no || '').replace(/"/g, '""')}"`,
          `"${(r.supplier_batch_no || '').replace(/"/g, '""')}"`,
          `"${(r.item_code || '').replace(/"/g, '""')}"`,
          `"${(r.product_name || '').replace(/"/g, '""')}"`,
          `"${(r.category_name || '').replace(/"/g, '""')}"`,
          `"${(r.brand_name || '').replace(/"/g, '""')}"`,
          `"${r.mfg_date || ''}"`,
          `"${r.exp_date || ''}"`,
          `"${r.days_to_expiry !== null && r.days_to_expiry !== undefined ? r.days_to_expiry : ''}"`,
          Number(r.total_stock || 0),
          Number(r.cost_price || r.purchase_rate || 0).toFixed(2),
          Number(r.mrp || 0).toFixed(2),
          Number(r.value_at_risk_cost || 0).toFixed(2),
          Number(r.value_at_risk_mrp || 0).toFixed(2),
          `"${(r.supplier_code || '').replace(/"/g, '""')}"`,
          `"${(r.supplier_name || '').replace(/"/g, '""')}"`,
          `"${(r.supplier_phone || '').replace(/"/g, '""')}"`,
          `"${(r.supplier_contact_name || '').replace(/"/g, '""')}"`,
          `"${(r.supplier_email || '').replace(/"/g, '""')}"`,
          `"${r.status || ''}"`
        ].join(','))
      ];

      const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `Batch_Expiry_Report_${expiryWindow}_days_${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success(`Exported ${rows.length} batch records with Vendor details to CSV/Excel`);
    } catch (err: any) {
      toast.dismiss('csv-export');
      toast.error('Failed to export batch report');
    } finally {
      setExporting(false);
    }
  };

  const handlePrint = async () => {
    if (total > batches.length && total <= 500) {
      const toastId = toast.loading('Preparing full report for print...');
      try {
        const res = await batches_api.get_expiry_report({
          window: expiryWindow,
          custom_days: expiryWindow === 'custom' && customDays ? Number(customDays) : undefined,
          supplier_id: selectedSupplierId ? Number(selectedSupplierId) : undefined,
          location_id: selectedLocationId,
          has_stock_only: hasStockOnly,
          search: searchQuery || undefined,
          page: 1,
          limit: 500,
        });
        setBatches(res.data.data || []);
        toast.dismiss(toastId);
        setTimeout(() => {
          window.print();
        }, 300);
      } catch {
        toast.dismiss(toastId);
        window.print();
      }
    } else {
      window.print();
    }
  };

  const selectedLoc = outlets.find(o => o.id === selectedLocationId);
  const selectedSup = suppliers.find(s => s.id === Number(selectedSupplierId));

  return (
    <div id="printable-expiry-report" className="printable-report p-4 sm:p-6 max-w-7xl mx-auto space-y-6 bg-white print:p-0 print:max-w-none print:space-y-3">
      {/* ── HEADER ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 print:hidden">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-500 flex items-center justify-center text-xl shadow-sm">
              <i className="fas fa-calendar-times"></i>
            </div>
            <div>
              <h1 className="text-2xl font-black text-slate-800 dark:text-white uppercase tracking-tight flex items-center gap-2">
                Batch & Expiry Report
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-800 font-bold normal-case">
                  Vendor-Linked
                </span>
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                Monitor 5-day, 15-day, and 30-day expiry windows, vendor contact details, and inventory value at risk.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Location filter */}
          <select
            value={selectedLocationId ?? ''}
            onChange={(e) => { setSelectedLocationId(e.target.value ? Number(e.target.value) : undefined); setPage(1); }}
            className="px-3.5 py-2 rounded-xl text-xs font-bold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 shadow-sm outline-none cursor-pointer"
          >
            <option value="">🏢 All Outlets / Warehouses</option>
            {outlets.map((o) => (
              <option key={o.id} value={o.id}>{o.outlet_name} ({o.unit_code})</option>
            ))}
          </select>

          {/* Export to CSV / Excel */}
          <button
            type="button"
            onClick={handleExportCSV}
            disabled={exporting}
            className="px-3.5 py-2 rounded-xl text-xs font-bold bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 text-emerald-700 transition-all shadow-sm flex items-center gap-1.5 disabled:opacity-50"
            title="Download Excel / CSV format with Vendor Phone Numbers & Values"
          >
            <i className={`fas ${exporting ? 'fa-spinner fa-spin' : 'fa-file-excel'} text-emerald-600`}></i>
            Export Excel
          </button>

          {/* Print Report */}
          <button
            type="button"
            onClick={handlePrint}
            className="px-3.5 py-2 rounded-xl text-xs font-bold bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-700 transition-all shadow-sm flex items-center gap-1.5"
            title="Print A4 Expiry Report"
          >
            <i className="fas fa-print text-slate-600"></i>
            Print Report
          </button>

          <button
            type="button"
            onClick={() => handleLegacyMigration(false)}
            disabled={migrating}
            className="px-3.5 py-2 rounded-xl text-xs font-bold bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100 transition-all flex items-center gap-1.5 shadow-sm disabled:opacity-50"
            title="Auto-creates opening batches for legacy products with positive stock that lack batches"
          >
            <i className={`fas ${migrating ? 'fa-spinner fa-spin' : 'fa-magic'} text-indigo-500`}></i>
            Migrate Legacy
          </button>

          <button
            type="button"
            onClick={() => navigate('/inventory/batches')}
            className="px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider bg-blue-600 hover:bg-blue-700 text-white transition-all shadow-md shadow-blue-500/20 flex items-center gap-1.5"
          >
            <i className="fas fa-cubes"></i> Batch Master
          </button>
        </div>
      </div>

      {/* ── PRINT-ONLY COMPANY HEADER ── */}
      <CompanyReportHeader
        title="BATCH EXPIRY & INVENTORY RISK REPORT"
        subtitle={`Filter: ${
          expiryWindow === 'all'
            ? 'All Batches'
            : expiryWindow === 'expired'
            ? 'Expired Stock'
            : `Expiring in ≤ ${expiryWindow === 'custom' ? customDays : expiryWindow} Days`
        }${selectedLoc ? ` | Location: ${selectedLoc.outlet_name}` : ' | All Outlets'}${
          selectedSup ? ` | Vendor: ${selectedSup.name}` : ''
        }${hasStockOnly ? ' | Positive Stock Only' : ''}`}
        metaItems={[
          { label: 'Total Batches', value: total },
          { label: 'Value At Risk (Cost)', value: `₹${(kpis.value_at_risk_cost || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}` },
          { label: 'Value At Risk (MRP)', value: `₹${(kpis.value_at_risk_mrp || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}` },
        ]}
        printOnly={true}
      />

      {/* ── PRINT-ONLY METRIC SUMMARY STRIP ── */}
      <div className="hidden print:grid grid-cols-4 gap-3 p-3 bg-slate-50 border border-slate-300 rounded-lg text-xs mb-3">
        <div>
          <span className="text-[10px] uppercase font-bold text-slate-500 block">Total Batches</span>
          <strong className="text-sm font-black text-slate-900">{total}</strong>
        </div>
        <div>
          <span className="text-[10px] uppercase font-bold text-rose-600 block">≤ 5 Days Urgent</span>
          <strong className="text-sm font-black text-rose-700">{kpis.near_expiry_5d ?? 0} Batches</strong>
        </div>
        <div>
          <span className="text-[10px] uppercase font-bold text-amber-600 block">≤ 15 Days Critical</span>
          <strong className="text-sm font-black text-amber-700">{kpis.near_expiry_15d ?? 0} Batches</strong>
        </div>
        <div>
          <span className="text-[10px] uppercase font-bold text-slate-500 block">Total Value At Risk (Cost)</span>
          <strong className="text-sm font-black text-rose-700">₹{Number(kpis.value_at_risk_cost || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</strong>
        </div>
      </div>

      {/* ── KPI METRICS CARDS ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3.5 print:hidden">
        {/* Next 5 Days (Urgent) */}
        <div
          onClick={() => { setExpiryWindow('5'); setPage(1); }}
          className={`border rounded-2xl p-4 shadow-sm cursor-pointer transition-all ${
            expiryWindow === '5'
              ? 'bg-rose-50 border-rose-400 ring-2 ring-rose-400'
              : 'bg-white hover:border-rose-300 border-slate-200'
          }`}
        >
          <div className="flex items-center justify-between text-slate-400 mb-1.5">
            <span className="text-[10px] font-black uppercase tracking-wider text-rose-700">Expiring &le; 5 Days</span>
            <span className="w-2.5 h-2.5 rounded-full bg-rose-600 animate-ping"></span>
          </div>
          <p className="text-2xl font-black text-rose-600 font-mono">{kpis.near_expiry_5d ?? 0}</p>
          <span className="text-[10px] text-rose-600 mt-1 block font-bold">🔴 Urgent Return/Sale</span>
        </div>

        {/* Next 15 Days (Critical) */}
        <div
          onClick={() => { setExpiryWindow('15'); setPage(1); }}
          className={`border rounded-2xl p-4 shadow-sm cursor-pointer transition-all ${
            expiryWindow === '15'
              ? 'bg-amber-50 border-amber-400 ring-2 ring-amber-400'
              : 'bg-white hover:border-amber-300 border-slate-200'
          }`}
        >
          <div className="flex items-center justify-between text-slate-400 mb-1.5">
            <span className="text-[10px] font-black uppercase tracking-wider text-amber-700">Expiring &le; 15 Days</span>
            <i className="fas fa-exclamation-triangle text-amber-500"></i>
          </div>
          <p className="text-2xl font-black text-amber-600 font-mono">{kpis.near_expiry_15d ?? 0}</p>
          <span className="text-[10px] text-amber-600 mt-1 block font-bold">🟠 Contact Vendor</span>
        </div>

        {/* Next 30 Days */}
        <div
          onClick={() => { setExpiryWindow('30'); setPage(1); }}
          className={`border rounded-2xl p-4 shadow-sm cursor-pointer transition-all ${
            expiryWindow === '30'
              ? 'bg-blue-50 border-blue-400 ring-2 ring-blue-400'
              : 'bg-white hover:border-blue-300 border-slate-200'
          }`}
        >
          <div className="flex items-center justify-between text-slate-400 mb-1.5">
            <span className="text-[10px] font-black uppercase tracking-wider text-blue-700">Expiring &le; 30 Days</span>
            <i className="fas fa-hourglass-half text-blue-500"></i>
          </div>
          <p className="text-2xl font-black text-blue-600 font-mono">{kpis.near_expiry_30d ?? 0}</p>
          <span className="text-[10px] text-blue-600 mt-1 block font-medium">30-day monitor</span>
        </div>

        {/* Expired Batches */}
        <div
          onClick={() => { setExpiryWindow('expired'); setPage(1); }}
          className={`border rounded-2xl p-4 shadow-sm cursor-pointer transition-all ${
            expiryWindow === 'expired'
              ? 'bg-red-50 border-red-500 ring-2 ring-red-500'
              : 'bg-white hover:border-red-300 border-slate-200'
          }`}
        >
          <div className="flex items-center justify-between text-slate-400 mb-1.5">
            <span className="text-[10px] font-black uppercase tracking-wider text-red-700">Expired Batches</span>
            <i className="fas fa-times-circle text-red-500"></i>
          </div>
          <p className="text-2xl font-black text-red-600 font-mono">{kpis.expired_batches ?? 0}</p>
          <span className="text-[10px] text-red-600 mt-1 block font-bold">Blocked From Sale</span>
        </div>

        {/* Active Batches */}
        <div
          onClick={() => { setExpiryWindow('all'); setPage(1); }}
          className={`border rounded-2xl p-4 shadow-sm cursor-pointer transition-all ${
            expiryWindow === 'all'
              ? 'bg-slate-50 border-slate-400 ring-2 ring-slate-400'
              : 'bg-white hover:border-slate-300 border-slate-200'
          }`}
        >
          <div className="flex items-center justify-between text-slate-400 mb-1.5">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-600">Active Batches</span>
            <i className="fas fa-check-circle text-emerald-500"></i>
          </div>
          <p className="text-2xl font-black text-emerald-600 font-mono">{kpis.active_batches ?? 0}</p>
          <span className="text-[10px] text-slate-400 mt-1 block font-medium">Total: {kpis.total_batches}</span>
        </div>

        {/* Stock Value At Risk */}
        <div className="bg-gradient-to-br from-rose-500/10 to-amber-500/10 border border-rose-500/20 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 mb-1.5">
            <span className="text-[10px] font-black uppercase tracking-wider text-rose-700">Cost at Risk</span>
            <i className="fas fa-rupee-sign text-rose-500"></i>
          </div>
          <p className="text-2xl font-black text-rose-600 font-mono">
            ₹{Number(kpis.value_at_risk_cost || kpis.stock_value_at_risk || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
          </p>
          <span className="text-[10px] text-slate-500 mt-1 block font-medium">
            MRP: ₹{Number(kpis.value_at_risk_mrp || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
          </span>
        </div>
      </div>

      {/* ── FILTER & SEARCH TOOLBAR ── */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-3.5 print:hidden">
        {/* Row 1: Expiry Window Pills */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 pb-3 border-b border-slate-100">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-bold text-slate-600 mr-1 flex items-center gap-1">
              <i className="fas fa-clock text-blue-500"></i> Expiry Window:
            </span>

            {[
              { label: 'All Batches', val: 'all' },
              { label: 'Expired (<0d)', val: 'expired', badgeClass: 'bg-red-100 text-red-700' },
              { label: '≤ 5 Days (Urgent)', val: '5', badgeClass: 'bg-rose-100 text-rose-800 font-black' },
              { label: '≤ 15 Days (Critical)', val: '15', badgeClass: 'bg-amber-100 text-amber-800 font-black' },
              { label: '≤ 30 Days', val: '30' },
              { label: '≤ 45 Days', val: '45' },
              { label: '≤ 60 Days', val: '60' },
              { label: '≤ 90 Days', val: '90' },
            ].map((w) => (
              <button
                key={w.val}
                type="button"
                onClick={() => { setExpiryWindow(w.val); setPage(1); }}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all border ${
                  expiryWindow === w.val
                    ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                    : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                }`}
              >
                {w.label}
              </button>
            ))}

            {/* Custom Days Input */}
            <div className="flex items-center gap-1 ml-1 bg-slate-50 px-2 py-1 rounded-xl border border-slate-200">
              <span className="text-[11px] font-bold text-slate-500">Custom Days:</span>
              <input
                type="number"
                min="1"
                max="365"
                placeholder="e.g. 10"
                value={customDays}
                onChange={(e) => {
                  setCustomDays(e.target.value);
                  setExpiryWindow('custom');
                  setPage(1);
                }}
                className="w-16 px-2 py-0.5 text-xs font-bold border border-slate-300 rounded-lg outline-none bg-white text-center focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Holding Stock Only checkbox */}
          <label className="flex items-center gap-2 cursor-pointer select-none text-xs font-bold text-slate-700 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200 hover:bg-slate-100">
            <input
              type="checkbox"
              checked={hasStockOnly}
              onChange={(e) => { setHasStockOnly(e.target.checked); setPage(1); }}
              className="rounded text-blue-600 focus:ring-blue-500 w-3.5 h-3.5"
            />
            <span>Holding Positive Stock Only ({'>'}0)</span>
          </label>
        </div>

        {/* Row 2: Search, Supplier Filter & Status Filter */}
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
          {/* Search Form */}
          <form onSubmit={handleSearch} className="flex-1 flex gap-2">
            <div className="relative flex-1">
              <i className="fas fa-search absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
              <input
                type="text"
                placeholder="Search Product Name, Item Code, Batch No, Supplier Lot, or Barcode..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-medium"
              />
            </div>
            <button
              type="submit"
              className="px-4 py-2 bg-slate-900 text-white hover:bg-slate-800 rounded-xl text-xs font-bold transition-all shadow-sm"
            >
              Search
            </button>
            {searchQuery && (
              <button
                type="button"
                onClick={() => { setSearchQuery(''); setPage(1); }}
                className="px-3 py-2 text-slate-400 hover:text-slate-600 text-xs font-semibold"
              >
                Clear
              </button>
            )}
          </form>

          {/* Supplier / Vendor Filter Dropdown */}
          <div className="flex items-center gap-2">
            <select
              value={selectedSupplierId}
              onChange={(e) => { setSelectedSupplierId(e.target.value ? Number(e.target.value) : ''); setPage(1); }}
              className="px-3 py-2 rounded-xl text-xs font-bold bg-white border border-slate-200 text-slate-700 shadow-sm outline-none max-w-[240px] truncate"
            >
              <option value="">🏢 All Vendors / Suppliers</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} {s.phone ? `(${s.phone})` : ''}
                </option>
              ))}
            </select>

            {/* Status Dropdown */}
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
              className="px-3 py-2 rounded-xl text-xs font-bold bg-white border border-slate-200 text-slate-700 outline-none"
            >
              <option value="">All Statuses</option>
              <option value="Active">Active</option>
              <option value="Near Expiry">Near Expiry</option>
              <option value="Expired">Expired</option>
              <option value="Quarantined">Quarantined</option>
              <option value="Recalled">Recalled</option>
              <option value="Closed">Closed</option>
            </select>
          </div>
        </div>
      </div>

      {/* ── REPORT SUMMARY BANNER ── */}
      {reportSummary && (
        <div className="bg-slate-900 text-white rounded-2xl p-4 shadow-sm flex flex-wrap items-center justify-between gap-4 text-xs font-medium">
          <div className="flex items-center gap-6 flex-wrap">
            <div>
              <span className="text-slate-400 block text-[10px] uppercase font-bold">Filtered Batches</span>
              <span className="font-mono text-base font-black text-white">{reportSummary.total_records} Records</span>
            </div>
            <div>
              <span className="text-slate-400 block text-[10px] uppercase font-bold">Total Stock Units</span>
              <span className="font-mono text-base font-black text-emerald-400">{Number(reportSummary.total_stock_units).toLocaleString()}</span>
            </div>
            <div>
              <span className="text-slate-400 block text-[10px] uppercase font-bold">Total Value at Risk (Cost)</span>
              <span className="font-mono text-base font-black text-rose-400">
                ₹{Number(reportSummary.total_cost_value).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
              </span>
            </div>
            <div>
              <span className="text-slate-400 block text-[10px] uppercase font-bold">Total MRP Value</span>
              <span className="font-mono text-base font-black text-blue-400">
                ₹{Number(reportSummary.total_mrp_value).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 text-[11px]">
            <span className="px-2.5 py-1 rounded-lg bg-rose-900/60 text-rose-300 font-bold border border-rose-800">
              🔴 ≤5d: {reportSummary.next_5d_count}
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-amber-900/60 text-amber-300 font-bold border border-amber-800">
              🟠 ≤15d: {reportSummary.next_15d_count}
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-red-900/60 text-red-300 font-bold border border-red-800">
              Expired: {reportSummary.expired_count}
            </span>
          </div>
        </div>
      )}

      {/* ── BATCHES TABLE ── */}
      <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-sm print:border-0 print:shadow-none print:rounded-none print:overflow-visible">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between print:hidden">
          <div className="flex items-center gap-2">
            <span className="text-xs font-black uppercase tracking-wider text-slate-700">
              Monitored Batch Registry
            </span>
            <span className="px-2 py-0.5 rounded-full bg-slate-100 text-[10px] font-bold text-slate-500 font-mono">
              {total} Batches Found
            </span>
          </div>

          <button
            type="button"
            onClick={loadBatches}
            className="text-xs text-blue-600 hover:underline flex items-center gap-1 font-bold"
          >
            <i className="fas fa-sync-alt"></i> Refresh
          </button>
        </div>

        {loading ? (
          <div className="py-20 text-center text-slate-400">
            <i className="fas fa-spinner fa-spin text-3xl mb-3 text-blue-500/40"></i>
            <p className="text-xs font-medium">Scanning batch register & vendor contact records...</p>
          </div>
        ) : batches.length === 0 ? (
          <div className="py-20 text-center text-slate-400">
            <i className="fas fa-clipboard-check text-4xl mb-3 opacity-20"></i>
            <p className="text-sm font-bold uppercase tracking-wider">No batches matched your filter criteria</p>
            <p className="text-xs text-slate-400 mt-1">Try resetting the date window or vendor filters above.</p>
          </div>
        ) : (
          <div className="overflow-x-auto print:overflow-visible">
            <table className="w-full text-left text-xs print:text-[9px] print:w-full">
              <thead className="bg-slate-50 uppercase text-[10px] font-black text-slate-400 tracking-wider border-b border-slate-100 print:bg-slate-100 print:text-slate-900 print:border-b-2 print:border-slate-800">
                <tr>
                  <th className="px-3.5 py-3 print:px-2 print:py-1.5 print:border print:border-slate-300">Batch & Lot</th>
                  <th className="px-3.5 py-3 print:px-2 print:py-1.5 print:border print:border-slate-300">Product / Item</th>
                  <th className="px-3.5 py-3 print:px-2 print:py-1.5 print:border print:border-slate-300">Mfg & Exp Dates</th>
                  <th className="px-3.5 py-3 print:px-2 print:py-1.5 print:border print:border-slate-300">Days Left</th>
                  <th className="px-3.5 py-3 text-right print:px-2 print:py-1.5 print:border print:border-slate-300">Available Qty</th>
                  <th className="px-3.5 py-3 text-right print:px-2 print:py-1.5 print:border print:border-slate-300">Cost & MRP</th>
                  <th className="px-3.5 py-3 text-right print:px-2 print:py-1.5 print:border print:border-slate-300">Value At Risk</th>
                  <th className="px-4 py-3 bg-blue-50/60 text-blue-900 border-x border-blue-100 print:px-2 print:py-1.5 print:bg-slate-100 print:text-slate-900 print:border print:border-slate-300">
                    Vendor / Supplier & Mobile #
                  </th>
                  <th className="px-3.5 py-3 text-center print:px-2 print:py-1.5 print:border print:border-slate-300">Status</th>
                  <th className="px-3.5 py-3 text-right print:hidden">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {batches.map((b) => {
                  const days = b.days_to_expiry;
                  const isExpired = b.status === 'Expired' || (days !== null && days !== undefined && days <= 0);
                  const isUnder5d = days !== null && days !== undefined && days > 0 && days <= 5;
                  const isUnder15d = days !== null && days !== undefined && days > 5 && days <= 15;
                  const isUnder30d = days !== null && days !== undefined && days > 15 && days <= 30;

                  // Clean phone number for WhatsApp link
                  const cleanPhone = (b.supplier_phone || '').replace(/[^0-9]/g, '');
                  const waNumber = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;

                  return (
                    <tr
                      key={b.id}
                      className={`hover:bg-slate-50/80 transition-colors ${
                        isExpired
                          ? 'bg-rose-50/30'
                          : isUnder5d
                          ? 'bg-red-50/40'
                          : isUnder15d
                          ? 'bg-amber-50/30'
                          : ''
                      }`}
                    >
                      {/* Batch & Lot */}
                      <td className="px-3.5 py-3.5 whitespace-nowrap print:px-2 print:py-1 print:border print:border-slate-300">
                        <div className="font-mono font-black text-blue-600 text-xs print:text-[9.5px] print:text-slate-900">
                          {b.batch_no}
                        </div>
                        {b.supplier_batch_no && (
                          <span className="text-[10px] text-slate-500 block mt-0.5 print:text-[8px]">
                            Lot: <span className="font-semibold">{b.supplier_batch_no}</span>
                          </span>
                        )}
                      </td>

                      {/* Product Name & Code */}
                      <td className="px-3.5 py-3.5 max-w-[220px] print:px-2 print:py-1 print:border print:border-slate-300">
                        <span className="font-bold text-slate-800 block truncate print:whitespace-normal print:text-[9.5px]" title={b.product_name}>
                          {b.product_name || `Product #${b.product_id}`}
                        </span>
                        <div className="flex items-center gap-1.5 text-[10px] text-slate-500 mt-0.5 font-mono print:text-[8px]">
                          <span>Code: {b.item_code || `#${b.product_id}`}</span>
                          {b.category_name && (
                            <span className="text-slate-400">· {b.category_name}</span>
                          )}
                        </div>
                      </td>

                      {/* Dates */}
                      <td className="px-3.5 py-3.5 whitespace-nowrap print:px-2 print:py-1 print:border print:border-slate-300">
                        <div className="text-[11px] print:text-[9px]">
                          <span className="text-slate-400 font-bold uppercase text-[9px] mr-1 print:text-slate-600">Exp:</span>
                          <span className={isExpired ? 'text-rose-600 font-black' : isUnder5d ? 'text-red-600 font-black' : isUnder15d ? 'text-amber-600 font-bold' : 'font-semibold text-slate-700'}>
                            {b.exp_date || '—'}
                          </span>
                        </div>
                        {b.mfg_date && (
                          <div className="text-[10px] text-slate-400 mt-0.5 print:text-[8px]">
                            <span className="uppercase text-[9px] mr-1 print:text-slate-600">Mfg:</span>
                            {b.mfg_date}
                          </div>
                        )}
                      </td>

                      {/* Days Left Countdown */}
                      <td className="px-3.5 py-3.5 whitespace-nowrap print:px-2 print:py-1 print:border print:border-slate-300">
                        {days !== null && days !== undefined ? (
                          <div className="flex items-center gap-1.5">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] print:text-[8.5px] font-black uppercase tracking-wider flex items-center gap-1 ${
                              days <= 0
                                ? 'bg-rose-100 text-rose-800 border border-rose-300'
                                : days <= 5
                                ? 'bg-red-100 text-red-800 border border-red-300 animate-pulse'
                                : days <= 15
                                ? 'bg-amber-100 text-amber-800 border border-amber-300'
                                : days <= 30
                                ? 'bg-blue-100 text-blue-800 border border-blue-200'
                                : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                            }`}>
                              {days <= 0 ? (
                                <>
                                  <i className="fas fa-exclamation-circle text-[9px]"></i>
                                  Expired ({Math.abs(days)}d ago)
                                </>
                              ) : days <= 5 ? (
                                <>
                                  <i className="fas fa-fire text-[9px] text-red-600"></i>
                                  {days} Days Left
                                </>
                              ) : days <= 15 ? (
                                <>
                                  <i className="fas fa-hourglass-end text-[9px] text-amber-600"></i>
                                  {days} Days Left
                                </>
                              ) : (
                                `${days} Days Left`
                              )}
                            </span>
                          </div>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>

                      {/* Available Qty */}
                      <td className="px-3.5 py-3.5 text-right font-black font-mono text-sm text-slate-800 print:px-2 print:py-1 print:border print:border-slate-300 print:text-[9.5px]">
                        {Number(b.total_stock ?? b.total_current_qty ?? 0).toLocaleString()}
                      </td>

                      {/* Rate & MRP */}
                      <td className="px-3.5 py-3.5 text-right whitespace-nowrap print:px-2 print:py-1 print:border print:border-slate-300">
                        <div className="font-mono text-slate-700 print:text-[9px]">
                          Cost: ₹{Number(b.purchase_rate || b.cost_price || 0).toFixed(2)}
                        </div>
                        <div className="text-[10px] font-mono text-slate-400 print:text-[8px]">
                          MRP: ₹{Number(b.mrp || 0).toFixed(2)}
                        </div>
                      </td>

                      {/* Value At Risk */}
                      <td className="px-3.5 py-3.5 text-right whitespace-nowrap print:px-2 print:py-1 print:border print:border-slate-300">
                        <div className="font-mono font-black text-rose-600 print:text-[9.5px]">
                          ₹{Number(b.value_at_risk_cost || (Number(b.total_stock || 0) * Number(b.cost_price || 0))).toFixed(2)}
                        </div>
                        <div className="text-[10px] font-mono text-slate-400 print:text-[8px]">
                          MRP: ₹{Number(b.value_at_risk_mrp || (Number(b.total_stock || 0) * Number(b.mrp || 0))).toFixed(2)}
                        </div>
                      </td>

                      {/* ── VENDOR / SUPPLIER & MOBILE NUMBER ── */}
                      <td className="px-4 py-3.5 bg-blue-50/40 border-x border-blue-100 max-w-[240px] print:px-2 print:py-1 print:bg-white print:border print:border-slate-300">
                        {b.supplier_name ? (
                          <div>
                            <div className="font-bold text-slate-800 text-xs print:text-[9.5px] truncate print:whitespace-normal" title={b.supplier_name}>
                              {b.supplier_name}
                            </div>

                            {/* Mobile Number & Call / WhatsApp Actions */}
                            {b.supplier_phone ? (
                              <div className="mt-1 flex items-center gap-2 flex-wrap print:mt-0.5">
                                <span className="hidden print:inline-block font-mono font-bold text-[9px] text-slate-900">
                                  📞 {b.supplier_phone}
                                </span>
                                <a
                                  href={`tel:${b.supplier_phone}`}
                                  className="inline-flex print:hidden items-center gap-1 text-[11px] font-black text-blue-700 hover:text-blue-900 bg-white px-2 py-0.5 rounded-md border border-blue-200 shadow-2xs"
                                  title="Click to call vendor"
                                >
                                  <i className="fas fa-phone-alt text-[9px] text-blue-500"></i>
                                  <span>{b.supplier_phone}</span>
                                </a>

                                {waNumber && (
                                  <a
                                    href={`https://wa.me/${waNumber}?text=${encodeURIComponent(
                                      `Hello ${b.supplier_name}, regarding Product "${b.product_name}" (Batch: ${b.batch_no}), expiry is on ${b.exp_date} (${days !== null && days !== undefined && days <= 0 ? 'Expired' : `${days} days left`}). Total stock: ${b.total_stock}. Please arrange return/replacement.`
                                    )}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-0.5 text-[10px] font-bold text-emerald-700 hover:text-emerald-900 bg-emerald-50 px-1.5 py-0.5 rounded-md border border-emerald-300 print:hidden"
                                    title="Send WhatsApp alert to vendor"
                                  >
                                    <i className="fab fa-whatsapp text-emerald-600"></i>
                                    <span>WA</span>
                                  </a>
                                )}
                              </div>
                            ) : (
                              <span className="text-[10px] text-slate-400 italic block mt-0.5 print:text-[8px]">
                                No mobile on file
                              </span>
                            )}

                            {/* Contact Person Name */}
                            {b.supplier_contact_name && (
                              <span className="text-[10px] text-slate-500 block mt-0.5 truncate print:text-[8px]">
                                Attn: {b.supplier_contact_name}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400 italic print:text-[8.5px]">— No Vendor Linked —</span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="px-3.5 py-3.5 text-center whitespace-nowrap print:px-2 print:py-1 print:border print:border-slate-300">
                        <span className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] print:text-[8.5px] font-black uppercase tracking-wider ${
                          b.status === 'Active' ? 'bg-emerald-100 text-emerald-800' :
                          b.status === 'Near Expiry' ? 'bg-amber-100 text-amber-800' :
                          b.status === 'Expired' ? 'bg-rose-100 text-rose-800' :
                          b.status === 'Quarantined' ? 'bg-purple-100 text-purple-800' :
                          b.status === 'Recalled' ? 'bg-red-100 text-red-900' :
                          'bg-slate-100 text-slate-700'
                        }`}>
                          {b.status}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="px-3.5 py-3.5 text-right whitespace-nowrap print:hidden">
                        <div className="flex items-center justify-end gap-1.5">
                          {b.status !== 'Quarantined' && (
                            <button
                              type="button"
                              onClick={() => setStatusModal({ open: true, batch: b, newStatus: 'Quarantined', reason: '' })}
                              className="px-2 py-1 rounded bg-purple-50 text-purple-700 hover:bg-purple-100 text-[10px] font-bold transition-all border border-purple-200"
                              title="Hold / Quarantine batch"
                            >
                              Hold
                            </button>
                          )}
                          {b.status === 'Quarantined' && (
                            <button
                              type="button"
                              onClick={() => setStatusModal({ open: true, batch: b, newStatus: 'Active', reason: '' })}
                              className="px-2 py-1 rounded bg-emerald-50 text-emerald-700 hover:bg-emerald-100 text-[10px] font-bold transition-all border border-emerald-200"
                              title="Release back to Active status"
                            >
                              Release
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => navigate(`/products/edit/${b.product_id}`)}
                            className="p-1 rounded text-slate-400 hover:text-blue-600 transition-colors"
                            title="Edit Item Master"
                          >
                            <i className="fas fa-edit"></i>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ── PAGINATION ── */}
        <div className="p-4 border-t border-slate-100 flex items-center justify-between print:hidden">
          <span className="text-[11px] text-slate-500 font-medium">
            Showing {batches.length} of {total} batches
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage(p => Math.max(1, p - 1))}
              className="px-3 py-1 rounded-lg text-xs font-bold border border-slate-200 disabled:opacity-40 hover:bg-slate-100"
            >
              Previous
            </button>
            <span className="text-xs font-bold text-slate-700 px-2 font-mono">
              Page {page} of {Math.max(1, Math.ceil(total / perPage))}
            </span>
            <button
              type="button"
              disabled={page * perPage >= total}
              onClick={() => setPage(p => p + 1)}
              className="px-3 py-1 rounded-lg text-xs font-bold border border-slate-200 disabled:opacity-40 hover:bg-slate-100"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {/* ── STATUS CHANGE AUDIT MODAL ── */}
      {statusModal.open && statusModal.batch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 print:hidden">
          <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-slate-100">
              <h3 className="text-base font-black uppercase tracking-tight text-slate-800 flex items-center gap-2">
                <i className="fas fa-shield-alt text-amber-500"></i> Update Batch Status
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                Changing status will impact sale eligibility across POS billing and warehouse dispatch.
              </p>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-[10px] font-black uppercase text-slate-400 mb-1">Target Batch</label>
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 font-mono text-xs">
                  <div className="font-bold text-blue-600">{statusModal.batch.batch_no}</div>
                  <div className="text-slate-500 text-[11px] font-sans mt-0.5">{statusModal.batch.product_name}</div>
                  {statusModal.batch.supplier_name && (
                    <div className="text-slate-600 text-[11px] font-sans mt-0.5 font-bold">
                      Vendor: {statusModal.batch.supplier_name} {statusModal.batch.supplier_phone ? `(${statusModal.batch.supplier_phone})` : ''}
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-black uppercase text-slate-400 mb-1">New Status</label>
                <select
                  value={statusModal.newStatus}
                  onChange={(e) => setStatusModal(prev => ({ ...prev, newStatus: e.target.value }))}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-xs font-bold outline-none"
                >
                  <option value="Active">Active (Normal Operations)</option>
                  <option value="Quarantined">Quarantined (Quality Hold / Inspection)</option>
                  <option value="Recalled">Recalled (Manufacturer Recall)</option>
                  <option value="Expired">Expired (Damaged / Date Elapsed)</option>
                  <option value="Closed">Closed (Zero balance / Discontinued)</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-black uppercase text-slate-400 mb-1">Audit Reason / Notes</label>
                <textarea
                  rows={3}
                  value={statusModal.reason}
                  onChange={(e) => setStatusModal(prev => ({ ...prev, reason: e.target.value }))}
                  placeholder="State reason for compliance / audit log (e.g. Near expiry return to vendor, broken seal)..."
                  className="w-full p-3 rounded-xl border border-slate-200 bg-slate-50 text-xs outline-none focus:ring-2 focus:ring-blue-500/20"
                ></textarea>
              </div>
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setStatusModal({ open: false, batch: null, newStatus: 'Quarantined', reason: '' })}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-200/60 transition-all"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleUpdateStatus}
                className="px-5 py-2 rounded-xl text-xs font-black uppercase tracking-wider bg-blue-600 hover:bg-blue-700 text-white shadow-md transition-all"
              >
                Confirm Status
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

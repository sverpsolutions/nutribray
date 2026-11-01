import { matchesSearch } from '../../utils/search';
import React, { useState, useEffect } from 'react';
import api from '../../api/axios';
import CompanyReportHeader from '../../components/common/CompanyReportHeader';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import { 
  ChevronDown, Download, Filter, Printer, RefreshCw, 
  Search, Grid, List as ListIcon, TrendingDown, AlertTriangle, 
  Package, DollarSign, LayoutGrid, X, CheckSquare, Square, Plus, Trash2,
  FileText, IndianRupee, Layers, Tag, Mail, FileDown, Database, Folder,
  ShieldCheck
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import toast from 'react-hot-toast';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const fmt = (n: any) => {
  const val = typeof n === 'string' ? parseFloat(n) : n;
  return Number(val || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const cur = (n: any) => `₹${fmt(n)}`;

const StockReport = () => {
  const [activeTab, setActiveTab] = useState<'summary' | 'detail'>('summary');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const [filtersData, setFiltersData] = useState<any>(null);

  const [search, setSearch] = useState('');
  const [selectedOutlets, setSelectedOutlets] = useState<number[]>([]);
  const [activeFilters, setActiveFilters] = useState<any[]>([]);
  
  const [currentFilterType, setCurrentFilterType] = useState('group');
  const [currentFilterIds, setCurrentFilterIds] = useState<number[]>([]);

  const [fromDate, setFromDate] = useState(new Date().toISOString().split('T')[0]);
  const [toDate, setToDate] = useState(new Date().toISOString().split('T')[0]);
  const [groupBy, setGroupBy] = useState('outlet');
  const [filterFlags, setFilterFlags] = useState({
    active_only: false,
    low_stock: false,
    negative_stock: false,
    zero_stock: false
  });

  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailTo, setEmailTo] = useState('');
  const [sendingEmail, setSendingEmail] = useState(false);

  useEffect(() => {
    const fetchFilters = async () => {
      try {
        const res = await api.get(`/stock-reports/filters`);
        setFiltersData(res.data);
      } catch (err) { console.error("Failed to fetch filters", err); }
    };
    fetchFilters();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const endpoint = activeTab === 'summary' ? '/stock-reports/summary' : '/stock-reports/detail';
      const params: any = {
        search,
        active_only: filterFlags.active_only,
        low_stock: filterFlags.low_stock,
        negative_stock: filterFlags.negative_stock,
        zero_stock: filterFlags.zero_stock,
      };

      if (selectedOutlets.length) params.outlet_ids = selectedOutlets;
      activeFilters.forEach(f => { params[`${f.type}_ids`] = f.ids; });

      if (activeTab === 'summary') params.group_by = groupBy;
      else { params.from_date = fromDate; params.to_date = toDate; }

      const res = await api.get(endpoint, { params, paramsSerializer: { indexes: null } });
      setData(res.data);
    } catch (err) { console.error("Failed to fetch stock data", err); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, [activeTab, groupBy, activeFilters, selectedOutlets, filterFlags]);

  const handleAddFilter = () => {
    if (currentFilterIds.length === 0) return;
    const typeLabel = filterTypes.find(t => t.id === currentFilterType)?.label;
    const names = currentFilterIds.map(id => {
      const list = filtersData[currentFilterType + 's'] || [];
      return list.find((o: any) => o.id === id)?.name;
    }).filter(Boolean);
    
    const existingIndex = activeFilters.findIndex(f => f.type === currentFilterType);
    if (existingIndex > -1) {
      const newFilters = [...activeFilters];
      newFilters[existingIndex] = { type: currentFilterType, label: typeLabel, ids: currentFilterIds, names };
      setActiveFilters(newFilters);
    } else {
      setActiveFilters([...activeFilters, { type: currentFilterType, label: typeLabel, ids: currentFilterIds, names }]);
    }
    setCurrentFilterIds([]);
  };

  const removeFilter = (type: string) => {
    setActiveFilters(activeFilters.filter(f => f.type !== type));
  };

  const filterTypes = [
    { id: 'group', label: 'Item Group' },
    { id: 'subgroup', label: 'Sub Group' },
    { id: 'category', label: 'Category' },
    { id: 'subcategory', label: 'Sub Category' },
    { id: 'brand', label: 'Brand' },
    { id: 'subbrand', label: 'Sub Brand' },
    { id: 'manufacturer', label: 'Manufacturer' },
    { id: 'submanufacturer', label: 'Sub Manufacturer' },
    { id: 'supplier', label: 'Supplier' },
  ];

  const MultiSelect = ({ label, options = [], selected, setSelected, className }: any) => {
    const [open, setOpen] = useState(false);
    const [searchQ, setSearchQ] = useState('');
    
    const filteredOptions = options?.filter((o: any) => matchesSearch(searchQ, o.name)) || [];

    return (
      <div className={cn("relative", className)}>
        <div onClick={() => setOpen(!open)} className="bg-white border border-slate-200 rounded-lg p-2 h-10 flex justify-between items-center cursor-pointer hover:border-indigo-400 transition-colors">
          <span className="text-xs truncate w-full">
            {selected.length === 0 ? label : `${selected.length} Selected`}
          </span>
          <ChevronDown size={14} className={cn("transition-transform shrink-0", open && "rotate-180")} />
        </div>
        {open && (
          <div className="absolute z-[9999] mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-2xl overflow-hidden min-w-[200px]">
            <div className="p-2 border-b border-slate-100 bg-slate-50">
               <input 
                 type="text" 
                 placeholder="Search..." 
                 className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded outline-none focus:border-indigo-400"
                 value={searchQ}
                 onChange={e => setSearchQ(e.target.value)}
                 onClick={e => e.stopPropagation()}
                 autoFocus
               />
            </div>
            <div className="max-h-60 overflow-y-auto">
              <div className="p-2 text-xs font-bold text-indigo-600 border-b border-slate-100 cursor-pointer hover:bg-indigo-50" 
                   onClick={() => selected.length === (options?.length || 0) ? setSelected([]) : setSelected(options.map((o: any) => o.id))}>
                {selected.length === (options?.length || 0) ? "Deselect All" : "Select All"}
              </div>
              {filteredOptions.length === 0 && (
                <div className="p-3 text-xs text-center text-slate-400">No results found</div>
              )}
              {filteredOptions.map((opt: any) => (
                <div key={opt.id} onClick={() => selected.includes(opt.id) ? setSelected(selected.filter((id: any) => id !== opt.id)) : setSelected([...selected, opt.id])} className="p-2 text-xs flex items-center gap-2 hover:bg-slate-50 cursor-pointer">
                  {selected.includes(opt.id) ? <CheckSquare size={14} className="text-indigo-600 shrink-0" /> : <Square size={14} className="text-slate-300 shrink-0" />}
                  <span className="truncate">{opt.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  const handleExportExcel = async () => {
    if (!data || !data.rows) return;
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(activeTab === 'summary' ? 'Stock Summary' : 'Stock Detail');
    worksheet.mergeCells('A1:P1');
    worksheet.getCell('A1').value = `Stock ${activeTab.charAt(0).toUpperCase() + activeTab.slice(1)} Report`;
    worksheet.getCell('A1').font = { size: 16, bold: true };
    worksheet.getCell('A1').alignment = { horizontal: 'center' };
    let headers = activeTab === 'summary' 
      ? ['Outlet Name', 'Qty', 'Basic_Cost', 'GST', 'Cost_Valu', 'MrpValue', 'DiscountV', 'SP_Value']
      : ['Date', 'Voucher #', 'Type', 'Outlet', 'Item Code', 'Item Name', 'IN', 'OUT', 'Balance', 'Rate', 'Value', 'User'];
    const headerRow = worksheet.addRow(headers);
    headerRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
      cell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
    });
    data.rows.forEach((r: any) => {
      if (activeTab === 'summary') {
        worksheet.addRow([r.outlet, +r.current_stock, +r.basic_value, +r.tax_value, +r.stock_value, +r.mrp_value, +r.discount_value, +r.selling_value]);
      } else {
        worksheet.addRow([r.date, r.voucher_no, r.transaction_type, r.outlet, r.item_code, r.item_name, +r.in_qty, +r.out_qty, +r.closing_qty, +r.cost_rate, +r.stock_value, r.user_name]);
      }
    });
    const buffer = await workbook.xlsx.writeBuffer();
    saveAs(new Blob([buffer]), `Stock_${activeTab}_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const handleSendEmail = async () => {
    if (!emailTo) { toast.error("Please enter an email address"); return; }
    setSendingEmail(true);
    try {
      await api.post('/stock-reports/email', { email: emailTo, report_type: activeTab });
      toast.success(`Report sent successfully to ${emailTo}`);
      setShowEmailModal(false);
    } catch (err) { toast.error("Failed to send email"); }
    finally { setSendingEmail(false); }
  };

  const SummaryCards = () => {
    const s = data?.dashboard || {};
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-9 gap-3 mb-6 no-print">
        {[
          { label: 'Total Qty', value: s.total_qty, icon: Package, color: 'text-blue-600', bg: 'bg-blue-50' },
          { label: 'Basic Value', value: cur(s.total_basic_value), icon: Layers, color: 'text-slate-600', bg: 'bg-slate-50' },
          { label: 'Total GST', value: cur(s.total_tax_value), icon: FileText, color: 'text-indigo-600', bg: 'bg-indigo-50' },
          { label: 'Cost Value', value: cur(s.total_value), icon: IndianRupee, color: 'text-emerald-600', bg: 'bg-emerald-50' },
          { label: 'MRP Value', value: cur(s.total_mrp_value), icon: TrendingDown, color: 'text-orange-600', bg: 'bg-orange-50' },
          { label: 'Sales Value', value: cur(s.total_selling_value), icon: DollarSign, color: 'text-purple-600', bg: 'bg-purple-50' },
          { label: 'Discount', value: cur(s.total_discount_value), icon: Tag, color: 'text-rose-600', bg: 'bg-rose-50' },
          { label: 'Neg Items', value: s.negative_items, icon: AlertTriangle, color: 'text-rose-600', bg: 'bg-rose-50' },
          { label: 'Zero Items', value: s.zero_items, icon: Grid, color: 'text-amber-600', bg: 'bg-amber-50' },
        ].map((card, i) => (
          <div key={i} className="bg-white p-3 rounded-2xl shadow-sm border border-slate-100 flex flex-col items-center text-center">
            <div className={cn("p-1.5 rounded-lg mb-2", card.bg)}><card.icon size={16} className={card.color} /></div>
            <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1">{card.label}</div>
            <div className={cn("text-xs font-black", card.color)}>{card.value}</div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-[calc(100vh-100px)] bg-slate-50 -my-6 mr-3 ml-3 rounded-2xl overflow-hidden shadow-sm print:h-auto print:overflow-visible print:m-0 print:rounded-none print:shadow-none print:bg-white printable-report">
      {/* Top Filter Bar */}
      <div className="bg-white border-b border-slate-200 p-4 space-y-4 no-print relative z-50">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">View Mode:</span>
            <div className="flex bg-slate-200/50 p-1 rounded-xl border border-slate-200">
              <button onClick={() => setActiveTab('summary')} className={cn("px-6 py-2 text-xs font-bold rounded-lg transition-all flex items-center gap-2", activeTab === 'summary' ? "bg-white text-indigo-600 shadow-md scale-105" : "text-slate-500 hover:text-slate-800 hover:bg-slate-200/50")}><LayoutGrid size={16} /> Stock Summary</button>
              <button onClick={() => setActiveTab('detail')} className={cn("px-6 py-2 text-xs font-bold rounded-lg transition-all flex items-center gap-2", activeTab === 'detail' ? "bg-white text-indigo-600 shadow-md scale-105" : "text-slate-500 hover:text-slate-800 hover:bg-slate-200/50")}><ListIcon size={16} /> Stock Ledger</button>
            </div>
          </div>

          <div className="h-8 w-[1px] bg-slate-200 mx-2"></div>

          <div className="flex items-center gap-2">
            <div className="relative w-64">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input type="text" placeholder="Search Items/Barcodes..." className="w-full pl-9 pr-4 py-2 text-xs border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500/20 outline-none" value={search} onChange={e => setSearch(e.target.value)}/>
            </div>
            
            <MultiSelect label="Select Outlets" options={filtersData?.outlets} selected={selectedOutlets} setSelected={setSelectedOutlets} className="w-48" />

            {activeTab === 'detail' && (
               <>
                <input type="date" className="p-2 text-xs border border-slate-200 rounded-lg h-10" value={fromDate} onChange={e => setFromDate(e.target.value)} />
                <input type="date" className="p-2 text-xs border border-slate-200 rounded-lg h-10" value={toDate} onChange={e => setToDate(e.target.value)} />
               </>
            )}

            <button onClick={fetchData} disabled={loading} className="bg-indigo-600 hover:bg-indigo-700 text-white h-10 px-6 rounded-lg text-xs font-bold uppercase tracking-widest flex items-center gap-2 shadow-lg shadow-indigo-500/20 active:scale-95 transition-all">
              {loading ? <RefreshCw size={14} className="animate-spin" /> : <RefreshCw size={14} />} Refresh
            </button>
          </div>

          <div className="flex-1"></div>
          
          <div className="flex items-center gap-3">
             <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Actions:</span>
             <div className="flex bg-slate-50 p-1 rounded-xl border border-slate-200">
               <button onClick={handleExportExcel} className="flex items-center gap-2 bg-white hover:bg-emerald-50 text-slate-700 px-4 h-9 rounded-lg border border-slate-200 text-xs font-bold shadow-sm active:scale-95 transition-all"><Download size={14} className="text-emerald-600" /> Excel</button>
               <button onClick={() => window.print()} className="flex items-center gap-2 bg-white hover:bg-blue-50 text-slate-700 px-4 h-9 rounded-lg border border-slate-200 text-xs font-bold shadow-sm active:scale-95 transition-all ml-1"><FileDown size={14} className="text-blue-600" /> PDF</button>
               <button onClick={() => setShowEmailModal(true)} className="flex items-center gap-2 bg-white hover:bg-indigo-50 text-slate-700 px-4 h-9 rounded-lg border border-slate-200 text-xs font-bold shadow-sm active:scale-95 transition-all ml-1"><Mail size={14} className="text-indigo-600" /> Email</button>
               <button onClick={() => window.print()} className="flex items-center gap-2 bg-slate-800 hover:bg-slate-900 text-white px-4 h-9 rounded-lg text-xs font-bold shadow-sm active:scale-95 transition-all ml-1"><Printer size={14} /> Print</button>
             </div>
          </div>
        </div>

        {/* Product Master Filter Builder */}
        <div className="bg-slate-50 p-4 rounded-2xl border border-indigo-100 shadow-sm relative">
           <div className="absolute top-0 left-0 w-1 h-full bg-indigo-500 rounded-l-2xl"></div>
           <div className="flex flex-wrap items-center gap-4">
              <div className="flex flex-col">
                <span className="text-[10px] font-black text-indigo-600 uppercase tracking-widest mb-1.5 ml-1">Filter Type</span>
                <select className="text-xs p-2 border border-slate-200 rounded-lg h-10 w-48 outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all" value={currentFilterType} onChange={e => { setCurrentFilterType(e.target.value); setCurrentFilterIds([]); }}>
                  {filterTypes.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
              </div>

              <div className="flex flex-col">
                <span className="text-[10px] font-black text-indigo-600 uppercase tracking-widest mb-1.5 ml-1">Select Value</span>
                <MultiSelect label={`Choose ${filterTypes.find(t => t.id === currentFilterType)?.label}...`} options={filtersData ? filtersData[currentFilterType + 's'] : []} selected={currentFilterIds} setSelected={setCurrentFilterIds} className="w-72" />
              </div>

              <div className="flex items-end h-full pt-5">
                <button onClick={handleAddFilter} className="bg-indigo-600 text-white hover:bg-indigo-700 px-5 h-10 rounded-lg text-xs font-bold flex items-center gap-2 transition-all shadow-md active:scale-95"><Plus size={16} /> Add Filter</button>
              </div>

              <div className="h-10 w-[1px] bg-slate-200 mx-2 hidden lg:block"></div>

              <div className="flex-1 flex flex-col min-w-[200px]">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Applied Master Filters</span>
                <div className="flex flex-wrap gap-2 min-h-[40px] items-center">
                    {activeFilters.map(f => (
                      <div key={f.type} className="bg-white border border-indigo-200 text-indigo-700 px-3 py-1.5 rounded-xl text-[10px] font-bold flex items-center gap-2 shadow-sm animate-in fade-in slide-in-from-left-2 duration-200">
                        <span className="bg-indigo-100 px-1.5 py-0.5 rounded uppercase text-[8px]">{f.label}</span>
                        <span className="truncate max-w-[150px]">{f.names.length > 2 ? `${f.names.length} Selected` : f.names.join(', ')}</span>
                        <button onClick={() => removeFilter(f.type)} className="text-slate-400 hover:text-red-500 transition-colors"><X size={14} /></button>
                      </div>
                    ))}
                    {activeFilters.length === 0 && <span className="text-[10px] text-slate-400 italic">No master filters applied (showing all products)</span>}
                </div>
              </div>
           </div>
        </div>

        <div className="flex flex-wrap items-center gap-6 pt-1">
           {[
             { id: 'active_only', label: 'Active Only' },
             { id: 'low_stock', label: 'Low Stock' },
             { id: 'negative_stock', label: 'Negative' },
             { id: 'zero_stock', label: 'Zero Stock' }
           ].map(flag => (
             <label key={flag.id} className="flex items-center gap-2 cursor-pointer group">
               <div onClick={() => setFilterFlags(prev => ({ ...prev, [flag.id]: !prev[flag.id as keyof typeof filterFlags] }))} className={cn("w-8 h-4 rounded-full relative transition-colors duration-200", filterFlags[flag.id as keyof typeof filterFlags] ? "bg-indigo-600" : "bg-slate-200")}>
                 <div className={cn("absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all duration-200", filterFlags[flag.id as keyof typeof filterFlags] ? "left-4.5" : "left-0.5")} />
               </div>
               <span className="text-[11px] font-bold text-slate-500 group-hover:text-indigo-600">{flag.label}</span>
             </label>
           ))}
           <div className="flex-1"></div>
           <div className="flex items-center gap-2 bg-slate-100 px-3 py-1 rounded-lg">
                <span className="text-[10px] font-bold text-slate-400 uppercase">Group By</span>
                <select className="bg-transparent text-[11px] font-bold text-slate-600 outline-none" value={groupBy} onChange={e => setGroupBy(e.target.value)}>
                  <option value="item">Item Level</option><option value="outlet">Outlet Summary</option><option value="group">Group Summary</option><option value="subgroup">Sub Group Summary</option><option value="category">Category Summary</option><option value="subcategory">Sub Category Summary</option><option value="brand">Brand Summary</option><option value="subbrand">Sub Brand Summary</option><option value="supplier">Supplier Summary</option>
                </select>
            </div>
        </div>
      </div>

      {/* Report Content */}
      <div className="flex-1 overflow-y-auto p-6 custom-scrollbar scroll-smooth print:p-0 print:overflow-visible">
        <CompanyReportHeader
          title={activeTab === 'summary' ? 'STOCK VALUATION & INVENTORY SUMMARY' : 'STOCK LEDGER REPORT'}
          subtitle={`Mode: ${activeTab === 'summary' ? `Summary grouped by ${groupBy.toUpperCase()}` : `Ledger from ${fromDate} to ${toDate}`}${search ? ` | Search: ${search}` : ''}`}
          metaItems={[
            { label: 'Total Qty', value: fmt(data?.dashboard?.total_qty) },
            { label: 'Cost Value', value: cur(data?.dashboard?.total_value) },
            { label: 'MRP Value', value: cur(data?.dashboard?.total_mrp_value) },
            { label: 'Tax Value', value: cur(data?.dashboard?.total_tax_value) },
          ]}
          printOnly={true}
        />
        {activeTab === 'summary' && <SummaryCards />}
        
        <div className="h-6"></div> 

        <div className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden print:border-none print:shadow-none print:rounded-none print:overflow-visible">
          <div className="overflow-x-auto min-h-[400px] print:min-h-0 print:overflow-visible">
            <table className="w-full text-[11px] text-left print:text-[9px]">
              <thead className="bg-[#1e293b] text-white uppercase tracking-tighter sticky top-0 z-20 print:bg-black">
                {activeTab === 'summary' ? (
                  <tr>
                    <th className="px-4 py-3">
                      {groupBy === 'item' ? 'Outlet' : 
                       groupBy === 'outlet' ? 'Outlet Name' :
                       groupBy === 'brand' ? 'Brand Name' :
                       groupBy === 'subbrand' ? 'Sub Brand' :
                       groupBy === 'group' ? 'Item Group' :
                       groupBy === 'subgroup' ? 'Sub Group' :
                       groupBy === 'supplier' ? 'Supplier Name' :
                       groupBy === 'category' ? 'Category' :
                       groupBy === 'subcategory' ? 'Sub Category' : 'Name'}
                    </th>
                    {groupBy === 'item' && <th className="px-4 py-3">Item Details</th>}
                    <th className="px-2 py-3 text-right">Qty</th>
                    {groupBy === 'item' && (
                       <>
                        <th className="px-2 py-3 text-right">Basic Cost</th>
                        <th className="px-2 py-3 text-right">GST</th>
                        <th className="px-2 py-3 text-right">Cost Price</th>
                        <th className="px-2 py-3 text-right">MRP</th>
                       </>
                    )}
                    <th className="px-2 py-3 text-right">Basic_Cost</th>
                    <th className="px-2 py-3 text-right">GST</th>
                    <th className="px-2 py-3 text-right">Cost_Valu</th>
                    <th className="px-2 py-3 text-right">MrpValue</th>
                    <th className="px-2 py-3 text-right">DiscountV</th>
                    <th className="px-2 py-3 text-right">SP_Value</th>
                  </tr>
                ) : (
                  <tr>
                    <th className="px-6 py-4">Date/Time</th><th className="px-4 py-4">Voucher/Type</th><th className="px-4 py-4">Item Name</th><th className="px-4 py-4 text-right">Opening</th><th className="px-4 py-4 text-right">IN</th><th className="px-4 py-4 text-right">OUT</th><th className="px-4 py-4 text-right">Closing</th><th className="px-4 py-4 text-right">Rate</th><th className="px-4 py-4">User</th>
                  </tr>
                )}
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (<tr><td colSpan={15} className="py-20 text-center"><RefreshCw className="animate-spin text-indigo-600 mx-auto" size={32} /><p className="font-bold text-slate-400 mt-2">Loading...</p></td></tr>) 
                : !data?.rows?.length ? (<tr><td colSpan={15} className="py-20 text-center"><Package className="text-slate-300 mx-auto" size={48} /><p className="font-bold text-slate-400 mt-2">No records found</p></td></tr>) 
                : data.rows.map((r: any, i: number) => (
                  <tr key={i} className="hover:bg-indigo-50/30 transition-colors">
                    {activeTab === 'summary' ? (
                      <>
                        <td className="px-4 py-2 font-bold text-slate-600">{r.outlet}</td>
                        {groupBy === 'item' && (
                          <td className="px-4 py-2">
                            <div className="font-black text-slate-800 truncate max-w-[200px]">{r.item_name}</div>
                            <div className="text-[9px] text-indigo-600 font-mono">{r.item_code}{r.barcode ? ` | EAN: ${r.barcode}` : ''}</div>
                          </td>
                        )}
                        <td className="px-2 py-2 text-right font-black text-slate-700">{fmt(r.current_stock)}</td>
                        {groupBy === 'item' && (
                           <>
                             <td className="px-2 py-2 text-right text-slate-500 font-mono">{cur(r.basic_cost)}</td>
                             <td className="px-2 py-2 text-right text-indigo-600 font-mono">{cur(r.avg_cost - r.basic_cost)}</td>
                             <td className="px-2 py-2 text-right text-slate-600 font-mono">{cur(r.avg_cost)}</td>
                             <td className="px-2 py-2 text-right text-slate-600 font-mono">{cur(r.mrp)}</td>
                           </>
                        )}
                        <td className="px-2 py-2 text-right font-bold text-slate-800 bg-slate-50/50">{fmt(r.basic_value)}</td>
                        <td className="px-2 py-2 text-right font-bold text-indigo-600">{fmt(r.tax_value)}</td>
                        <td className="px-2 py-2 text-right font-black text-emerald-700 bg-emerald-50/20">{fmt(r.stock_value)}</td>
                        <td className="px-2 py-2 text-right font-bold text-orange-700">{fmt(r.mrp_value)}</td>
                        <td className="px-2 py-2 text-right font-bold text-rose-700">{fmt(r.discount_value)}</td>
                        <td className="px-2 py-2 text-right font-bold text-purple-700">{fmt(r.selling_value)}</td>
                      </>
                    ) : (
                      <>
                        <td className="px-6 py-3.5 whitespace-nowrap"><div className="font-bold text-slate-700">{r.date?.split('T')[0]}</div><div className="text-[10px] text-slate-400">{r.date?.split('T')[1]?.split('.')[0]}</div></td>
                        <td className="px-4 py-3.5"><div className="font-mono text-blue-600 font-bold">#{r.voucher_no}</div><span className="text-[9px] font-black uppercase text-slate-500">{r.transaction_type}</span></td>
                        <td className="px-4 py-3.5"><div className="font-bold text-slate-800">{r.item_name}</div><div className="text-[9px] text-slate-400">{r.outlet}</div></td>
                        <td className="px-4 py-3.5 text-right font-mono text-slate-500">{fmt(+r.opening_qty)}</td><td className="px-4 py-3.5 text-right font-black text-emerald-600">{r.in_qty > 0 ? `+${fmt(r.in_qty)}` : '—'}</td><td className="px-4 py-3.5 text-right font-black text-rose-600">{r.out_qty > 0 ? `-${fmt(r.out_qty)}` : '—'}</td><td className="px-4 py-3.5 text-right font-black text-indigo-700 bg-indigo-50/30">{fmt(+r.closing_qty)}</td>
                        <td className="px-4 py-3.5 text-right font-mono text-slate-600">{cur(+r.cost_rate)}</td><td className="px-4 py-3.5"><div className="text-[10px] font-bold text-slate-500">{r.user_name}</div></td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
              {activeTab === 'summary' && data?.rows?.length > 0 && (
                <tfoot className="bg-slate-100 font-black border-t-2 border-slate-300 print:bg-white print:border-black">
                  <tr>
                    <td colSpan={groupBy === 'item' ? 2 : 1} className="px-4 py-3 text-slate-500 uppercase tracking-widest text-[9px]">Grand Totals</td>
                    <td className="px-2 py-3 text-right text-blue-600">{fmt(data.dashboard?.total_qty)}</td>
                    {groupBy === 'item' && <td colSpan={4}></td>}
                    <td className="px-2 py-3 text-right text-slate-800">{fmt(data.dashboard?.total_basic_value)}</td>
                    <td className="px-2 py-3 text-right text-indigo-600">{fmt(data.dashboard?.total_tax_value)}</td>
                    <td className="px-2 py-3 text-right text-emerald-600">{fmt(data.dashboard?.total_value)}</td>
                    <td className="px-2 py-3 text-right text-orange-600">{fmt(data.dashboard?.total_mrp_value)}</td>
                    <td className="px-2 py-3 text-right text-rose-600">{fmt(data.dashboard?.total_discount_value)}</td>
                    <td className="px-2 py-3 text-right text-purple-600">{fmt(data.dashboard?.total_selling_value)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      </div>

      {/* Email Modal */}
      {showEmailModal && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
           <div className="bg-white w-full max-md rounded-3xl shadow-2xl overflow-hidden border border-slate-200 animate-in zoom-in-95 duration-200">
              <div className="bg-indigo-600 p-6 text-white flex justify-between items-center">
                 <div>
                    <h3 className="text-lg font-black uppercase tracking-widest">Email Report</h3>
                    <p className="text-[10px] opacity-80 font-bold uppercase mt-1">Send summary to stakeholders</p>
                 </div>
                 <button onClick={() => setShowEmailModal(false)} className="hover:bg-white/20 p-2 rounded-xl transition-colors"><X size={20} /></button>
              </div>
              <div className="p-8 space-y-6">
                 <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Recipient Email</label>
                    <div className="relative">
                       <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                       <input type="email" placeholder="manager@nutribay.com" className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all text-sm font-bold" value={emailTo} onChange={e => setEmailTo(e.target.value)} />
                    </div>
                 </div>
                 <button onClick={handleSendEmail} disabled={sendingEmail || !emailTo} className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white py-4 rounded-2xl font-black uppercase tracking-widest text-xs flex items-center justify-center gap-3 shadow-xl shadow-indigo-500/20 active:scale-[0.98] transition-all">
                    {sendingEmail ? <RefreshCw size={18} className="animate-spin" /> : <Mail size={18} />} Send Report
                 </button>
              </div>
           </div>
        </div>
      )}

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 6px; height: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #cbd5e1; }
        @media print {
          .no-print { display: none !important; }
          .flex { display: block !important; }
          .overflow-hidden { overflow: visible !important; }
          .h-\\[calc\\(100vh-100px\\)\\] { height: auto !important; }
          .m-6 { margin: 0 !important; }
          .p-6 { padding: 0 !important; }
          table { width: 100% !important; border-collapse: collapse !important; }
          th { background: #000 !important; color: #fff !important; }
          td, th { border: 1px solid #ddd !important; padding: 8px !important; }
        }
      `}</style>
    </div>
  );
};

export default StockReport;

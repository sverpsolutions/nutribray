import React, { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useParams, useNavigate } from 'react-router-dom';
import { products_api, product_list_item } from '../../api/products';
import { masters_api, item_group_type, item_subgroup_type, item_subcategory_type, item_category_type, category_type, brand_type, sub_category_brand_type, manufacturer_type, sub_manufacturer_type, variant_type, flavour_type, product_classification_type, country_type, unit_type, hsn_type } from '../../api/masters';
import { suppliers_api, supplier_list_item } from '../../api/suppliers';
import { customers_api } from '../../api/customers';
import { packaging_api, packaging_config, PackagingType, calcTotalUnits, calcVolumeCBM, storage_type_type, temperature_category_type } from '../../api/packaging';
import { getCompanySettings, CompanySettings } from '../../api/company';
import { channels_api, channel_price, simulate_result } from '../../api/channels';
import { audit_api } from '../../api/audit';
import { batches_api, ProductBatch } from '../../api/batches';
import toast from 'react-hot-toast';
import QuickAddModal, { QuickAddConfig } from '../../components/QuickAddModal';
import PriceSimulator from '../../components/PriceSimulator';
import { usePermissions } from '../../hooks/usePermissions';
import ErrorBoundary from '../../components/ErrorBoundary';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  PointElement,
  LineElement,
  Filler
} from 'chart.js';
import { Bar } from 'react-chartjs-2';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

const SectionHeader = ({ icon, title, color = 'blue' }: { icon: string; title: string; color?: string }) => {
  const colors: Record<string, string> = {
    blue: 'from-blue-600/20 to-blue-600/5 border-blue-500 text-blue-700 dark:text-blue-400 icon-blue-600',
    green: 'from-emerald-600/20 to-emerald-600/5 border-emerald-500 text-emerald-700 dark:text-emerald-400 icon-emerald-600',
    amber: 'from-orange-500/20 to-orange-500/5 border-orange-500 text-orange-700 dark:text-orange-400 icon-orange-500',
    violet: 'from-indigo-600/20 to-indigo-600/5 border-indigo-500 text-indigo-700 dark:text-indigo-400 icon-indigo-600',
    rose: 'from-rose-500/20 to-rose-500/5 border-rose-500 text-rose-700 dark:text-rose-400 icon-rose-500',
    cyan: 'from-cyan-500/20 to-cyan-500/5 border-cyan-500 text-cyan-700 dark:text-cyan-400 icon-cyan-500',
  };
  
  const current = colors[color] || colors.blue;
  const iconColorMatch = current.match(/icon-([a-z]+-[0-9]+)/);
  const iconColor = iconColorMatch ? `text-${iconColorMatch[1]}` : 'text-blue-600';

  return (
    <div className={`flex items-center gap-4 border-l-[4px] bg-gradient-to-r ${current.split(' icon-')[0]} px-4 py-3 mb-8 rounded-r-xl shadow-sm relative overflow-hidden`}>
      <div className="absolute inset-0 bg-white/40 dark:bg-slate-900/40 pointer-events-none"></div>
      <div className="relative z-10 flex items-center justify-center w-10 h-10 rounded-xl bg-white dark:bg-slate-800 shadow-md border border-white/50 dark:border-slate-700/50">
        <i className={`fas ${icon} text-lg ${iconColor} drop-shadow-sm`}></i>
      </div>
      <div className="relative z-10 flex flex-col">
        <span className="font-black text-xs uppercase tracking-[0.25em] italic">{title}</span>
        <span className="text-[10px] opacity-70 font-bold uppercase tracking-wider mt-0.5 italic">Section Configuration</span>
      </div>
    </div>
  );
};

const Label = ({ children, required, action }: { children: React.ReactNode; required?: boolean; action?: React.ReactNode }) => (
  <div className="flex items-center justify-between mb-1.5">
    <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wide">
      {children}{required && <span className="text-rose-500 ml-1 font-black">*</span>}
    </label>
    {action}
  </div>
);

const Field = ({ children }: { children: React.ReactNode }) => (
  <div>{children}</div>
);

const ActivityCharts = ({ data }: { data: any[] }) => {
  if (!data || !Array.isArray(data) || data.length === 0) {
    return (
      <div className="h-[280px] flex flex-col items-center justify-center text-slate-400 py-10 bg-slate-50/50 dark:bg-slate-800/20 rounded-2xl border border-slate-100 dark:border-slate-800/50 border-dashed">
        <i className="fas fa-chart-line text-3xl mb-3 opacity-20"></i>
        <p className="text-[10px] font-black uppercase tracking-[0.2em] opacity-40 italic">No Recent Activity</p>
        <p className="text-[9px] text-slate-400 mt-1 font-medium">Analytics will appear once transactions start</p>
      </div>
    );
  }

  const labels = data.map(d => d.label);
  
  const commonOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        mode: 'index' as const,
        intersect: false,
        backgroundColor: '#0f172a',
        titleFont: { size: 10, weight: 'bold' as const },
        bodyFont: { size: 10 },
        padding: 10,
        cornerRadius: 12,
        boxPadding: 4
      }
    },
    scales: {
      x: { 
        grid: { display: false },
        ticks: { font: { size: 9, weight: 'bold' as const }, color: '#94a3b8' }
      },
      y: {
        border: { display: false },
        grid: { color: 'rgba(148, 163, 184, 0.08)' },
        ticks: { font: { size: 9, weight: 'bold' as const }, color: '#94a3b8' }
      }
    }
  };

  const qtyData = {
    labels,
    datasets: [
      {
        label: 'In Qty',
        data: data.map(d => d.in_qty),
        backgroundColor: '#10b981',
        borderRadius: 6,
        barThickness: 12,
      },
      {
        label: 'Out Qty',
        data: data.map(d => d.out_qty),
        backgroundColor: '#1E8489',
        borderRadius: 6,
        barThickness: 12,
      }
    ]
  };

  const amtData = {
    labels,
    datasets: [
      {
        label: 'Purchase (₹)',
        data: data.map(d => d.in_amount),
        backgroundColor: '#059669',
        borderRadius: 6,
        barThickness: 12,
      },
      {
        label: 'Sales (₹)',
        data: data.map(d => d.out_amount),
        backgroundColor: '#f43f5e',
        borderRadius: 6,
        barThickness: 12,
      }
    ]
  };

  return (
    <div className="flex flex-col gap-8 h-full">
      <div className="flex flex-col h-[140px] bg-white dark:bg-slate-900/50 p-4 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm transition-all hover:shadow-md">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-1 h-3 bg-blue-500 rounded-full"></div>
            <span className="text-[10px] font-black uppercase text-slate-500 dark:text-slate-400 tracking-widest italic">Quantity Flow</span>
          </div>
          <div className="flex gap-3">
            <span className="flex items-center gap-1.5 text-[8px] font-black text-emerald-500 uppercase"><div className="w-2 h-2 rounded-full bg-emerald-500 shadow-lg shadow-emerald-500/20"></div> In</span>
            <span className="flex items-center gap-1.5 text-[8px] font-black text-blue-500 uppercase"><div className="w-2 h-2 rounded-full bg-blue-500 shadow-lg shadow-blue-500/20"></div> Out</span>
          </div>
        </div>
        <div className="flex-1"><Bar data={qtyData} options={commonOptions} /></div>
      </div>

      <div className="flex flex-col h-[140px] bg-white dark:bg-slate-900/50 p-4 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm transition-all hover:shadow-md">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-1 h-3 bg-rose-500 rounded-full"></div>
            <span className="text-[10px] font-black uppercase text-slate-500 dark:text-slate-400 tracking-widest italic">Valuation (Amount ₹)</span>
          </div>
          <div className="flex gap-3">
            <span className="flex items-center gap-1.5 text-[8px] font-black text-emerald-600 uppercase"><div className="w-2 h-2 rounded-full bg-emerald-600 shadow-lg shadow-emerald-600/20"></div> In</span>
            <span className="flex items-center gap-1.5 text-[8px] font-black text-rose-500 uppercase"><div className="w-2 h-2 rounded-full bg-rose-500 shadow-lg shadow-rose-500/20"></div> Out</span>
          </div>
        </div>
        <div className="flex-1"><Bar data={amtData} options={commonOptions} /></div>
      </div>
    </div>
  );
};

const ProductAdd = () => {
  const inputCls = "w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-700 dark:text-slate-200 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all outline-none text-sm placeholder:text-slate-400";
  const selectCls = "w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-700 dark:text-slate-200 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all outline-none text-sm cursor-pointer appearance-none";
  const cardCls = "bg-white dark:bg-slate-900 rounded-3xl shadow-xl shadow-slate-200/50 dark:shadow-none border border-slate-100 dark:border-slate-800 p-8 mb-8 relative";

  const { can_add_master, can_add_global_master, can_view_margins } = usePermissions();
  const [quick_add, set_quick_add] = useState<QuickAddConfig | null>(null);

  /** Tiny "+" button shown beside a label when user has add-permission */
  const add_btn = (cfg: QuickAddConfig, show: boolean) =>
    show ? (
      <button
        type="button"
        title={`Quick add ${cfg.label}`}
        onClick={() => set_quick_add(cfg)}
        className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-blue-100 text-blue-600 hover:bg-blue-600 hover:text-white text-xs font-black transition-colors leading-none shrink-0"
      >+</button>
    ) : null;

  const { register, handleSubmit, watch, setValue, reset, setFocus, formState: { errors } } = useForm<Record<string, any>>({
    defaultValues: {
      is_sellable: true, is_active: true, gst_percent: '0',
      carton_size: 1, low_stock_threshold: 5,
      min_stock: '0', reorder_level: '0', max_stock_level: '0',
      item_type: 'FG', bom_applicable: false,
      multiplier_to_base: '1', conversion_factor: '1',
      allow_sale: true, allow_purchase: true, status: 'ACTIVE',
      is_asset: false,
      has_batch_tracking: false,
      has_expiry_tracking: false,
      mfg_date_required: false,
      exp_date_required: false,
      shelf_life_days: '',
      min_shelf_life_purchase_days: '',
      min_shelf_life_sale_days: '',
      near_expiry_alert_days: 60,
      allow_expired_sale: false,
      allow_neg_batch_stock: false,
      batch_wise_purchase_rate: true,
      batch_wise_selling_price: false,
      is_fefo_enabled: true,
    }
  });

  const [compSettings, setCompSettings] = useState<CompanySettings | null>(null);

  useEffect(() => {
    getCompanySettings()
        .then(res => {
            if (res) setCompSettings(res);
        })
        .catch(err => {
            console.error("Failed to load company settings", err);
            toast.error("Critical: Failed to load system settings. Some features may be disabled.");
        });
  }, []);
  const { id } = useParams();
  const navigate = useNavigate();
  const [isEdit, setIsEdit] = useState(Boolean(id));
  const [productId, setProductId] = useState<number | null>(id ? Number(id) : null);
  const prevMastersRef = useRef({ group: '', subgroup: '', category: '' });
  const isInitialLoadRef = useRef(true);
  const [categories, setCategories] = useState<item_category_type[]>([]);
  const [subcategories, setSubcategories] = useState<item_subcategory_type[]>([]);
  const [groups, setGroups] = useState<item_group_type[]>([]);
  const [subgroups, setSubgroups] = useState<item_subgroup_type[]>([]);
  const [brands, setBrands] = useState<brand_type[]>([]);
  const [subBrands, setSubBrands] = useState<sub_category_brand_type[]>([]);
  const [manufacturers, setManufacturers] = useState<manufacturer_type[]>([]);
  const [subManufacturers, setSubManufacturers] = useState<sub_manufacturer_type[]>([]);
  const [variants, setVariants] = useState<variant_type[]>([]);
  const [flavours, setFlavours] = useState<flavour_type[]>([]);
  const [classifications, setClassifications] = useState<product_classification_type[]>([]);
  const [customerNames, setCustomerNames] = useState<string[]>([]);
  const [countries, setCountries] = useState<country_type[]>([]);
  const [suppliers, setSuppliers] = useState<supplier_list_item[]>([]);
  const [allOutlets, setAllOutlets] = useState<any[]>([]);
  const [units, setUnits] = useState<unit_type[]>([]);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [hsnSearch, setHsnSearch] = useState('');
  const [hsnResults, setHsnResults] = useState<hsn_type[]>([]);
  const [searchingHsn, setSearchingHsn] = useState(false);
  const [hsnIdx, setHsnIdx] = useState(-1);
  const [suggestedHsn, setSuggestedHsn] = useState<hsn_type | null>(null);
  const hsnListRef = useRef<HTMLDivElement>(null);

  // Tabs
  const [activeTab, setActiveTab] = useState<'General' | 'SIP' | 'Batch & Expiry' | 'Outlet Pricing' | 'Price Control' | 'Online Channels'>('General');
  const [productBatches, setProductBatches] = useState<ProductBatch[]>([]);
  const [loadingBatches, setLoadingBatches] = useState(false);
  const [calcMfgDate, setCalcMfgDate] = useState<string>('');
  const [calcPreviewExpiry, setCalcPreviewExpiry] = useState<string>('');
  const [outletPricing, setOutletPricing] = useState<any[]>([]);
  const [channelPrices, setChannelPrices] = useState<channel_price[]>([]);
  const [loadingChannels, setLoadingChannels] = useState(false);
  const [simulatorOpen, setSimulatorOpen] = useState(false);
  const [activeSimPartner, setActiveSimPartner] = useState<channel_price | null>(null);

  // Search modal state
  const [showModal, setShowModal] = useState(false);
  const [nameSearch, setNameSearch] = useState('');
  const [searchResults, setSearchResults] = useState<product_list_item[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchHighlightIdx, setSearchHighlightIdx] = useState(-1);
  const nameSearchRef = useRef<HTMLInputElement>(null);
  const searchDropdownRef = useRef<HTMLDivElement>(null);

  // Success modal state
  const [successModal, setSuccessModal] = useState<{ show: boolean; code: string; name: string; id: number | null }>({ show: false, code: '', name: '', id: null });

  // ── Packaging state ──────────────────────────────────────────────────────────
  const [pkgConfig, setPkgConfig] = useState<packaging_config | null>(null);
  const [pkgType, setPkgType] = useState<PackagingType>('LOOSE');
  const [pkgInnerQty, setPkgInnerQty] = useState<number>(1);
  const [pkgInnerPacks, setPkgInnerPacks] = useState<number>(1);
  const [pkgTotalUnits, setPkgTotalUnits] = useState<number>(1);
  const [pkgLength, setPkgLength] = useState<string>('');
  const [pkgWidth, setPkgWidth]   = useState<string>('');
  const [pkgHeight, setPkgHeight] = useState<string>('');
  const [pkgVolume, setPkgVolume] = useState<number | null>(null);
  const [pkgGrossKg, setPkgGrossKg] = useState<string>('');
  const [pkgNetKg, setPkgNetKg]   = useState<string>('');
  const [pkgUnitBarcode, setPkgUnitBarcode]     = useState<string>('');
  const [pkgInnerBarcode, setPkgInnerBarcode]   = useState<string>('');
  const [pkgCartonBarcode, setPkgCartonBarcode] = useState<string>('');
  const [pkgQrCode, setPkgQrCode] = useState<boolean>(false);
  const [pkgRack, setPkgRack]   = useState<string>('');
  const [pkgNotes, setPkgNotes] = useState<string>('');
  const [storageTypes, setStorageTypes] = useState<storage_type_type[]>([]);
  const [tempCats, setTempCats] = useState<temperature_category_type[]>([]);
  const [pkgOuterQty, setPkgOuterQty] = useState<number>(1);
  const [pkgShelfLife, setPkgShelfLife] = useState<number>(0);
  const [pkgStorageTypeId, setPkgStorageTypeId] = useState<number | null>(null);
  const [pkgTempCatId, setPkgTempCatId] = useState<number | null>(null);
  const [pkgBaseUomId, setPkgBaseUomId] = useState<number | null>(null);
  const [pkgPurchaseUomId, setPkgPurchaseUomId] = useState<number | null>(null);
  const [pkgSalesUomId, setPkgSalesUomId] = useState<number | null>(null);
  const [pkgInnerUomId, setPkgInnerUomId] = useState<number | null>(null);
  const [pkgOuterUomId, setPkgOuterUomId] = useState<number | null>(null);
  const [pkgSaving, setPkgSaving] = useState(false);
  const [activityData, setActivityData] = useState<any[]>([]);
  const pkgInnerPacksRef = useRef<HTMLInputElement>(null);

  const loadActivity = async (id: number) => {
    try {
      const res = await products_api.get_activity(id);
      setActivityData(Array.isArray(res.data) ? res.data : []);
    } catch (e) { 
      console.error("Failed to load activity", e); 
      setActivityData([]);
    }
  };

  const loadChannelPrices = async (id: number) => {
    setLoadingChannels(true);
    try {
      const res = await channels_api.get_product_prices(id);
      setChannelPrices(Array.isArray(res?.data?.prices) ? res.data.prices : []);
    } catch (e) { 
        console.error("Failed to load channel prices", e); 
        setChannelPrices([]);
    }
    finally { setLoadingChannels(false); }
  };

  useEffect(() => {
    if (productId && activeTab === 'Online Channels') {
        loadChannelPrices(productId);
    }
  }, [productId, activeTab]);

  useEffect(() => {
    if (productId && activeTab === 'Batch & Expiry') {
      setLoadingBatches(true);
      batches_api.list({ product_id: productId, per_page: 50 })
        .then(res => setProductBatches(Array.isArray(res.data) ? res.data : ((res.data as any)?.data || [])))
        .catch(err => console.error("Failed to load product batches", err))
        .finally(() => setLoadingBatches(false));
    }
  }, [productId, activeTab]);

  const watchShelfLife = watch('shelf_life_days');
  useEffect(() => {
    if (calcMfgDate && watchShelfLife && Number(watchShelfLife) > 0) {
      const d = new Date(calcMfgDate);
      if (!isNaN(d.getTime())) {
        d.setDate(d.getDate() + Number(watchShelfLife));
        setCalcPreviewExpiry(d.toISOString().slice(0, 10));
        return;
      }
    }
    setCalcPreviewExpiry('');
  }, [calcMfgDate, watchShelfLife]);

  const handleApplySimulatedPrice = async (result: simulate_result) => {
    if (!productId || !activeSimPartner) return;
    try {
        await channels_api.upsert_product_price(productId, {
            partner_id: activeSimPartner.partner_id,
            mrp: activeSimPartner.mrp,
            base_cost: activeSimPartner.base_cost,
            selling_price: result.selling_price,
            final_settlement_rate: result.settlement_rate,
            margin_percent: activeSimPartner.margin_percent, // uses simulator's extra_margin if changed
            partner_commission: activeSimPartner.partner_commission,
            is_active: true
        });
        toast.success(`Updated pricing for ${activeSimPartner.partner_name}`);
        setSimulatorOpen(false);
        loadChannelPrices(productId);
    } catch (e) {
        toast.error("Failed to update channel price");
    }
  };

  const watchGroup = watch('group_id');
  const watchSubGroup = watch('subgroup_id');
  const watchCategory = watch('category_id');
  const watchSubCategory = watch('subcategory_id');
  const watchBrand = watch('brand_id');
  const watchSubBrand = watch('sub_category_brand_id');
  const watchVariant = watch('variant_id');
  const watchFlavour = watch('flavour_id');
  const watchManufacturer = watch('manufacturer_id');
  const watchCountry = watch('country_id');
  const watchIsWeighing = watch('is_weighing_item');
  const watchUnitId = watch('unit_id');
  const watchWeightKg = watch('weight_kg');

  const [imgFront, setImgFront] = useState<string | null>(null);
  const [imgBack, setImgBack] = useState<string | null>(null);
  const [imgTop, setImgTop] = useState<string | null>(null);
  const [imgSide, setImgSide] = useState<string | null>(null);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>, side: 'img_front' | 'img_back' | 'img_top' | 'img_side') => {
    const file = e.target.files?.[0];
    if (file) {
      // shrink to fit 800×800 and store as WebP (server keeps uploads as-is; phone photos are 3–5 MB)
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, 800 / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        const base64 = canvas.toDataURL('image/webp', 0.85);
        if (side === 'img_front') setImgFront(base64);
        if (side === 'img_back') setImgBack(base64);
        if (side === 'img_top') setImgTop(base64);
        if (side === 'img_side') setImgSide(base64);
        setValue(side, base64);
      };
      img.onerror = () => { URL.revokeObjectURL(url); toast.error('Could not read that image'); };
      img.src = url;
    }
  };

  useEffect(() => {
    masters_api.get_item_groups().then(r => setGroups(r?.data || [])).catch(console.error);
    masters_api.get_item_categories().then(r => setCategories(r?.data || [])).catch(console.error);
    masters_api.get_brands().then(r => setBrands(r?.data || [])).catch(console.error);
    masters_api.get_manufacturers().then(r => setManufacturers(r?.data || [])).catch(console.error);
    masters_api.get_countries().then(r => {
      const data = r?.data || [];
      setCountries(data);
      // Default to India if not editing
      if (!productId) {
        const india = data.find(c => c.name.toLowerCase() === 'india');
        if (india) setValue('country_id', india.id);
      }
    }).catch(console.error);
    masters_api.get_units().then(r => setUnits(r?.data || [])).catch(console.error);
    masters_api.get_variants().then(r => setVariants(r?.data || [])).catch(console.error);
    masters_api.get_flavours().then(r => setFlavours(r?.data || [])).catch(console.error);
    masters_api.get_product_classifications().then(r => setClassifications(r?.data || [])).catch(console.error);
    customers_api.list({ per_page: 200 }).then(r => setCustomerNames((r.data?.data || []).map((c: { name: string }) => c.name))).catch(console.error);
    // Removed invalid packaging_api.get_storage_types calls.

    suppliers_api.list({ per_page: 1000 })
        .then(r => setSuppliers(r?.data?.data || []))
        .catch(err => {
            console.error("Failed to load suppliers", err);
            setSuppliers([]);
        });
    packaging_api.list_storage_types().then(r => setStorageTypes(r?.data || [])).catch(console.error);
    packaging_api.list_temperature_categories().then(r => setTempCats(r?.data || [])).catch(console.error);

    masters_api.get_outlets().then(r => {
      const data = r?.data || [];
      setAllOutlets(data);
      // If new item, initialize pricing rows
      if (!productId) {
        setOutletPricing(data.map(o => ({
          outlet_id: o.id, outlet_name: o.outlet_name, unit_code: o.unit_code,
          type: o.type === 'H' ? 'HO' : 'Outlet', cost_price: '', mrp: '', selling_price: '', wsp: '', stock_qty: 0, is_active: true
        })));
      }
    }).catch(console.error);

    setTimeout(() => {
        const el = document.getElementById('scan_barcode');
        if (el) el.focus();
    }, 200);

    if (id) {
      loadItemById(Number(id));
    }
  }, [id]);

  useEffect(() => {
    if (watchGroup) {
      masters_api.get_item_subgroups(Number(watchGroup))
        .then(r => setSubgroups(r?.data || []))
        .catch(err => {
            console.error("Failed to load subgroups", err);
            setSubgroups([]);
        });
    } else {
      setSubgroups([]);
    }
    
    // Cascading reset logic
    if (watchGroup !== prevMastersRef.current.group) {
        // Only clear if it's NOT the initial load of an existing product
        if (!isInitialLoadRef.current) {
            setValue('subgroup_id', '');
            setValue('category_id', '');
            setValue('subcategory_id', '');
        }
        prevMastersRef.current.group = watchGroup || '';
    }
  }, [watchGroup]);

  useEffect(() => {
    if (watchSubGroup) {
      masters_api.get_item_categories(Number(watchSubGroup))
        .then(r => setCategories(r?.data || []))
        .catch(err => {
            console.error("Failed to load categories", err);
            setCategories([]);
        });
    } else {
      masters_api.get_item_categories()
        .then(r => setCategories(r?.data || []))
        .catch(err => {
            console.error("Failed to load categories", err);
            setCategories([]);
        });
    }

    if (watchSubGroup !== prevMastersRef.current.subgroup) {
        if (!isInitialLoadRef.current) {
            setValue('category_id', '');
            setValue('subcategory_id', '');
        }
        prevMastersRef.current.subgroup = watchSubGroup || '';
    }
  }, [watchSubGroup]);

  useEffect(() => {
    if (watchCategory) {
      masters_api.get_item_subcategories(Number(watchCategory))
        .then(r => setSubcategories(r?.data || []))
        .catch(err => {
            console.error("Failed to load subcategories", err);
            setSubcategories([]);
        });
    } else {
      setSubcategories([]);
    }

    if (watchCategory !== prevMastersRef.current.category) {
        if (!isInitialLoadRef.current) {
            setValue('subcategory_id', '');
        }
        prevMastersRef.current.category = watchCategory || '';
    }
  }, [watchCategory]);

  // Handle Suggested HSN on Subcategory change
  useEffect(() => {
    if (watchSubCategory) {
      masters_api.get_suggested_hsn(Number(watchSubCategory))
        .then(res => {
          const h = res?.data;
          if (!h) return;
          setSuggestedHsn(h);
          
          // Auto-fill all columns with same
          setValue('suggested_hsn_id', h.id);
          setValue('hsn_id', h.id);
          setValue('hsn_code', h.hsn_code);
          setHsnSearch(h.hsn_code);
          
          const gstNum = parseFloat(String(h.gst_percent || '0'));
          const gstSelect = String(Math.round(gstNum));
          setValue('gst_percent', gstSelect);
          setValue('purchase_tax_percent', String(gstNum));
          setValue('sale_tax_percent', String(gstNum));
          
          toast.success(`Auto-filled HSN ${h.hsn_code} for subcategory`);
        })
        .catch(() => {
          setSuggestedHsn(null);
          setValue('suggested_hsn_id', null);
        });
    } else {
      setSuggestedHsn(null);
      setValue('suggested_hsn_id', null);
    }
  }, [watchSubCategory]);

  useEffect(() => {
    if (watchManufacturer) {
      masters_api.get_sub_manufacturers(Number(watchManufacturer))
        .then(r => setSubManufacturers(r?.data || []))
        .catch(err => {
            console.error("Failed to load submanufacturers", err);
            setSubManufacturers([]);
        });
    } else {
      setSubManufacturers([]);
    }
    if (!id || (watchManufacturer && Number(watchManufacturer) !== productId)) {
        setValue('submanufacturer_id', '');
    }
  }, [watchManufacturer]);

  // Auto-fill Purchase UOM and Sales UOM when Base Unit changes
  useEffect(() => {
    if (watchUnitId) {
      const u = units.find(u => u.id === Number(watchUnitId));
      if (u) {
        const cur_purchase = watch('purchase_unit');
        if (!cur_purchase) setValue('purchase_unit', u.unit_code);
        const cur_unit = watch('unit');
        if (!cur_unit) setValue('unit', u.unit_code);
      }
    }
  }, [watchUnitId]);

  useEffect(() => {
    if (watchBrand) {
      masters_api.get_sub_brands(Number(watchBrand))
        .then(r => setSubBrands(r?.data || []))
        .catch(err => {
            console.error("Failed to load subbrands", err);
            setSubBrands([]);
        });
    } else {
      setSubBrands([]);
    }
    if (!productId || (watchBrand && Number(watchBrand) !== productId)) {
        setValue('sub_category_brand_id', '');
    }
  }, [watchBrand]);

  const watchStatus      = watch('status');
  const watchExpiry      = watch('expiry_date');
  const watchGst         = watch('gst_percent');
  const watchBasicCost   = watch('basic_cost');
  const watchCostPrice   = watch('cost_price');
  const watchMrp         = watch('mrp');
  const watchMrpMargin   = watch('mrp_margin');
  const watchSp          = watch('selling_price');
  const watchWsp         = watch('wsp');
  const watchPricingMode = watch('pricing_mode');

  const isMarkdown = compSettings?.enable_markdown_calc || watchPricingMode === 'MARKDOWN';

  useEffect(() => {
    if (watchGst !== undefined) {
      setValue('purchase_tax_percent', watchGst);
      setValue('sale_tax_percent', watchGst);
    }
  }, [watchGst]);

  // Auto-calculate CP when basic_cost or GST changes
  useEffect(() => {
    if (isMarkdown) return; // Skip if in Markdown mode
    const bc  = parseFloat(String(watchBasicCost || 0)) || 0;
    const gst = parseFloat(String(watchGst || 0)) || 0;
    if (bc > 0) {
      setValue('cost_price', (bc * (1 + gst / 100)).toFixed(2));
    }
  }, [watchBasicCost, watchGst, isMarkdown]);

  // Markdown Calculation Mode: MRP + Margin -> CP + Basic Cost
  useEffect(() => {
    if (!isMarkdown) return;
    const mrp = parseFloat(String(watchMrp || 0)) || 0;
    const mgn = parseFloat(String(watchMrpMargin || 0)) || 0;
    const gst = parseFloat(String(watchGst || 0)) || 0;
    
    if (mrp > 0) {
      const cp = mrp * (1 - mgn / 100);
      const bc = cp / (1 + gst / 100);
      setValue('cost_price', cp.toFixed(2));
      setValue('basic_cost', bc.toFixed(2));
    }
  }, [watchMrp, watchMrpMargin, watchGst, isMarkdown]);

  // Auto-calculate all margin % whenever any price changes
  useEffect(() => {
    const cp  = parseFloat(String(watchCostPrice  || 0)) || 0;
    const mrp = parseFloat(String(watchMrp        || 0)) || 0;
    const sp  = parseFloat(String(watchSp         || 0)) || 0;
    const wsp = parseFloat(String(watchWsp        || 0)) || 0;
    if (cp <= 0) {
      setValue('cp_margin',  '');
      if (!isMarkdown) setValue('mrp_margin', '');
      setValue('sp_margin',  '');
      setValue('wsp_margin', '');
      return;
    }
    setValue('cp_margin',  sp  > 0 ? (((sp  - cp) / cp)  * 100).toFixed(2) : '');
    if (!isMarkdown) {
        setValue('mrp_margin', mrp > 0 ? (((mrp - cp) / mrp) * 100).toFixed(2) : '');
    }
    setValue('sp_margin',  sp  > 0 ? (((sp  - cp) / sp)  * 100).toFixed(2) : '');
    setValue('wsp_margin', wsp > 0 ? (((wsp - cp) / wsp) * 100).toFixed(2) : '');
  }, [watchCostPrice, watchMrp, watchSp, watchWsp, isMarkdown]);

  useEffect(() => {
    if (!watchStatus) return;
    if (watchStatus === 'ACTIVE') {
      setValue('allow_purchase', true);
      setValue('allow_sale', true);
      setValue('is_hidden_pos', false);
    } else if (watchStatus === 'TEMP_INACTIVE') {
      setValue('allow_sale', false);
      setValue('is_hidden_pos', true);
    } else if (watchStatus === 'DISCONTINUED' || watchStatus === 'BLOCKED') {
      setValue('allow_purchase', false);
      setValue('allow_sale', false);
      setValue('is_hidden_pos', true);
    }
  }, [watchStatus]);

  useEffect(() => {
    if (!watchExpiry) return;
    const expiry = new Date(watchExpiry);
    const now = new Date();
    if (expiry < now) {
      setValue('is_expired', true);
      setValue('allow_sale', false);
    } else {
      setValue('is_expired', false);
    }
  }, [watchExpiry]);

  const generateCode = () => {
    const cat = categories.find(c => c.id.toString() === (watchCategory as any)?.toString());
    const scat = subcategories.find(s => s.id.toString() === (watch('subcategory_id') as any)?.toString());
    
    // Default to prefix based if category not selected
    if (!cat) { toast.error('Select Category first'); return; }
    
    if (!cat) return;
    let prefix = cat.short_name || cat.name.slice(0, 3).toUpperCase();
    if (scat) {
      prefix += `-${scat.short_name || scat.name.slice(0, 3).toUpperCase()}`;
    }
    
    // Auto-generate a random serial suffix for now (Option 1 & 2 combined)
    const serial = Math.floor(1000 + Math.random() * 9000);
    setValue('item_code', `${prefix}-${serial}`);
  };

  const handleScan = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const code = e.currentTarget.value.trim();
    if (!code) return;
    try {
      const res = await products_api.lookup_barcode(code);
      toast.success('Item found — loaded for editing');
      reset({ ...res.data });
      setIsEdit(true);
      setProductId(res.data.id);
      setImagePreview(res.data.thumbnail_img || null);
      setImgFront(res.data.img_front || null);
      setImgBack(res.data.img_back || null);
      setImgTop(res.data.img_top || null);
      setImgSide(res.data.img_side || null);
      loadActivity(res.data.id);
      
      // Fetch outlet pricing
      try {
        const pricingRes = await products_api.get_outlet_pricing(res.data.id);
        setOutletPricing(pricingRes.data);
      } catch (e) { console.error("Failed to fetch outlet pricing", e); }
    } catch (err: any) {
      if (err.response?.status === 404) {
        toast.success('New item — fill in details');
        reset({ barcode: code, is_sellable: true, is_active: true, gst_percent: '0', carton_size: 1, low_stock_threshold: 5, country_id: countries.find(c => c.name.toLowerCase() === 'india')?.id ?? '', is_asset: false });
        setIsEdit(false); setProductId(null);
        setImagePreview(null); setImgFront(null); setImgBack(null); setImgTop(null); setImgSide(null);
        setActivityData([]);
        // Initialize outlet pricing for new item
        setOutletPricing(allOutlets.map(o => ({
          outlet_id: o.id, outlet_name: o.outlet_name, unit_code: o.unit_code,
          type: o.type === 'H' ? 'HO' : 'Outlet', cost_price: '', mrp: '', selling_price: '', wsp: '', stock_qty: 0, is_active: true
        })));
        setTimeout(() => setFocus('name'), 50);
      } else toast.error('Barcode lookup failed');
    } finally {
      setNameSearch('');
      setSearchResults([]);
    }
  };

  // Load a product by ID into the form (used from search modal)
  const loadItemById = async (id: number) => {
    try {
      const res = await products_api.get(id);
      reset({ ...res.data });
      setIsEdit(true);
      setProductId(id);
      setHsnSearch(res.data.hsn_code || '');
      setImagePreview(res.data.thumbnail_img || null);
      setImgFront(res.data.img_front || null);
      setImgBack(res.data.img_back || null);
      setImgTop(res.data.img_top || null);
      setImgSide(res.data.img_side || null);
      loadActivity(id);
      setShowModal(false);
      setNameSearch('');
      setSearchResults([]);
      toast.success(`Loaded: ${res.data.name}`);
      window.scrollTo({ top: 0, behavior: 'smooth' });

      // Fetch outlet pricing
      try {
        const pricingRes = await products_api.get_outlet_pricing(id);
        setOutletPricing(pricingRes.data);
      } catch (e) { console.error("Failed to fetch outlet pricing", e); }

      // Fetch packaging config
      await loadPackaging(id);

      // Important: Update ref to prevent initial reset
      prevMastersRef.current = {
        group: res.data.group_id?.toString() || '',
        subgroup: res.data.subgroup_id?.toString() || '',
        category: res.data.category_id?.toString() || '',
      };
      isInitialLoadRef.current = false;

      // Log OPEN action
      audit_api.log({
        action: 'OPEN',
        module: 'Item Master',
        details: `Viewed Product: ${res.data.name} (Code: ${res.data.item_code})`
      });
    } catch { toast.error('Failed to load item'); }
  };

  // Unified search: name search + barcode, arrow keys, Enter to select
  const handleNameSearch = async (val: string) => {
    setNameSearch(val);
    setSearchHighlightIdx(-1);
    if (val.trim().length < 2) { setSearchResults([]); return; }
    setSearching(true);
    try {
      const res = await products_api.list({ search: val.trim(), per_page: 15 });
      setSearchResults(res.data.data);
    } catch { setSearchResults([]); }
    finally { setSearching(false); }
  };

  const handleUnifiedKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    const val = e.currentTarget.value.trim();

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSearchHighlightIdx(i => Math.min(i + 1, searchResults.length - 1));
      // scroll highlighted item into view
      setTimeout(() => {
        const el = searchDropdownRef.current?.querySelector(`[data-idx="${Math.min(searchHighlightIdx + 1, searchResults.length - 1)}"]`) as HTMLElement;
        el?.scrollIntoView({ block: 'nearest' });
      }, 0);
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSearchHighlightIdx(i => Math.max(i - 1, -1));
      setTimeout(() => {
        const el = searchDropdownRef.current?.querySelector(`[data-idx="${Math.max(searchHighlightIdx - 1, 0)}"]`) as HTMLElement;
        el?.scrollIntoView({ block: 'nearest' });
      }, 0);
      return;
    }

    if (e.key === 'Escape') {
      setNameSearch(''); setSearchResults([]); setSearchHighlightIdx(-1);
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      if (!val) return;

      // If a result is highlighted → load it
      if (searchHighlightIdx >= 0 && searchResults[searchHighlightIdx]) {
        loadItemById(searchResults[searchHighlightIdx].id);
        return;
      }

      // If results exist → load first
      if (searchResults.length > 0) {
        loadItemById(searchResults[0].id);
        return;
      }

      // No results → treat as barcode scan
      try {
        const res = await products_api.lookup_barcode(val);
        toast.success('Item found — loaded for editing');
        reset({ ...res.data });
        setIsEdit(true); setProductId(res.data.id);
        setImgFront(res.data.img_front || null); setImgBack(res.data.img_back || null);
        setImgTop(res.data.img_top || null); setImgSide(res.data.img_side || null);
        loadActivity(res.data.id);
        try { const pr = await products_api.get_outlet_pricing(res.data.id); setOutletPricing(pr.data); } catch {}
      } catch (err: any) {
        if (err.response?.status === 404) {
          toast.success('New item — fill in details');
          reset({ barcode: val, is_sellable: true, is_active: true, gst_percent: '0', carton_size: 1, low_stock_threshold: 5, country_id: countries.find(c => c.name.toLowerCase() === 'india')?.id ?? '', is_asset: false });
          setIsEdit(false); setProductId(null);
          setImgFront(null); setImgBack(null); setImgTop(null); setImgSide(null);
          setActivityData([]);
          setOutletPricing(allOutlets.map(o => ({
            outlet_id: o.id, outlet_name: o.outlet_name, unit_code: o.unit_code,
            type: o.type === 'H' ? 'HO' : 'Outlet', cost_price: '', mrp: '', selling_price: '', wsp: '', stock_qty: 0, is_active: true
          })));
          setTimeout(() => setFocus('name'), 50);
        } else toast.error('Lookup failed');
      } finally {
        setNameSearch(''); setSearchResults([]); setSearchHighlightIdx(-1);
      }
    }
  };

  // HSN search handler
  const handleHsnSearch = async (val: string) => {
    setHsnIdx(-1);
    setHsnSearch(val);
    setValue('hsn_code', val);
    
    // Alert if mismatch with suggestion
    if (suggestedHsn && val !== suggestedHsn.hsn_code) {
      // Small delay to avoid alerting on every keystroke if needed, but user asked for alert on change
      // Using a toast for better UX but user specifically said alert
      alert("Entered HSN does not match suggested HSN for selected subcategory");
    }

    if (val.trim().length < 2) { setHsnResults([]); return; }
    setSearchingHsn(true);
    try {
      const res = await masters_api.get_hsn({ search: val.trim(), per_page: 10 });
      const data = (res.data as any).data ?? res.data;
      setHsnResults(Array.isArray(data) ? data : []);
    } catch { setHsnResults([]); }
    finally { setSearchingHsn(false); }
  };

  // Enter key on price fields: calculate + move focus, never submit
  const handlePriceEnter = (e: React.KeyboardEvent<HTMLInputElement>, nextId: string) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    e.stopPropagation();
    const fieldId = (e.target as HTMLInputElement).id;
    if (fieldId === 'f_basic_cost') {
      const bc  = parseFloat((e.target as HTMLInputElement).value) || 0;
      const gst = parseFloat(String(watch('gst_percent') || '0')) || 0;
      const cp  = +(bc * (1 + gst / 100)).toFixed(2);
      setValue('cost_price', String(cp));
    }
    setTimeout(() => {
      const next = document.getElementById(nextId);
      if (next) { next.focus(); try { (next as HTMLInputElement).select(); } catch {} }
    }, 10);
  };

  const selectHsnItem = (h: hsn_type) => {
    const gstNum    = parseFloat(String(h.gst_percent || '0'));
    const gstSelect = String(Math.round(gstNum));
    setValue('hsn_code', h.hsn_code);
    setValue('gst_percent', gstSelect);
    setValue('purchase_tax_percent', String(gstNum));
    setValue('sale_tax_percent', String(gstNum));
    setHsnSearch(h.hsn_code);
    setHsnResults([]);
    setHsnIdx(-1);
    // Allow cascading resets after HSN selection
    isInitialLoadRef.current = false;
  };

  const handleHsnKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!hsnResults.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = (hsnIdx + 1) % hsnResults.length;
      setHsnIdx(next);
      hsnListRef.current?.children[next]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = (hsnIdx - 1 + hsnResults.length) % hsnResults.length;
      setHsnIdx(prev);
      hsnListRef.current?.children[prev]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (hsnIdx >= 0 && hsnResults[hsnIdx]) selectHsnItem(hsnResults[hsnIdx]);
      // Jump to Basic Cost
      setTimeout(() => {
        const next = document.getElementById('f_basic_cost');
        if (next) { next.focus(); try { (next as HTMLInputElement).select(); } catch {} }
      }, 50);
    } else if (e.key === 'Escape') {
      setHsnResults([]);
      setHsnIdx(-1);
    }
  };

  // ── Packaging: auto-recalculate whenever qty/packs/dims change ────────────────
  useEffect(() => {
    const total = calcTotalUnits(pkgInnerQty, pkgInnerPacks);
    setPkgTotalUnits(total);
    // Alert if inner pack is zero
    if (pkgInnerQty === 0 && pkgType !== 'LOOSE') {
      toast.error('Warning: Inner Pack Qty is zero!');
    }
  }, [pkgInnerQty, pkgInnerPacks, pkgType]);

  useEffect(() => {
    const vol = calcVolumeCBM(
      parseFloat(pkgLength) || null,
      parseFloat(pkgWidth)  || null,
      parseFloat(pkgHeight) || null,
    );
    setPkgVolume(vol);
  }, [pkgLength, pkgWidth, pkgHeight]);

  // ── Load existing packaging config when item is loaded ────────────────────────
  const loadPackaging = async (pid: number) => {
    try {
      const res = await packaging_api.get(pid);
      if (res.data) {
        const p = res.data;
        setPkgConfig(p);
        setPkgType(p.packaging_type as PackagingType);
        setPkgInnerQty(p.inner_pack_qty);
        setPkgInnerPacks(p.inner_packs_per_carton);
        setPkgTotalUnits(p.total_units_per_carton);
        setPkgLength(p.carton_length_cm ?? '');
        setPkgWidth(p.carton_width_cm ?? '');
        setPkgHeight(p.carton_height_cm ?? '');
        setPkgVolume(p.carton_volume_cbm ? parseFloat(p.carton_volume_cbm) : null);
        setPkgGrossKg(p.gross_weight_kg ?? '');
        setPkgNetKg(p.net_weight_kg ?? '');
        setPkgUnitBarcode(p.unit_barcode ?? '');
        setPkgInnerBarcode(p.inner_barcode ?? '');
        setPkgCartonBarcode(p.carton_barcode ?? '');
        setPkgOuterQty(p.outer_carton_qty);
        setPkgShelfLife(p.shelf_life_days ?? 0);
        setPkgStorageTypeId(p.storage_type_id);
        setPkgTempCatId(p.temperature_category_id);
        setPkgBaseUomId(p.base_uom_id);
        setPkgPurchaseUomId(p.purchase_uom_id);
        setPkgSalesUomId(p.sales_uom_id);
        setPkgInnerUomId(p.inner_pack_uom_id);
        setPkgOuterUomId(p.outer_carton_uom_id);
        setPkgRack(p.rack_location ?? '');
        setPkgNotes(p.notes ?? '');
      } else {
        resetPackaging();
      }
    } catch { /* no packaging yet */ resetPackaging(); }
  };

  const resetPackaging = () => {
    setPkgConfig(null); setPkgType('LOOSE');
    setPkgInnerQty(1); setPkgInnerPacks(1); setPkgTotalUnits(1);
    setPkgLength(''); setPkgWidth(''); setPkgHeight(''); setPkgVolume(null);
    setPkgGrossKg(''); setPkgNetKg('');
    setPkgUnitBarcode(''); setPkgInnerBarcode(''); setPkgCartonBarcode('');
    setPkgOuterQty(1); setPkgShelfLife(0); setPkgStorageTypeId(null); setPkgTempCatId(null);
    setPkgBaseUomId(null); setPkgPurchaseUomId(null); setPkgSalesUomId(null);
    setPkgInnerUomId(null); setPkgOuterUomId(null);
    setPkgRack(''); setPkgNotes('');
  };

  const clearForm = () => {
    const indiaId = countries.find(c => c.name.toLowerCase() === 'india')?.id ?? '';
    const defaults = {
      name: '', bill_print_name: '', full_item_name: '', item_code: '', barcode: '', barcode_crt: '',
      category_id: '', subcategory_id: '', group_id: '', subgroup_id: '',
      brand_id: '', sub_category_brand_id: '', manufacturer_id: '', submanufacturer_id: '',
      classification_id: '', variant_id: '', flavour_id: '', supplier_id: '',
      country_id: indiaId, unit_id: '', purchase_unit: '', unit: '',
      carton_size: 1, basic_cost: '', purchase_price: '', cost_price: '', selling_price: '', wsp: '', mrp: '',
      gst_percent: '0', purchase_tax_percent: '0', sale_tax_percent: '0',
      description: '', plu_code: '', low_stock_threshold: 5, min_stock: '0', reorder_level: '0', max_stock_level: '0', item_type: 'FG', bom_applicable: false,
      shelf_life_days: '', rack_no: '', aisle_no: '', weight_kg: '', variant: '', size: '', ref_item_code: '', model_no: '',
      allow_neg_stock: false, is_asset: false,
      is_dual_unit: false, is_consumable: false, is_raw_material: false, is_raw_non_sellable: false,
      is_batch_required: false, is_weighing_item: false, is_discountable: true, is_hidden_pos: false,
      is_expired: false, status: 'ACTIVE', approved_by: '', multiplier_to_base: '1', conversion_factor: '1',
      has_batch_tracking: false, has_expiry_tracking: false, mfg_date_required: false, exp_date_required: false,
      min_shelf_life_purchase_days: '', min_shelf_life_sale_days: '', near_expiry_alert_days: 60,
      allow_expired_sale: false, allow_neg_batch_stock: false, batch_wise_purchase_rate: true,
      batch_wise_selling_price: false, is_fefo_enabled: true,
      price_update_level: 'All Store Level', pricing_mode: 'STANDARD', fixed_margin_percent: '',
      allow_custom_margin: true, minimum_margin_percent: '', default_channel_margin: '', online_partner_enabled: false,
      cp_margin: '', mrp_margin: '', sp_margin: '', wsp_margin: '',
    };
    reset(defaults);
    resetPackaging();
    setProductBatches([]);
    setCalcMfgDate('');
    setCalcPreviewExpiry('');
    setIsEdit(false);
    setProductId(null);
    setImagePreview(null);
    setImgFront(null); setImgBack(null); setImgTop(null); setImgSide(null);
    setHsnSearch('');
    setHsnResults([]);
    setSuggestedHsn(null);
    setActivityData([]);
    isInitialLoadRef.current = true; // Reset for new entry
    setOutletPricing(allOutlets.map(o => ({
      outlet_id: o.id, outlet_name: o.outlet_name, unit_code: o.unit_code,
      type: o.type === 'H' ? 'HO' : 'Outlet', cost_price: '', mrp: '', selling_price: '', wsp: '', stock_qty: 0, is_active: true
    })));
  };

  // ── Save packaging ─────────────────────────────────────────────────────────────
  const savePackaging = async () => {
    if (!productId) { toast.error('Save item first before configuring packaging'); return; }

    // Client-side validation
    if (pkgInnerQty < 1 || pkgInnerPacks < 1) {
      toast.error('Invalid packaging configuration — Inner Pack Qty and Inner Packs must be ≥ 1');
      return;
    }
    const gross = parseFloat(pkgGrossKg) || 0;
    const net   = parseFloat(pkgNetKg)   || 0;
    if (gross > 0 && net > 0 && gross < net) {
      toast.error('Invalid packaging configuration — Gross Weight must be ≥ Net Weight');
      return;
    }

    const payload = {
      product_id: productId,
      item_code: watch('item_code') || undefined,
      packaging_type: pkgType,
      inner_pack_qty: pkgInnerQty,
      inner_packs_per_carton: pkgInnerPacks,
      carton_length_cm: parseFloat(pkgLength) || null,
      carton_width_cm:  parseFloat(pkgWidth)  || null,
      carton_height_cm: parseFloat(pkgHeight) || null,
      gross_weight_kg:  gross || null,
      net_weight_kg:    net   || null,
      unit_barcode:    pkgUnitBarcode    || null,
      inner_barcode:   pkgInnerBarcode   || null,
      carton_barcode:  pkgCartonBarcode  || null,
      outer_carton_qty: pkgOuterQty,
      shelf_life_days:  pkgShelfLife || null,
      storage_type_id:  pkgStorageTypeId,
      temperature_category_id: pkgTempCatId,
      base_uom_id:      pkgBaseUomId,
      purchase_uom_id:  pkgPurchaseUomId,
      sales_uom_id:     pkgSalesUomId,
      inner_pack_uom_id: pkgInnerUomId,
      outer_carton_uom_id: pkgOuterUomId,
      rack_location:   pkgRack  || null,
      notes:           pkgNotes || null,
    };

    try {
      setPkgSaving(true);
      if (pkgConfig) {
        const r = await packaging_api.update(pkgConfig.id, payload);
        setPkgConfig(r.data);
      } else {
        const r = await packaging_api.create(payload);
        setPkgConfig(r.data);
      }
      toast.success('Packaging configuration saved!');
    } catch (e: any) {
      const detail = e.response?.data?.detail;
      toast.error(typeof detail === 'string' ? detail : 'Failed to save packaging');
    } finally {
      setPkgSaving(false);
    }
  };

  // Item Type drives the Stock Classification ticks (only when the user changes the type; saved items keep their ticks)
  const TYPE_FLAGS: Record<string, Record<string, boolean>> = {
    FG:   { is_sellable: true,  is_raw_material: false, is_raw_non_sellable: false, is_consumable: false },
    RM:   { is_sellable: false, is_raw_material: true,  is_raw_non_sellable: true,  is_consumable: false },
    PM:   { is_sellable: false, is_raw_material: false, is_raw_non_sellable: true,  is_consumable: false },
    SFG:  { is_sellable: false, is_raw_material: false, is_raw_non_sellable: true,  is_consumable: false },
    CONS: { is_sellable: false, is_raw_material: false, is_raw_non_sellable: false, is_consumable: true },
  };
  const applyItemType = (t: string) => {
    Object.entries(TYPE_FLAGS[t] || {}).forEach(([k, v]) => setValue(k, v, { shouldDirty: true }));
    if (t !== 'FG') setValue('bom_applicable', t === 'SFG', { shouldDirty: true });
  };

  const onSubmit = async (data: any) => {
    if (!hsnSearch.trim()) {
      toast.error('HSN / SAC Code is required');
      return;
    }
    const cat = categories.find(c => c.id.toString() === data.category_id?.toString());
    if (cat) data.category = cat.name;

    // Cleanup: Convert empty strings to null
    Object.keys(data).forEach(key => {
      if (data[key] === '') data[key] = null;
    });

    try {
      if (isEdit && productId) {
        await products_api.update(productId, data);
        toast.success('Item updated successfully!');
        clearForm();
        setTimeout(() => document.getElementById('scan_barcode')?.focus(), 100);
      } else {
        const res = await products_api.create(data);
        const newId = res.data.id;
        const itemCode = res.data.item_code || data.item_code || `ID-${newId}`;  // server generates the code when left blank
        // Show success popup with item code
        setSuccessModal({ show: true, code: itemCode, name: data.name, id: newId });
        return;
      }
    } catch (err: any) {
      console.error('Save error:', err);
      const detail = err.response?.data?.detail;
      if (Array.isArray(detail)) {
        const msg = detail.map((d: any) => {
          const field = Array.isArray(d.loc) ? d.loc[d.loc.length - 1] : 'field';
          return `${field}: ${d.msg}`;
        }).join(' | ');
        toast.error(msg || 'Validation Error');
      } else {
        const status = err.response?.status;
        const detailStr = typeof detail === 'string' ? detail : (detail ? JSON.stringify(detail) : '');
        const msg = `Save failed: ${detailStr || status || err.message || 'Unknown Error'}`;
        toast.error(msg, { duration: 5000 });
      }
    }
  };



  /** Called by QuickAddModal after a successful create — refresh the list and auto-select. */
  async function on_quick_add_success(id: number, name: string) {
    if (!quick_add) return
    switch (quick_add.type) {
      case 'group':
        masters_api.get_item_groups().then(r => setGroups(r.data))
        setValue('group_id', id)
        break
      case 'subgroup':
        if (quick_add.parent_id) masters_api.get_item_subgroups(quick_add.parent_id).then(r => setSubgroups(r.data))
        setValue('subgroup_id', id)
        break
      case 'category':
        masters_api.get_item_categories().then(r => setCategories(r.data))
        setValue('category_id', id)
        break
      case 'subcategory':
        if (quick_add.parent_id) masters_api.get_item_subcategories(quick_add.parent_id).then(r => setSubcategories(r.data))
        setValue('subcategory_id', id)
        break
      case 'brand':
        masters_api.get_brands().then(r => setBrands(r.data))
        setValue('brand_id', id)
        break
      case 'subbrand':
        masters_api.get_sub_brands(quick_add.parent_id, quick_add.parent_id2).then(r => setSubBrands(r.data))
        setValue('sub_category_brand_id', id)
        break
      case 'variant':
        masters_api.get_variants().then(r => setVariants(r.data))
        setValue('variant_id', id)
        break
      case 'flavour':
        masters_api.get_flavours().then(r => setFlavours(r.data))
        setValue('flavour_id', id)
        break
      case 'classification':
        masters_api.get_product_classifications().then(r => setClassifications(r.data))
        setValue('classification_id', id)
        break
      case 'manufacturer':
        masters_api.get_manufacturers().then(r => setManufacturers(r.data))
        setValue('manufacturer_id', id)
        break
    }
    set_quick_add(null)
  }

  const totalStock = outletPricing.reduce((acc, o) => acc + (parseFloat(o.stock_qty) || 0), 0);
  const maxStock = Math.max(...outletPricing.map(o => parseFloat(o.stock_qty) || 0), 1);

  return (
    <div className="w-full pb-28 p-8 flex flex-col lg:flex-row gap-8 items-start">
      {/* ── LEFT SIDEBAR: STOCK & ANALYTICS ── */}
      {isEdit && (
        <aside className="w-full lg:w-80 shrink-0 space-y-6 sticky top-24">
          {/* Stock Summary Card */}
          <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-xl p-6 border border-slate-100 dark:border-slate-800 overflow-hidden relative group">
            <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/5 rounded-full -mr-16 -mt-16 blur-3xl group-hover:bg-blue-500/10 transition-all duration-500"></div>
            
            <div className="relative z-10">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-lg shadow-blue-600/20">
                  <i className="fas fa-warehouse text-sm"></i>
                </div>
                <div>
                  <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 italic">Live Inventory</h3>
                  <p className="text-xl font-black text-slate-800 dark:text-white tracking-tighter">STOCK LEVELS</p>
                </div>
              </div>

              {/* Total Summary */}
              <div className="bg-slate-50 dark:bg-slate-800/50 rounded-2xl p-4 mb-6 border border-slate-100 dark:border-slate-700/50">
                <p className="text-[9px] font-black uppercase text-slate-500 mb-1 tracking-widest italic text-center">Total Cumulative Stock</p>
                <p className="text-3xl font-black text-blue-600 dark:text-blue-400 text-center tracking-tighter">
                  {totalStock.toLocaleString()} <span className="text-xs text-slate-400 font-bold ml-1">{watch('unit') || 'PCS'}</span>
                </p>
              </div>

              {/* Location Breakdown */}
              <div className="space-y-5 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                {outletPricing.map((o) => {
                  const qty = parseFloat(o.stock_qty) || 0;
                  const percentage = (qty / maxStock) * 100;
                  return (
                    <div key={o.outlet_id} className="group/item">
                      <div className="flex justify-between items-end mb-1.5">
                        <div className="flex flex-col">
                          <span className="text-[9px] font-black uppercase text-slate-400 tracking-wider group-hover/item:text-blue-500 transition-colors">{o.unit_code}</span>
                          <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 truncate max-w-[140px]">{o.outlet_name}</span>
                        </div>
                        <div className="text-right">
                          <span className={`text-sm font-mono font-black ${qty > 0 ? 'text-slate-800 dark:text-white' : 'text-slate-300 dark:text-slate-700'}`}>
                            {qty.toLocaleString()}
                          </span>
                        </div>
                      </div>
                      <div className="h-2 w-full bg-slate-100 dark:bg-slate-800/50 rounded-full overflow-hidden border border-slate-50 dark:border-slate-800 shadow-inner">
                        <div 
                          className={`h-full rounded-full transition-all duration-1000 ease-out shadow-sm ${
                            qty > (watch('low_stock_threshold') || 5) 
                              ? 'bg-gradient-to-r from-blue-600 to-blue-400' 
                              : qty > 0 ? 'bg-gradient-to-r from-amber-500 to-amber-300' : 'bg-slate-200 dark:bg-slate-800'
                          }`}
                          style={{ width: `${Math.max(qty > 0 ? 2 : 0, Math.min(percentage, 100))}%` }}
                        ></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Activity/Analytics sidebar card */}
          <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-xl p-6 border border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 rounded-lg bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                <i className="fas fa-chart-pie text-xs"></i>
              </div>
              <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 italic">Product Analytics</h3>
            </div>
            <ActivityCharts data={activityData} />
          </div>
        </aside>
      )}

      {/* ── MAIN CONTENT AREA ── */}
      <div className="flex-1 min-w-0">
      {/* Quick Add Modal */}
      {quick_add && (
        <QuickAddModal
          {...quick_add}
          onSuccess={on_quick_add_success}
          onClose={() => set_quick_add(null)}
        />
      )}

      {/* ── TOP BAR — UNIFIED SEARCH ── */}
      <div className="bg-slate-900 dark:bg-[#0f3460] rounded-xl border border-slate-700 p-4 mb-5 sticky top-0 z-40 shadow-lg">
        <div className="flex items-center gap-3">

          {/* Icon */}
          <div className="bg-blue-600 text-white w-11 h-11 rounded-lg flex items-center justify-center shrink-0">
            <i className="fas fa-barcode text-lg"></i>
          </div>

          {/* Unified search input */}
          <div className="flex-1 relative">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 italic">
              📷 Scan EAN / UPC &nbsp;·&nbsp; 🔍 Search by Name, Code or Barcode — <kbd className="bg-slate-700 text-slate-300 rounded px-1 text-[9px]">↑↓</kbd> Navigate &nbsp; <kbd className="bg-slate-700 text-slate-300 rounded px-1 text-[9px]">Enter</kbd> Select
            </p>
            <div className="flex items-center bg-slate-950 border border-slate-700 rounded-lg focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/30 transition-all">
              {/* Search icon */}
              <span className="pl-4 text-slate-500 shrink-0">
                {searching
                  ? <i className="fas fa-spinner fa-spin text-blue-400"></i>
                  : <i className="fas fa-search text-slate-500"></i>
                }
              </span>
              <input
                id="scan_barcode"
                ref={nameSearchRef}
                type="text"
                autoComplete="off"
                value={nameSearch}
                onChange={e => handleNameSearch(e.target.value)}
                onKeyDown={handleUnifiedKeyDown}
                className="flex-1 bg-transparent text-white text-base px-3 py-2.5 outline-none placeholder-slate-600 font-mono"
                placeholder="Scan barcode OR type name / item code…"
              />
              {/* Hint when typing */}
              {nameSearch && searchResults.length > 0 && (
                <span className="text-slate-500 text-[10px] pr-2 shrink-0 hidden sm:block">
                  {searchHighlightIdx >= 0 ? `${searchHighlightIdx + 1}/${searchResults.length}` : `${searchResults.length} found`}
                </span>
              )}
              {/* Clear button */}
              {nameSearch && (
                <button type="button"
                  onClick={() => { setNameSearch(''); setSearchResults([]); setSearchHighlightIdx(-1); nameSearchRef.current?.focus(); }}
                  className="pr-3 text-slate-500 hover:text-white transition-colors shrink-0">
                  <i className="fas fa-times-circle"></i>
                </button>
              )}
            </div>

            {/* Dropdown results */}
            {(searchResults.length > 0 || (searching && nameSearch.length >= 2) || (!searching && nameSearch.length >= 2 && searchResults.length === 0)) && (
              <div
                ref={searchDropdownRef}
                className="absolute top-full left-0 right-0 mt-1 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl z-50 max-h-80 overflow-y-auto"
              >
                {searching && (
                  <div className="px-4 py-3 text-xs text-slate-400 flex items-center gap-2">
                    <i className="fas fa-spinner fa-spin text-blue-400"></i> Searching…
                  </div>
                )}

                {!searching && searchResults.length === 0 && nameSearch.length >= 2 && (
                  <div className="px-4 py-4 text-center">
                    <div className="text-slate-500 text-sm mb-1">No items found for "<b className="text-slate-300">{nameSearch}</b>"</div>
                    <div className="text-slate-600 text-xs">Press <kbd className="bg-slate-700 text-slate-300 rounded px-1">Enter</kbd> to look up as barcode</div>
                  </div>
                )}

                {searchResults.map((item, idx) => (
                  <button
                    key={item.id}
                    type="button"
                    data-idx={idx}
                    onMouseEnter={() => setSearchHighlightIdx(idx)}
                    onClick={() => loadItemById(item.id)}
                    className={`w-full text-left px-4 py-3 transition-colors border-b border-slate-800 last:border-0 flex items-center justify-between gap-2 ${
                      searchHighlightIdx === idx ? 'bg-blue-600/30 border-blue-700/30' : 'hover:bg-slate-800'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {searchHighlightIdx === idx && (
                        <i className="fas fa-arrow-right text-blue-400 text-xs shrink-0"></i>
                      )}
                      <div className="min-w-0">
                        <p className="text-white text-sm font-semibold leading-tight truncate">{item.name}</p>
                        <p className="text-slate-400 text-xs mt-0.5">{item.item_code} · {item.category} · {item.brand || '—'}</p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-green-400 text-sm font-mono font-bold">₹{item.selling_price}</p>
                      <p className={`text-[10px] font-bold ${item.is_active ? 'text-green-500' : 'text-rose-500'}`}>
                        {item.is_active ? 'Active' : 'Inactive'}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Modify button */}
          <button type="button"
            onClick={() => setShowModal(true)}
            className="shrink-0 bg-amber-500 hover:bg-amber-600 text-white px-4 py-2.5 rounded-lg font-bold text-sm flex items-center gap-2 shadow-lg transition-all">
            <i className="fas fa-edit"></i>
            <span className="hidden sm:inline">Modify Item</span>
          </button>

          {/* Mode badge */}
          <div className="text-right shrink-0">
            <p className="text-[10px] text-slate-500 uppercase">Mode</p>
            <p className={`font-black text-sm italic ${isEdit ? 'text-amber-400' : 'text-green-400'}`}>
              {isEdit ? '✏ EDIT' : '+ NEW'}
            </p>
          </div>
        </div>
      </div>

      {/* ── MODIFY ITEM MODAL ── */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-start justify-center pt-24 px-4">
          <div className="bg-white dark:bg-[#16213e] rounded-2xl shadow-2xl w-full max-w-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="bg-amber-500 px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3 text-white">
                <i className="fas fa-edit text-lg"></i>
                <span className="font-bold text-base">Search & Load Item to Modify</span>
              </div>
              <button type="button" onClick={() => { setShowModal(false); setNameSearch(''); setSearchResults([]); }}
                className="text-white hover:text-amber-200 text-xl">
                <i className="fas fa-times"></i>
              </button>
            </div>
            <div className="p-5">
              <div className="relative">
                <i className="fas fa-search absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"></i>
                <input
                  type="text"
                  value={nameSearch}
                  onChange={e => handleNameSearch(e.target.value)}
                  onKeyDown={handleUnifiedKeyDown}
                  className="w-full pl-10 pr-4 py-3 border border-slate-300 dark:border-slate-600 rounded-xl text-sm focus:ring-2 focus:ring-amber-500 outline-none bg-white dark:bg-[#0f3460] dark:text-slate-100"
                  placeholder="Type item name, code, or barcode…"
                  autoFocus
                />
              </div>
              <div className="mt-3 max-h-80 overflow-y-auto custom-scrollbar rounded-xl border border-slate-100 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700">
                {searching && (
                  <div className="px-4 py-4 text-center text-slate-400 text-sm">
                    <i className="fas fa-spinner fa-spin mr-2"></i>Searching...
                  </div>
                )}
                {!searching && searchResults.length === 0 && nameSearch.length >= 2 && (
                  <div className="px-4 py-4 text-center text-slate-400 text-sm">No items found for "{nameSearch}"</div>
                )}
                {!searching && nameSearch.length < 2 && (
                  <div className="px-4 py-4 text-center text-slate-400 text-sm">Type at least 2 characters to search</div>
                )}
                {searchResults.map((item, idx) => (
                  <button key={item.id} type="button"
                    data-idx={idx}
                    onMouseEnter={() => setSearchHighlightIdx(idx)}
                    onClick={() => loadItemById(item.id)}
                    className={`w-full text-left px-4 py-3 transition-colors ${searchHighlightIdx === idx ? 'bg-amber-50 dark:bg-amber-900/20' : 'hover:bg-amber-50 dark:hover:bg-amber-900/10'}`}>
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm text-slate-800 dark:text-slate-100 truncate">{item.name}</p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {item.item_code && <span className="font-mono bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded mr-2">{item.item_code}</span>}
                          {item.category} {item.brand ? `· ${item.brand}` : ''}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-bold text-sm text-green-600 dark:text-green-400 font-mono">₹{parseFloat(item.selling_price).toFixed(2)}</p>
                        <p className="text-xs text-slate-400">Stock: {parseFloat(item.stock_qty).toFixed(0)} {item.unit}</p>
                      </div>
                      <div className="shrink-0">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${item.is_active ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-rose-100 text-rose-700'}`}>
                          {item.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── TABS ── */}
      <div className="flex items-center gap-1 overflow-x-auto no-scrollbar mb-6">
        {['General', 'SIP', 'Batch & Expiry', 'Outlet Pricing', 'Price Control', 'Online Channels'].map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setActiveTab(t as any)}
            className={`px-5 py-2.5 rounded-lg text-xs font-black uppercase tracking-widest transition-all italic ${
              activeTab === t
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <i className={`fas ${
              t === 'General' ? 'fa-info-circle' : 
              t === 'SIP' ? 'fa-sync' : 
              t === 'Batch & Expiry' ? 'fa-boxes' :
              t === 'Outlet Pricing' ? 'fa-store' : 
              t === 'Online Channels' ? 'fa-globe' :
              'fa-sliders-h'
            } mr-2`}></i>
            {t === 'SIP' ? ' (SIP) Sales, Indent, Purchase' : t}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit(onSubmit)} onKeyDown={(e) => {
        if (e.key !== 'Enter') return;
        const t = e.target as HTMLElement;
        if (t.tagName === 'TEXTAREA') return;
        if (t.tagName === 'BUTTON' || (t as HTMLInputElement).type === 'submit') return;
        if (t.id === 'scan_barcode') return; // scan field uses Enter intentionally
        e.preventDefault();
      }}>
            {/* SIP: Sales, Indent & Purchase Content */}
            {activeTab === 'SIP' && (
              <div className="animate-in fade-in slide-in-from-bottom-4 duration-300">
                <div className={cardCls}>
                  <SectionHeader icon="fa-sync" title="(SIP) Sales, Indent, Purchase" color="violet" />
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {/* Left: Status Dropdown */}
                    <div className="space-y-4">
                      <Label required>Operational Status</Label>
                      <div className="relative group">
                        <select 
                          {...register('status')} 
                          className={`${selectCls} h-12 text-sm font-bold pl-12 border-2 ${
                            watchStatus === 'ACTIVE' ? 'border-green-500/30 bg-green-50/10 text-green-600' :
                            watchStatus === 'TEMP_INACTIVE' ? 'border-amber-500/30 bg-amber-50/10 text-amber-600' :
                            'border-rose-500/30 bg-rose-50/10 text-rose-600'
                          }`}
                        >
                          <option value="ACTIVE">✅ ACTIVE - Normal Operations</option>
                          <option value="TEMP_INACTIVE">⚠️ TEMP INACTIVE - Suspended</option>
                          <option value="DISCONTINUED">🚫 DISCONTINUED - Legacy Item</option>
                          <option value="BLOCKED">🛑 BLOCKED - Compliance/Issue</option>
                        </select>
                        <div className={`absolute left-4 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full ${
                          watchStatus === 'ACTIVE' ? 'bg-green-500' :
                          watchStatus === 'TEMP_INACTIVE' ? 'bg-amber-500' :
                          'bg-rose-500'
                        } shadow-lg shadow-current/50`}></div>
                      </div>
                      
                      <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                        <h4 className="text-[10px] font-black uppercase text-slate-400 mb-2 tracking-widest">(SIP) Status Help Line</h4>
                        <ul className="text-[11px] space-y-2 text-slate-600 dark:text-slate-400 font-medium">
                          <li className={watchStatus === 'ACTIVE' ? 'text-green-600 dark:text-green-400 font-bold' : ''}>
                            <i className="fas fa-check-circle mr-2 text-green-500"></i> <strong>ACTIVE:</strong> Item is live. Visible in <strong>Sales</strong>, <strong>Indent</strong> requests, and <strong>Purchases</strong>.
                          </li>
                          <li className={watchStatus === 'TEMP_INACTIVE' ? 'text-amber-600 dark:text-amber-400 font-bold' : ''}>
                            <i className="fas fa-pause-circle mr-2 text-amber-500"></i> <strong>TEMP_INACTIVE:</strong> Suspended from <strong>Sales</strong> and <strong>Indent</strong>. Stocks remain but cannot be sold.
                          </li>
                          <li className={watchStatus === 'DISCONTINUED' ? 'text-rose-600 dark:text-rose-400 font-bold' : ''}>
                            <i className="fas fa-times-circle mr-2 text-rose-500"></i> <strong>DISCONTINUED:</strong> Permanent block for <strong>Purchases</strong> and <strong>Sales</strong>. No new <strong>Indents</strong> allowed.
                          </li>
                          <li className={watchStatus === 'BLOCKED' ? 'text-rose-600 dark:text-rose-400 font-bold' : ''}>
                            <i className="fas fa-ban mr-2 text-rose-500"></i> <strong>BLOCKED:</strong> Restricted for quality/compliance. Blocked across <strong>SIP</strong> cycle.
                          </li>
                        </ul>
                      </div>
                    </div>

                    {/* Right: Behavior Toggles */}
                    <div className="grid grid-cols-1 gap-4">
                      <Label>SIP Behavior Flags (Sales, Indent, Purchase)</Label>
                      {[
                        { key: 'allow_sale', label: 'Allow Sale / Billing', icon: 'fa-shopping-cart', desc: 'Enable for Sales Invoices' },
                        { key: 'allow_purchase', label: 'Allow Purchase / Indent', icon: 'fa-truck-loading', desc: 'Enable for GRN and Indents' },
                        { key: 'is_hidden_pos', label: 'Hide from POS Search', icon: 'fa-eye-slash', desc: 'Invisible to Sales staff' },
                        { key: 'is_expired', label: 'Item Expired', icon: 'fa-hourglass-end', desc: 'Auto-blocks Sales/Billing', color: 'rose' },
                      ].map((f) => (
                        <label key={f.key} className={`flex items-center gap-4 p-3 rounded-xl border transition-all cursor-pointer ${
                          watch(f.key as any) 
                            ? 'bg-blue-50/50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800' 
                            : 'bg-white dark:bg-slate-900 border-slate-100 dark:border-slate-800 opacity-60'
                        }`}>
                          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                            watch(f.key as any) ? 'bg-blue-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-400'
                          }`}>
                            <i className={`fas ${f.icon}`}></i>
                          </div>
                          <div className="flex-1">
                            <p className="text-xs font-black uppercase tracking-tight">{f.label}</p>
                            <p className="text-[10px] text-slate-400 font-medium">{f.desc}</p>
                          </div>
                          <div className="relative inline-flex items-center cursor-pointer">
                            <input type="checkbox" {...register(f.key as any)} className="sr-only peer" />
                            <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>

                <div className={cardCls}>
                  <SectionHeader icon="fa-calendar-times" title="Date Based Controls" color="amber" />
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <Field>
                      <Label>Expiry Date</Label>
                      <input type="date" {...register('expiry_date')} className={inputCls} />
                      {watch('is_expired') && (
                        <p className="text-[10px] text-rose-500 font-black uppercase mt-1">
                          <i className="fas fa-exclamation-triangle mr-1"></i> Item has expired!
                        </p>
                      )}
                    </Field>
                    <Field>
                      <Label>Launch Date</Label>
                      <input type="date" {...register('launch_date')} className={inputCls} />
                    </Field>
                    <Field>
                      <Label>Discontinue Date</Label>
                      <input type="date" {...register('discontinue_date')} className={inputCls} />
                    </Field>
                  </div>
                </div>
              </div>
            )}

            {/* General Tab Content */}
            {activeTab === 'General' && (
              <div className="animate-in fade-in slide-in-from-bottom-4 duration-300">
                {/* ── HEADER / SAP BASIC INFO ── */}
                <div className={cardCls}>
                  <SectionHeader icon="fa-cube" title="Product Master Header" color="blue" />
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
                    {/* Left side: Image Upload (4-Part) */}
                    <div className="md:col-span-4 space-y-4">
                      <div className="grid grid-cols-2 gap-3">
                        {[
                          { id: 'img_front', label: 'Front View', state: imgFront, setState: setImgFront },
                          { id: 'img_back',  label: 'Back View',  state: imgBack,  setState: setImgBack },
                          { id: 'img_top',   label: 'Top View',   state: imgTop,   setState: setImgTop },
                          { id: 'img_side',  label: 'Side View',  state: imgSide,  setState: setImgSide },
                        ].map((side) => (
                          <div key={side.id} className="relative group">
                            <div className={`aspect-square rounded-2xl border-2 border-dashed transition-all flex flex-col items-center justify-center overflow-hidden bg-slate-50/50 dark:bg-slate-800/30 ${
                              side.state ? 'border-blue-500/50' : 'border-slate-200 dark:border-slate-700 hover:border-blue-400'
                            }`}>
                              {side.state ? (
                                <div className="relative w-full h-full">
                                  <img src={side.state} alt={side.label} className="w-full h-full object-cover" />
                                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                                    <button type="button" onClick={() => { side.setState(null); setValue(side.id, null); }} className="w-8 h-8 rounded-full bg-rose-500 text-white flex items-center justify-center hover:bg-rose-600 transition-colors">
                                      <i className="fas fa-trash-alt text-xs"></i>
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <label className="w-full h-full flex flex-col items-center justify-center cursor-pointer group-hover:bg-blue-50/50 dark:group-hover:bg-blue-900/10 transition-all">
                                  <i className="fas fa-camera text-2xl text-slate-300 group-hover:text-blue-400 mb-2"></i>
                                  <span className="text-[9px] font-black uppercase text-slate-400 group-hover:text-blue-500 tracking-tighter">{side.label}</span>
                                  <span className="mt-2 text-[13px] font-semibold text-slate-300 group-hover:text-blue-400 select-none">800 × 800 px</span>
                                  <span className="text-[10px] text-slate-300 group-hover:text-blue-400 select-none text-center px-2 leading-tight">Square · auto-resized</span>
                                  <input type="file" className="hidden" accept="image/*" onChange={(e) => handleImageChange(e, side.id as any)} />
                                </label>
                              )}
                            </div>
                            {side.state && (
                              <div className="absolute bottom-2 left-2 right-2 bg-black/60 backdrop-blur-md rounded-lg py-1 px-2 pointer-events-none">
                                <p className="text-[8px] font-black text-white uppercase text-center tracking-widest">{side.label}</p>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                      <p className="text-[9px] text-slate-400 font-medium italic text-center">
                        <i className="fas fa-info-circle mr-1"></i> Images will be saved as <strong>barcode_side.webp</strong>
                      </p>

                    </div>

                    {/* Right side: Main fields */}
                    <div className="md:col-span-8 space-y-6">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Item Name */}
                        <div>
                          <Label required>Item Name</Label>
                          <input 
                            {...register('name', { required: true })} 
                            className={`${inputCls} text-lg font-bold`} 
                            placeholder="e.g. Amul Butter 500g" 
                          />
                        </div>
                        {/* Bill Print Name */}
                        <div>
                          <Label>Bill Print Name (Max 50 chars)</Label>
                          <input 
                            {...register('bill_print_name')} 
                            className={inputCls} 
                            maxLength={50}
                            placeholder="Short receipt name" 
                          />
                        </div>
                      </div>

                      {/* Classification & Full Item Name */}
                      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
                        <div className="md:col-span-3">
                          <Label required>Item Type</Label>
                          <select {...register('item_type', { onChange: e => applyItemType(e.target.value) })} className={`${selectCls} font-semibold`}>
                            <option value="FG">Finished Goods</option><option value="RM">Raw Material</option><option value="PM">Packing Material</option>
                            <option value="SFG">Semi-Finished Goods</option><option value="CONS">Consumables</option><option value="OTH">Other Inventory</option>
                          </select>
                        </div>
                        <div className="md:col-span-3">
                          <Label>Customer (made for)</Label>
                          <input {...register('manufacturer_name')} list="customer-names" className={selectCls} placeholder="Pick customer" autoComplete="off" />
                          <datalist id="customer-names">{customerNames.map(n => <option key={n} value={n} />)}</datalist>
                        </div>
                        <div className="md:col-span-3">
                          <Label>Printing</Label>
                          <label className="flex items-center gap-2 text-sm py-2"><input type="checkbox" {...register('needs_printing')} />Printed item - sent to a printer (tin / label / carton)</label>
                        </div>
                        <div className="md:col-span-3">
                          <Label>Product Classification</Label>
                          <select {...register('classification_id')} className={selectCls}>
                            <option value="">— Select —</option>
                            {classifications.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                        </div>
                        <div className="md:col-span-6">
                          <Label>Full Item Name</Label>
                          <input 
                            {...register('full_item_name')} 
                            className={inputCls} 
                            placeholder="Enter detailed item name for reports" 
                          />
                        </div>
                      </div>

                      <div className="space-y-4">
                        {/* ROW 1: GROUP & SUBGROUP */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-3 bg-slate-50 dark:bg-slate-800/30 rounded-xl border border-slate-100 dark:border-slate-800">
                          <div>
                            <Label required action={add_btn({ type: 'group', label: 'Item Group' }, can_add_global_master())}>Item Group</Label>
                            <select {...register('group_id')} className={selectCls}>
                              <option value="">— Select Group —</option>
                              {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                            </select>
                          </div>
                          <div>
                            <Label required action={add_btn({
                              type: 'subgroup', label: 'Item Sub Group',
                              parent_id: Number(watchGroup) || undefined,
                              parent_label: groups.find(g => g.id === Number(watchGroup))?.name,
                            }, can_add_global_master())}>Item Sub Group</Label>
                            <select {...register('subgroup_id')} className={selectCls}>
                              <option value="">— Select Sub Group —</option>
                              {subgroups.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                            </select>
                          </div>
                        </div>

                        {/* ROW 2: CATEGORY & SUBCATEGORY */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-3 bg-slate-50 dark:bg-slate-800/30 rounded-xl border border-slate-100 dark:border-slate-800">
                          <div>
                            <Label required action={add_btn({
                              type: 'category', label: 'Category',
                              parent_id: Number(watch('subgroup_id')) || undefined,
                              parent_label: subgroups.find(s => s.id === Number(watch('subgroup_id')))?.name,
                            }, can_add_master(Number(watchCategory) || undefined))}>Category</Label>
                            <select {...register('category_id', { required: true })} className={selectCls}>
                              <option value="">— Select Category —</option>
                              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                          </div>
                          <div>
                            <Label action={add_btn({
                              type: 'subcategory', label: 'Sub Category',
                              parent_id: Number(watchCategory) || undefined,
                              parent_label: categories.find(c => c.id === Number(watchCategory))?.name,
                            }, can_add_master(Number(watchCategory) || undefined))}>Sub Category</Label>
                            <select {...register('subcategory_id')} className={selectCls}>
                              <option value="">— Select —</option>
                              {subcategories.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                            </select>
                          </div>
                        </div>

                        {/* ROW 3: BRAND & SUB BRAND */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-3 bg-slate-50 dark:bg-slate-800/30 rounded-xl border border-slate-100 dark:border-slate-800">
                          <div>
                            <Label action={add_btn({ type: 'brand', label: 'Brand' }, can_add_master(Number(watchCategory) || undefined))}>Brand</Label>
                            <select {...register('brand_id')} className={selectCls}>
                              <option value="">— None —</option>
                              {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                            </select>
                          </div>
                          <div>
                            <Label action={add_btn({
                              type: 'subbrand', label: 'Sub Brand',
                              parent_id: Number(watchBrand) || undefined,
                              parent_id2: Number(watchSubCategory) || undefined,
                              parent_label: brands.find(b => b.id === Number(watchBrand))?.name,
                              parent_label2: subcategories.find(s => s.id === Number(watchSubCategory))?.name,
                            }, can_add_master(Number(watchCategory) || undefined))}>Sub Brand</Label>
                            <select {...register('sub_category_brand_id')} className={selectCls}>
                              <option value="">— None —</option>
                              {subBrands.map(sb => <option key={sb.id} value={sb.id}>{sb.name}</option>)}
                            </select>
                          </div>
                        </div>

                        {/* ROW 4: VARIANT & FLAVOUR */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-3 bg-slate-50 dark:bg-slate-800/30 rounded-xl border border-slate-100 dark:border-slate-800">
                          <div>
                            <Label action={add_btn({ type: 'variant', label: 'Variant' }, can_add_global_master())}>Variant Master</Label>
                            <select {...register('variant_id')} className={selectCls}>
                              <option value="">— Select Variant —</option>
                              {variants.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                            </select>
                          </div>
                          <div>
                            <Label action={add_btn({ type: 'flavour', label: 'Flavour' }, can_add_global_master())}>Flavour Master</Label>
                            <select {...register('flavour_id')} className={selectCls}>
                              <option value="">— Select Flavour —</option>
                              {flavours.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                            </select>
                          </div>
                        </div>

                        {/* ── PACKING DETAILS SECTION ── */}
                        <div className="bg-indigo-50/50 dark:bg-indigo-900/10 border border-indigo-100 dark:border-indigo-900/30 rounded-2xl p-6 space-y-6">
                          <SectionHeader icon="fa-box-open" title="Advanced Packing Details" color="violet" />
                          
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <Field>
                              <Label>Base UOM</Label>
                              <select value={pkgBaseUomId || ''} onChange={e => setPkgBaseUomId(Number(e.target.value))} className={selectCls}>
                                <option value="">— Select —</option>
                                {units.map(u => <option key={u.id} value={u.id}>{u.unit_name} ({u.unit_code})</option>)}
                              </select>
                            </Field>
                            <Field>
                              <Label>Purchase UOM</Label>
                              <select value={pkgPurchaseUomId || ''} onChange={e => setPkgPurchaseUomId(Number(e.target.value))} className={selectCls}>
                                <option value="">— Select —</option>
                                {units.map(u => <option key={u.id} value={u.id}>{u.unit_name} ({u.unit_code})</option>)}
                              </select>
                            </Field>
                            <Field>
                              <Label>Sales UOM</Label>
                              <select value={pkgSalesUomId || ''} onChange={e => setPkgSalesUomId(Number(e.target.value))} className={selectCls}>
                                <option value="">— Select —</option>
                                {units.map(u => <option key={u.id} value={u.id}>{u.unit_name} ({u.unit_code})</option>)}
                              </select>
                            </Field>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 p-4 bg-white dark:bg-slate-900 rounded-xl border border-indigo-100 dark:border-indigo-800 shadow-sm">
                            <Field>
                              <Label required>Inner Pack Qty</Label>
                              <input type="number" value={pkgInnerQty} onChange={e => setPkgInnerQty(Math.max(0, parseInt(e.target.value) || 0))} className={inputCls} />
                            </Field>
                            <Field>
                              <Label>Inner Pack UOM</Label>
                              <select value={pkgInnerUomId || ''} onChange={e => setPkgInnerUomId(Number(e.target.value))} className={selectCls}>
                                <option value="">— Select —</option>
                                {units.map(u => <option key={u.id} value={u.id}>{u.unit_name} ({u.unit_code})</option>)}
                              </select>
                            </Field>
                            <Field>
                              <Label required>No of Inner Packs</Label>
                              <input type="number" value={pkgInnerPacks} onChange={e => setPkgInnerPacks(Math.max(1, parseInt(e.target.value) || 1))} className={inputCls} />
                            </Field>
                            <Field>
                              <Label>Total PCS in Carton (Auto)</Label>
                              <input type="number" value={pkgTotalUnits} readOnly className={`${inputCls} bg-indigo-50 dark:bg-indigo-900/20 font-bold text-indigo-700 dark:text-indigo-400`} />
                            </Field>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                            <Field>
                              <Label>Outer Carton Qty</Label>
                              <input type="number" value={pkgOuterQty} onChange={e => setPkgOuterQty(Math.max(1, parseInt(e.target.value) || 1))} className={inputCls} />
                            </Field>
                            <Field>
                              <Label>Outer Carton UOM</Label>
                              <select value={pkgOuterUomId || ''} onChange={e => setPkgOuterUomId(Number(e.target.value))} className={selectCls}>
                                <option value="">— Select —</option>
                                {units.map(u => <option key={u.id} value={u.id}>{u.unit_name} ({u.unit_code})</option>)}
                              </select>
                            </Field>
                            <Field>
                              <Label>Carton Weight (kg)</Label>
                              <input type="number" step="0.001" value={pkgGrossKg} onChange={e => setPkgGrossKg(e.target.value)} className={inputCls} placeholder="0.000" />
                            </Field>
                            <Field>
                              <Label>Volume (CBM)</Label>
                              <input type="number" value={pkgVolume || ''} readOnly className={`${inputCls} bg-slate-50 dark:bg-slate-800/50`} placeholder="Auto" />
                            </Field>
                          </div>

                          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                            <Field>
                              <Label>Dimensions (L × W × H cm)</Label>
                              <div className="flex items-center gap-2">
                                <input type="number" value={pkgLength} onChange={e => setPkgLength(e.target.value)} className={inputCls} placeholder="L" />
                                <span className="text-slate-400">×</span>
                                <input type="number" value={pkgWidth} onChange={e => setPkgWidth(e.target.value)} className={inputCls} placeholder="W" />
                                <span className="text-slate-400">×</span>
                                <input type="number" value={pkgHeight} onChange={e => setPkgHeight(e.target.value)} className={inputCls} placeholder="H" />
                              </div>
                            </Field>
                            <Field>
                              <Label>Storage Type</Label>
                              <select value={pkgStorageTypeId || ''} onChange={e => setPkgStorageTypeId(Number(e.target.value))} className={selectCls}>
                                <option value="">— Select —</option>
                                {storageTypes.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                              </select>
                            </Field>
                            <Field>
                              <Label>Temperature Category</Label>
                              <select value={pkgTempCatId || ''} onChange={e => setPkgTempCatId(Number(e.target.value))} className={selectCls}>
                                <option value="">— Select —</option>
                                {tempCats.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                              </select>
                            </Field>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4 border-t border-indigo-100 dark:border-indigo-900/30">
                            <Field>
                              <Label>Single PCS Barcode</Label>
                              <input type="text" value={pkgUnitBarcode} onChange={e => setPkgUnitBarcode(e.target.value)} className={inputCls} placeholder="Scan PCS Barcode" />
                            </Field>
                            <Field>
                              <Label>Inner Pack Barcode</Label>
                              <input type="text" value={pkgInnerBarcode} onChange={e => setPkgInnerBarcode(e.target.value)} className={inputCls} placeholder="Scan Inner Barcode" />
                            </Field>
                            <Field>
                              <Label>Outer Carton Barcode</Label>
                              <input type="text" value={pkgCartonBarcode} onChange={e => setPkgCartonBarcode(e.target.value)} className={inputCls} placeholder="Scan Carton Barcode" />
                            </Field>
                          </div>

                          <div className="flex items-center gap-6 p-4 bg-indigo-600/5 dark:bg-indigo-600/10 rounded-xl border border-indigo-200/50 dark:border-indigo-800/50">
                            <label className="flex items-center gap-3 cursor-pointer group">
                              <div className="relative">
                                <input type="checkbox" checked={pkgQrCode} onChange={e => setPkgQrCode(e.target.checked)} className="sr-only peer" />
                                <div className="w-11 h-6 bg-slate-200 dark:bg-slate-700 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-300 dark:peer-focus:ring-indigo-800 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                              </div>
                              <span className="text-sm font-bold text-indigo-900 dark:text-indigo-100 uppercase tracking-wide group-hover:text-indigo-600 transition-colors">Enable QR Code Label Printing</span>
                            </label>
                            <button
                              type="button"
                              onClick={savePackaging}
                              disabled={pkgSaving || !productId}
                              className="ml-auto bg-indigo-600 hover:bg-indigo-700 text-white px-8 py-2.5 rounded-xl font-bold text-sm shadow-lg shadow-indigo-600/20 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {pkgSaving ? <><i className="fas fa-spinner fa-spin mr-2"></i> Saving...</> : <><i className="fas fa-save mr-2"></i> Save Packing Details</>}
                            </button>
                          </div>
                        </div>

                        {/* ROW 5: MANUFACTURE & SUB MANUFACTURE */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-3 bg-slate-50 dark:bg-slate-800/30 rounded-xl border border-slate-100 dark:border-slate-800">
                          <div>
                            <Label>Manufacturer</Label>
                            <select {...register('manufacturer_id')} className={selectCls}>
                              <option value="">— Select —</option>
                              {manufacturers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                            </select>
                          </div>
                          <div>
                            <Label>Sub Manufacture</Label>
                            <select {...register('submanufacturer_id')} className={selectCls}>
                              <option value="">— Select —</option>
                              {subManufacturers.map(sm => <option key={sm.id} value={sm.id}>{sm.name}</option>)}
                            </select>
                          </div>
                        </div>

                        {/* ROW 6: OTHER INFO */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-3 bg-slate-50 dark:bg-slate-800/30 rounded-xl border border-slate-100 dark:border-slate-800">
                          <div>
                            <Label required>Country of Origin</Label>
                            <select {...register('country_id', { required: true })} className={selectCls}>
                              <option value="">— Select —</option>
                              {countries.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                          </div>
                          <div>
                            <Label>Preferred Supplier</Label>
                            <select {...register('supplier_id')} className={selectCls}>
                              <option value="">— Select Supplier —</option>
                              {(suppliers || []).map(s => <option key={s.id} value={s.id}>{s.supplier_name || s.name}</option>)}
                            </select>
                          </div>
                        </div>
                      </div>
                      
                      <div>
                        <Label>Full Description</Label>
                        <textarea {...register('description')} className={`${inputCls} h-16 resize-none`} placeholder="Full item details"></textarea>
                      </div>
                    </div>
                  </div>
                </div>

            {/* ── IDENTIFICATION & WEIGHING ── */}
            <div className={cardCls}>
              <SectionHeader icon="fa-id-card" title="Identification & Weighing Machine" color="amber" />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Field>
                  <Label>Item Code (Auto/Custom)</Label>
                  <div className="flex">
                    <input {...register('item_code')} className={`${inputCls} rounded-r-none font-mono`} placeholder="Code" />
                    <button type="button" onClick={generateCode} className="bg-blue-600 text-white px-3 rounded-r border border-blue-600 hover:bg-blue-700">
                      <i className="fas fa-magic"></i>
                    </button>
                  </div>
                </Field>
                <Field>
                  <Label>EAN / Barcode</Label>
                  <input {...register('barcode')} className={`${inputCls} font-mono`} placeholder="EAN13" />
                </Field>
                <Field>
                  <Label>Ref. Item Code</Label>
                  <input {...register('ref_item_code')} className={inputCls} placeholder="Internal Ref" />
                </Field>
                <Field>
                  <div className="flex flex-col gap-1">
                    <Label>Weighing Machine PLU</Label>
                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-2 cursor-pointer bg-slate-50 dark:bg-slate-800 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 shrink-0">
                        <input type="checkbox" {...register('is_weighing_item')} className="w-4 h-4 accent-blue-600 rounded" />
                        <span className="text-[10px] font-black uppercase">Enable</span>
                      </label>
                      <input 
                        {...register('plu_code')} 
                        disabled={!watchIsWeighing}
                        required={watchIsWeighing}
                        className={`${inputCls} font-mono ${!watchIsWeighing ? 'opacity-50' : ''}`} 
                        placeholder={watchIsWeighing ? "PLU Code" : "Disabled"} 
                      />
                    </div>
                  </div>
                </Field>
              </div>
              <div className="mt-4 flex flex-wrap gap-6 pt-4 border-t border-slate-100 dark:border-slate-700">
                {[
                  { key: 'is_discountable', label: 'Allow Discount' },
                ].map(({ key, label }) => (
                  <label key={key} className="flex items-center gap-2 cursor-pointer group">
                    <div className="relative flex items-center">
                      <input type="checkbox" {...register(key as any)} className="w-4 h-4 accent-blue-600 rounded" />
                    </div>
                    <span className="text-xs font-bold text-slate-600 dark:text-slate-300 group-hover:text-blue-600 transition-colors">{label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* ── STOCK CLASSIFICATION & UNIT ── */}
            <div className={cardCls}>
              <SectionHeader icon="fa-layer-group" title="Stock Classification & Unit" color="violet" />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="col-span-2 md:col-span-4 flex flex-wrap gap-6 pb-3 border-b border-slate-100 dark:border-slate-700 mb-2">
                  {[
                    { key: 'is_raw_material', label: 'Raw Material' },
                    { key: 'is_sellable', label: 'Sellable' },
                    { key: 'is_raw_non_sellable', label: 'Raw Non-Sellable' },
                    { key: 'is_asset', label: 'Asset' },
                    { key: 'is_consumable', label: 'Consumable' },
                    { key: 'is_dual_unit', label: 'Dual Unit' },
                    { key: 'is_batch_required', label: 'Batch Required' },
                    { key: 'allow_neg_stock', label: 'Allow Neg. Stock' },
                    { key: 'is_active', label: 'Active' },
                  ].map(({ key, label }) => (
                    <label key={key} className="flex items-center gap-2 cursor-pointer text-sm font-medium">
                      <input type="checkbox" {...register(key as any)} className="w-4 h-4 accent-blue-600 rounded" />
                      {label}
                      {key === 'is_batch_required' && watch('is_batch_required') && (
                        <span className="flex items-center gap-1 ml-1" title="GRN: Expiry = Mfg Date + these days">
                          <input type="number" min="0" placeholder="Shelf days"
                            value={watch('shelf_life_days') ?? ''}
                            onChange={e => setValue('shelf_life_days', e.target.value as any, { shouldDirty: true })}
                            className="w-24 h-7 px-2 border border-slate-300 dark:border-slate-600 rounded-lg text-xs font-mono bg-white dark:bg-slate-800" />
                          <span className="text-[10px] text-slate-400">days (Mfg + days = Expiry)</span>
                        </span>
                      )}
                    </label>
                  ))}
                </div>

                <Field>
                  <Label>Base Storage Unit</Label>
                  <select {...register('unit_id')} className={selectCls}>
                    <option value="">— Select —</option>
                    {units.map(u => <option key={u.id} value={u.id}>{u.unit_name} ({u.unit_code})</option>)}
                  </select>
                </Field>
                <Field>
                  <Label>Purchase Unit</Label>
                  <select {...register('purchase_unit')} className={selectCls}>
                    <option value="">— Same as Base —</option>
                    {units.map(u => (
                      <option key={u.id} value={u.unit_code}>
                        {u.unit_name ? `${u.unit_name} (${u.unit_code})` : u.unit_code}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field>
                  <Label>Conv. Factor (Purch→Base)</Label>
                  <input {...register('conversion_factor')} type="number" step="0.001" className={inputCls} placeholder="1" />
                </Field>
                <Field>
                  <Label>Carton Size (Sales)</Label>
                  <input {...register('carton_size')} type="number" className={inputCls} placeholder="1" />
                </Field>
              </div>
            </div>

            {/* ── TAX CONFIGURATION ── */}
            <div className={cardCls}>
              <SectionHeader icon="fa-receipt" title="Tax Configuration" color="rose" />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Field>
                  <Label required>HSN / SAC Code</Label>
                  <div className="relative">
                    <input
                      type="text"
                      value={hsnSearch}
                      onChange={e => handleHsnSearch(e.target.value)}
                      onKeyDown={handleHsnKeyDown}
                      autoComplete="off"
                      className={`${inputCls} font-mono ${!hsnSearch ? 'border-rose-300 dark:border-rose-600' : ''} ${suggestedHsn ? 'bg-amber-50/50 dark:bg-amber-900/10' : ''}`}
                      placeholder="Search HSN... (required)"
                    />
                    {suggestedHsn && (
                      <div className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] font-black bg-amber-500 text-white px-1.5 py-0.5 rounded shadow-sm uppercase">Suggested</div>
                    )}
                    {hsnResults.length > 0 && (
                      <div ref={hsnListRef} className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl z-50 max-h-60 overflow-y-auto custom-scrollbar">
                        {hsnResults.map((h, i) => (
                          <button
                            key={h.id}
                            type="button"
                            onClick={() => selectHsnItem(h)}
                            className={`w-full text-left px-4 py-2.5 transition-colors border-b border-slate-50 dark:border-slate-800 last:border-0 ${i === hsnIdx ? 'bg-blue-50 dark:bg-blue-900/30' : 'hover:bg-blue-50 dark:hover:bg-blue-900/20'}`}
                          >
                            <div className="flex justify-between items-center gap-2">
                              <span className="font-mono font-bold text-blue-600 dark:text-blue-400 text-xs">{h.hsn_code}</span>
                              <span className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 px-2 py-0.5 rounded text-[10px] font-black">{h.gst_percent}%</span>
                            </div>
                            <p className="text-[10px] text-slate-500 mt-1 truncate">{h.description || 'No description'}</p>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </Field>
                <Field>
                  <Label>Default GST %</Label>
                  <select {...register('gst_percent')} className={selectCls}>
                    <option value="0">0%</option>
                    <option value="3">3%</option>
                    <option value="5">5%</option>
                    <option value="12">12%</option>
                    <option value="18">18%</option>
                    <option value="28">28%</option>
                  </select>
                </Field>
                <Field>
                  <Label>Purchase Tax % <span className="text-slate-400 font-normal font-mono">(PUR_TAX)</span></Label>
                  <div className="relative">
                    <input {...register('purchase_tax_percent')} type="number" step="0.01" className={`${inputCls} pr-8`} placeholder="0.00" />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-[10px]">%</span>
                  </div>
                </Field>
                <Field>
                  <Label>Sale Tax % <span className="text-slate-400 font-normal font-mono">(SALE_TAX)</span></Label>
                  <div className="relative">
                    <input {...register('sale_tax_percent')} type="number" step="0.01" className={`${inputCls} pr-8`} placeholder="0.00" />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-[10px]">%</span>
                  </div>
                </Field>
              </div>
              <p className="mt-3 text-[10px] text-slate-400 italic">
                <i className="fas fa-info-circle mr-1"></i> Use different rates if buying loose (0%) and selling packed (5%).
              </p>
            </div>

            {/* ── PRICING ── */}
            <div className={cardCls}>
              <div className="flex items-center justify-between">
                <SectionHeader icon="fa-indian-rupee-sign" title="Pricing" color="green" />
                <label className="flex items-center gap-2 cursor-pointer bg-blue-50 dark:bg-blue-900/20 px-3 py-1.5 rounded-xl border border-blue-100 dark:border-blue-800 transition-all hover:scale-105 active:scale-95">
                    <input type="checkbox" 
                        checked={watchPricingMode === 'MARKDOWN'}
                        onChange={e => setValue('pricing_mode', e.target.checked ? 'MARKDOWN' : 'STANDARD')}
                        className="w-4 h-4 accent-blue-600 rounded" 
                    />
                    <span className="text-[10px] font-black uppercase text-blue-600 dark:text-blue-400 tracking-tight">Enable Markdown Pricing Engine</span>
                </label>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                {(can_view_margins() || !compSettings?.markdown_admin_only) && (
                  <>
                    <Field>
                      <Label>Basic Cost (excl GST)</Label>
                      <input {...register('basic_cost')} id="f_basic_cost" type="number" step="0.01"
                        readOnly={isMarkdown}
                        className={`${inputCls} font-mono ${isMarkdown ? 'bg-slate-100 dark:bg-slate-800' : ''}`} placeholder="0.00"
                        onKeyDown={e => handlePriceEnter(e, 'f_mrp')} />
                    </Field>
                    <Field>
                      <Label>Cost Price (CP) <small className="text-slate-400 font-normal">auto</small></Label>
                      <input {...register('cost_price')} id="f_cost_price" type="number" step="0.01"
                        readOnly={isMarkdown}
                        className={`${inputCls} font-mono ${isMarkdown ? 'bg-green-100/50 dark:bg-green-900/10' : 'bg-green-50 dark:bg-green-900/10'}`} placeholder="0.00"
                        onKeyDown={e => handlePriceEnter(e, 'f_mrp')} />
                    </Field>
                  </>
                )}
                <Field>
                  <Label>MRP</Label>
                  <input {...register('mrp')} id="f_mrp" type="number" step="0.01"
                    className={`${inputCls} font-mono font-bold`} placeholder="0.00"
                    onKeyDown={e => handlePriceEnter(e, 'f_selling_price')} />
                </Field>
                <Field>
                  <Label>Sale Rate (SP)</Label>
                  <input {...register('selling_price')} id="f_selling_price" type="number" step="0.01"
                    className={`${inputCls} font-mono font-bold text-green-700 dark:text-green-400`} placeholder="0.00"
                    onKeyDown={e => handlePriceEnter(e, 'f_wsp')} />
                </Field>
                <Field>
                  <Label>WSP (Wholesale)</Label>
                  <input {...register('wsp')} id="f_wsp" type="number" step="0.01"
                    className={`${inputCls} font-mono`} placeholder="0.00"
                    onKeyDown={e => handlePriceEnter(e, 'f_reorder_level')} />
                </Field>
              </div>

              {(can_view_margins() || !compSettings?.markdown_admin_only) && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4 pt-4 border-t border-slate-100 dark:border-slate-700">
                  <Field>
                    <Label>CP Markup % <small className="text-slate-400 font-normal">(SP-CP)/CP</small></Label>
                    <input {...register('cp_margin')} id="f_cp_margin" type="number" step="0.01" readOnly
                      className={`${inputCls} font-mono font-bold bg-amber-50 dark:bg-amber-900/10 text-amber-700 dark:text-amber-400`} placeholder="—" />
                  </Field>
                  <Field>
                    <Label>{isMarkdown ? 'Markdown % (on MRP)' : 'MRP Margin %'}</Label>
                    <input {...register('mrp_margin')} id="f_mrp_margin" type="number" step="0.01" 
                      readOnly={!isMarkdown}
                      className={`${inputCls} font-mono font-bold ${isMarkdown ? 'bg-white dark:bg-slate-800 ring-2 ring-emerald-500/20' : 'bg-amber-50 dark:bg-amber-900/10'} text-amber-700 dark:text-amber-400`} placeholder={isMarkdown ? "Markdown %" : "—"} />
                  </Field>
                  <Field>
                    <Label>SP Margin % <small className="text-slate-400 font-normal">(SP-CP)/SP</small></Label>
                    <input {...register('sp_margin')} id="f_sp_margin" type="number" step="0.01" readOnly
                      className={`${inputCls} font-mono font-bold bg-amber-50 dark:bg-amber-900/10 text-amber-700 dark:text-amber-400`} placeholder="—" />
                  </Field>
                  <Field>
                    <Label>WS Margin % <small className="text-slate-400 font-normal">(WS-CP)/WS</small></Label>
                    <input {...register('wsp_margin')} id="f_wsp_margin" type="number" step="0.01" readOnly
                      className={`${inputCls} font-mono font-bold bg-amber-50 dark:bg-amber-900/10 text-amber-700 dark:text-amber-400`} placeholder="—" />
                  </Field>
                </div>
              )}
            </div>

            {/* ── MANUFACTURING INVENTORY ── */}
            <div className={cardCls}>
              <SectionHeader icon="fa-industry" title="Manufacturing Inventory" color="cyan" />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Field>
                  <Label>Purchase Pack Qty</Label>
                  <input {...register('purchase_pack_qty')} type="number" step="any" className={`${inputCls} font-mono`} placeholder="e.g. 50 per bundle" />
                </Field>
                <Field>
                  <Label>Minimum Order Qty</Label>
                  <input {...register('min_order_qty')} type="number" step="any" className={`${inputCls} font-mono`} placeholder="MOQ" />
                </Field>
                <Field>
                  <Label>&nbsp;</Label>
                  <label className="flex items-center gap-2 text-sm mt-2"><input type="checkbox" {...register('bom_applicable')} />Has a BOM (manufactured)</label>
                </Field>
                <div className="col-span-2 md:col-span-4">
                  <Label>Remarks</Label>
                  <input {...register('item_remarks')} className={inputCls} placeholder="e.g. customer-specific red cap" />
                </div>
              </div>
            </div>

            {/* ── STOCK THRESHOLDS ── */}
            <div className={cardCls}>
              <SectionHeader icon="fa-chart-bar" title="Stock Thresholds" color="cyan" />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Field>
                  <Label>Reorder Level</Label>
                  <input {...register('reorder_level')} id="f_reorder_level" type="number" step="0.001" 
                    className={`${inputCls} font-mono`} placeholder="0" 
                    onKeyDown={e => handlePriceEnter(e, 'f_min_stock')} />
                </Field>
                <Field>
                  <Label>Min Stock</Label>
                  <input {...register('min_stock')} id="f_min_stock" type="number" step="0.001" 
                    className={`${inputCls} font-mono`} placeholder="0" 
                    onKeyDown={e => handlePriceEnter(e, 'f_max_stock_level')} />
                </Field>
                <Field>
                  <Label>Max Stock</Label>
                  <input {...register('max_stock_level')} id="f_max_stock_level" type="number" step="0.001" 
                    className={`${inputCls} font-mono`} placeholder="0" 
                    onKeyDown={e => handlePriceEnter(e, 'f_low_stock_threshold')} />
                </Field>
                <Field>
                  <Label>Low Stock Alert</Label>
                  <input {...register('low_stock_threshold')} id="f_low_stock_threshold" type="number" 
                    className={`${inputCls} font-mono`} placeholder="5" 
                    onKeyDown={e => handlePriceEnter(e, 'f_weight_kg')} />
                </Field>
              </div>
            </div>

            {/* ── PHYSICAL DETAILS ── */}
            <div className={cardCls}>
              <SectionHeader icon="fa-warehouse" title="Physical Details" color="rose" />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Field>
                  <Label>Weight</Label>
                  <div className="flex items-stretch">
                    <input {...register('weight_kg')} id="f_weight_kg" type="number" step="0.001"
                      className={`${inputCls} font-mono rounded-r-none flex-1`} placeholder="0.000"
                      onKeyDown={e => handlePriceEnter(e, 'f_shelf_life_days')} />
                    <span className="inline-flex items-center px-3 bg-slate-100 dark:bg-slate-700 border border-l-0 border-slate-200 dark:border-slate-600 rounded-r-xl text-xs font-black text-slate-500 dark:text-slate-300 min-w-[3rem] justify-center">
                      {units.find(u => u.id === Number(watchUnitId))?.unit_code || 'KG'}
                    </span>
                  </div>
                </Field>
                <Field>
                  <Label>Shelf Life (days)</Label>
                  <input {...register('shelf_life_days')} id="f_shelf_life_days" type="number"
                    className={`${inputCls} font-mono`} placeholder="0"
                    onKeyDown={e => handlePriceEnter(e, 'f_expiry_date')} />
                </Field>
                <Field>
                  <Label>Expiry Date</Label>
                  <input {...register('expiry_date')} id="f_expiry_date" type="date" className={inputCls} />
                </Field>
                <Field>
                  <Label>Model / Part No.</Label>
                  <input {...register('model_no')} className={inputCls} placeholder="e.g. PRO-X2" />
                </Field>
                <Field>
                  <Label>Aisle # (Warehouse)</Label>
                  <input {...register('aisle_no')} className={`${inputCls} font-mono`} placeholder="e.g. A-12" />
                </Field>
                <Field>
                  <Label>Rack # (Warehouse)</Label>
                  <input {...register('rack_no')} className={`${inputCls} font-mono`} placeholder="e.g. R-03" />
                </Field>
              </div>
            </div>
          </div>
        )}
  
            {/* ── OUTLET PRICING TAB ── */}
            {activeTab === 'Outlet Pricing' && (
          <div className={cardCls}>
            <SectionHeader icon="fa-store" title="Location-wise Pricing & Stock" color="violet" />
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b dark:border-slate-700">
                    <th className="p-3 text-[10px] font-bold text-slate-500 uppercase">Outlet</th>
                    <th className="p-3 text-[10px] font-bold text-slate-500 uppercase">QOH (Stock)</th>
                    <th className="p-3 text-[10px] font-bold text-slate-500 uppercase">CP</th>
                    <th className="p-3 text-[10px] font-bold text-slate-500 uppercase">MRP</th>
                    <th className="p-3 text-[10px] font-bold text-slate-500 uppercase">SP</th>
                    <th className="p-3 text-[10px] font-bold text-slate-500 uppercase">WSP</th>
                    <th className="p-3 text-[10px] font-bold text-slate-500 uppercase text-center">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {outletPricing.map((row, idx) => (
                    <tr key={row.outlet_id} className="border-b dark:border-slate-800">
                      <td className="p-3 text-sm">{row.outlet_name}</td>
                      <td className="p-3 font-mono text-sm">{parseFloat(row.stock_qty || 0).toFixed(2)}</td>
                      <td className="p-2"><input type="number" value={row.cost_price || ''} onChange={e => { const p = [...outletPricing]; p[idx].cost_price = e.target.value; setOutletPricing(p); }} className={`${inputCls} h-8`} placeholder={watch('basic_cost') || '0.00'} /></td>
                      <td className="p-2"><input type="number" value={row.mrp || ''} onChange={e => { const p = [...outletPricing]; p[idx].mrp = e.target.value; setOutletPricing(p); }} className={`${inputCls} h-8`} placeholder={watch('mrp') || '0.00'} /></td>
                      <td className="p-2"><input type="number" value={row.selling_price || ''} onChange={e => { const p = [...outletPricing]; p[idx].selling_price = e.target.value; setOutletPricing(p); }} className={`${inputCls} h-8`} placeholder={watch('selling_price') || '0.00'} /></td>
                      <td className="p-2"><input type="number" value={row.wsp || ''} onChange={e => { const p = [...outletPricing]; p[idx].wsp = e.target.value; setOutletPricing(p); }} className={`${inputCls} h-8`} placeholder={watch('wsp') || '0.00'} /></td>
                      <td className="p-2 text-center">
                        <button 
                          type="button"
                          onClick={() => {
                            const p = [...outletPricing];
                            p[idx].is_active = !p[idx].is_active;
                            setOutletPricing(p);
                          }}
                          className={`w-12 h-6 rounded-full relative transition-all ${row.is_active ? 'bg-green-500' : 'bg-slate-300 dark:bg-slate-700'}`}
                        >
                          <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${row.is_active ? 'right-1' : 'left-1'}`}></div>
                        </button>
                        <p className={`text-[9px] font-bold mt-1 uppercase ${row.is_active ? 'text-green-600' : 'text-slate-400'}`}>
                          {row.is_active ? 'Active' : 'Inactive'}
                        </p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-8 flex justify-end">
              <button
                type="button"
                onClick={async () => {
                  if (!productId) return;
                  // Fill defaults if empty
                  const finalPricing = outletPricing.map(p => ({
                    ...p,
                    cost_price: p.cost_price || watch('basic_cost'),
                    mrp: p.mrp || watch('mrp'),
                    selling_price: p.selling_price || watch('selling_price'),
                    wsp: p.wsp || watch('wsp'),
                    is_active: p.is_active ?? true
                  }));
                  try {
                    await products_api.update_outlet_pricing(productId, finalPricing);
                    toast.success('Outlet pricing updated!');
                  } catch { toast.error('Failed to update outlet pricing'); }
                }}
                disabled={!productId}
                className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-2.5 rounded-lg font-bold text-sm shadow-lg transition-all disabled:opacity-50"
              >
                <i className="fas fa-save mr-2"></i> Save Outlet Pricing
              </button>
            </div>
          </div>
        )}

        {/* ── PRICE CONTROL TAB ── */}
        {activeTab === 'Price Control' && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-300">
            <div className={cardCls}>
              <SectionHeader icon="fa-sliders-h" title="Price Governance & Control" color="rose" />
              
              <div className="bg-rose-50 dark:bg-rose-900/10 border border-rose-200 dark:border-rose-800 rounded-2xl p-6">
                <div className="mb-6">
                  <h3 className="text-sm font-black text-rose-700 dark:text-rose-400 uppercase tracking-widest flex items-center gap-2">
                    <i className="fas fa-layer-group"></i>
                    Price Update Level
                  </h3>
                  <p className="text-xs text-rose-600 dark:text-rose-500 mt-1 font-medium italic">
                    Define how price changes for this item should propagate across your store network.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {[
                    { id: 'All Store Level', label: 'Global (All Stores)', icon: 'fa-globe', desc: 'Sync price change to every outlet automatically.' },
                    { id: 'City Level', label: 'Regional (City-wise)', icon: 'fa-city', desc: 'Apply updates only to stores in the same city.' },
                    { id: 'State Level', label: 'Regional (State-wise)', icon: 'fa-map-marked-alt', desc: 'Apply updates to all stores within the state.' },
                    { id: 'Selective Store Level', label: 'Granular (Selective)', icon: 'fa-mouse-pointer', desc: 'Manually choose specific stores for this update.' },
                    { id: 'Store Type Level', label: 'Categorical (Store Type)', icon: 'fa-tags', desc: 'Sync by store category (e.g., Express vs Hyper).' }
                  ].map((lvl) => (
                    <div key={lvl.id} className="space-y-2">
                      <label className={`flex items-start gap-4 p-4 rounded-xl border-2 cursor-pointer transition-all hover:shadow-md ${
                        watch('price_update_level') === lvl.id 
                          ? 'bg-white dark:bg-rose-900/30 border-rose-500 shadow-sm' 
                          : 'bg-white/50 dark:bg-slate-800/50 border-transparent hover:border-rose-200 dark:hover:border-rose-800'
                      }`}>
                        <input 
                          type="radio" 
                          value={lvl.id} 
                          {...register('price_update_level')}
                          className="mt-1 w-4 h-4 text-rose-600 focus:ring-rose-500" 
                        />
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <i className={`fas ${lvl.icon} ${watch('price_update_level') === lvl.id ? 'text-rose-500' : 'text-slate-400'}`}></i>
                            <span className={`text-sm font-bold uppercase tracking-wide ${watch('price_update_level') === lvl.id ? 'text-rose-700 dark:text-rose-300' : 'text-slate-600 dark:text-slate-400'}`}>
                              {lvl.label}
                            </span>
                          </div>
                          <p className="text-[10px] text-slate-500 leading-relaxed">{lvl.desc}</p>
                        </div>
                      </label>

                      {/* Targeted Value Selection */}
                      {watch('price_update_level') === lvl.id && (lvl.id === 'City Level' || lvl.id === 'State Level' || lvl.id === 'Store Type Level') && (
                        <div className="ml-8 animate-in slide-in-from-top-2 duration-200">
                          <Label required>Select {lvl.id.replace(' Level', '')}</Label>
                          <select 
                            {...register('price_update_target')}
                            className={`${selectCls} border-rose-300 dark:border-rose-800 focus:ring-rose-500`}
                          >
                            <option value="">-- Select {lvl.id.replace(' Level', '')} --</option>
                            {lvl.id === 'City Level' && Array.from(new Set(allOutlets.map(o => o.city).filter(Boolean))).sort().map(city => (
                              <option key={city} value={city}>{city}</option>
                            ))}
                            {lvl.id === 'State Level' && Array.from(new Set(allOutlets.map(o => o.state).filter(Boolean))).sort().map(state => (
                              <option key={state} value={state}>{state}</option>
                            ))}
                            {lvl.id === 'Store Type Level' && Array.from(new Set(allOutlets.map(o => o.store_type).filter(Boolean))).sort().map(type => (
                              <option key={type} value={type}>{type}</option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Quick Info Box */}
              <div className="mt-6 flex items-center gap-4 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl">
                <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-800 flex items-center justify-center shrink-0">
                  <i className="fas fa-info-circle text-blue-600 dark:text-blue-400"></i>
                </div>
                <div>
                  <p className="text-xs font-bold text-blue-800 dark:text-blue-300 uppercase">Pro Tip</p>
                  <p className="text-[10px] text-blue-700 dark:text-blue-400 mt-0.5">
                    Setting a price level ensures consistent pricing strategies across your branches without manual intervention for each store.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── ONLINE CHANNELS TAB ── */}
        {activeTab === 'Online Channels' && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-300">
            {!compSettings?.enable_channel_pricing ? (
                <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 p-8 rounded-3xl text-center">
                    <i className="fas fa-lock text-4xl text-amber-400 mb-4"></i>
                    <h3 className="text-lg font-bold">Channel Pricing Disabled</h3>
                    <p className="text-sm text-slate-500 max-w-md mx-auto mt-2">Enable Online Channel Pricing in Company Settings to manage marketplace-specific rates here.</p>
                </div>
            ) : (
                <div className={cardCls}>
                    <SectionHeader icon="fa-globe" title="Online Marketplace Pricing" color="blue" />
                    
                    {loadingChannels ? (
                        <div className="py-20 text-center"><i className="fas fa-spinner fa-spin text-3xl text-primary/20"></i></div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {(channelPrices || []).map(cp => (
                                <div key={cp.partner_id} className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 overflow-hidden shadow-sm hover:shadow-md transition-all group">
                                    <div className="p-4 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-white text-[10px] font-black uppercase italic shadow-sm overflow-hidden ${
                                                cp.partner_code === 'SWG' ? 'bg-orange-500' : 
                                                cp.partner_code === 'ZOM' ? 'bg-rose-500' :
                                                cp.partner_code === 'AMZ' ? 'bg-slate-900' :
                                                'bg-gradient-to-br from-blue-500 to-indigo-600'
                                            }`}>
                                                {cp.logo_url ? (
                                                    <img src={cp.logo_url} alt={cp.partner_name} className="w-full h-full object-cover" />
                                                ) : (
                                                    <span>{cp.partner_code}</span>
                                                )}
                                            </div>
                                            <span className="font-bold text-sm">{cp.partner_name}</span>
                                        </div>
                                        <button 
                                            type="button"
                                            onClick={() => {
                                                setActiveSimPartner(cp);
                                                setSimulatorOpen(true);
                                            }}
                                            className="text-xs font-black text-primary uppercase tracking-tighter hover:underline"
                                        >
                                            <i className="fas fa-calculator mr-1"></i> Simulate
                                        </button>
                                    </div>
                                    <div className="p-5 space-y-4">
                                        <div className="flex justify-between items-end">
                                            <div>
                                                <p className="text-[10px] font-black text-slate-400 uppercase">Selling Price</p>
                                                <p className="text-xl font-black text-slate-800 dark:text-white">₹{cp.selling_price || '—'}</p>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-[10px] font-black text-slate-400 uppercase">Settlement</p>
                                                <p className="text-sm font-bold text-primary">₹{cp.final_settlement_rate || '—'}</p>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-2 gap-3 pt-3 border-t border-slate-50 dark:border-slate-700">
                                            <div className="text-[10px] text-slate-400">
                                                <span className="block font-bold">NET PROFIT</span>
                                                <span className={`font-mono font-bold ${cp.net_profit && cp.net_profit > 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                                    ₹{cp.net_profit ?? '—'}
                                                </span>
                                            </div>
                                            <div className="text-[10px] text-slate-400">
                                                <span className="block font-bold">MARGIN %</span>
                                                <span className="font-mono font-bold text-slate-600 dark:text-slate-300">
                                                    {cp.net_margin_pct ?? '—'}%
                                                </span>
                                            </div>
                                        </div>
                                        
                                        <div className="flex items-center gap-2">
                                            <div className={`flex-1 h-1 rounded-full ${cp.net_margin_pct && cp.net_margin_pct > 15 ? 'bg-emerald-500' : 'bg-amber-500'} opacity-20`}></div>
                                            <span className="text-[8px] font-black uppercase text-slate-400">{cp.settlement_days}D SETTLE</span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
          </div>
        )}

        {/* ── BATCH & EXPIRY MANAGEMENT TAB ── */}
        {activeTab === 'Batch & Expiry' && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-300 space-y-8">
            {/* Presets Header */}
            <div className="bg-gradient-to-r from-blue-900/30 to-indigo-900/20 border border-blue-500/20 p-6 rounded-3xl flex flex-col md:flex-row items-center justify-between gap-4">
              <div>
                <h3 className="text-base font-black uppercase tracking-wider text-slate-800 dark:text-white flex items-center gap-2">
                  <i className="fas fa-boxes text-blue-500"></i> Batch & Expiry Configuration Presets
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Quick-apply tracking rules according to product category requirements.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setValue('has_batch_tracking', false);
                    setValue('has_expiry_tracking', false);
                    setValue('mfg_date_required', false);
                    setValue('exp_date_required', false);
                    toast.success('Applied: Standard Non-Batch Preset');
                  }}
                  className="px-3.5 py-1.5 rounded-xl text-xs font-bold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 text-slate-700 dark:text-slate-200 transition-all shadow-sm"
                >
                  <i className="fas fa-ban mr-1.5 text-slate-400"></i> No Batch / Expiry
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setValue('has_batch_tracking', true);
                    setValue('has_expiry_tracking', false);
                    setValue('mfg_date_required', false);
                    setValue('exp_date_required', false);
                    setValue('is_fefo_enabled', false);
                    toast.success('Applied: Batch-Only (Dry/Hardware) Preset');
                  }}
                  className="px-3.5 py-1.5 rounded-xl text-xs font-bold bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 hover:bg-amber-100 transition-all shadow-sm"
                >
                  <i className="fas fa-barcode mr-1.5 text-amber-500"></i> Batch Only (No Expiry)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setValue('has_batch_tracking', true);
                    setValue('has_expiry_tracking', true);
                    setValue('mfg_date_required', true);
                    setValue('exp_date_required', true);
                    setValue('is_fefo_enabled', true);
                    setValue('allow_expired_sale', false);
                    if (!watch('shelf_life_days')) setValue('shelf_life_days', 180);
                    if (!watch('near_expiry_alert_days')) setValue('near_expiry_alert_days', 60);
                    toast.success('Applied: Full FMCG / Expiry Preset');
                  }}
                  className="px-3.5 py-1.5 rounded-xl text-xs font-bold bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 transition-all shadow-sm"
                >
                  <i className="fas fa-shield-alt mr-1.5 text-emerald-500"></i> Full Expiry + FEFO (FMCG)
                </button>
              </div>
            </div>

            {/* Core Tracking Toggles */}
            <div className={cardCls}>
              <SectionHeader icon="fa-sliders-h" title="Tracking Flags & Operational Controls" color="blue" />
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[
                  {
                    key: 'has_batch_tracking',
                    label: 'Batch Tracking',
                    desc: 'Maintain distinct batch IDs, vendor lots & batch-wise stock levels',
                    icon: 'fa-cubes',
                    color: 'blue'
                  },
                  {
                    key: 'has_expiry_tracking',
                    label: 'Expiry Tracking',
                    desc: 'Track expiration dates and enforce shelf-life constraints',
                    icon: 'fa-calendar-alt',
                    color: 'emerald'
                  },
                  {
                    key: 'is_fefo_enabled',
                    label: 'FEFO Allocation',
                    desc: 'First Expiry, First Out automatically selects nearest expiry at POS/Sale',
                    icon: 'fa-sort-amount-up-alt',
                    color: 'violet'
                  },
                  {
                    key: 'mfg_date_required',
                    label: 'Mfg Date Required',
                    desc: 'Mandate manufacturing date during GRN goods receipt',
                    icon: 'fa-industry',
                    color: 'cyan'
                  },
                  {
                    key: 'exp_date_required',
                    label: 'Expiry Date Required',
                    desc: 'Mandate expiration date during GRN goods receipt',
                    icon: 'fa-calendar-times',
                    color: 'amber'
                  },
                  {
                    key: 'allow_expired_sale',
                    label: 'Allow Expired Sale',
                    desc: 'Permit selling expired stock (Strictly disabled by default)',
                    icon: 'fa-exclamation-triangle',
                    color: 'rose'
                  },
                  {
                    key: 'allow_neg_batch_stock',
                    label: 'Allow Negative Batch Stock',
                    desc: 'Permit billing below zero for individual batches',
                    icon: 'fa-minus-circle',
                    color: 'rose'
                  },
                  {
                    key: 'batch_wise_purchase_rate',
                    label: 'Batch Purchase Rate Tracking',
                    desc: 'Track distinct cost/purchase rate per individual batch',
                    icon: 'fa-file-invoice-dollar',
                    color: 'blue'
                  },
                  {
                    key: 'batch_wise_selling_price',
                    label: 'Batch-Wise Selling Price',
                    desc: 'Allow batches of same product to have different selling prices',
                    icon: 'fa-tags',
                    color: 'indigo'
                  },
                ].map((f) => (
                  <label
                    key={f.key}
                    className={`flex items-start gap-3.5 p-4 rounded-2xl border transition-all cursor-pointer ${
                      watch(f.key as any)
                        ? 'bg-blue-50/50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800 shadow-sm'
                        : 'bg-white dark:bg-slate-900 border-slate-100 dark:border-slate-800 opacity-60 hover:opacity-90'
                    }`}
                  >
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
                      watch(f.key as any) ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20' : 'bg-slate-100 dark:bg-slate-800 text-slate-400'
                    }`}>
                      <i className={`fas ${f.icon} text-sm`}></i>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-black uppercase tracking-tight text-slate-800 dark:text-slate-100">{f.label}</p>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">{f.desc}</p>
                    </div>
                    <div className="relative inline-flex items-center cursor-pointer shrink-0 mt-1">
                      <input type="checkbox" {...register(f.key as any)} className="sr-only peer" />
                      <div className="w-10 h-5 bg-slate-200 peer-focus:outline-none dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Shelf Life & Policy Thresholds */}
            <div className={cardCls}>
              <SectionHeader icon="fa-hourglass-half" title="Shelf Life & Expiry Policies" color="amber" />
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <div>
                  <Label>Total Shelf Life (Days)</Label>
                  <div className="relative">
                    <input
                      type="number"
                      min="0"
                      {...register('shelf_life_days')}
                      className={inputCls}
                      placeholder="e.g. 180"
                    />
                    <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Days</span>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1.5">Auto-computes expiry when Mfg Date is entered at GRN.</p>
                </div>

                <div>
                  <Label>Min Remaining at Purchase (Days)</Label>
                  <div className="relative">
                    <input
                      type="number"
                      min="0"
                      {...register('min_shelf_life_purchase_days')}
                      className={inputCls}
                      placeholder="e.g. 60"
                    />
                    <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Days</span>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1.5">Rejects/warns at GRN if supplier goods have less life left.</p>
                </div>

                <div>
                  <Label>Min Remaining at Sale (Days)</Label>
                  <div className="relative">
                    <input
                      type="number"
                      min="0"
                      {...register('min_shelf_life_sale_days')}
                      className={inputCls}
                      placeholder="e.g. 15"
                    />
                    <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Days</span>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1.5">Blocks sale at POS if remaining shelf life is below this limit.</p>
                </div>

                <div>
                  <Label>Near-Expiry Alert Threshold</Label>
                  <select {...register('near_expiry_alert_days')} className={selectCls}>
                    <option value="15">15 Days Before Expiry</option>
                    <option value="30">30 Days Before Expiry</option>
                    <option value="45">45 Days Before Expiry</option>
                    <option value="60">60 Days Before Expiry (Recommended)</option>
                    <option value="90">90 Days Before Expiry</option>
                    <option value="120">120 Days Before Expiry</option>
                    <option value="180">180 Days Before Expiry</option>
                  </select>
                  <p className="text-[10px] text-slate-400 mt-1.5">Batches within this window trigger dashboard alerts.</p>
                </div>
              </div>

              {/* Date Simulator preview */}
              <div className="mt-8 pt-6 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/20 p-5 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700">
                <h4 className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-2 mb-3">
                  <i className="fas fa-calculator text-blue-500"></i> Interactive Shelf Life Calculator & Preview
                </h4>
                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex-1 min-w-[200px]">
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Simulate Mfg Date</label>
                    <input
                      type="date"
                      value={calcMfgDate}
                      onChange={(e) => setCalcMfgDate(e.target.value)}
                      className={inputCls}
                    />
                  </div>
                  <div className="flex items-center justify-center pt-5 text-slate-400">
                    <i className="fas fa-arrow-right text-lg hidden md:block"></i>
                  </div>
                  <div className="flex-1 min-w-[200px]">
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Calculated Expiry Date</label>
                    <input
                      type="date"
                      readOnly
                      value={calcPreviewExpiry}
                      className={`${inputCls} bg-blue-50/50 dark:bg-blue-900/20 font-bold text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800`}
                    />
                  </div>
                  <div className="w-full md:w-auto pt-4 md:pt-5">
                    {calcPreviewExpiry ? (
                      <span className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 text-xs font-bold">
                        <i className="fas fa-check-circle text-emerald-600"></i> Valid Calculation ({watch('shelf_life_days')} days shelf life)
                      </span>
                    ) : (
                      <span className="text-[11px] text-slate-400 italic">Enter a Mfg Date and Shelf Life to preview auto-calculated expiry</span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Central Product Batches Register (if editing existing product) */}
            {productId ? (
              <div className={cardCls}>
                <div className="flex items-center justify-between mb-6">
                  <SectionHeader icon="fa-list-ul" title={`Recorded Batches for Item #${productId}`} color="violet" />
                  <button
                    type="button"
                    onClick={() => {
                      setLoadingBatches(true);
                      batches_api.list({ product_id: productId, per_page: 50 })
                        .then(res => setProductBatches(Array.isArray(res.data) ? res.data : ((res.data as any)?.data || [])))
                        .catch(err => console.error("Failed to refresh batches", err))
                        .finally(() => setLoadingBatches(false));
                    }}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all border border-slate-200 dark:border-slate-700"
                  >
                    <i className="fas fa-sync-alt mr-1"></i> Refresh
                  </button>
                </div>

                {loadingBatches ? (
                  <div className="py-12 text-center text-slate-400">
                    <i className="fas fa-spinner fa-spin text-2xl mb-2"></i>
                    <p className="text-xs">Loading recorded batches...</p>
                  </div>
                ) : productBatches.length === 0 ? (
                  <div className="py-12 text-center bg-slate-50 dark:bg-slate-800/30 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 text-slate-400">
                    <i className="fas fa-box-open text-3xl mb-2 opacity-30"></i>
                    <p className="text-xs font-bold uppercase tracking-wider">No Batches Inwarded Yet</p>
                    <p className="text-[11px] mt-1 text-slate-500">Batches will automatically register here as goods are received via GRN.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-100 dark:bg-slate-800 uppercase text-[10px] font-black text-slate-500 tracking-wider">
                        <tr>
                          <th className="px-4 py-3">Batch ID / No</th>
                          <th className="px-4 py-3">Supplier Batch</th>
                          <th className="px-4 py-3">Mfg Date</th>
                          <th className="px-4 py-3">Exp Date</th>
                          <th className="px-4 py-3 text-right">Available Qty</th>
                          <th className="px-4 py-3 text-right">Purchase Rate</th>
                          <th className="px-4 py-3 text-right">MRP</th>
                          <th className="px-4 py-3 text-center">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {productBatches.map((b) => {
                          const isExpired = b.status === 'Expired' || (b.days_to_expiry !== null && b.days_to_expiry !== undefined && b.days_to_expiry <= 0);
                          const isNearExpiry = b.status === 'Near Expiry' || (b.days_to_expiry !== null && b.days_to_expiry !== undefined && b.days_to_expiry > 0 && b.days_to_expiry <= 60);
                          return (
                            <tr key={b.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40 transition-colors">
                              <td className="px-4 py-3 font-mono font-bold text-blue-600 dark:text-blue-400">
                                {b.batch_no}
                              </td>
                              <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                                {b.supplier_batch_no || '—'}
                              </td>
                              <td className="px-4 py-3 text-slate-500">
                                {b.mfg_date || '—'}
                              </td>
                              <td className="px-4 py-3">
                                <span className={`font-semibold ${isExpired ? 'text-rose-600' : isNearExpiry ? 'text-amber-600' : 'text-slate-700 dark:text-slate-200'}`}>
                                  {b.exp_date || '—'}
                                </span>
                                {b.days_to_expiry !== null && b.days_to_expiry !== undefined && (
                                  <span className="block text-[9px] text-slate-400">
                                    {b.days_to_expiry <= 0 ? 'Expired' : `${b.days_to_expiry}d left`}
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-right font-black text-slate-800 dark:text-white">
                                {b.total_current_qty ?? 0}
                              </td>
                              <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-300">
                                ₹{Number(b.purchase_rate || 0).toFixed(2)}
                              </td>
                              <td className="px-4 py-3 text-right font-bold text-slate-800 dark:text-white">
                                ₹{Number(b.mrp || 0).toFixed(2)}
                              </td>
                              <td className="px-4 py-3 text-center">
                                <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                                  b.status === 'Active' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300' :
                                  b.status === 'Near Expiry' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300' :
                                  b.status === 'Expired' ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300' :
                                  b.status === 'Quarantined' ? 'bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300' :
                                  'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                                }`}>
                                  {b.status}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        )}

        {/* ── STICKY FOOTER ── */}
        <div className="sticky bottom-0 z-30 bg-white dark:bg-[#16213e] border-t border-slate-200 dark:border-slate-700 px-6 py-4 flex items-center justify-between shadow-[0_-10px_20px_rgba(0,0,0,0.05)] mt-8 -mx-8 -mb-8">
          <button type="button" onClick={clearForm}
            className="px-5 py-2 rounded-lg border dark:border-slate-600 text-sm font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 transition-all">
            Clear
          </button>
          <button type="submit" className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-8 py-2.5 rounded-lg font-bold text-sm shadow-lg transition-all">
            <i className="fas fa-save"></i> {isEdit ? 'Update Item' : 'Save New Item'}
          </button>
        </div>
      </form>

      {/* ── ITEM CREATED SUCCESS POPUP ── */}
      {successModal.show && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-[#16213e] rounded-2xl shadow-2xl p-8 max-w-sm w-full mx-4 text-center">
            {/* Green Check */}
            <div className="w-20 h-20 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto mb-5">
              <i className="fas fa-check-circle text-green-500 text-4xl"></i>
            </div>
            {/* Title */}
            <h2 className="text-xl font-black text-slate-800 dark:text-slate-100 uppercase tracking-wide mb-1">
              Item Created Successfully!
            </h2>
            <p className="text-slate-500 dark:text-slate-400 text-sm mb-5 truncate px-2">{successModal.name}</p>
            {/* Item Code Box */}
            <div className="bg-slate-100 dark:bg-slate-800 rounded-xl px-6 py-4 mb-6 border-2 border-green-200 dark:border-green-800">
              <p className="text-xs text-slate-400 uppercase tracking-widest mb-1 font-semibold">Item Code</p>
              <p className="text-2xl font-black font-mono text-blue-600 dark:text-blue-400 tracking-wider">
                {successModal.code || `#${successModal.id}`}
              </p>
            </div>
            {/* OK Button */}
            <button
              autoFocus
              onClick={() => {
                setSuccessModal({ show: false, code: '', name: '', id: null });
                clearForm();
                setTimeout(() => {
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                  document.getElementById('scan_barcode')?.focus();
                }, 50);
              }}
              className="w-full bg-green-600 hover:bg-green-700 active:scale-95 text-white font-bold text-base py-3 rounded-xl transition-all shadow-lg"
            >
              <i className="fas fa-check mr-2"></i> OK
            </button>
          </div>
        </div>
      )}
      {simulatorOpen && activeSimPartner && (
        <PriceSimulator 
            isOpen={simulatorOpen}
            onClose={() => setSimulatorOpen(false)}
            onApply={handleApplySimulatedPrice}
            partnerName={activeSimPartner.partner_name}
            initialData={{
                mrp: activeSimPartner.mrp,
                cost_price: activeSimPartner.base_cost,
                gst_percent: Number(watch('gst_percent')) || 0,
                partner_commission: activeSimPartner.partner_commission,
                extra_margin: activeSimPartner.margin_percent,
                delivery_charge: activeSimPartner.default_delivery || 0,
                packing_charge: activeSimPartner.default_packing || 0
            }}
        />
      )}
      </div>
    </div>
  );
};

function ProductAddWrapper() {
  return (
    <ErrorBoundary>
      <ProductAdd />
    </ErrorBoundary>
  );
}

export default ProductAddWrapper;


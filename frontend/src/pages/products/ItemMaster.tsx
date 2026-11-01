import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useNavigate, useLocation } from 'react-router-dom';
import { products_api, type product_list_item, type paginated } from '../../api/products';
import Groups from '../masters/Groups';
import SubGroups from '../masters/SubGroups';
import Categories from '../masters/Categories';
import SubCategories from '../masters/SubCategories';
import Brands from '../masters/Brands';
import SubBrands from '../masters/SubBrands';
import Manufacturers from '../masters/Manufacturers';
import SubManufacturers from '../masters/SubManufacturers';
import Variants from '../masters/Variants';
import Flavours from '../masters/Flavours';
import ProductClassification from '../masters/ProductClassification';
import Units from '../masters/Units';
import CountryMaster from '../masters/CountryMaster';
import HsnMaster from '../masters/HsnMaster';
import GstMaster from '../masters/GstMaster';
import Suppliers from '../masters/Suppliers';
import ChannelPartners from '../masters/ChannelPartners';


const PER_PAGE = 50;

const ItemMaster = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const queryParams = new URLSearchParams(location.search);
  const initialSection = queryParams.get('section') || 'products';

  const [activeSection, setActiveSection] = useState(initialSection);
  
  useEffect(() => {
    const s = new URLSearchParams(location.search).get('section');
    if (s) setActiveSection(s);
  }, [location.search]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchParams] = useSearchParams();
  const urlType = searchParams.get('type') || '';   // sidebar shortcuts: ?type=RM / PM / FG
  const [itemType, setItemType] = useState(urlType);   // FG / RM / PM / SFG / CONS / OTH
  useEffect(() => { setItemType(urlType); }, [urlType]);
  const [resultCount, setResultCount] = useState(0);

  // ── Product list state ────────────────────────────────────────────────────
  const [result, setResult] = useState<paginated<product_list_item> | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const loadProducts = useCallback(async (p: number, s: string) => {
    setLoading(true);
    try {
      const res = await products_api.list({ page: p, per_page: PER_PAGE, search: s, item_type: itemType || undefined });
      setResult(res.data);
    } catch (e) {
      console.error('Failed to load products', e);
    } finally {
      setLoading(false);
    }
  }, [itemType]);

  // Load products on mount, when section switches to products, and when the item type filter changes (back to page 1)
  useEffect(() => {
    if (activeSection === 'products') { setPage(1); loadProducts(1, searchQuery); }
  }, [activeSection, itemType]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearch = (val: string) => {
    setSearchQuery(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPage(1);
      loadProducts(1, val);
    }, 350);
  };

  const goPage = (p: number) => {
    setPage(p);
    loadProducts(p, searchQuery);
  };

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`Deactivate "${name}"?`)) return;
    await products_api.delete(id);
    loadProducts(page, searchQuery);
  };

  const [selectedIndex, setSelectedIndex] = useState(-1);

  const rows = result?.data ?? [];

  // Reset selection on new data
  useEffect(() => {
    setSelectedIndex(-1);
  }, [rows, page]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (activeSection !== 'products' || rows.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(prev => (prev < rows.length - 1 ? prev + 1 : prev));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(prev => (prev > 0 ? prev - 1 : prev));
      } else if (e.key === 'Enter' && selectedIndex >= 0) {
        e.preventDefault();
        const item = rows[selectedIndex];
        if (item) navigate(`/products/edit/${item.id}`);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeSection, rows, selectedIndex, navigate]);

  // ── Sections ──────────────────────────────────────────────────────────────
  const sections = [
    { id: 'products',          label: 'Item Master',            icon: 'fas fa-box-open',        color: '#4cc9f0' },
    { id: 'groups',            label: 'Item Groups',            icon: 'fas fa-layer-group',     color: '#4361ee' },
    { id: 'subgroups',         label: 'Sub Groups',             icon: 'fas fa-sitemap',         color: '#f72585' },
    { id: 'categories',        label: 'Categories',             icon: 'fas fa-tags',            color: '#7209b7' },
    { id: 'subcategories',     label: 'Sub Categories',         icon: 'fas fa-list-ul',         color: '#fb8500' },
    { id: 'brands',            label: 'Brand Master',           icon: 'fas fa-trademark',       color: '#ff6b35' },
    { id: 'subbrands',         label: 'Sub Brand Master',       icon: 'fas fa-certificate',     color: '#fb8500' },
    { id: 'countries',         label: 'Country Master',         icon: 'fas fa-globe-americas',  color: '#00b4d8' },
    { id: 'manufacturers',     label: 'Manufacturer Master',    icon: 'fas fa-industry',        color: '#8ecae6' },
    { id: 'submanufacturers',  label: 'Sub-Manufacturer',       icon: 'fas fa-industry',        color: '#4cc9f0' },
    { id: 'variants',          label: 'Variant Master',         icon: 'fas fa-tags',            color: '#ff6b35' },
    { id: 'flavours',          label: 'Flavour Master',         icon: 'fas fa-ice-cream',       color: '#fb8500' },
    { id: 'classification',    label: 'Product Classification', icon: 'fas fa-th-large',        color: '#ffafcc' },
    { id: 'units',             label: 'Unit Master',            icon: 'fas fa-balance-scale',   color: '#0ea5e9' },
    { id: 'hsn',               label: 'HSN Master',             icon: 'fas fa-barcode',         color: '#7c3aed' },
    { id: 'gst',               label: 'GST Master',             icon: 'fas fa-percent',         color: '#10b981' },
    { id: 'suppliers',         label: 'Suppliers',              icon: 'fas fa-truck-loading',   color: '#f59e0b' },
    { id: 'channels',          label: 'Channel Partners',       icon: 'fas fa-handshake',       color: '#4361ee' },
  ];


  const activeLabel = sections.find(s => s.id === activeSection)?.label ?? '';
  const activeIcon  = sections.find(s => s.id === activeSection)?.icon  ?? '';

  const counterLabel = activeSection === 'products'
    ? `${result?.total ?? 0} Items`
    : `${resultCount} Records`;

  return (
    <div className="flex h-full overflow-hidden bg-white rounded-xl shadow-xl border border-slate-200">

      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      {activeSection !== 'products' && (
        <aside className="w-64 shrink-0 bg-[#0a0a1a] text-slate-300 flex flex-col border-r border-slate-800 shadow-2xl">
          <div className="p-6 bg-slate-900/50 border-b border-slate-800">
            <div className="text-[10px] uppercase font-black tracking-[0.25em] text-orange-500 flex items-center">
              <i className="fas fa-database mr-3" /> Master Control
            </div>
          </div>
          <nav className="flex-1 overflow-y-auto custom-scrollbar">
            {sections.map((s) => (
              <button
                key={s.id}
                onClick={() => { setActiveSection(s.id); setSearchQuery(''); }}
                className={`w-full flex items-center px-6 py-3.5 text-xs transition-all border-l-[3px] group relative ${
                  activeSection === s.id
                    ? 'bg-gradient-to-r from-orange-500/20 to-transparent text-white border-orange-500 font-bold'
                    : 'border-transparent text-slate-400 hover:bg-white/5 hover:text-slate-100'
                }`}
              >
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center mr-3 transition-all ${
                  activeSection === s.id ? 'bg-orange-500 shadow-lg shadow-orange-500/40' : 'bg-slate-800/50 group-hover:bg-slate-700'
                }`}>
                  <i className={`${s.icon} text-[11px] ${activeSection === s.id ? 'text-white' : ''}`}
                     style={activeSection === s.id ? {} : { color: s.color }} />
                </div>
                <span className={`tracking-wide uppercase font-black text-[10px] ${activeSection === s.id ? 'text-orange-500' : ''}`}>
                  {s.label}
                </span>
                {activeSection === s.id && (
                  <div className="absolute right-4 w-1.5 h-1.5 rounded-full bg-orange-500 shadow-[0_0_8px_#ff6b35]" />
                )}
              </button>
            ))}

            <div className="mt-4 p-4 space-y-2">
              <button onClick={() => navigate('/products/add')}
                className="w-full bg-green-600 hover:bg-green-700 text-xs py-2 rounded-lg font-bold text-white shadow-lg transition-all">
                <i className="fas fa-plus-circle mr-2" /> Add New Item
              </button>
              <button onClick={() => navigate('/products/import')}
                className="w-full bg-blue-600 hover:bg-blue-700 text-xs py-2 rounded-lg font-bold text-white shadow-lg transition-all flex items-center justify-center gap-2">
                <i className="fas fa-file-excel" /> Import from Excel
              </button>
            </div>
          </nav>
        </aside>
      )}

      {/* ── Main Content ─────────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col bg-[#f0f2f5] overflow-hidden dark:bg-[#1a1a2e]">

        {/* Header */}
        <header className="bg-white dark:bg-[#0f3460] border-b border-slate-200 dark:border-slate-800 px-6 py-4 flex justify-between items-center shadow-sm z-10">
          <div>
            <h2 className="text-xl font-black flex items-center text-slate-800 dark:text-white uppercase tracking-tighter">
              <div className="w-10 h-10 rounded-xl bg-orange-500/10 flex items-center justify-center mr-3 border border-orange-500/20">
                <i className={`${activeIcon} text-orange-500`} />
              </div>
              {activeLabel}
            </h2>
          </div>
          <div className="flex items-center space-x-4">
            <div className="relative">
              <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs" />
              <input
                type="text"
                placeholder={`Search ${activeLabel}…`}
                className="bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-full py-2 pl-9 pr-4 text-xs w-72 focus:ring-2 focus:ring-orange-500 outline-none transition-all dark:text-slate-200"
                value={searchQuery}
                onChange={e => handleSearch(e.target.value)}
              />
            </div>
            {activeSection === 'products' && (
              <select value={itemType} onChange={e => setItemType(e.target.value)} title="Item type"
                className="bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-full py-2 px-3 text-xs font-semibold outline-none dark:text-slate-200">
                <option value="">All item types</option>
                {Object.entries(ITEM_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            )}
            <div className="bg-orange-500 text-white text-[11px] font-black px-4 py-1.5 rounded-full uppercase tracking-widest shadow-lg shadow-orange-500/20">
              {counterLabel}
            </div>
            {activeSection === 'products' && (
              <button onClick={() => loadProducts(page, searchQuery)}
                className="text-slate-400 hover:text-orange-500 transition-colors" title="Refresh">
                <i className={`fas fa-sync-alt ${loading ? 'fa-spin' : ''}`} />
              </button>
            )}
          </div>
        </header>

        {/* Body */}
        <div className="flex-1 overflow-auto p-6 custom-scrollbar flex flex-col gap-0">
          {activeSection === 'products' ? (
            <>
              {/* Hint */}
              <p className="text-[10px] text-slate-400 mb-2 font-semibold">
                Double-click any row to edit &nbsp;·&nbsp; {PER_PAGE} per page
              </p>

              <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden dark:bg-[#16213e] dark:border-[#0f3460] flex-1">
                <div className="overflow-auto h-full">
                  <table className="w-full text-left text-xs min-w-[960px]">
                    <thead className="bg-[#f8f9fa] border-b-2 border-slate-200 dark:bg-[#0f3460] dark:border-[#1a1a2e] sticky top-0 z-10">
                      <tr className="text-slate-600 dark:text-slate-300">
                        <th className="px-4 py-3 font-bold uppercase tracking-tighter w-10">#</th>
                        <th className="px-4 py-3 font-bold uppercase tracking-tighter">Code</th>
                        <th className="px-4 py-3 font-bold uppercase tracking-tighter">Item Name</th>
                        <th className="px-4 py-3 font-bold uppercase tracking-tighter">Type</th>
                        <th className="px-4 py-3 font-bold uppercase tracking-tighter">Category</th>
                        <th className="px-4 py-3 font-bold uppercase tracking-tighter">Customer</th>
                        <th className="px-4 py-3 font-bold uppercase tracking-tighter text-center">Unit</th>
                        <th className="px-4 py-3 font-bold uppercase tracking-tighter text-center">Pcs / Carton</th>
                        <th className="px-4 py-3 font-bold uppercase tracking-tighter text-right">MRP</th>
                        <th className="px-4 py-3 font-bold uppercase tracking-tighter text-right">Selling</th>
                        <th className="px-4 py-3 font-bold uppercase tracking-tighter text-right">GST%</th>
                        <th className="px-4 py-3 font-bold uppercase tracking-tighter text-center">Stock</th>
                        <th className="px-4 py-3 font-bold uppercase tracking-tighter text-center">Status</th>
                        <th className="px-4 py-3 font-bold uppercase tracking-tighter text-center">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {loading ? (
                        <tr>
                          <td colSpan={14} className="py-20 text-center">
                            <i className="fas fa-spinner fa-spin text-2xl text-orange-500" />
                            <p className="text-slate-400 text-xs mt-2">Loading {PER_PAGE} items…</p>
                          </td>
                        </tr>
                      ) : rows.length === 0 ? (
                        <tr>
                          <td colSpan={14} className="py-20 text-center text-slate-400 italic">
                            No items found{searchQuery ? ` for "${searchQuery}"` : ''}
                          </td>
                        </tr>
                      ) : rows.map((item, idx) => {
                        const isSelected = idx === selectedIndex;
                        return (
                          <tr
                            key={item.id}
                            ref={el => { if (isSelected) el?.scrollIntoView({ block: 'nearest' }); }}
                            onDoubleClick={() => navigate(`/products/edit/${item.id}`)}
                            className={`transition-colors cursor-pointer select-none border-l-4 ${
                              isSelected 
                                ? 'bg-amber-50 border-amber-500 dark:bg-amber-900/20' 
                                : 'hover:bg-orange-50/60 dark:hover:bg-slate-800/50 border-transparent'
                            }`}
                            title="Double-click or press Enter to edit"
                          >
                          <td className="px-4 py-2.5 text-slate-400 text-[10px]">
                            {(page - 1) * PER_PAGE + idx + 1}
                          </td>
                          <td className="px-4 py-2.5">
                            <code className="bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded text-[10px] font-bold text-blue-600 dark:text-blue-400">
                              {item.item_code || '—'}
                            </code>
                          </td>
                          <td className="px-4 py-2.5 max-w-[220px]">
                            <div className="font-bold text-slate-800 dark:text-slate-200 truncate">{item.name}</div>
                            {item.barcode && (
                              <div className="text-[10px] text-slate-400 text-numeric">{item.barcode}</div>
                            )}
                          </td>
                          <td className="px-4 py-2.5"><span className={`px-2 py-0.5 rounded text-[10px] font-bold ${ITEM_TYPES[item.item_type || 'FG']?.cls}`}>{ITEM_TYPES[item.item_type || 'FG']?.label}</span></td>
                          <td className="px-4 py-2.5 text-slate-500 max-w-[120px] truncate">{item.category}</td>
                          <td className="px-4 py-2.5 text-slate-500 max-w-[180px] truncate" title={item.manufacturer_name || item.brand || ''}>{item.manufacturer_name || item.brand || '—'}</td>
                          <td className="px-4 py-2.5 text-center">
                            <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded text-[10px] font-bold dark:bg-blue-900/30 dark:text-blue-400">
                              {item.unit}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-center font-semibold text-slate-700 dark:text-slate-200">{item.total_pcs_in_carton ?? 1}</td>
                          <td className="px-4 py-2.5 text-right text-numeric text-slate-600 dark:text-slate-300">
                            ₹{parseFloat(item.mrp).toFixed(2)}
                          </td>
                          <td className="px-4 py-2.5 text-right text-numeric font-bold text-green-600 dark:text-green-400">
                            ₹{parseFloat(item.selling_price).toFixed(2)}
                          </td>
                          <td className="px-4 py-2.5 text-right text-slate-500">{item.gst_percent}%</td>
                          <td className="px-4 py-2.5 text-center">
                            <span className={`font-bold text-numeric ${parseFloat(item.stock_qty) <= 5 ? 'text-red-600' : 'text-slate-700 dark:text-slate-300'}`}>
                              {parseFloat(item.stock_qty).toFixed(0)}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-center">
                            <span className={`text-[10px] font-black px-2 py-0.5 rounded-full uppercase ${
                              item.is_active
                                ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                : 'bg-red-100 text-red-600 dark:bg-red-900/20 dark:text-red-400'
                            }`}>
                              {item.is_active ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-center" onClick={e => e.stopPropagation()}>
                            <div className="flex justify-center gap-1">
                              <button
                                onClick={() => navigate(`/products/edit/${item.id}`)}
                                className="p-1.5 bg-blue-50 text-blue-600 rounded hover:bg-blue-100 dark:bg-blue-900/20 transition-all"
                                title="Edit"
                              >
                                <i className="fas fa-edit" />
                              </button>
                              <button
                                onClick={() => handleDelete(item.id, item.name)}
                                className="p-1.5 bg-red-50 text-red-600 rounded hover:bg-red-100 dark:bg-red-900/20 transition-all"
                                title="Deactivate"
                              >
                                <i className="fas fa-trash" />
                              </button>
                            </div>
                          </td>
                        </tr>
                        );
                      })
                      }
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Pagination */}
              {result && result.total_pages > 1 && (
                <div className="flex items-center justify-between py-3 text-xs text-slate-600 dark:text-slate-400">
                  <span>
                    Showing {(page - 1) * PER_PAGE + 1}–{Math.min(page * PER_PAGE, result.total)} of{' '}
                    <strong>{result.total.toLocaleString()}</strong> items
                  </span>
                  <div className="flex items-center gap-1">
                    <button disabled={page === 1}
                      onClick={() => goPage(1)}
                      className="px-2 py-1 border rounded disabled:opacity-40 hover:bg-slate-100 dark:hover:bg-slate-800">
                      «
                    </button>
                    <button disabled={page === 1}
                      onClick={() => goPage(page - 1)}
                      className="px-3 py-1 border rounded disabled:opacity-40 hover:bg-slate-100 dark:hover:bg-slate-800">
                      Prev
                    </button>

                    {/* Page number buttons — show 5 around current */}
                    {Array.from({ length: Math.min(5, result.total_pages) }, (_, i) => {
                      const start = Math.max(1, Math.min(page - 2, result.total_pages - 4));
                      return start + i;
                    }).map(p => (
                      <button key={p} onClick={() => goPage(p)}
                        className={`px-3 py-1 border rounded font-bold ${p === page ? 'bg-orange-500 text-white border-orange-500' : 'hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
                        {p}
                      </button>
                    ))}

                    <button disabled={page === result.total_pages}
                      onClick={() => goPage(page + 1)}
                      className="px-3 py-1 border rounded disabled:opacity-40 hover:bg-slate-100 dark:hover:bg-slate-800">
                      Next
                    </button>
                    <button disabled={page === result.total_pages}
                      onClick={() => goPage(result.total_pages)}
                      className="px-2 py-1 border rounded disabled:opacity-40 hover:bg-slate-100 dark:hover:bg-slate-800">
                      »
                    </button>
                    <span className="ml-2 text-[10px] text-slate-400">
                      Page {page}/{result.total_pages}
                    </span>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="bg-white rounded-lg shadow-xl p-6 h-full overflow-auto">
              {activeSection === 'groups'           && <Groups           searchQuery={searchQuery} onCountUpdate={setResultCount} />}
              {activeSection === 'subgroups'        && <SubGroups        searchQuery={searchQuery} onCountUpdate={setResultCount} />}
              {activeSection === 'categories'       && <Categories       searchQuery={searchQuery} onCountUpdate={setResultCount} />}
              {activeSection === 'subcategories'    && <SubCategories    searchQuery={searchQuery} onCountUpdate={setResultCount} />}
              {activeSection === 'brands'           && <Brands           searchQuery={searchQuery} onCountUpdate={setResultCount} />}
              {activeSection === 'subbrands'        && <SubBrands        searchQuery={searchQuery} onCountUpdate={setResultCount} />}
              {activeSection === 'manufacturers'    && <Manufacturers    searchQuery={searchQuery} onCountUpdate={setResultCount} />}
              {activeSection === 'submanufacturers' && <SubManufacturers searchQuery={searchQuery} onCountUpdate={setResultCount} />}
              {activeSection === 'variants'         && <Variants         searchQuery={searchQuery} onCountUpdate={setResultCount} />}
              {activeSection === 'flavours'         && <Flavours         searchQuery={searchQuery} onCountUpdate={setResultCount} />}
              {activeSection === 'classification'   && <ProductClassification searchQuery={searchQuery} onCountUpdate={setResultCount} />}
              {activeSection === 'countries'        && <CountryMaster    searchQuery={searchQuery} onCountUpdate={setResultCount} />}
              {activeSection === 'units'            && <Units            searchQuery={searchQuery} onCountUpdate={setResultCount} />}
              {activeSection === 'hsn'              && <HsnMaster        searchQuery={searchQuery} onCountUpdate={setResultCount} />}
              {activeSection === 'gst'              && <GstMaster        searchQuery={searchQuery} onCountUpdate={setResultCount} />}
              {activeSection === 'suppliers'        && <Suppliers        searchQuery={searchQuery} onCountUpdate={setResultCount} />}
              {activeSection === 'channels'         && <ChannelPartners searchQuery={searchQuery} onCountUpdate={setResultCount} />}
            </div>

          )}
        </div>
      </main>
    </div>
  );
};

export const ITEM_TYPES: Record<string, { label: string; cls: string }> = {
  FG: { label: 'Finished Goods', cls: 'bg-emerald-100 text-emerald-800' },
  RM: { label: 'Raw Material', cls: 'bg-amber-100 text-amber-800' },
  PM: { label: 'Packing Material', cls: 'bg-sky-100 text-sky-800' },
  SFG: { label: 'Semi-Finished', cls: 'bg-violet-100 text-violet-800' },
  CONS: { label: 'Consumable', cls: 'bg-slate-200 text-slate-700' },
  OTH: { label: 'Other', cls: 'bg-slate-100 text-slate-600' },
};

export default ItemMaster;

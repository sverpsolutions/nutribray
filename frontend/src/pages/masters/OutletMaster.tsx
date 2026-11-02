import React, { useState, useEffect } from 'react';
import api from '../../api/axios';
import { useSyncStore } from '../../store/syncStore';

const API_BASE = '/api/v1';

interface Region {
  id: number;
  code: string;
  name: string;
  manager_name?: string;
  contact_phone?: string;
  email?: string;
  is_active: boolean;
  total_zones?: number;
  total_stores?: number;
}

interface Zone {
  id: number;
  name: string;
  zone_code?: string;
  region_id?: number;
  region_name?: string;
  manager_name?: string;
  contact_phone?: string;
  email?: string;
  is_active: boolean;
  total_stores?: number;
}

interface Outlet {
  id: number;
  unit_code: string;
  outlet_name: string;
  display_name?: string;
  region_id?: number;
  region_name?: string;
  zone_id?: number;
  zone_name?: string;
  city?: string;
  state?: string;
  country?: string;
  pincode?: string;
  address?: string;
  landmark?: string;
  manager_name?: string;
  manager_mobile?: string;
  manager_email?: string;
  store_phone?: string;
  whatsapp_number?: string;
  emergency_contact?: string;
  store_type?: string;
  store_category?: string;
  store_size?: string;
  store_timing?: string;
  is_active: boolean;
  is_connected: boolean;
  negative_stock?: 'company' | 'block' | 'allow';
  outlet_code?: string;
  is_delivery_available?: boolean;
  is_online_order_available?: boolean;
  server_name?: string;
  database_name?: string;
  db_username?: string;
  db_password?: string;
  type?: string;
  notes?: string;
  price_update_level?: string;
  opening_date?: string;
  gst_number?: string;
  pan_number?: string;
  latitude?: string;
  longitude?: string;
  map_link?: string;
  short_name?: string;
  company_name?: string;
}

interface CompanyHierarchy {
  company_name: string;
  legal_name: string;
  brand_name: string;
  ho_address: string;
  ho_phone: string;
  ho_email: string;
  logo_path: string;
  total_regions: number;
  total_zones: number;
  total_stores: number;
  regions: {
    id: number;
    code: string;
    name: string;
    manager_name?: string;
    contact_phone?: string;
    email?: string;
    is_active: boolean;
    zones: {
      id: number;
      zone_code?: string;
      name: string;
      manager_name?: string;
      contact_phone?: string;
      is_active: boolean;
      outlets: {
        id: number;
        unit_code: string;
        outlet_name: string;
        display_name?: string;
        city?: string;
        state?: string;
        pincode?: string;
        manager_name?: string;
        manager_mobile?: string;
        store_type?: string;
        store_category?: string;
        is_active: boolean;
      }[];
    }[];
  }[];
}

const OutletMaster = () => {
  const [viewMode, setViewMode] = useState<'outlets' | 'hierarchy' | 'regions-zones'>('outlets');
  const [showModal, setShowModal] = useState(false);
  const [checkingId, setCheckingId] = useState<number | null>(null);
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [regions, setRegions] = useState<Region[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [hierarchy, setHierarchy] = useState<CompanyHierarchy | null>(null);
  const [loading, setLoading] = useState(true);

  // Region & Zone Modals
  const [showRegionModal, setShowRegionModal] = useState(false);
  const [showZoneModal, setShowZoneModal] = useState(false);
  const [regionForm, setRegionForm] = useState({ code: '', name: '', manager_name: '', contact_phone: '', email: '' });
  const [zoneForm, setZoneForm] = useState({ name: '', zone_code: '', region_id: 1, manager_name: '', contact_phone: '', email: '' });
  const [editingRegionId, setEditingRegionId] = useState<number | null>(null);
  const [editingZoneId, setEditingZoneId] = useState<number | null>(null);

  const { runningOutlets, globalStatus } = useSyncStore();

  const [formData, setFormData] = useState<Partial<Outlet>>({
    outlet_name: '',
    unit_code: '',
    outlet_code: '',
    display_name: '',
    region_id: 1,
    zone_id: undefined,
    short_name: '',
    company_name: '',
    city: 'New Delhi',
    state: 'Delhi',
    country: 'India',
    pincode: '',
    address: '',
    landmark: '',
    manager_name: '',
    manager_mobile: '',
    manager_email: '',
    store_phone: '',
    whatsapp_number: '',
    emergency_contact: '',
    gst_number: '',
    pan_number: '',
    latitude: '',
    longitude: '',
    map_link: '',
    store_type: 'Company Operated',
    store_category: '24/7 Convenience Retail',
    store_size: '',
    opening_date: '',
    store_timing: '24 Hours / 7 Days Open',
    is_delivery_available: false,
    is_online_order_available: false,
    notes: '',
    price_update_level: 'All Store Level',
    server_name: '',
    database_name: '',
    db_username: 'postgres',
    db_password: '',
    type: 'O',
    is_active: true,
    negative_stock: 'company'
  });

  const [activeTab, setActiveTab] = useState('General');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterRegion, setFilterRegion] = useState<string>('');
  const [filterZone, setFilterZone] = useState<string>('');
  const [filterCity, setFilterCity] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [editId, setEditId] = useState<number | null>(null);

  useEffect(() => {
    fetchAllData();
  }, []);

  const fetchAllData = async () => {
    setLoading(true);
    try {
      const [outletsRes, regionsRes, zonesRes, hierRes] = await Promise.all([
        api.get('/outlets'),
        api.get('/outlets/regions'),
        api.get('/outlets/zones'),
        api.get('/outlets/hierarchy')
      ]);
      setOutlets(outletsRes.data);
      setRegions(regionsRes.data);
      setZones(zonesRes.data);
      setHierarchy(hierRes.data);
    } catch (err) {
      console.error('Failed to fetch store hierarchy data', err);
    } finally {
      setLoading(false);
    }
  };

  const checkConnection = async (id: number) => {
    setCheckingId(id);
    try {
      const res = await api.post(`/outlets/test-connection/${id}`);
      if (res.data.success) {
        alert(`Success! ${res.data.data.sample_info}`);
      } else {
        alert(`Connection Failed: ${res.data.error}`);
      }
      fetchAllData();
    } catch (err: any) {
      alert(`Error: ${formatError(err)}`);
    } finally {
      setCheckingId(null);
    }
  };

  const handleEdit = (o: Outlet) => {
    setEditId(o.id);
    setFormData({
      ...o,
      opening_date: o.opening_date ? o.opening_date.split('T')[0] : ''
    });
    setActiveTab('General');
    setShowModal(true);
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm("Are you sure you want to deactivate this outlet?")) return;
    try {
      await api.delete(`/outlets/${id}`);
      fetchAllData();
    } catch (err) {
      alert("Failed to deactivate outlet");
    }
  };

  const sendWhatsApp = (o: Outlet) => {
    const text = `*NUTRIBRAY Store: ${o.display_name || o.outlet_name}*\nUnit: ${o.unit_code}\nZone: ${o.zone_name || 'N/A'}\nAddress: ${o.address || 'N/A'}\nManager: ${o.manager_name || 'N/A'}\nPhone: ${o.manager_mobile || o.store_phone || 'N/A'}`;
    const url = `https://wa.me/${o.whatsapp_number || o.manager_mobile}?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
  };

  const formatError = (err: any) => {
    const detail = err.response?.data?.detail;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail)) {
      return detail.map((d: any) => `${d.loc.join('.')}: ${d.msg}`).join('\n');
    }
    return err.message || "An unexpected error occurred";
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const dataToSend = {
      ...formData,
      opening_date: formData.opening_date || null
    };

    try {
      if (editId) {
        await api.put(`/outlets/${editId}`, dataToSend);
        alert("Outlet updated successfully!");
      } else {
        await api.post(`/outlets`, dataToSend);
        alert("Outlet registered successfully!");
      }
      setShowModal(false);
      setEditId(null);
      fetchAllData();
    } catch (err: any) {
      alert(`Error: ${formatError(err)}`);
    }
  };

  const handleSaveRegion = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingRegionId) {
        await api.put(`/outlets/regions/${editingRegionId}`, regionForm);
      } else {
        await api.post('/outlets/regions', regionForm);
      }
      setShowRegionModal(false);
      setEditingRegionId(null);
      setRegionForm({ code: '', name: '', manager_name: '', contact_phone: '', email: '' });
      fetchAllData();
    } catch (err: any) {
      alert(`Failed to save region: ${formatError(err)}`);
    }
  };

  const handleSaveZone = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingZoneId) {
        await api.put(`/outlets/zones/${editingZoneId}`, zoneForm);
      } else {
        await api.post('/outlets/zones', zoneForm);
      }
      setShowZoneModal(false);
      setEditingZoneId(null);
      setZoneForm({ name: '', zone_code: '', region_id: 1, manager_name: '', contact_phone: '', email: '' });
      fetchAllData();
    } catch (err: any) {
      alert(`Failed to save zone: ${formatError(err)}`);
    }
  };

  const filteredOutlets = outlets.filter(o => {
    const matchesSearch = !searchQuery || 
      (o.outlet_name?.toLowerCase() || '').includes(searchQuery.toLowerCase()) ||
      (o.display_name?.toLowerCase() || '').includes(searchQuery.toLowerCase()) ||
      (o.unit_code?.toLowerCase() || '').includes(searchQuery.toLowerCase()) ||
      (o.manager_name?.toLowerCase() || '').includes(searchQuery.toLowerCase()) ||
      (o.address?.toLowerCase() || '').includes(searchQuery.toLowerCase());
    
    const matchesRegion = !filterRegion || String(o.region_id) === filterRegion;
    const matchesZone = !filterZone || String(o.zone_id) === filterZone;
    const matchesCity = !filterCity || o.city === filterCity;
    const matchesType = !filterType || o.store_type === filterType;
    const matchesStatus = !filterStatus || (filterStatus === 'active' ? o.is_active : !o.is_active);

    return matchesSearch && matchesRegion && matchesZone && matchesCity && matchesType && matchesStatus;
  });

  return (
    <div className="space-y-6 max-w-[1700px] mx-auto p-3">
      {/* ── Brand Header Banner ── */}
      <div className="bg-gradient-to-r from-[#1c1322] via-[#2f1338] to-[#1a1c36] text-white p-6 rounded-3xl shadow-xl border border-white/10 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-white/10 backdrop-blur-md flex items-center justify-center p-1.5 shadow-inner border border-white/20 shrink-0">
            <img src="/nutribay_logo.svg" alt="NUTRIBRAY" className="w-full h-full object-contain" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full bg-[#8c2785] text-white text-[10px] font-black tracking-widest uppercase">
                NUTRIBRAY
              </span>
              <span className="text-purple-300 text-xs font-semibold">24/7 Retail Operations</span>
            </div>
            <h1 className="text-2xl font-black tracking-tight text-white mt-1">
              Store Network & Location Hierarchy
            </h1>
            <p className="text-xs text-purple-200/80 mt-0.5">
              Head Office: Mohan Cooperative Industrial Estate, South Delhi • Helpline: 74003 39365
            </p>
          </div>
        </div>

        {/* View Switcher Pills */}
        <div className="flex items-center gap-2 bg-black/30 p-1.5 rounded-2xl border border-white/10 shrink-0">
          <button
            onClick={() => setViewMode('outlets')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
              viewMode === 'outlets' 
                ? 'bg-[#8c2785] text-white shadow-md' 
                : 'text-purple-200 hover:text-white hover:bg-white/5'
            }`}
          >
            <i className="fas fa-store"></i> All Outlets ({outlets.length})
          </button>
          <button
            onClick={() => setViewMode('hierarchy')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
              viewMode === 'hierarchy' 
                ? 'bg-[#8c2785] text-white shadow-md' 
                : 'text-purple-200 hover:text-white hover:bg-white/5'
            }`}
          >
            <i className="fas fa-sitemap"></i> Enterprise Hierarchy Tree
          </button>
          <button
            onClick={() => setViewMode('regions-zones')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
              viewMode === 'regions-zones' 
                ? 'bg-[#8c2785] text-white shadow-md' 
                : 'text-purple-200 hover:text-white hover:bg-white/5'
            }`}
          >
            <i className="fas fa-map-marked-alt"></i> Regions & Zones ({regions.length}/{zones.length})
          </button>
        </div>
      </div>

      {/* ── KPI Summary Cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-[11px] font-black uppercase tracking-wider text-slate-400">Total Outlets</p>
            <p className="text-2xl font-black text-slate-800 mt-1">{outlets.length}</p>
            <p className="text-[11px] text-emerald-600 font-semibold mt-0.5">24/7 Confirmed Active</p>
          </div>
          <div className="w-11 h-11 rounded-2xl bg-purple-50 text-[#8c2785] flex items-center justify-center text-lg">
            <i className="fas fa-store-alt"></i>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-[11px] font-black uppercase tracking-wider text-slate-400">Operational Regions</p>
            <p className="text-2xl font-black text-slate-800 mt-1">{regions.length}</p>
            <p className="text-[11px] text-purple-600 font-semibold mt-0.5">NCR01 • Delhi NCR Hub</p>
          </div>
          <div className="w-11 h-11 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center text-lg">
            <i className="fas fa-globe-asia"></i>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-[11px] font-black uppercase tracking-wider text-slate-400">Operational Zones</p>
            <p className="text-2xl font-black text-slate-800 mt-1">{zones.length}</p>
            <p className="text-[11px] text-indigo-600 font-semibold mt-0.5">Delhi, Noida, Gurugram</p>
          </div>
          <div className="w-11 h-11 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center text-lg">
            <i className="fas fa-layer-group"></i>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-[11px] font-black uppercase tracking-wider text-slate-400">Database Status</p>
            <p className="text-2xl font-black text-emerald-600 mt-1">
              {outlets.filter(o => o.is_connected).length} / {outlets.length}
            </p>
            <p className="text-[11px] text-slate-400 font-semibold mt-0.5">Live Synced Stores</p>
          </div>
          <div className="w-11 h-11 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center text-lg">
            <i className="fas fa-signal"></i>
          </div>
        </div>
      </div>

      {/* ───────────────────────────────────────────────────────────── */}
      {/* VIEW: ALL OUTLETS                                             */}
      {/* ───────────────────────────────────────────────────────────── */}
      {viewMode === 'outlets' && (
        <div className="space-y-6">
          {/* Action Bar & Multi-Level Filters */}
          <div className="bg-white p-5 rounded-3xl shadow-sm border border-slate-100 space-y-4">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div className="relative flex-1 max-w-md">
                <i className="fas fa-search absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"></i>
                <input 
                  type="text" 
                  placeholder="Search store name, code, manager, address..." 
                  className="w-full pl-11 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-[#8c2785] focus:border-transparent transition-all"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button 
                  onClick={() => {
                    setEditId(null);
                    setFormData({
                      outlet_name: '', unit_code: '', outlet_code: '', display_name: '',
                      region_id: 1, zone_id: zones[0]?.id || undefined,
                      city: 'New Delhi', state: 'Delhi', country: 'India', pincode: '', address: '',
                      manager_name: '', manager_mobile: '', manager_email: '', store_phone: '',
                      store_type: 'Company Operated', store_category: '24/7 Convenience Retail',
                      store_timing: '24 Hours / 7 Days Open', is_active: true, is_connected: true, type: 'O', negative_stock: 'company'
                    });
                    setActiveTab('General');
                    setShowModal(true);
                  }}
                  className="bg-[#8c2785] hover:bg-[#731f6d] text-white font-bold py-2.5 px-5 rounded-xl shadow-md transition-all flex items-center text-xs"
                >
                  <i className="fas fa-plus-circle mr-2"></i> Register New Store
                </button>
              </div>
            </div>

            {/* Filter Pills */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 pt-2 border-t border-slate-100">
              <select 
                className="bg-slate-50 border border-slate-200 rounded-xl text-xs px-3 py-2 font-medium text-slate-700 focus:ring-2 focus:ring-[#8c2785]"
                value={filterRegion}
                onChange={e => setFilterRegion(e.target.value)}
              >
                <option value="">All Regions ({regions.length})</option>
                {regions.map(r => (
                  <option key={r.id} value={r.id}>{r.name} ({r.code})</option>
                ))}
              </select>

              <select 
                className="bg-slate-50 border border-slate-200 rounded-xl text-xs px-3 py-2 font-medium text-slate-700 focus:ring-2 focus:ring-[#8c2785]"
                value={filterZone}
                onChange={e => setFilterZone(e.target.value)}
              >
                <option value="">All Zones ({zones.length})</option>
                {zones.map(z => (
                  <option key={z.id} value={z.id}>{z.name} ({z.zone_code || 'Zone'})</option>
                ))}
              </select>

              <select 
                className="bg-slate-50 border border-slate-200 rounded-xl text-xs px-3 py-2 font-medium text-slate-700 focus:ring-2 focus:ring-[#8c2785]"
                value={filterCity}
                onChange={e => setFilterCity(e.target.value)}
              >
                <option value="">All Cities</option>
                {Array.from(new Set(outlets.map(o => o.city).filter(Boolean))).map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>

              <select 
                className="bg-slate-50 border border-slate-200 rounded-xl text-xs px-3 py-2 font-medium text-slate-700 focus:ring-2 focus:ring-[#8c2785]"
                value={filterStatus}
                onChange={e => setFilterStatus(e.target.value)}
              >
                <option value="">All Status</option>
                <option value="active">Active Stores</option>
                <option value="inactive">Inactive Stores</option>
              </select>

              <button 
                onClick={() => { setSearchQuery(''); setFilterRegion(''); setFilterZone(''); setFilterCity(''); setFilterType(''); setFilterStatus(''); }}
                className="bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold rounded-xl text-xs px-3 py-2 transition-all"
              >
                <i className="fas fa-undo mr-1.5"></i> Reset Filters
              </button>
            </div>
          </div>

          {/* Store Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {filteredOutlets.length === 0 ? (
              <div className="col-span-full py-20 text-center bg-white rounded-3xl border border-dashed border-slate-200">
                <i className="fas fa-store-slash text-5xl text-slate-200 mb-4"></i>
                <p className="text-slate-400 font-bold">No stores found matching your filters.</p>
              </div>
            ) : filteredOutlets.map(o => (
              <div 
                key={o.id} 
                className="group bg-white rounded-3xl overflow-hidden shadow-xs hover:shadow-xl hover:shadow-purple-900/10 border border-slate-200 transition-all duration-300 flex flex-col relative"
              >
                {/* Store Top Card Banner */}
                <div className="p-5 bg-gradient-to-br from-purple-50 via-slate-50 to-purple-100/40 border-b border-purple-100/50">
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex flex-wrap gap-1.5">
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-600 text-white shadow-xs">
                        {o.is_active ? 'ACTIVE' : 'INACTIVE'}
                      </span>
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-[#8c2785] text-white">
                        {o.store_timing || '24/7 OPEN'}
                      </span>
                      {o.negative_stock && o.negative_stock !== 'company' && (
                        <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-extrabold text-white ${o.negative_stock === 'block' ? 'bg-red-600' : 'bg-amber-500'}`}>
                          {o.negative_stock === 'block' ? 'NEGATIVE BLOCKED' : 'NEGATIVE ALLOWED'}
                        </span>
                      )}
                    </div>

                    <div className="flex gap-1">
                      <button 
                        onClick={() => handleEdit(o)} 
                        className="w-7 h-7 rounded-full bg-white text-[#8c2785] flex items-center justify-center hover:bg-[#8c2785] hover:text-white transition-all shadow-xs border border-purple-100"
                        title="Edit Store"
                      >
                        <i className="fas fa-edit text-[11px]"></i>
                      </button>
                      <button 
                        onClick={() => sendWhatsApp(o)} 
                        className="w-7 h-7 rounded-full bg-white text-emerald-600 flex items-center justify-center hover:bg-emerald-600 hover:text-white transition-all shadow-xs border border-emerald-100"
                        title="Share on WhatsApp"
                      >
                        <i className="fab fa-whatsapp text-[12px]"></i>
                      </button>
                    </div>
                  </div>

                  <h3 className="text-base font-black text-slate-800 leading-tight mb-1 truncate" title={o.display_name || o.outlet_name}>
                    {o.display_name || o.outlet_name}
                  </h3>
                  
                  <div className="flex items-center gap-2 mt-2">
                    <code className="text-[11px] font-bold bg-white px-2 py-0.5 rounded-md text-[#8c2785] border border-purple-200 shadow-2xs">
                      {o.unit_code}
                    </code>
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest truncate">
                      {o.city || 'Delhi NCR'}
                    </span>
                  </div>
                </div>

                {/* Location Hierarchy Badges */}
                <div className="px-5 py-2.5 bg-slate-50/70 border-b border-slate-100 flex items-center justify-between text-[11px]">
                  <span className="text-slate-500 font-semibold flex items-center gap-1.5 truncate">
                    <i className="fas fa-map-pin text-[#8c2785]"></i>
                    <strong className="text-slate-800 font-bold">{o.zone_name || 'Delhi Zone'}</strong>
                  </span>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider shrink-0">
                    {o.region_name || 'NCR01'}
                  </span>
                </div>

                {/* Store Body Details */}
                <div className="p-5 space-y-3.5 flex-grow text-xs">
                  <div className="flex items-start gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center text-slate-400 shrink-0 mt-0.5">
                      <i className="fas fa-location-arrow text-[11px]"></i>
                    </div>
                    <div>
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-wider leading-none mb-1">Store Address</p>
                      <p className="text-slate-600 font-medium leading-relaxed line-clamp-2">{o.address || 'Address registered'}</p>
                    </div>
                  </div>

                  <div className="flex items-start gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center text-slate-400 shrink-0 mt-0.5">
                      <i className="fas fa-user-tie text-[11px]"></i>
                    </div>
                    <div>
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-wider leading-none mb-1">Store In-Charge</p>
                      <p className="text-slate-700 font-bold leading-tight">{o.manager_name || 'Store Manager'}</p>
                      <p className="text-[10px] text-slate-400 font-mono mt-0.5">{o.manager_mobile || o.store_phone || '+91 74003 39365'}</p>
                    </div>
                  </div>
                </div>

                {/* Bottom Status & Diagnostic Action */}
                <div className="px-5 py-3.5 bg-slate-50/80 border-t border-slate-100 flex items-center justify-between">
                  <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
                    o.is_connected ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${o.is_connected ? 'bg-emerald-500' : 'bg-slate-400'}`}></span>
                    {o.is_connected ? 'DB Online' : 'Standby'}
                  </span>

                  <button 
                    onClick={() => checkConnection(o.id)}
                    disabled={checkingId === o.id}
                    className="text-[11px] font-bold text-[#8c2785] hover:text-[#731f6d] flex items-center gap-1 transition-all"
                  >
                    {checkingId === o.id ? (
                      <><i className="fas fa-spinner fa-spin"></i> Testing</>
                    ) : (
                      <><i className="fas fa-plug"></i> Test Ping</>
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────── */}
      {/* VIEW: ENTERPRISE HIERARCHY TREE                                */}
      {/* ───────────────────────────────────────────────────────────── */}
      {viewMode === 'hierarchy' && hierarchy && (
        <div className="space-y-6">
          {/* Company Card Header */}
          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-6 border-b border-slate-100">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-2xl bg-purple-50 p-2 border border-purple-200 flex items-center justify-center shrink-0">
                  <img src="/nutribay_logo.svg" alt="NUTRIBRAY" className="max-w-full max-h-full object-contain" />
                </div>
                <div>
                  <span className="px-2.5 py-0.5 rounded-md bg-[#8c2785] text-white text-[10px] font-black uppercase">
                    Level 1: Enterprise Corporate Entity
                  </span>
                  <h2 className="text-xl font-black text-slate-800 mt-1">{hierarchy.legal_name}</h2>
                  <p className="text-xs text-slate-500 font-medium mt-0.5">{hierarchy.ho_address}</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="text-right">
                  <p className="text-[10px] font-black text-slate-400 uppercase">Executive Contact</p>
                  <p className="text-xs font-bold text-slate-800">{hierarchy.ho_phone}</p>
                  <p className="text-xs text-[#8c2785] font-semibold">{hierarchy.ho_email}</p>
                </div>
              </div>
            </div>

            {/* Tree Nodes: Regions -> Zones -> Stores */}
            <div className="mt-6 space-y-6">
              {hierarchy.regions.map(r => (
                <div key={r.id} className="border-2 border-purple-100 rounded-3xl p-6 bg-gradient-to-b from-purple-50/20 to-white space-y-5">
                  {/* Level 2: Region */}
                  <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 pb-4 border-b border-purple-100">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-purple-600 text-white flex items-center justify-center text-base font-black shadow-md shadow-purple-200">
                        <i className="fas fa-globe"></i>
                      </div>
                      <div>
                        <span className="px-2 py-0.5 rounded bg-purple-100 text-purple-800 text-[10px] font-black uppercase">
                          Level 2: Region • Code {r.code}
                        </span>
                        <h3 className="text-lg font-black text-slate-800 mt-0.5">{r.name}</h3>
                      </div>
                    </div>
                    <div className="text-xs text-slate-600 font-medium">
                      Regional Head: <strong className="text-slate-800">{r.manager_name}</strong> • Phone: {r.contact_phone}
                    </div>
                  </div>

                  {/* Level 3: Zones Container */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                    {r.zones.map(z => (
                      <div key={z.id} className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3">
                        <div className="flex justify-between items-start">
                          <div>
                            <span className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 text-[9px] font-black uppercase">
                              Level 3: Zone • {z.zone_code || 'Zone'}
                            </span>
                            <h4 className="text-sm font-black text-slate-800 mt-1">{z.name}</h4>
                          </div>
                          <span className="px-2 py-0.5 rounded-full bg-[#8c2785] text-white text-[10px] font-bold">
                            {z.outlets.length} Stores
                          </span>
                        </div>

                        <p className="text-[11px] text-slate-500 font-medium">
                          Area Manager: <strong className="text-slate-700">{z.manager_name}</strong> ({z.contact_phone})
                        </p>

                        {/* Level 4: Stores list within this Zone */}
                        <div className="pt-2 border-t border-slate-100 space-y-1.5">
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Assigned 24/7 Outlets:</p>
                          <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                            {z.outlets.map(sto => (
                              <div key={sto.id} className="p-2 rounded-xl bg-slate-50 hover:bg-purple-50/50 transition-colors flex items-center justify-between text-xs">
                                <div className="truncate">
                                  <p className="font-bold text-slate-800 truncate leading-tight">{sto.display_name || sto.outlet_name}</p>
                                  <p className="text-[10px] text-slate-400 font-mono">{sto.unit_code} • {sto.city}</p>
                                </div>
                                <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0"></span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────── */}
      {/* VIEW: REGIONS & ZONES MANAGEMENT                              */}
      {/* ───────────────────────────────────────────────────────────── */}
      {viewMode === 'regions-zones' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Regions Table */}
          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-lg font-black text-slate-800">Operational Regions</h3>
                <p className="text-xs text-slate-500">Corporate macro-divisions</p>
              </div>
              <button 
                onClick={() => {
                  setEditingRegionId(null);
                  setRegionForm({ code: '', name: '', manager_name: '', contact_phone: '', email: '' });
                  setShowRegionModal(true);
                }}
                className="bg-[#8c2785] text-white font-bold py-2 px-4 rounded-xl text-xs hover:bg-[#731f6d] transition-all"
              >
                <i className="fas fa-plus mr-1"></i> Add Region
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider font-bold">
                  <tr>
                    <th className="p-3 rounded-l-xl">Code</th>
                    <th className="p-3">Region Name</th>
                    <th className="p-3">Manager</th>
                    <th className="p-3">Zones / Stores</th>
                    <th className="p-3 rounded-r-xl">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {regions.map(r => (
                    <tr key={r.id} className="hover:bg-slate-50/60">
                      <td className="p-3 font-mono font-bold text-[#8c2785]">{r.code}</td>
                      <td className="p-3 font-bold text-slate-800">{r.name}</td>
                      <td className="p-3">
                        <p className="font-semibold text-slate-700">{r.manager_name || 'N/A'}</p>
                        <p className="text-[10px] text-slate-400">{r.contact_phone}</p>
                      </td>
                      <td className="p-3">
                        <span className="font-bold text-indigo-600">{r.total_zones || 5} Zones</span> • {r.total_stores || outlets.length} Stores
                      </td>
                      <td className="p-3">
                        <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-bold text-[10px]">
                          Active
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Zones Table */}
          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-lg font-black text-slate-800">Cluster Zones</h3>
                <p className="text-xs text-slate-500">Regional sales & operational clusters</p>
              </div>
              <button 
                onClick={() => {
                  setEditingZoneId(null);
                  setZoneForm({ name: '', zone_code: '', region_id: regions[0]?.id || 1, manager_name: '', contact_phone: '', email: '' });
                  setShowZoneModal(true);
                }}
                className="bg-[#2c57a4] text-white font-bold py-2 px-4 rounded-xl text-xs hover:bg-[#234685] transition-all"
              >
                <i className="fas fa-plus mr-1"></i> Add Zone
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider font-bold">
                  <tr>
                    <th className="p-3 rounded-l-xl">Code</th>
                    <th className="p-3">Zone Name</th>
                    <th className="p-3">Area Manager</th>
                    <th className="p-3">Stores</th>
                    <th className="p-3 rounded-r-xl">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {zones.map(z => (
                    <tr key={z.id} className="hover:bg-slate-50/60">
                      <td className="p-3 font-mono font-bold text-[#2c57a4]">{z.zone_code || 'ZONE'}</td>
                      <td className="p-3 font-bold text-slate-800">{z.name}</td>
                      <td className="p-3">
                        <p className="font-semibold text-slate-700">{z.manager_name || 'Area Manager'}</p>
                        <p className="text-[10px] text-slate-400">{z.contact_phone}</p>
                      </td>
                      <td className="p-3 font-bold text-[#8c2785]">
                        {z.total_stores || outlets.filter(o => o.zone_id === z.id).length} Stores
                      </td>
                      <td className="p-3">
                        <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-bold text-[10px]">
                          Active
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────── */}
      {/* MODAL: CREATE / EDIT STORE                                    */}
      {/* ───────────────────────────────────────────────────────────── */}
      {showModal && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl max-w-4xl w-full overflow-hidden shadow-2xl border border-slate-100 max-h-[90vh] flex flex-col">
            <div className="p-6 bg-gradient-to-r from-[#1c1322] to-[#2f1338] text-white flex justify-between items-center">
              <div>
                <span className="text-[10px] font-black uppercase tracking-wider text-purple-300">
                  NUTRIBRAY Store Registry
                </span>
                <h3 className="text-lg font-black text-white mt-0.5">
                  {editId ? 'Modify Store Information' : 'Register New NUTRIBRAY Store'}
                </h3>
              </div>
              <button 
                onClick={() => setShowModal(false)}
                className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-all"
              >
                <i className="fas fa-times"></i>
              </button>
            </div>

            {/* Modal Tabs */}
            <div className="flex bg-slate-50 border-b border-slate-100 px-6 gap-2">
              {['General', 'Address & Contact', 'Operations & Database'].map(t => (
                <button
                  key={t}
                  onClick={() => setActiveTab(t)}
                  className={`py-3 px-4 text-xs font-bold border-b-2 transition-all ${
                    activeTab === t 
                      ? 'border-[#8c2785] text-[#8c2785]' 
                      : 'border-transparent text-slate-400 hover:text-slate-600'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-4 flex-1">
              {activeTab === 'General' && (
                <div className="space-y-4 text-xs">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="font-bold text-slate-700 block mb-1">Outlet Name *</label>
                      <input 
                        required 
                        type="text" 
                        placeholder="e.g. nutribray - South Extension" 
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                        value={formData.outlet_name || ''} 
                        onChange={e => setFormData({...formData, outlet_name: e.target.value})} 
                      />
                    </div>
                    <div>
                      <label className="font-bold text-slate-700 block mb-1">Display Name (Signage)</label>
                      <input 
                        type="text" 
                        placeholder="e.g. NUTRIBRAY South Extension Market" 
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                        value={formData.display_name || ''} 
                        onChange={e => setFormData({...formData, display_name: e.target.value})} 
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <div>
                      <label className="font-bold text-slate-700 block mb-1">Unit Code *</label>
                      <input 
                        required 
                        type="text" 
                        placeholder="e.g. G0021" 
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono font-bold text-[#8c2785]"
                        value={formData.unit_code || ''} 
                        onChange={e => setFormData({...formData, unit_code: e.target.value, outlet_code: e.target.value})} 
                      />
                    </div>
                    <div>
                      <label className="font-bold text-slate-700 block mb-1">Region</label>
                      <select 
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium"
                        value={formData.region_id || ''}
                        onChange={e => setFormData({...formData, region_id: Number(e.target.value)})}
                      >
                        {regions.map(r => (
                          <option key={r.id} value={r.id}>{r.name} ({r.code})</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="font-bold text-slate-700 block mb-1">Zone</label>
                      <select 
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium"
                        value={formData.zone_id || ''}
                        onChange={e => setFormData({...formData, zone_id: Number(e.target.value)})}
                      >
                        <option value="">Select Zone</option>
                        {zones.map(z => (
                          <option key={z.id} value={z.id}>{z.name} ({z.zone_code})</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="font-bold text-slate-700 block mb-1">Store Type</label>
                      <select 
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                        value={formData.store_type || 'Company Operated'}
                        onChange={e => setFormData({...formData, store_type: e.target.value})}
                      >
                        <option value="Company Operated">Company Operated (COCO)</option>
                        <option value="Franchise">Franchise (FOFO)</option>
                      </select>
                    </div>
                    <div>
                      <label className="font-bold text-slate-700 block mb-1">Store Category</label>
                      <input 
                        type="text" 
                        placeholder="24/7 Convenience Retail" 
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                        value={formData.store_category || ''} 
                        onChange={e => setFormData({...formData, store_category: e.target.value})} 
                      />
                    </div>
                    <div>
                      <label className="font-bold text-slate-700 block mb-1">Store Timing</label>
                      <input 
                        type="text" 
                        placeholder="24 Hours / 7 Days Open" 
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                        value={formData.store_timing || '24 Hours / 7 Days Open'} 
                        onChange={e => setFormData({...formData, store_timing: e.target.value})} 
                      />
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'Address & Contact' && (
                <div className="space-y-4 text-xs">
                  <div>
                    <label className="font-bold text-slate-700 block mb-1">Full Address *</label>
                    <textarea 
                      rows={2} 
                      className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                      value={formData.address || ''} 
                      onChange={e => setFormData({...formData, address: e.target.value})} 
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="font-bold text-slate-700 block mb-1">City</label>
                      <input 
                        type="text" 
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                        value={formData.city || ''} 
                        onChange={e => setFormData({...formData, city: e.target.value})} 
                      />
                    </div>
                    <div>
                      <label className="font-bold text-slate-700 block mb-1">State</label>
                      <input 
                        type="text" 
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                        value={formData.state || ''} 
                        onChange={e => setFormData({...formData, state: e.target.value})} 
                      />
                    </div>
                    <div>
                      <label className="font-bold text-slate-700 block mb-1">PIN Code</label>
                      <input 
                        type="text" 
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                        value={formData.pincode || ''} 
                        onChange={e => setFormData({...formData, pincode: e.target.value})} 
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="font-bold text-slate-700 block mb-1">Store Manager Name</label>
                      <input 
                        type="text" 
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                        value={formData.manager_name || ''} 
                        onChange={e => setFormData({...formData, manager_name: e.target.value})} 
                      />
                    </div>
                    <div>
                      <label className="font-bold text-slate-700 block mb-1">Manager Mobile / WhatsApp</label>
                      <input 
                        type="text" 
                        placeholder="+91 98711 00000" 
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                        value={formData.manager_mobile || ''} 
                        onChange={e => setFormData({...formData, manager_mobile: e.target.value, whatsapp_number: e.target.value})} 
                      />
                    </div>
                    <div>
                      <label className="font-bold text-slate-700 block mb-1">Store Email</label>
                      <input 
                        type="email" 
                        placeholder="store@nutribay.com" 
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                        value={formData.manager_email || ''} 
                        onChange={e => setFormData({...formData, manager_email: e.target.value})} 
                      />
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'Operations & Database' && (
                <div className="space-y-4 text-xs">
                  <div className="p-4 bg-purple-50/50 rounded-2xl border border-purple-100 space-y-3">
                    <p className="font-bold text-[#8c2785] text-xs">Database Connection Settings</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="text-slate-600 block mb-1">Database Server / IP</label>
                        <input 
                          type="text" 
                          placeholder="localhost or remote IP" 
                          className="w-full p-2 bg-white border border-slate-200 rounded-lg font-mono text-xs"
                          value={formData.server_name || ''} 
                          onChange={e => setFormData({...formData, server_name: e.target.value})} 
                        />
                      </div>
                      <div>
                        <label className="text-slate-600 block mb-1">Database Name</label>
                        <input 
                          type="text" 
                          placeholder="outlet_db" 
                          className="w-full p-2 bg-white border border-slate-200 rounded-lg font-mono text-xs"
                          value={formData.database_name || ''} 
                          onChange={e => setFormData({...formData, database_name: e.target.value})} 
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-6 pt-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input 
                        type="checkbox" 
                        checked={formData.is_active} 
                        onChange={e => setFormData({...formData, is_active: e.target.checked})} 
                        className="rounded text-[#8c2785] focus:ring-[#8c2785]"
                      />
                      <span className="font-bold text-slate-700">Active Operational Store</span>
                    </label>

                    <label className="flex items-center gap-2">
                      <span className="font-bold text-slate-700">Billing below zero stock</span>
                      <select
                        value={formData.negative_stock || 'company'}
                        onChange={e => setFormData({...formData, negative_stock: e.target.value as 'company' | 'block' | 'allow'})}
                        className="p-1.5 bg-white border border-slate-200 rounded-lg text-xs font-semibold"
                        title="Whether this outlet may bill, transfer or return an item that would go below zero stock"
                      >
                        <option value="company">Use company setting</option>
                        <option value="block">Block (no negative stock)</option>
                        <option value="allow">Allow negative stock</option>
                      </select>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer">
                      <input 
                        type="checkbox" 
                        checked={formData.is_delivery_available} 
                        onChange={e => setFormData({...formData, is_delivery_available: e.target.checked})} 
                        className="rounded text-[#8c2785] focus:ring-[#8c2785]"
                      />
                      <span className="font-medium text-slate-700">Delivery Available</span>
                    </label>
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                <button 
                  type="button" 
                  onClick={() => setShowModal(false)}
                  className="px-5 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-bold text-xs hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="px-6 py-2.5 rounded-xl bg-[#8c2785] hover:bg-[#731f6d] text-white font-bold text-xs shadow-md"
                >
                  {editId ? 'Save Store Changes' : 'Register Store'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL: ADD REGION ── */}
      {showRegionModal && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-100 space-y-4">
            <h3 className="text-base font-black text-slate-800">Add Operational Region</h3>
            <form onSubmit={handleSaveRegion} className="space-y-3 text-xs">
              <div>
                <label className="font-bold text-slate-700 block mb-1">Region Code *</label>
                <input required type="text" placeholder="e.g. NCR02" className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl uppercase font-mono" value={regionForm.code} onChange={e => setRegionForm({...regionForm, code: e.target.value.toUpperCase()})} />
              </div>
              <div>
                <label className="font-bold text-slate-700 block mb-1">Region Name *</label>
                <input required type="text" placeholder="e.g. Punjab & North" className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl" value={regionForm.name} onChange={e => setRegionForm({...regionForm, name: e.target.value})} />
              </div>
              <div>
                <label className="font-bold text-slate-700 block mb-1">Regional Manager</label>
                <input type="text" placeholder="Manager Name" className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl" value={regionForm.manager_name} onChange={e => setRegionForm({...regionForm, manager_name: e.target.value})} />
              </div>
              <div>
                <label className="font-bold text-slate-700 block mb-1">Contact Phone</label>
                <input type="text" placeholder="+91 ..." className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl" value={regionForm.contact_phone} onChange={e => setRegionForm({...regionForm, contact_phone: e.target.value})} />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowRegionModal(false)} className="px-4 py-2 border rounded-xl font-bold">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-[#8c2785] text-white rounded-xl font-bold">Save Region</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL: ADD ZONE ── */}
      {showZoneModal && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-100 space-y-4">
            <h3 className="text-base font-black text-slate-800">Add Cluster Zone</h3>
            <form onSubmit={handleSaveZone} className="space-y-3 text-xs">
              <div>
                <label className="font-bold text-slate-700 block mb-1">Parent Region *</label>
                <select className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium" value={zoneForm.region_id} onChange={e => setZoneForm({...zoneForm, region_id: Number(e.target.value)})}>
                  {regions.map(r => (
                    <option key={r.id} value={r.id}>{r.name} ({r.code})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="font-bold text-slate-700 block mb-1">Zone Code</label>
                <input type="text" placeholder="e.g. Z-ND" className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono uppercase" value={zoneForm.zone_code} onChange={e => setZoneForm({...zoneForm, zone_code: e.target.value.toUpperCase()})} />
              </div>
              <div>
                <label className="font-bold text-slate-700 block mb-1">Zone Name *</label>
                <input required type="text" placeholder="e.g. North Delhi Zone" className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl" value={zoneForm.name} onChange={e => setZoneForm({...zoneForm, name: e.target.value})} />
              </div>
              <div>
                <label className="font-bold text-slate-700 block mb-1">Area Manager</label>
                <input type="text" placeholder="Area Manager Name" className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl" value={zoneForm.manager_name} onChange={e => setZoneForm({...zoneForm, manager_name: e.target.value})} />
              </div>
              <div>
                <label className="font-bold text-slate-700 block mb-1">Contact Phone</label>
                <input type="text" placeholder="+91 ..." className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl" value={zoneForm.contact_phone} onChange={e => setZoneForm({...zoneForm, contact_phone: e.target.value})} />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowZoneModal(false)} className="px-4 py-2 border rounded-xl font-bold">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-[#2c57a4] text-white rounded-xl font-bold">Save Zone</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default OutletMaster;

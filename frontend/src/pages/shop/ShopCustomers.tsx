import React, { useEffect, useState } from 'react';
import { Users, Search, ChevronLeft, ChevronRight, RefreshCw, Phone, Mail, MapPin, ShoppingBag, DollarSign, Calendar } from 'lucide-react';
import { shopService } from '../../services/shopService';

const ShopCustomers: React.FC = () => {
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');

  const loadCustomers = async () => {
    setLoading(true);
    try {
      const params: any = { page, per_page: 15 };
      if (search) params.search = search;
      const res = await shopService.getAdminCustomers(params);
      setCustomers(res.data || []);
      setTotal(res.total || 0);
      setTotalPages(res.total_pages || 1);
    } catch (err) {
      console.error('Error loading customers:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadCustomers(); }, [page]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    loadCustomers();
  };

  return (
    <div className="p-6 space-y-6 bg-slate-50 min-h-screen">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-slate-900 flex items-center gap-3">
            <div className="w-10 h-10 bg-violet-500 rounded-2xl flex items-center justify-center">
              <Users className="text-white w-5 h-5" />
            </div>
            Shop Customers
          </h1>
          <p className="text-slate-500 font-medium mt-1">All registered online shop customers • {total} total</p>
        </div>
        <button onClick={loadCustomers} className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl font-bold text-sm text-slate-600 transition-colors">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Search */}
      <form onSubmit={handleSearch} className="max-w-md relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name, phone or email..."
          className="w-full pl-11 pr-4 py-3 bg-white border border-slate-200 rounded-xl font-medium text-sm text-slate-800 placeholder-slate-400 focus:ring-2 focus:ring-violet-400 focus:border-violet-400 outline-none transition-all"
        />
      </form>

      {/* Customer Cards (Grid) */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array(6).fill(0).map((_, i) => (
            <div key={i} className="bg-white rounded-3xl p-6 animate-pulse space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-slate-100 rounded-full" />
                <div className="space-y-2 flex-1">
                  <div className="h-4 bg-slate-100 rounded-full w-3/4" />
                  <div className="h-3 bg-slate-100 rounded-full w-1/2" />
                </div>
              </div>
              <div className="h-3 bg-slate-100 rounded-full w-full" />
              <div className="h-3 bg-slate-100 rounded-full w-2/3" />
            </div>
          ))}
        </div>
      ) : customers.length === 0 ? (
        <div className="bg-white rounded-3xl p-16 text-center">
          <Users className="w-16 h-16 text-slate-200 mx-auto mb-4" />
          <p className="text-slate-400 font-bold text-lg">No customers found</p>
          <p className="text-slate-300 text-sm mt-1">Customers will appear here when they place orders on the shop</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {customers.map((cust: any) => (
            <div key={cust.id} className="bg-white rounded-3xl border border-slate-100 shadow-sm hover:shadow-md transition-all p-6 space-y-4">
              {/* Customer Header */}
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-gradient-to-br from-violet-400 to-purple-600 rounded-full flex items-center justify-center text-white font-black text-lg shadow-lg shadow-violet-200">
                  {(cust.name || 'C').charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-black text-slate-900 truncate">{cust.name}</h3>
                  <p className="text-xs text-slate-400 flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    {cust.created_at ? new Date(cust.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '-'}
                  </p>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${cust.status ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                  {cust.status ? 'Active' : 'Inactive'}
                </span>
              </div>

              {/* Contact Details */}
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2 text-slate-600">
                  <Phone className="w-3.5 h-3.5 text-slate-400" />
                  <span className="font-medium">{cust.phone}</span>
                </div>
                {cust.email && (
                  <div className="flex items-center gap-2 text-slate-600">
                    <Mail className="w-3.5 h-3.5 text-slate-400" />
                    <span className="font-medium truncate">{cust.email}</span>
                  </div>
                )}
                {(cust.address || cust.city) && (
                  <div className="flex items-center gap-2 text-slate-600">
                    <MapPin className="w-3.5 h-3.5 text-slate-400" />
                    <span className="font-medium truncate">{[cust.address, cust.city, cust.state].filter(Boolean).join(', ')}</span>
                  </div>
                )}
              </div>

              {/* Order Stats */}
              <div className="flex gap-3 pt-3 border-t border-slate-100">
                <div className="flex-1 bg-blue-50 rounded-xl p-3 text-center">
                  <div className="flex items-center justify-center gap-1 text-blue-600">
                    <ShoppingBag className="w-3.5 h-3.5" />
                    <span className="text-lg font-black">{cust.order_count || 0}</span>
                  </div>
                  <p className="text-[10px] font-bold text-blue-400 uppercase">Orders</p>
                </div>
                <div className="flex-1 bg-emerald-50 rounded-xl p-3 text-center">
                  <div className="flex items-center justify-center gap-1 text-emerald-600">
                    <DollarSign className="w-3.5 h-3.5" />
                    <span className="text-lg font-black">₹{parseFloat(cust.total_spent || 0).toLocaleString('en-IN')}</span>
                  </div>
                  <p className="text-[10px] font-bold text-emerald-400 uppercase">Spent</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between bg-white rounded-2xl border border-slate-100 px-6 py-4">
          <p className="text-xs text-slate-400 font-medium">Page {page} of {totalPages} • {total} customers</p>
          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage(p => p - 1)}
              className="p-2 bg-slate-50 hover:bg-slate-100 rounded-lg disabled:opacity-30 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage(p => p + 1)}
              className="p-2 bg-slate-50 hover:bg-slate-100 rounded-lg disabled:opacity-30 transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ShopCustomers;

import React, { useState } from 'react';

const Inventory = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState('');

  const products = [
    { id: 1, name: 'Fresh Pomfret (Large)', category: 'Fish', hsn: '0301', stock: 45, unit: 'KG', purchase: 650, sale: 850, value: 29250, expiry: '2024-05-15' },
    { id: 2, name: 'Lobster (Small)', category: 'Shellfish', hsn: '0306', stock: 0, unit: 'KG', purchase: 1200, sale: 1800, value: 0, expiry: null },
    { id: 3, name: 'Salmon Fillet', category: 'Frozen', hsn: '0303', stock: 5, unit: 'PKT', purchase: 450, sale: 620, value: 2250, expiry: '2024-05-02' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold flex items-center">
            <span className="bg-blue-600 text-white p-1 rounded mr-2"><i className="fas fa-warehouse"></i></span>
            Inventory Management
          </h1>
          <p className="text-xs text-slate-500 font-medium mt-1">Real-time stock status & valuation</p>
        </div>
        <button className="bg-amber-500 text-white font-bold py-2 px-6 rounded shadow-lg hover:bg-amber-600 transition-all flex items-center">
          <i className="fas fa-boxes mr-2"></i> Physical Stock Audit
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="card shadow-sm border-0 bg-white">
          <div className="card-body">
            <p className="text-[10px] text-slate-400 uppercase font-bold tracking-widest mb-1">Total Stock Value</p>
            <h4 className="text-xl font-black text-slate-800">₹ 1,24,500.00</h4>
          </div>
        </div>
        <div className="card shadow-sm border-0 bg-white">
          <div className="card-body">
            <p className="text-[10px] text-slate-400 uppercase font-bold tracking-widest mb-1">Out of Stock</p>
            <h4 className="text-xl font-black text-red-600">5 items</h4>
          </div>
        </div>
        <div className="card shadow-sm border-0 bg-white">
          <div className="card-body">
            <p className="text-[10px] text-slate-400 uppercase font-bold tracking-widest mb-1">Low Stock</p>
            <h4 className="text-xl font-black text-amber-500">12 items</h4>
          </div>
        </div>
        <div className="card shadow-sm border-0 bg-white">
          <div className="card-body">
            <p className="text-[10px] text-slate-400 uppercase font-bold tracking-widest mb-1">Expiring Soon</p>
            <h4 className="text-xl font-black text-orange-600">3 items</h4>
          </div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="card shadow-sm border-0 bg-white p-3 flex space-x-4">
        <div className="flex-1 relative">
          <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"></i>
          <input 
            type="text" 
            placeholder="Search product, category, HSN..." 
            className="form-control pl-10 h-10 text-sm"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <select className="form-control w-48 h-10 text-sm" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">All Stock Status</option>
          <option value="out">Out of Stock</option>
          <option value="low">Low Stock</option>
          <option value="ok">In Stock</option>
        </select>
      </div>

      {/* Table */}
      <div className="card shadow-sm border-0 overflow-hidden">
        <div className="card-body p-0">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#1a1a2e] text-white">
              <tr className="uppercase tracking-tighter">
                <th className="px-4 py-3">#</th>
                <th className="px-4 py-3">Product Name</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3 text-center">Current Stock</th>
                <th className="px-4 py-3 text-right">Purchase ₹</th>
                <th className="px-4 py-3 text-right">Selling ₹</th>
                <th className="px-4 py-3 text-right">Total Value</th>
                <th className="px-4 py-3 text-center">Expiry</th>
                <th className="px-4 py-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {products.map((p, idx) => {
                const stockCls = p.stock === 0 ? 'bg-red-100 text-red-700' : p.stock <= 10 ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700';
                return (
                  <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 text-slate-400">{idx + 1}</td>
                    <td className="px-4 py-3">
                       <div className="font-bold text-slate-800">{p.name}</div>
                       <div className="text-[10px] text-slate-500">HSN: {p.hsn}</div>
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-600">{p.category}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`px-2 py-1 rounded-full font-bold text-[10px] ${stockCls}`}>
                        {p.stock} {p.unit}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono">₹{p.purchase.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right font-mono">₹{p.sale.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right font-bold text-slate-900 font-mono">₹{p.value.toLocaleString()}</td>
                    <td className="px-4 py-3 text-center">
                       {p.expiry ? (
                         <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${new Date(p.expiry) < new Date() ? 'bg-red-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
                           {p.expiry}
                         </span>
                       ) : <span className="text-slate-300">N/A</span>}
                    </td>
                    <td className="px-4 py-3">
                       <div className="flex justify-center space-x-1">
                          <button className="p-1 text-blue-600 hover:bg-blue-50 rounded"><i className="fas fa-history mr-1"></i> Logs</button>
                          <button className="p-1 text-amber-600 hover:bg-amber-50 rounded"><i className="fas fa-adjust mr-1"></i> Adjust</button>
                       </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Inventory;

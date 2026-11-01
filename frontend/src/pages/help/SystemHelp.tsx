import React, { useState } from 'react';
import { APP_ROUTES } from '../../routes/config';
import { useTabStore } from '../../store/tabStore';
import { matchesSearch } from '../../utils/search';

export default function SystemHelp() {
  const [search, setSearch] = useState('');
  const addTab = useTabStore(s => s.addTab);

  const filteredRoutes = APP_ROUTES.filter(r => 
    matchesSearch(search, r.title) || 
    r.id.includes(search)
  ).sort((a, b) => a.id.localeCompare(b.id));

  const handleOpen = (route: any) => {
    addTab({ id: route.path, title: route.title, path: route.path });
  };

  const getFormDescription = (title: string) => {
    switch (title) {
      case 'Dashboard': return 'Overview of key performance indicators, sales trends, and system alerts.';
      case 'Item Master': return 'Comprehensive product management including pricing, HSN configuration, and multi-channel integration.';
      case 'Suppliers': return 'Vendor onboarding, registration management, and ledger tracking.';
      case 'Billing / Invoicing': return 'Create and manage sales invoices, process payments, and handle cancellations.';
      case 'Purchase Orders': return 'Generate POs, manage approvals, and distribute items across outlets.';
      case 'Goods Receipt Note': return 'Record incoming stock from suppliers and update inventory levels.';
      case 'Audit Logs': return 'Full traceability of all user actions including create, edit, delete, and navigation events.';
      case 'Employees': return 'HR module for managing employee profiles and directory.';
      case 'Attendance': return 'Track employee clock-in/out times and attendance history.';
      case 'Inventory': return 'Real-time stock monitoring and warehouse management.';
      case 'Stock Transfer OUT': return 'Process outgoing stock transfers between warehouses or outlets.';
      default: return 'Core application module for processing business transactions and data management.';
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950">
      <div className="p-8 bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-xl">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-4xl font-black mb-2 flex items-center gap-3">
            <i className="fas fa-book-open"></i> System Help & Documentation
          </h1>
          <p className="text-blue-100 text-lg mb-8 opacity-90">
            Use this guide to find Form IDs and understand the features of each module.
          </p>
          
          <div className="relative max-w-2xl">
            <i className="fas fa-search absolute left-4 top-1/2 -translate-y-1/2 text-blue-400"></i>
            <input 
              type="text" 
              placeholder="Search by Form Name or Transaction ID (e.g. 101)..."
              className="w-full h-14 pl-12 pr-6 rounded-2xl bg-white/10 backdrop-blur-md border border-white/20 text-white placeholder:text-blue-200 outline-none focus:ring-4 focus:ring-white/10 transition-all text-lg"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-8">
        <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredRoutes.map((route) => (
            <div 
              key={route.id}
              className="group bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm hover:shadow-2xl hover:-translate-y-1 transition-all duration-300"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="w-12 h-12 rounded-2xl bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400 text-xl font-black">
                  {route.id}
                </div>
                <button 
                  onClick={() => handleOpen(route)}
                  className="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:bg-blue-600 hover:text-white transition-all opacity-0 group-hover:opacity-100"
                >
                  Open Form
                </button>
              </div>
              
              <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-2">{route.title}</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed mb-6">
                {getFormDescription(route.title)}
              </p>
              
              <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-tighter">Transaction Code</span>
                <span className="px-2 py-1 rounded bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 text-xs font-mono font-bold">
                  /{route.id}
                </span>
              </div>
            </div>
          ))}
        </div>

        {filteredRoutes.length === 0 && (
          <div className="text-center py-20">
            <div className="w-20 h-20 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-400">
              <i className="fas fa-search text-3xl"></i>
            </div>
            <h3 className="text-xl font-bold text-slate-800 dark:text-white">No results found</h3>
            <p className="text-slate-500">Try searching for a different keyword or ID.</p>
          </div>
        )}
      </div>

      <div className="p-6 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800">
        <div className="max-w-4xl mx-auto flex items-center gap-6">
          <div className="flex-1">
            <h4 className="font-bold text-slate-800 dark:text-white mb-1">Quick Tip: Fast Navigation</h4>
            <p className="text-sm text-slate-500">
              Press the "Go to..." bar at the top of any page and type a Form ID to jump instantly.
            </p>
          </div>
          <div className="hidden sm:flex gap-2">
             <kbd className="px-2 py-1 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded text-xs font-mono">Enter</kbd>
          </div>
          <button 
            onClick={() => addTab({ id: '/portals', title: 'Portal Hub', path: '/portals' })}
            className="ml-auto px-6 py-2.5 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-200 dark:shadow-none flex items-center gap-2"
          >
            <i className="fas fa-qrcode"></i> View Login QR Codes
          </button>
        </div>
      </div>
    </div>
  );
}

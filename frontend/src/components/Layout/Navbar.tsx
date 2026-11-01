import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useBrandingStore } from '../../store/brandingStore';
import api from '../../api/axios';

const Navbar = () => {
  const { brand_name, logo_path, fetchSettings } = useBrandingStore();
  const [pendingVendors, setPendingVendors] = useState<number>(0);
  const [showNotifPanel, setShowNotifPanel] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchSettings();
  }, []);

  useEffect(() => {
    const fetchPending = async () => {
      try {
        const res = await api.get('/suppliers', {
          params: { registration_status: 'submitted', per_page: 1, page: 1 },
        });
        setPendingVendors(res.data?.total ?? 0);
      } catch { /* ignore */ }
    };
    fetchPending();
    const timer = setInterval(fetchPending, 60_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setShowNotifPanel(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <nav className="h-[56px] bg-white border-b border-border px-6 flex items-center justify-between sticky top-0 z-40">
      <div className="flex items-center gap-6">
        <div className="relative group max-w-[400px]">
          <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-[12px]"></i>
          <input 
            type="text" 
            placeholder="Search forms or Transaction ID (e.g. 101)..." 
            className="h-9 w-[350px] bg-bg-app border border-border rounded-fiori pl-9 pr-4 text-[13px] outline-none focus:border-primary transition-all"
          />
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1">
            <span className="text-[9px] font-bold text-text-muted border border-border px-1 rounded bg-white">ENTER TO GO</span>
            <span className="text-[10px] font-bold text-text-muted border border-border px-1 rounded bg-white">⌘K</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-5">
        {/* Help */}
        <button className="text-text-secondary hover:text-primary transition-colors">
          <i className="far fa-question-circle text-lg"></i>
        </button>

        {/* Layout Switcher */}
        <button className="text-text-secondary hover:text-primary transition-colors">
          <i className="fas fa-th-large text-lg"></i>
        </button>

        {/* Notifications */}
        <div className="relative" ref={notifRef}>
          <button onClick={() => setShowNotifPanel(!showNotifPanel)} className="text-text-secondary hover:text-primary transition-colors relative">
            <i className="far fa-bell text-lg"></i>
            {pendingVendors > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center border-2 border-white">
                {pendingVendors}
              </span>
            )}
          </button>
        </div>

        {/* User Profile */}
        <div className="flex items-center gap-3 pl-4 border-l border-border">
          <div className="text-right">
            <p className="text-[12px] font-bold text-text-primary m-0 leading-none">System Administrator</p>
            <p className="text-[10px] text-text-muted font-bold uppercase m-0 mt-1">ADMIN</p>
          </div>
          <div className="w-9 h-9 rounded-full bg-primary flex items-center justify-center text-white font-bold shadow-lg shadow-primary/20">
            S
          </div>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;

import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTabStore } from '../../store/tabStore';
import { useAuthStore } from '../../store/authStore';
import { APP_ROUTES } from '../../routes/config';
import { toast } from 'react-hot-toast';
import { audit_api } from '../../api/audit';
import api from '../../api/axios';
import BackupModal from '../common/BackupModal';
import CommandPalette from '../common/CommandPalette';
import { useThemeStore } from '../../store/themeStore';
import { isFull, keepFull, toggleFull } from '../../utils/fullscreen';
import StoreSwitcher from './StoreSwitcher';

interface HeaderProps {
  onSidebarToggle: () => void;
}

interface NotificationItem {
  id: string;
  title: string;
  desc: string;
  time: string;
  icon: string;
  color: string;
  path: string;
  read: boolean;
}

export default function Header({ onSidebarToggle }: HeaderProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const addTab = useTabStore(s => s.addTab);
  const user = useAuthStore(s => s.user);
  const [full, setFull] = useState(isFull());
  useEffect(() => keepFull(setFull), []);  // stay full screen after a reload (on the next click)
  const { isDarkMode, toggleDarkMode } = useThemeStore();

  // States
  const [pendingVendors, setPendingVendors] = useState<number>(0);
  const [showNotifPanel, setShowNotifPanel] = useState(false);
  const [showBackupModal, setShowBackupModal] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);

  // Notification items list
  const [notifications, setNotifications] = useState<NotificationItem[]>([
    {
      id: '1',
      title: 'Low Stock Alert',
      desc: 'Lobster (Small) has reached 0 stock limit',
      time: '10 mins ago',
      icon: 'fas fa-exclamation-triangle',
      color: 'text-red-600 bg-red-50',
      path: '/inventory/status',
      read: false,
    },
    {
      id: '2',
      title: 'New Online Order',
      desc: 'Order #1042 received from Taj Hotel',
      time: '30 mins ago',
      icon: 'fas fa-shopping-bag',
      color: 'text-green-600 bg-green-50',
      path: '/admin/shop/orders',
      read: false,
    },
    {
      id: '3',
      title: 'SPS Verification',
      desc: 'GRN-0055 mismatch detected of ₹1,300',
      time: '1 hour ago',
      icon: 'fas fa-file-invoice-dollar',
      color: 'text-amber-600 bg-amber-50',
      path: '/accounts/bills',
      read: false,
    },
    {
      id: '4',
      title: 'Leave Request',
      desc: 'Ravi Patel requested 1 day Sick Leave',
      time: '2 hours ago',
      icon: 'fas fa-calendar-times',
      color: 'text-violet-600 bg-violet-50',
      path: '/hr/leaves',
      read: false,
    },
  ]);

  // Sync pending registrations count to notifications list dynamically
  useEffect(() => {
    if (pendingVendors > 0) {
      setNotifications(prev => {
        const filtered = prev.filter(n => n.id !== 'vendor-pending');
        return [
          {
            id: 'vendor-pending',
            title: 'Supplier Onboarding',
            desc: `${pendingVendors} supplier registrations submitted`,
            time: 'Just now',
            icon: 'fas fa-truck-loading',
            color: 'text-blue-600 bg-blue-50',
            path: '/masters/suppliers/approvals',
            read: false,
          },
          ...filtered,
        ];
      });
    }
  }, [pendingVendors]);

  // Handle Ctrl+K / Cmd+K global shortcuts
  useEffect(() => {
    const handleGlobalShortcuts = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setShowCommandPalette(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleGlobalShortcuts);
    return () => window.removeEventListener('keydown', handleGlobalShortcuts);
  }, []);

  // Handle clicks outside notification panel to auto-close
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setShowNotifPanel(false);
      }
    };
    window.addEventListener('mousedown', handleClickOutside);
    return () => window.removeEventListener('mousedown', handleClickOutside);
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

  const handleNotificationClick = (item: NotificationItem) => {
    // Mark as read
    setNotifications(prev => prev.map(n => n.id === item.id ? { ...n, read: true } : n));
    setShowNotifPanel(false);
    
    // Resolve route and add tab
    const route = APP_ROUTES.find(r => r.path === item.path);
    if (route) {
      addTab({ id: route.path, title: route.title, path: route.path });
      navigate(route.path);
    } else {
      // Fallback
      addTab({ id: item.path, title: item.title, path: item.path });
      navigate(item.path);
    }
  };

  const handleClearAll = () => {
    setNotifications([]);
    setShowNotifPanel(false);
    toast.success("Notifications cleared");
  };

  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <header className="h-[64px] bg-[var(--color-sidebar)] flex items-center px-6 gap-4 sticky top-0 z-50">
      <button 
        id="sidebar-toggle-btn"
        onClick={onSidebarToggle}
        className="w-10 h-10 rounded-lg hover:bg-app-bg flex items-center justify-center text-text-secondary transition-colors"
        aria-label="Toggle sidebar"
      >
        <i className="fas fa-bars"></i>
      </button>

      {/* Global Command Bar wrapper */}
      <div 
        onClick={() => setShowCommandPalette(true)}
        className="flex-1 max-w-lg cursor-pointer"
      >
        <div className="relative group w-full">
          <i className="fas fa-search absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted text-[13px]"></i>
          <div className="w-full h-10 bg-[#F9FAFB] border border-border-strong rounded-lg pl-10 pr-20 flex items-center text-[14px] text-text-muted select-none group-hover:border-primary transition-colors">
            Search screens, items, invoices…
          </div>
          <div className="absolute inset-y-0 right-2.5 flex items-center">
             <kbd className="px-1.5 py-0.5 bg-white border border-border rounded text-[11px] font-mono text-text-secondary">Ctrl K</kbd>
          </div>
        </div>
      </div>

      {/* Scope: which plant this screen is about */}
      <div className="hidden xl:flex items-center gap-2 text-[13px] text-text-secondary">
        <span className="font-semibold text-text-primary">Nutribray plant</span>
        <span className="text-border-strong">/</span>
        <span>NCR01, Delhi NCR</span>
      </div>

      <div className="flex items-center gap-4 ml-auto">
        <StoreSwitcher />
        {/* Global Tools */}
        <div className="flex items-center gap-1 pr-4 border-r border-border">
          <button
            onClick={toggleFull}
            className="text-text-secondary hover:text-primary transition-colors w-10 h-10 rounded-lg hover:bg-app-bg flex items-center justify-center"
            title={full ? 'Exit full screen (Esc)' : 'Full screen'}
            aria-label={full ? 'Exit full screen' : 'Full screen'}
            aria-pressed={full}
          >
            <i className={`fas ${full ? 'fa-compress' : 'fa-expand'} text-lg`}></i>
          </button>
          <button
            onClick={toggleDarkMode}
            className="text-text-secondary hover:text-primary transition-colors w-10 h-10 rounded-lg hover:bg-app-bg flex items-center justify-center"
            title={isDarkMode ? 'Light mode' : 'Dark mode'}
            aria-label={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-pressed={isDarkMode}
          >
            <i className={`fas ${isDarkMode ? 'fa-sun' : 'fa-moon'} text-lg`}></i>
          </button>
          {/* Stunning Interactive Notification Bell */}
          <div className="relative" ref={notifRef}>
            <button
              onClick={() => setShowNotifPanel(!showNotifPanel)}
              className="text-text-secondary hover:text-primary transition-all relative w-10 h-10 rounded-lg hover:bg-app-bg flex items-center justify-center"
              title="Notifications"
            >
              <i className="far fa-bell text-lg"></i>
              {unreadCount > 0 && (
                <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 bg-[#D92D20] text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                  {unreadCount}
                </span>
              )}
            </button>

            {/* Glassmorphism Notification dropdown panel */}
            {showNotifPanel && (
              <div className="absolute right-0 mt-3.5 w-80 bg-white rounded-xl shadow-xl border border-border overflow-hidden z-[1000] animate-in fade-in slide-in-from-top-3 duration-200">
                <div className="px-4 py-3 flex justify-between items-center border-b border-border">
                  <span className="text-[14px] font-semibold text-text-primary">Notifications ({unreadCount})</span>
                  {notifications.length > 0 && (
                    <button onClick={handleClearAll} className="text-[13px] font-medium text-primary hover:underline">
                      Clear All
                    </button>
                  )}
                </div>
                <div className="max-h-[320px] overflow-y-auto divide-y divide-slate-100">
                  {notifications.length > 0 ? (
                    notifications.map(item => (
                      <div
                        key={item.id}
                        onClick={() => handleNotificationClick(item)}
                        className={`flex gap-3 p-3.5 hover:bg-slate-50 cursor-pointer transition-colors ${!item.read ? 'bg-yellow-50/20' : ''}`}
                      >
                        <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${item.color}`}>
                          <i className={`${item.icon} text-xs`}></i>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className={`text-xs ${!item.read ? 'font-bold text-slate-900' : 'text-slate-600'}`}>{item.title}</p>
                          <p className="text-[10px] text-slate-400 mt-0.5 leading-tight">{item.desc}</p>
                          <p className="text-[8px] font-bold text-slate-300 uppercase tracking-tighter mt-1">{item.time}</p>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="p-8 text-center text-slate-400">
                      <i className="far fa-bell-slash text-2xl opacity-30 mb-2"></i>
                      <p className="text-xs font-bold uppercase tracking-wider">No alerts</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <button 
            onClick={() => setShowBackupModal(true)}
            className="text-text-secondary hover:text-primary transition-all w-10 h-10 rounded-lg hover:bg-app-bg flex items-center justify-center"
            title="Database Backup"
          >
            <i className="fas fa-database text-lg"></i>
          </button>

          <button 
            onClick={() => addTab({ id: '/help', title: 'System Help', path: '/help' })}
            className="text-text-secondary hover:text-primary transition-all w-10 h-10 rounded-lg hover:bg-app-bg flex items-center justify-center"
            title="System Help (ID: 999)"
          >
            <i className="far fa-question-circle text-lg"></i>
          </button>
          
          <button
            onClick={() => addTab({ id: '/portals', title: 'Portal Hub', path: '/portals' })}
            className="text-text-secondary hover:text-primary transition-all w-10 h-10 rounded-lg hover:bg-app-bg flex items-center justify-center"
            title="Portal Hub (ID: 990)"
          >
            <i className="fas fa-th-large text-lg"></i>
          </button>
        </div>

        {/* User Profile */}
        <div className="flex items-center gap-3 pl-2">
          <div className="text-right hidden sm:block">
            <p className="text-[13px] font-semibold text-text-primary leading-none m-0">{user?.name || 'Admin User'}</p>
            <p className="text-[12px] text-text-muted m-0 mt-1">{user?.role || 'Senior Manager'}</p>
          </div>
          <div className="w-9 h-9 rounded-full bg-primary flex items-center justify-center text-white font-semibold">
            {(user?.name || 'A').charAt(0).toUpperCase()}
          </div>
        </div>
      </div>

      <BackupModal isOpen={showBackupModal} onClose={() => setShowBackupModal(false)} />
      
      {/* Global Command Palette */}
      <CommandPalette isOpen={showCommandPalette} onClose={() => setShowCommandPalette(false)} />
    </header>
  );
}




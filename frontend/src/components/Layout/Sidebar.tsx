import { useState, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useBrandingStore } from '../../store/brandingStore';
import { useAuthStore } from '../../store/authStore';
import { useAuth } from '../../hooks/useAuth';
import { isAllowed } from '../../config/mfgOnly';
import { useMyAccess } from '../../hooks/useMyAccess';

/* ─── Menu Structure ─────────────────────────────────────── */
const ALL_SECTIONS = [
  {
    label: 'Dashboard',
    to: '/dashboard',
    icon: 'fas fa-tachometer-alt',
    color: '#3b82f6', // Blue
  },
  {
    label: 'Head Office',
    to: '/ho-dashboard',
    icon: 'fas fa-building',
    color: '#6366f1',
  },
  {
    label: 'Approvals',
    to: '/approvals',
    icon: 'fas fa-check-double',
    color: '#f59e0b',
  },
  {
    label: 'Store Health',
    to: '/stores/health',
    icon: 'fas fa-heartbeat',
    color: '#14A3A8',
  },
  {
    label: 'Products',
    icon: 'fas fa-box-open',
    color: '#f59e0b', // Amber
    children: [
      { label: 'Finished Goods', to: '/products/list?type=FG', icon: 'fas fa-box' },
      { label: 'Raw Materials', to: '/products/list?type=RM', icon: 'fas fa-wheat-awn' },
      { label: 'Packing Material', to: '/products/list?type=PM', icon: 'fas fa-boxes-packing' },
      { label: 'All Items', to: '/products/list', icon: 'fas fa-list' },
      { label: 'Add New Item', to: '/products/add', icon: 'fas fa-plus-circle' },
      { label: 'Import from Excel', to: '/products/import', icon: 'fas fa-file-excel' },
    ],
  },
  {
    label: 'Masters',
    icon: 'fas fa-sitemap',
    color: '#6366f1', // Indigo
    children: [
      { label: 'Item Groups', to: '/masters/groups', icon: 'fas fa-layer-group' },
      { label: 'Sub Groups', to: '/masters/subgroups', icon: 'fas fa-sitemap' },
      { label: 'Categories', to: '/masters/categories', icon: 'fas fa-tags' },
      { label: 'Sub Categories', to: '/masters/subcategories', icon: 'fas fa-list-ul' },
      { label: 'Brands', to: '/masters/brands', icon: 'fas fa-trademark' },
      { label: 'Sub Brands', to: '/masters/subbrands', icon: 'fas fa-certificate' },
      { label: 'Manufacturers', to: '/masters/manufacturers', icon: 'fas fa-industry' },
      { label: 'Sub Manufacturers', to: '/masters/submanufacturers', icon: 'fas fa-industry' },
      { label: 'Variant Master', to: '/masters/variants', icon: 'fas fa-tags' },
      { label: 'Flavour Master', to: '/masters/flavours', icon: 'fas fa-ice-cream' },
      { label: 'Product Classification', to: '/masters/classification', icon: 'fas fa-th-large' },
      { label: 'Unit Master', to: '/masters/units', icon: 'fas fa-balance-scale' },
      { label: 'HSN Master', to: '/masters/hsn', icon: 'fas fa-barcode' },
      { label: 'GST Master', to: '/masters/gst', icon: 'fas fa-percent' },
      { label: 'Country Master', to: '/masters/countries', icon: 'fas fa-globe' },
      { label: 'Warehouse Racking', to: '/masters/warehouse-racking', icon: 'fas fa-th-large' },
      { label: 'Suppliers', to: '/masters/suppliers', icon: 'fas fa-truck' },
      { label: 'Customers', to: '/masters/customers', icon: 'fas fa-users' },
      { label: 'Outlet Master', to: '/masters/outlets', icon: 'fas fa-store' },
      { label: 'Channel Partners', to: '/masters/channels', icon: 'fas fa-globe' },
    ],
  },
  {
    label: 'Estimates',
    icon: 'fas fa-file-alt',
    color: '#14b8a6', // Teal
    children: [
      { label: 'All Estimates', to: '/billing/estimates', icon: 'fas fa-list' },
      { label: 'New Estimate', to: '/billing/estimates/new', icon: 'fas fa-plus' },
    ],
  },
  {
    label: 'Billing',
    icon: 'fas fa-file-invoice',
    color: '#10b981', // Emerald
    children: [
      { label: 'Day & Shift', to: '/billing/day-shift', icon: 'fas fa-cash-register' },
      { label: 'All Invoices', to: '/billing/invoices', icon: 'fas fa-list' },
      { label: 'New Invoice', to: '/billing/create', icon: 'fas fa-plus' },
      { label: 'Sales Return', to: '/billing/returns', icon: 'fas fa-undo' },
      { label: 'Credit Notes', to: '/billing/returns/list', icon: 'fas fa-list' },
    ],
  },
  {
    label: 'Purchases',
    icon: 'fas fa-shopping-cart',
    color: '#ef4444', // Red
    children: [
      { label: 'Excel Import (PO / GRN / Bill / Items / Prices)', to: '/imports', icon: 'fas fa-file-excel' },
      { label: 'PO List', to: '/purchases/po', icon: 'fas fa-file-invoice' },
      { label: 'Create New PO', to: '/purchases/po/create', icon: 'fas fa-plus-circle' },
      { label: 'GRN — Inward', to: '/purchases/grn', icon: 'fas fa-truck-loading' },
      { label: 'New Purchase Entry', to: '/purchases/grn/new', icon: 'fas fa-cart-plus' },
      { label: 'Purchase Return', to: '/purchase-returns/create', icon: 'fas fa-undo' },
      { label: 'Debit Notes', to: '/purchase-returns', icon: 'fas fa-file-invoice' },
    ],
  },
  {
    label: 'Inventory',
    icon: 'fas fa-warehouse',
    color: '#a855f7', // Purple
    children: [
      { label: 'Expiry & Batches', to: '/inventory/expiry-dashboard', icon: 'fas fa-calendar-times' },
      { label: 'Expiry Control (Remove / Correct)', to: '/inventory/expiry-control', icon: 'fas fa-hourglass-half' },
      { label: 'Batch Master Register', to: '/inventory/batches', icon: 'fas fa-cubes' },
      { label: 'Stock Status', to: '/inventory/status', icon: 'fas fa-list' },
      { label: 'Rack / Location', to: '/masters/warehouse-racking', icon: 'fas fa-th-large' },
      { label: 'Stock Take / Audit', to: '/inventory/stock-take', icon: 'fas fa-boxes' },
      { label: 'Barcode Printing', to: '/inventory/barcode', icon: 'fas fa-barcode' },
      { label: 'Stock Transfer OUT', to: '/inventory/transfer/out', icon: 'fas fa-sign-out-alt' },
      { label: 'New Transfer Out', to: '/inventory/transfer/multi', icon: 'fas fa-plus-circle' },
      { label: 'Stock Transfer IN', to: '/inventory/transfer/in', icon: 'fas fa-sign-in-alt' },
      { label: 'Global Store Sync', to: '/inventory/sync', icon: 'fas fa-cloud-download-alt' },
      { label: 'Synchronization Monitor', to: '/inventory/monitor', icon: 'fas fa-satellite' },
    ],
  },
  {
    label: 'Logistics',
    icon: 'fas fa-truck',
    color: '#0ea5e9', // Sky
    children: [
      { label: 'Shipment List', to: '/logistics/list', icon: 'fas fa-list' },
      { label: 'New Transfer', to: '/logistics/new', icon: 'fas fa-plus-circle' },
    ],
  },
  {
    label: 'Accounts',
    icon: 'fas fa-calculator',
    color: '#f43f5e', // Rose
    children: [
      { label: 'Accounts Dashboard', to: '/accounts/dashboard', icon: 'fas fa-tachometer-alt' },
      { label: 'Cash Management', to: '/accounts/cash', icon: 'fas fa-wallet' },
      { label: 'Bill Entry (SPS)', to: '/accounts/bills', icon: 'fas fa-file-invoice-dollar' },
      { label: 'Supplier Payments', to: '/accounts/payments', icon: 'fas fa-money-check-alt' },
    ],
  },
  {
    label: 'Promotions',
    icon: 'fas fa-bullhorn',
    color: '#eab308', // Yellow
    children: [
      { label: 'Schemes', to: '/schemes', icon: 'fas fa-percent' },
      { label: 'Bulk Discount', to: '/bulk-pricing', icon: 'fas fa-tags' },
    ],
  },
  {
    label: 'Manufacturing',
    icon: 'fas fa-industry',
    color: '#4f46e5', // Indigo
    children: [
      { label: 'Plant Dashboard', to: '/manufacturing/plant', icon: 'fas fa-gauge-high' },
      { label: 'Customer Orders & Dispatch', to: '/manufacturing/customer-orders', icon: 'fas fa-file-signature' },
      { label: 'Material Planning & Shortages', to: '/manufacturing/material-planning', icon: 'fas fa-clipboard-check' },
      { label: 'Printing Job Work', to: '/manufacturing/printing', icon: 'fas fa-print' },
      { label: 'Production', to: '/manufacturing/production', icon: 'fas fa-industry' },
      { label: 'Department Stores', to: '/manufacturing/stores', icon: 'fas fa-warehouse' },
      { label: 'Stock Report', to: '/manufacturing/stock-report', icon: 'fas fa-chart-pie' },
      { label: 'Stock Take', to: '/manufacturing/stock-take', icon: 'fas fa-clipboard-list' },
      { label: 'Brands, Artwork & Specs', to: '/manufacturing/masters', icon: 'fas fa-palette' },
      { label: 'Mfg Reports', to: '/reports', icon: 'fas fa-chart-bar' },
      { label: 'Mfg Dashboard', to: '/manufacturing/dashboard', icon: 'fas fa-tachometer-alt' },
      { label: 'Plant Settings', to: '/manufacturing/settings', icon: 'fas fa-cogs' },
      { label: 'Bill of Materials', to: '/manufacturing/boms', icon: 'fas fa-layer-group' },
      { label: 'BOM Approvals', to: '/manufacturing/boms?status=DRAFT', icon: 'fas fa-check-double' },
      { label: 'Production Planning', to: '/manufacturing/planning', icon: 'fas fa-calendar-alt' },
      { label: 'Material Requirements', to: '/manufacturing/planning', icon: 'fas fa-boxes-stacked' },
      { label: 'Manufacturing Orders', to: '/manufacturing/orders', icon: 'fas fa-clipboard-list' },
      { label: 'Batch Traceability', to: '/manufacturing/traceability', icon: 'fas fa-sitemap' },
      { label: 'Production Reports', to: '/manufacturing/reports', icon: 'fas fa-chart-line' },
    ],
  },
  {
    label: 'HR & Payroll',
    icon: 'fas fa-users-cog',
    color: '#8b5cf6', // Violet
    children: [
      { label: 'HR Dashboard', to: '/hr/dashboard', icon: 'fas fa-tachometer-alt' },
      { label: 'Employee Master', to: '/hr/employees', icon: 'fas fa-users' },
      { label: 'Daily Attendance', to: '/hr/attendance', icon: 'fas fa-clock' },
      { label: 'Leave Requests', to: '/hr/leaves', icon: 'fas fa-calendar-times' },
      { label: 'Salary Slips', to: '/hr/salary', icon: 'fas fa-file-invoice-dollar' },
    ],
  },
  {
    label: 'Reports',
    icon: 'fas fa-chart-bar',
    color: '#84cc16', // Lime
    children: [
      { label: 'Report Center', to: '/reports/center', icon: 'fas fa-chart-pie' },
      { label: 'Sales Report', to: '/reports/sales', icon: 'fas fa-chart-line' },
      { label: 'Profit & Loss', to: '/reports/pl', icon: 'fas fa-balance-scale' },
      { label: 'Purchase Report', to: '/reports/purchases', icon: 'fas fa-shopping-cart' },
      { label: 'GST Report', to: '/reports/gst', icon: 'fas fa-receipt' },
      { label: 'Stock Report', to: '/reports/stock', icon: 'fas fa-cubes' },
      { label: 'Stock Ledger', to: '/reports/ledger', icon: 'fas fa-book' },
      { label: 'Stock as at Time', to: '/reports/stock-as-at', icon: 'fas fa-clock' },
      { label: 'Outstanding Dues', to: '/reports/outstanding', icon: 'fas fa-exclamation-triangle' },
      { label: 'Hourly Sales', to: '/reports/hourly', icon: 'fas fa-clock' },
      { label: 'Audit Logs', to: '/reports/audit-logs', icon: 'fas fa-history' },
    ],
  },
  {
    label: 'Online Shop',
    icon: 'fas fa-shopping-bag',
    color: '#10b981', // Emerald
    children: [
      { label: 'Shop Dashboard', to: '/admin/shop/dashboard', icon: 'fas fa-tachometer-alt' },
      { label: 'Shop Orders', to: '/admin/shop/orders', icon: 'fas fa-receipt' },
      { label: 'Shop Customers', to: '/admin/shop/customers', icon: 'fas fa-users' },
      { label: 'Sales Reports', to: '/admin/shop/reports', icon: 'fas fa-chart-line' },
      { label: 'Banner Settings', to: '/admin/shop/settings', icon: 'fas fa-images' },
    ],
  },
  {
    label: 'Settings',
    icon: 'fas fa-cog',
    color: '#94a3b8', // Slate
    children: [
      { label: 'Company Profile', to: '/settings/company', icon: 'fas fa-building' },
      { label: 'Users & Locations', to: '/settings/users', icon: 'fas fa-user-shield' },
      { label: 'Payment Modes', to: '/settings/payment-modes', icon: 'fas fa-wallet' },
      { label: 'Discount Control', to: '/settings/discounts', icon: 'fas fa-percent' },
      { label: 'PO E-mail (Outlook)', to: '/settings/po-email', icon: 'fas fa-envelope' },
      { label: 'Telegram Assistant', to: '/settings/telegram', icon: 'fab fa-telegram' },
      { label: 'Loyalty Programme', to: '/loyalty', icon: 'fas fa-gift' },
      { label: 'Dashboard Builder', to: '/settings/dashboard-builder', icon: 'fas fa-th-large' },
      { label: 'Theme & Styling', to: '/settings/theme', icon: 'fas fa-palette' },
      { label: 'System Help', to: '/help', icon: 'fas fa-question-circle' },
    ],
  },
];

const ALLOWED_SECTIONS = ALL_SECTIONS
  .map(sec => sec.children ? { ...sec, children: sec.children.filter(c => isAllowed(c.to)) } : sec)
  .filter(sec => sec.children ? sec.children.length > 0 : !!sec.to && isAllowed(sec.to));

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  isPinned: boolean;
  onPinToggle: () => void;
}

export default function Sidebar({ collapsed, onToggle, isPinned, onPinToggle }: SidebarProps) {
  const location = useLocation();
  const { canPath } = useMyAccess();   // hide menu entries the user has no 'view' permission for
  const NAV_SECTIONS = ALLOWED_SECTIONS
    .map(sec => sec.children ? { ...sec, children: sec.children.filter(c => canPath(c.to)) } : sec)
    .filter(sec => sec.children ? sec.children.length > 0 : !sec.to || canPath(sec.to));
  const { brand_name, logo_path, fetchSettings } = useBrandingStore();
  const user = useAuthStore((s) => s.user);
  const { logout } = useAuth();

  const [openGroups, setOpenGroups] = useState<string[]>([]);
  const [isHovered, setIsHovered] = useState(false);

  // Derived state for visual width
  // If collapsed manually, it stays w-0.
  // If not pinned, it stays 64px but expands to 240px on hover.
  const isExpanded = !collapsed && (isPinned || isHovered);
  const showFull = isExpanded;
  const isAutoHiding = !isPinned && !collapsed;

  useEffect(() => {
    fetchSettings();
    const active = NAV_SECTIONS.find(s => s.children?.some(c => location.pathname.startsWith(c.to)));
    if (active) setOpenGroups([active.label]);
  }, []);

  function toggleGroup(label: string) {
    setOpenGroups(prev => prev.includes(label) ? prev.filter(g => g !== label) : [...prev, label]);
  }

  return (
    <aside 
      id="app-sidebar"
      className={`sidebar flex flex-col h-screen transition-all duration-300 relative overflow-hidden ${collapsed ? 'w-0' : (isExpanded ? 'w-[248px]' : 'w-[64px]')}`}
      style={{ 
        minWidth: collapsed ? '0px' : (isExpanded ? '248px' : '64px'),
        zIndex: isAutoHiding && isHovered ? 100 : 50,
        position: isAutoHiding && isHovered ? 'absolute' : 'relative',
        left: 0,
        top: 0
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className={`${showFull ? 'w-[248px]' : 'w-[64px]'} flex flex-col h-full shrink-0 transition-all duration-300`}>
        {/* ── Brand Header ── */}
        <div className="h-[64px] flex items-center px-4 gap-3 shrink-0 border-b border-[var(--sb-rule)]">
          <div className="w-9 h-9 rounded-lg bg-[var(--sb-chip)] flex items-center justify-center shrink-0 overflow-hidden p-1 shadow-inner">
            <img 
              src={logo_path || "/nutribay_logo.svg"} 
              alt="NUTRIBAY" 
              className="w-full h-full object-contain" 
              onError={(e) => { e.currentTarget.src = "/nutribay_logo.svg"; }}
            />
          </div>
          
          {showFull && (
            <div className="min-w-0 flex-1 animate-in fade-in slide-in-from-left-2 duration-300">
              <p className="text-[var(--sb-strong)] text-[15px] font-bold tracking-tight m-0 leading-tight truncate" title={brand_name || 'nutribay'}>{brand_name || 'nutribay'}</p>
              <span className="block text-[11px] text-purple-200/60 font-medium leading-tight mt-0.5">Manufacturing ERP</span>
            </div>
          )}
          
          {showFull && (
            <div className="flex gap-1 animate-in fade-in duration-500">
              <button 
                onClick={onPinToggle}
                className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors ${isPinned ? 'bg-[var(--sb-hover)] text-[var(--sb-strong)]' : 'text-[var(--sb-muted)] hover:bg-[var(--sb-hover)] hover:text-[var(--sb-strong)]'}`}
                title={isPinned ? "Unpin Sidebar (Auto-Hide)" : "Pin Sidebar"}
                aria-label={isPinned ? "Unpin sidebar" : "Pin sidebar"}
              >
                <i className={`fas fa-thumbtack text-[11px] ${isPinned ? '' : '-rotate-45'}`}></i>
              </button>
              <button 
                onClick={onToggle}
                className="w-8 h-8 rounded-md flex items-center justify-center transition-colors text-[var(--sb-muted)] hover:bg-[var(--sb-hover)] hover:text-[var(--sb-strong)]"
                title="Close Sidebar"
                aria-label="Close sidebar"
              >
                <i className="fas fa-times text-[11px]"></i>
              </button>
            </div>
          )}
        </div>

        {/* ── Navigation ── */}
        <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-0.5 sidebar-scroll" aria-label="Main">
          {NAV_SECTIONS.map((section) => {
            const isOpen = openGroups.includes(section.label);
            const isGroupActive = section.children?.some(c => location.pathname.startsWith(c.to)) || (section.to && location.pathname === section.to);

            if (section.to) {
              return (
                <NavLink 
                  key={section.to}
                  to={section.to} 
                  title={!showFull ? section.label : ''}
                  className={({ isActive }) => `sidebar-item relative ${isActive ? 'active' : ''} ${!showFull ? 'justify-center px-0' : ''}`}
                >
                  <i className={`${section.icon} w-5 text-center text-[15px]`}></i>
                  {showFull && <span className="animate-in fade-in slide-in-from-left-1 duration-200">{section.label}</span>}
                </NavLink>
              );
            }

            return (
              <div key={section.label}>
                <button 
                  onClick={() => showFull && toggleGroup(section.label)}
                  className={`sidebar-item relative w-full ${isGroupActive ? 'active' : ''} ${!showFull ? 'justify-center px-0' : ''}`}
                  title={!showFull ? section.label : ''}
                  aria-expanded={showFull ? isOpen : undefined}
                >
                  <i className={`${section.icon} w-5 text-center text-[15px]`}></i>
                  {showFull && <span className="flex-1 text-left animate-in fade-in slide-in-from-left-1 duration-200">{section.label}</span>}
                  {showFull && <i className={`fas fa-chevron-${isOpen ? 'down' : 'right'} text-[10px] opacity-50`}></i>}
                </button>

                {showFull && isOpen && (
                  <div className="ml-[21px] pl-3 my-1 border-l border-[#1E313C] space-y-0.5">
                    {section.children?.map(child => (
                      <NavLink 
                        key={child.to} 
                        to={child.to} 
                        className={({ isActive: routeActive }) => { const [cp, cq] = child.to.split('?'); const isActive = routeActive && (cq ? location.search === '?' + cq : (cp !== '/products/list' || !location.search)); return `flex items-center h-[34px] px-2.5 rounded-md text-[13px] transition-colors ${isActive ? 'bg-[var(--sb-active)] text-[var(--sb-strong)] font-semibold' : 'text-[var(--sb-text)] hover:bg-[var(--sb-hover)] hover:text-[var(--sb-strong)]'}`; }}
                      >
                        <span className="truncate">{child.label}</span>
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* ── Footer ── */}
        <div className={`p-3 border-t border-[#1E313C] space-y-1 ${!showFull ? 'items-center flex flex-col' : ''}`}>
          <div className={`flex items-center gap-3 ${showFull ? 'px-2 py-2' : 'w-10 h-10 justify-center'}`} title={!showFull ? user?.name : ''}>
            <div className="w-8 h-8 rounded-full bg-[var(--sb-chip)] flex items-center justify-center text-[13px] font-semibold text-[var(--sb-strong)] shrink-0">
              {(user?.name || 'A').charAt(0).toUpperCase()}
            </div>
            {showFull && (
              <div className="min-w-0 flex-1 animate-in fade-in duration-300">
                <p className="text-[var(--sb-strong)] text-[13px] font-medium truncate m-0">{user?.name || 'Admin'}</p>
                <p className="text-[var(--sb-muted)] text-[12px] m-0 truncate">{user?.role || 'User'}</p>
              </div>
            )}
          </div>
          <button onClick={logout} className={`sidebar-item relative w-full hover:!text-[#b42318] ${!showFull ? 'justify-center px-0' : ''}`} title="Logout">
            <i className="fas fa-sign-out-alt w-5 text-center"></i>
            {showFull && <span className="animate-in fade-in duration-300">Logout</span>}
          </button>
        </div>
      </div>
    </aside>
  );
}

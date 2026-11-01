import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import AppLayout from './layouts/AppLayout';
import Login from './pages/auth/Login';
import Dashboard from './pages/dashboard/Dashboard';
import OwnerMobile from './pages/dashboard/OwnerMobile';
import MobileApp from './pages/mobile/MobileApp';
import ItemMaster from './pages/products/ItemMaster';
import ProductAdd from './pages/products/ProductAdd';
import ProductForm from './pages/products/ProductForm';
import ImportProducts from './pages/products/ImportProducts';
import Suppliers from './pages/masters/Suppliers';
import SupplierDetail from './pages/suppliers/SupplierDetail';
import VendorApprovals from './pages/suppliers/VendorApprovals';
import VendorRegistration from './pages/suppliers/VendorRegistration';
import VendorPortal from './pages/suppliers/VendorPortal';
import HsnMaster from './pages/masters/HsnMaster';
import InvoiceList from './pages/billing/InvoiceList';
import InvoiceCreate from './pages/billing/InvoiceCreate';
import InvoiceView from './pages/billing/InvoiceView';
import EstimateList from './pages/billing/EstimateList';
import EstimateCreate from './pages/billing/EstimateCreate';
import Purchases from './pages/purchases/Purchases';
import PurchaseEntry from './pages/purchases/PurchaseEntry';
import POList from './pages/purchases/POList';
import POCreate from './pages/purchases/POCreate';
import PODetail from './pages/purchases/PODetail';
import POGuestDetail from './pages/purchases/POGuestDetail';
import Inventory from './pages/inventory/Inventory';
import StockTakeList from './pages/inventory/StockTakeList';
import StockTakeCount from './pages/inventory/StockTakeCount';
import StockTakeView from './pages/inventory/StockTakeView';
import StockTakeVariancePrint from './pages/inventory/StockTakeVariancePrint';
import GRNPrint from './pages/purchases/GRNPrint';
import AccountsDashboard from './pages/accounts/AccountsDashboard';
import Payments from './pages/accounts/Payments';
import ReportCenter from './pages/reports/ReportCenter';
import SalesReport from './pages/reports/SalesReport';
import PurchaseReport from './pages/reports/PurchaseReport';
import StockReport from './pages/reports/StockReport';
import ProfitLossReport from './pages/reports/ProfitLossReport';
import GSTReport from './pages/reports/GSTReport';
import PaymentMatrix from './pages/reports/PaymentMatrix';
import OutstandingReport from './pages/reports/OutstandingReport';
import PaymentCollectionReport from './pages/reports/PaymentCollectionReport';
import HourlySalesReport from './pages/reports/HourlySalesReport';
import HierarchyReport from './pages/reports/HierarchyReport';
import StockLedgerReport from './pages/reports/StockLedgerReport';
import HsnMismatchReport from './pages/reports/HsnMismatchReport';
import HsnMappingReport from './pages/reports/HsnMappingReport';
import HsnExceptionReport from './pages/reports/HsnExceptionReport';
import TaxBreakupReport from './pages/reports/TaxBreakupReport';
import MasterPODistributionReport from './pages/reports/MasterPODistributionReport';
import EmployeeDirectory from './pages/hr/EmployeeDirectory';
import Attendance from './pages/hr/Attendance';
import HRDashboard from './pages/hr/HRDashboard';
import LeaveRequests from './pages/hr/LeaveRequests';
import SalarySlips from './pages/hr/SalarySlips';
import Customers from './pages/masters/Customers';
import Groups from './pages/masters/Groups';
import SubGroups from './pages/masters/SubGroups';
import Categories from './pages/masters/Categories';
import SubCategories from './pages/masters/SubCategories';
import Brands from './pages/masters/Brands';
import SubBrands from './pages/masters/SubBrands';
import Manufacturers from './pages/masters/Manufacturers';
import Units from './pages/masters/Units';
import GstMaster from './pages/masters/GstMaster';
import CountryMaster from './pages/masters/CountryMaster';
import OutletMaster from './pages/masters/OutletMaster';
import SubManufacturers from './pages/masters/SubManufacturers';
import Variants from './pages/masters/Variants';
import Flavours from './pages/masters/Flavours';
import ProductClassification from './pages/masters/ProductClassification';
import GlobalSync from './pages/inventory/GlobalSync';
import SyncMonitor from './pages/inventory/SyncMonitor';
import CompanySettings from './pages/settings/CompanySettings'
import WarehouseRacking from './pages/masters/WarehouseRacking';
import PutawayDashboard from './pages/wms/PutawayDashboard';
import GRNPutaway from './pages/wms/GRNPutaway';
import QuickScan from './pages/wms/QuickScan';
import ChannelPartners from './pages/masters/ChannelPartners';
import ChannelMarginReport from './pages/reports/ChannelMarginReport';
import LowMarginReport from './pages/reports/LowMarginReport';
import MarkdownItemReport from './pages/reports/MarkdownItemReport';
import ThemeSettings from './pages/settings/ThemeSettings';
import UserManagement from './pages/settings/UserManagement';
import DashboardBuilder from './pages/dashboard/DashboardBuilder';
import PortalHub from './pages/help/PortalHub';
import BillEntry from './pages/accounts/BillEntry';
import Schemes from './pages/promotions/Schemes';
import BulkDiscount from './pages/promotions/BulkDiscount';
import ProcessingDashboard from './pages/processing/ProcessingDashboard';
import ReceiveLot from './pages/processing/ReceiveLot';
import BOMRecipes from './pages/processing/BOMRecipes';
import ProductionBatches from './pages/processing/ProductionBatches';
import SystemHelp from './pages/help/SystemHelp';
import AuditLogReport from './pages/reports/AuditLogReport';
import LogisticList from './pages/logistics/LogisticList';
import LogisticTransferWizard from './pages/logistics/LogisticTransferWizard';
import ShopLayout from './layouts/ShopLayout';
import ShopHome from './pages/shop/ShopHome';
import Cart from './pages/shop/Cart';
import VendorPortalLogin from './pages/suppliers/VendorPortalLogin';
import VendorPortalActivate from './pages/suppliers/VendorPortalActivate';
import ShopDashboard from './pages/shop/ShopDashboard';
import ShopOrders from './pages/shop/ShopOrders';
import ShopCustomers from './pages/shop/ShopCustomers';
import ShopReports from './pages/shop/ShopReports';
import BannerManagement from './pages/shop/BannerManagement';
import { ThemeProvider } from './context/ThemeContext';

// Nutribray Manufacturing Module
import ManufacturingDashboard from './pages/manufacturing/ManufacturingDashboard';
import ManufacturingSettings from './pages/manufacturing/ManufacturingSettings';
import BomList from './pages/manufacturing/BomList';
import ProductionPlanning from './pages/manufacturing/ProductionPlanning';
import ManufacturingOrdersList from './pages/manufacturing/ManufacturingOrdersList';
import ManufacturingOrderDetail from './pages/manufacturing/ManufacturingOrderDetail';
import BatchTraceabilityPage from './pages/manufacturing/BatchTraceabilityPage';
import ManufacturingReportsPage from './pages/manufacturing/ManufacturingReportsPage';
import MfgMasters from './pages/manufacturing/MfgMasters';
import MfgStores from './pages/manufacturing/MfgStores';
import MfgPrinting from './pages/manufacturing/MfgPrinting';
import MfgProduction from './pages/manufacturing/MfgProduction';
import MfgCustomerOrders from './pages/manufacturing/MfgCustomerOrders';
import MfgPlantDashboard from './pages/manufacturing/MfgPlantDashboard';
import MfgPlanning from './pages/manufacturing/MfgPlanning';
import MfgStockTake from './pages/manufacturing/MfgStockTake';
import MfgStockReport from './pages/manufacturing/MfgStockReport';
import Approvals from './pages/retail/Approvals';
import ExpiryControl from './pages/retail/Expiry';
import PaymentModes from './pages/retail/PaymentModes';
import HeadOffice from './pages/retail/HeadOffice';
import Loyalty from './pages/retail/Loyalty';
import DiscountPolicy from './pages/retail/DiscountPolicy';
import ExcelImport from './pages/retail/ExcelImport';
import { PoEmailSettings } from './pages/retail/purchaseControls';
import TelegramAssistant from './pages/settings/TelegramAssistant';

// Placeholder components for other modules
const Masters = () => <div className="h-96 flex items-center justify-center border-2 border-dashed border-slate-300 rounded-xl text-slate-400">Masters Module (Phase 3)</div>;
const Estimates = () => <div className="h-96 flex items-center justify-center border-2 border-dashed border-slate-300 rounded-xl text-slate-400">Estimates Module</div>;

const App = () => {
  return (
    <ThemeProvider>
      <Router>
        <Toaster position="top-right" />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/vendor/login" element={<VendorPortalLogin />} />
          <Route path="/vendor/activate/:token" element={<VendorPortalActivate />} />
          <Route path="/vendor/reset-password/:token" element={<VendorPortalActivate />} />
          <Route path="/vendor-registration/:token" element={<VendorRegistration />} />
          <Route path="/vendor-portal" element={<VendorPortal />} />
          <Route path="/portal/vendor" element={<VendorPortal />} />
          <Route path="/po/guest/:id" element={<POGuestDetail />} />
          <Route path="/inventory/stock-take/variance-print/:id" element={<StockTakeVariancePrint />} />
          <Route path="/purchases/grn/print/:id" element={<GRNPrint />} />
          <Route path="/grn/print/:id" element={<GRNPrint />} />
          
          {/* Owner phone view (installable) */}
          <Route path="/owner" element={<OwnerMobile />} />
          <Route path="/m" element={<MobileApp />} />

          {/* HHT / Mobile WMS Routes */}
          <Route path="/hht" element={<PutawayDashboard />} />
          <Route path="/hht/putaway/:grnId" element={<GRNPutaway />} />
          <Route path="/hht/quick-scan" element={<QuickScan />} />
          
          {/* Consumer Shop Routes */}
          <Route path="/shop" element={<ShopLayout />}>
            <Route index element={<ShopHome />} />
            <Route path="cart" element={<Cart />} />
          </Route>
          
          <Route path="/" element={<AppLayout />}>
            <Route index element={<Navigate to="/manufacturing/plant" replace />} />
            <Route path="dashboard" element={<Dashboard />} />
            
            {/* Products & Masters */}
            <Route path="products/item-master" element={<ItemMaster />} />
            <Route path="products/add" element={<ProductAdd />} />
            <Route path="products/edit/:id" element={<ProductAdd />} />
            <Route path="products/list" element={<ItemMaster />} />
            <Route path="products/import" element={<ImportProducts />} />
            
            <Route path="masters/suppliers" element={<Suppliers />} />
            <Route path="masters/suppliers/:id" element={<SupplierDetail />} />
            <Route path="masters/suppliers/approvals" element={<VendorApprovals />} />
            <Route path="portal/vendor" element={<VendorPortal />} />
            <Route path="vendor/register" element={<VendorRegistration />} />
            <Route path="masters/customers" element={<Customers />} />
            <Route path="masters/groups" element={<Groups />} />
            <Route path="masters/subgroups" element={<SubGroups />} />
            <Route path="masters/categories" element={<Categories />} />
            <Route path="masters/subcategories" element={<SubCategories />} />
            <Route path="masters/brands" element={<Brands />} />
            <Route path="masters/subbrands" element={<SubBrands />} />
            <Route path="masters/manufacturers" element={<Manufacturers />} />
            <Route path="masters/submanufacturers" element={<SubManufacturers />} />
            <Route path="masters/variants" element={<Variants />} />
            <Route path="masters/flavours" element={<Flavours />} />
            <Route path="masters/classification" element={<ProductClassification />} />
            <Route path="masters/units" element={<Units />} />
            <Route path="masters/gst" element={<GstMaster />} />
            <Route path="masters/countries" element={<CountryMaster />} />
            <Route path="masters/outlets" element={<OutletMaster />} />
            <Route path="masters/hsn" element={<HsnMaster />} />
            <Route path="masters/warehouse-racking" element={<WarehouseRacking />} />
            <Route path="masters/channels" element={<ChannelPartners />} />
            <Route path="masters/*" element={<Masters />} />
            
            {/* Settings */}
            <Route path="settings/company" element={<CompanySettings />} />
            <Route path="settings/theme" element={<ThemeSettings />} />
            <Route path="settings/users" element={<UserManagement />} />
            <Route path="settings/dashboard-builder" element={<DashboardBuilder />} />
            <Route path="help" element={<SystemHelp />} />
            <Route path="portals" element={<PortalHub />} />
            <Route path="reports/audit-logs" element={<AuditLogReport />} />
            
            {/* Billing & Estimates */}
            <Route path="billing/invoices" element={<InvoiceList />} />
            <Route path="billing/invoices/:id" element={<InvoiceView />} />
            <Route path="billing/invoices/new" element={<InvoiceCreate />} />
            <Route path="billing/estimates" element={<EstimateList />} />
            <Route path="billing/estimates/new" element={<EstimateCreate />} />
            <Route path="estimates/*" element={<Estimates />} />
            
            {/* Purchases & Inventory */}
            <Route path="purchases/list" element={<Purchases />} />
            <Route path="purchases/grn" element={<Purchases />} />
            <Route path="purchases/grn/new" element={<PurchaseEntry />} />
            <Route path="purchases/grn/:id" element={<Purchases />} />
            <Route path="purchases/po" element={<POList />} />
            <Route path="purchases/po/create" element={<POCreate />} />
            <Route path="purchases/po/edit/:id" element={<POCreate />} />
            <Route path="purchases/po/:id" element={<PODetail />} />
            <Route path="purchases/*" element={<Purchases />} />
            <Route path="inventory/status" element={<Inventory />} />
            <Route path="inventory/sync" element={<GlobalSync />} />
            <Route path="inventory/monitor" element={<SyncMonitor />} />
            <Route path="inventory/stock-take" element={<StockTakeList />} />
            <Route path="inventory/audit" element={<StockTakeList />} />
            <Route path="inventory/stock-take/count/:id" element={<StockTakeCount />} />
            <Route path="inventory/stock-take/view/:id" element={<StockTakeView />} />
            <Route path="inventory/*" element={<Inventory />} />
            
            {/* Logistics */}
            <Route path="logistics/list" element={<LogisticList />} />
            <Route path="logistics/new" element={<LogisticTransferWizard />} />
            <Route path="logistics/transfer/:id" element={<LogisticTransferWizard />} />
            
            {/* Accounts & Payments */}
            <Route path="accounts/dashboard" element={<AccountsDashboard />} />
            <Route path="accounts/bills" element={<BillEntry />} />
            <Route path="accounts/payments" element={<Payments />} />
            <Route path="accounts/*" element={<AccountsDashboard />} />
            
            {/* Reports Suite — all 10 active */}
            <Route path="reports/center"      element={<ReportCenter />} />
            <Route path="reports/sales"       element={<SalesReport />} />
            <Route path="reports/purchases"   element={<PurchaseReport />} />
            <Route path="reports/stock"       element={<StockReport />} />
            <Route path="reports/pl"          element={<ProfitLossReport />} />
            <Route path="reports/gst"         element={<GSTReport />} />
            <Route path="reports/payments-matrix" element={<PaymentMatrix />} />
            <Route path="reports/outstanding" element={<OutstandingReport />} />
            <Route path="reports/payments"    element={<PaymentCollectionReport />} />
            <Route path="reports/hourly"      element={<HourlySalesReport />} />
            <Route path="reports/hierarchy"   element={<HierarchyReport />} />
            <Route path="reports/ledger"      element={<StockReport />} />
            <Route path="reports/hsn-mismatch" element={<HsnMismatchReport />} />
            <Route path="reports/hsn-mapping" element={<HsnMappingReport />} />
            <Route path="reports/hsn-exceptions" element={<HsnExceptionReport />} />
            <Route path="reports/channel-margin" element={<ChannelMarginReport />} />
            <Route path="reports/low-margin" element={<LowMarginReport />} />
            <Route path="reports/markdown-items" element={<MarkdownItemReport />} />
            <Route path="reports/tax-breakup" element={<TaxBreakupReport />} />
            <Route path="reports/master-po"   element={<MasterPODistributionReport />} />
            <Route path="reports/*"           element={<ReportCenter />} />
            
            {/* Shop Admin */}
            <Route path="admin/shop/dashboard" element={<ShopDashboard />} />
            <Route path="admin/shop/orders" element={<ShopOrders />} />
            <Route path="admin/shop/customers" element={<ShopCustomers />} />
            <Route path="admin/shop/reports" element={<ShopReports />} />
            <Route path="admin/shop/settings" element={<BannerManagement />} />
            
            {/* HR & Payroll */}
            <Route path="hr/dashboard" element={<HRDashboard />} />
            <Route path="hr/employees" element={<EmployeeDirectory />} />
            <Route path="hr/attendance" element={<Attendance />} />
            <Route path="hr/leaves" element={<LeaveRequests />} />
            <Route path="hr/salary" element={<SalarySlips />} />
            <Route path="hr/*" element={<HRDashboard />} />

            {/* Promotions */}
            <Route path="schemes" element={<Schemes />} />
            <Route path="bulk-pricing" element={<BulkDiscount />} />

            {/* Legacy Processing redirects to Nutribray Manufacturing */}
            <Route path="processing" element={<Navigate to="/manufacturing/dashboard" replace />} />
            <Route path="processing/receive" element={<Navigate to="/purchases/grn" replace />} />
            <Route path="production/recipes" element={<Navigate to="/manufacturing/boms" replace />} />
            <Route path="production/batches" element={<Navigate to="/manufacturing/orders" replace />} />

            {/* Nutribray Manufacturing */}
            <Route path="manufacturing/dashboard" element={<ManufacturingDashboard />} />
            <Route path="manufacturing/settings" element={<ManufacturingSettings />} />
            <Route path="manufacturing/boms" element={<BomList />} />
            <Route path="manufacturing/planning" element={<ProductionPlanning />} />
            <Route path="manufacturing/orders" element={<ManufacturingOrdersList />} />
            <Route path="manufacturing/orders/:id" element={<ManufacturingOrderDetail />} />
            <Route path="manufacturing/traceability" element={<BatchTraceabilityPage />} />
            <Route path="manufacturing/reports" element={<ManufacturingReportsPage />} />
            <Route path="manufacturing/masters" element={<MfgMasters />} />
            <Route path="manufacturing/stores" element={<MfgStores />} />
            <Route path="manufacturing/stock-take" element={<MfgStockTake />} />
            <Route path="manufacturing/stock-report" element={<MfgStockReport />} />
            <Route path="manufacturing/printing" element={<MfgPrinting />} />
            <Route path="manufacturing/production" element={<MfgProduction />} />
            <Route path="manufacturing/customer-orders" element={<MfgCustomerOrders />} />
            <Route path="manufacturing/plant" element={<MfgPlantDashboard />} />
            <Route path="manufacturing/material-planning" element={<MfgPlanning />} />
            <Route path="approvals" element={<Approvals />} />
            <Route path="inventory/expiry-control" element={<ExpiryControl />} />
            <Route path="settings/payment-modes" element={<PaymentModes />} />
            <Route path="ho-dashboard" element={<HeadOffice />} />
            <Route path="loyalty" element={<Loyalty />} />
            <Route path="settings/discounts" element={<DiscountPolicy />} />
            <Route path="settings/po-email" element={<PoEmailSettings />} />
            <Route path="settings/telegram" element={<TelegramAssistant />} />
            <Route path="imports" element={<ExcelImport />} />

            {/* Any other path: keep the shell; TabbedOutlet renders it from routes/config.tsx */}
            <Route path="*" element={null} />
          </Route>
        </Routes>
      </Router>
    </ThemeProvider>
  );
};

export default App;

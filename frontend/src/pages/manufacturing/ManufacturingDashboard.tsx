import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { manufacturingApi, type MfgDashboardData, type MfgOrder } from '../../api/manufacturing';

const STATUS_STYLE: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-700 border-slate-300',
  APPROVED: 'bg-blue-100 text-blue-800 border-blue-300',
  MATERIALS_RESERVED: 'bg-amber-100 text-amber-800 border-amber-300',
  MATERIALS_ISSUED: 'bg-purple-100 text-purple-800 border-purple-300',
  IN_PRODUCTION: 'bg-indigo-100 text-indigo-800 border-indigo-300',
  QC_PENDING: 'bg-orange-100 text-orange-800 border-orange-300',
  COMPLETED: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  CANCELLED: 'bg-rose-100 text-rose-700 border-rose-300',
};

const QC_STYLE: Record<string, string> = {
  PENDING: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  RELEASED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  REJECTED: 'bg-rose-50 text-rose-700 border-rose-200',
  QUARANTINED: 'bg-purple-50 text-purple-700 border-purple-200',
};

export default function ManufacturingDashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState<MfgDashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchDashboard = () => {
    setLoading(true);
    manufacturingApi
      .getDashboard()
      .then((res) => setData(res.data))
      .catch((err) => console.error('Failed to load mfg dashboard', err))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchDashboard();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12 text-slate-500">
        <i className="fas fa-spinner fa-spin text-2xl mr-3 text-indigo-600" />
        <span>Loading Nutribray Manufacturing Intelligence...</span>
      </div>
    );
  }

  const stats = data?.stats || {
    active_orders: 0,
    completed_orders: 0,
    pending_qc: 0,
    approved_boms: 0,
    critical_shortages: 0,
    rm_stock_alerts: 0,
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-3">
            <span className="p-2.5 bg-gradient-to-br from-indigo-600 to-purple-700 text-white rounded-xl shadow-sm">
              <i className="fas fa-industry text-xl" />
            </span>
            <div>
              <h1 className="text-2xl font-black text-slate-800 tracking-tight">
                Nutribray Manufacturing Control Center
              </h1>
              <p className="text-xs text-slate-500 font-medium">
                Integrated Plant Operations • Formulation BOMs • Production Scheduling • FEFO Traceability • Quality Release
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/manufacturing/orders')}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold text-xs flex items-center gap-2 shadow-sm transition"
          >
            <i className="fas fa-plus-circle" /> New Production Order
          </button>
          <button
            onClick={() => navigate('/manufacturing/boms')}
            className="px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-lg font-semibold text-xs flex items-center gap-2 shadow-sm transition"
          >
            <i className="fas fa-scroll" /> Bill of Materials
          </button>
          <button
            onClick={fetchDashboard}
            title="Refresh"
            className="p-2 bg-white hover:bg-slate-50 text-slate-600 border border-slate-300 rounded-lg text-xs shadow-sm transition"
          >
            <i className="fas fa-sync-alt" />
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <div
          onClick={() => navigate('/manufacturing/orders?status=IN_PRODUCTION')}
          className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm hover:border-indigo-400 cursor-pointer transition"
        >
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-[11px] font-bold">Active Orders</span>
            <span className="p-1.5 bg-indigo-50 text-indigo-600 rounded-md">
              <i className="fas fa-cogs text-xs" />
            </span>
          </div>
          <div className="text-2xl font-black text-slate-800">{stats.active_orders}</div>
          <p className="text-[10px] text-slate-400 mt-1">In progress on floor</p>
        </div>

        <div
          onClick={() => navigate('/manufacturing/orders?status=COMPLETED')}
          className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm hover:border-emerald-400 cursor-pointer transition"
        >
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-[11px] font-bold">Completed</span>
            <span className="p-1.5 bg-emerald-50 text-emerald-600 rounded-md">
              <i className="fas fa-check-circle text-xs" />
            </span>
          </div>
          <div className="text-2xl font-black text-emerald-700">{stats.completed_orders}</div>
          <p className="text-[10px] text-slate-400 mt-1">Posted to FG store</p>
        </div>

        <div
          onClick={() => navigate('/manufacturing/orders?status=QC_PENDING')}
          className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm hover:border-amber-400 cursor-pointer transition"
        >
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-[11px] font-bold">Pending QC</span>
            <span className="p-1.5 bg-amber-50 text-amber-600 rounded-md">
              <i className="fas fa-microscope text-xs" />
            </span>
          </div>
          <div className="text-2xl font-black text-amber-700">{stats.pending_qc}</div>
          <p className="text-[10px] text-slate-400 mt-1">Quarantine gate hold</p>
        </div>

        <div
          onClick={() => navigate('/manufacturing/boms')}
          className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm hover:border-blue-400 cursor-pointer transition"
        >
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-[11px] font-bold">Approved BOMs</span>
            <span className="p-1.5 bg-blue-50 text-blue-600 rounded-md">
              <i className="fas fa-layer-group text-xs" />
            </span>
          </div>
          <div className="text-2xl font-black text-blue-800">{stats.approved_boms}</div>
          <p className="text-[10px] text-slate-400 mt-1">Active formulations</p>
        </div>

        <div
          onClick={() => navigate('/manufacturing/planning')}
          className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm hover:border-rose-400 cursor-pointer transition"
        >
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-[11px] font-bold">Shortages</span>
            <span className="p-1.5 bg-rose-50 text-rose-600 rounded-md">
              <i className="fas fa-exclamation-triangle text-xs" />
            </span>
          </div>
          <div className="text-2xl font-black text-rose-600">{stats.critical_shortages}</div>
          <p className="text-[10px] text-slate-400 mt-1">Shortage items pending PO</p>
        </div>

        <div
          onClick={() => navigate('/manufacturing/traceability')}
          className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm hover:border-purple-400 cursor-pointer transition"
        >
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-[11px] font-bold">Genealogy</span>
            <span className="p-1.5 bg-purple-50 text-purple-600 rounded-md">
              <i className="fas fa-bezier-curve text-xs" />
            </span>
          </div>
          <div className="text-2xl font-black text-purple-700">100%</div>
          <p className="text-[10px] text-slate-400 mt-1">Forward / Backward FEFO</p>
        </div>
      </div>

      {/* Main Grid: Orders & Shortages */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Manufacturing Orders (2 Cols) */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
            <div className="flex items-center gap-2">
              <i className="fas fa-clipboard-list text-indigo-600 text-sm" />
              <h2 className="font-bold text-slate-800 text-sm">Recent Manufacturing Orders</h2>
            </div>
            <button
              onClick={() => navigate('/manufacturing/orders')}
              className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold"
            >
              View All Orders →
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 text-slate-500 font-bold text-[10px] border-b border-slate-200">
                  <th className="py-2.5 px-3">Order No</th>
                  <th className="py-2.5 px-3">Product / SKU</th>
                  <th className="py-2.5 px-3 text-right">Planned Qty</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3">QC Status</th>
                  <th className="py-2.5 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(!data?.recent_orders || data.recent_orders.length === 0) ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-400">
                      No manufacturing orders found.
                    </td>
                  </tr>
                ) : (
                  data.recent_orders.map((o: MfgOrder) => (
                    <tr key={o.id} className="hover:bg-indigo-50/30 transition">
                      <td className="py-2.5 px-3 font-mono font-bold text-indigo-600">
                        {o.order_no}
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="font-semibold text-slate-800">{o.product_name || `Item #${o.product_id}`}</div>
                        <div className="text-[10px] text-slate-400 font-mono">{o.item_code}</div>
                      </td>
                      <td className="py-2.5 px-3 text-right font-semibold text-slate-700">
                        {Number(o.planned_qty).toLocaleString()} {o.unit}
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                            STATUS_STYLE[o.status] || 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {o.status.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                            QC_STYLE[o.qc_status] || 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {o.qc_status}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <button
                          onClick={() => navigate(`/manufacturing/orders/${o.id}`)}
                          className="px-2.5 py-1 bg-slate-100 hover:bg-indigo-600 hover:text-white rounded text-[11px] font-semibold text-slate-700 transition"
                        >
                          Workbench →
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Low Stock Raw Materials Alert (1 Col) */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
          <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
            <div className="flex items-center gap-2">
              <i className="fas fa-boxes text-rose-500 text-sm" />
              <h2 className="font-bold text-slate-800 text-sm">Material Inventory & Alerts</h2>
            </div>
            <button
              onClick={() => navigate('/manufacturing/planning')}
              className="text-xs text-rose-600 hover:text-rose-800 font-semibold"
            >
              Shortage Matrix →
            </button>
          </div>

          <div className="overflow-y-auto max-h-[380px] p-2 space-y-2">
            {(!data?.low_stock_raw_materials || data.low_stock_raw_materials.length === 0) ? (
              <div className="p-8 text-center text-slate-400 text-xs">
                All raw materials and packaging have adequate stock buffers.
              </div>
            ) : (
              data.low_stock_raw_materials.map((m) => {
                const isShort = m.available_stock <= 0;
                return (
                  <div
                    key={m.id}
                    className={`p-3 rounded-lg border text-xs flex items-center justify-between ${
                      isShort
                        ? 'bg-rose-50/50 border-rose-200'
                        : 'bg-slate-50 border-slate-200'
                    }`}
                  >
                    <div>
                      <div className="font-semibold text-slate-800">{m.name}</div>
                      <div className="text-[10px] text-slate-400 font-mono">{m.item_code}</div>
                      <div className="text-[10px] text-slate-500 mt-1">
                        Physical: <span className="font-semibold">{Number(m.current_stock).toFixed(1)}</span> |
                        Reserved: <span className="text-amber-600 font-semibold">{Number(m.reserved_stock).toFixed(1)}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div
                        className={`text-sm font-black ${
                          isShort ? 'text-rose-600' : 'text-slate-700'
                        }`}
                      >
                        {Number(m.available_stock).toFixed(1)} {m.unit}
                      </div>
                      <span
                        className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-bold mt-1 ${
                          isShort
                            ? 'bg-rose-100 text-rose-800'
                            : 'bg-emerald-100 text-emerald-800'
                        }`}
                      >
                        {isShort ? 'DEFICIT' : 'AVAILABLE'}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="p-3 bg-slate-50 border-t border-slate-200 mt-auto">
            <button
              onClick={() => navigate('/purchases/po/create')}
              className="w-full py-1.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded font-semibold text-xs flex items-center justify-center gap-2 transition"
            >
              <i className="fas fa-cart-plus text-indigo-600" /> Create Material Purchase Order
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

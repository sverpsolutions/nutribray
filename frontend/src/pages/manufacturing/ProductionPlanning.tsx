import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import {
  manufacturingApi,
  type MfgOrder,
  type MaterialRequirementPlan,
} from '../../api/manufacturing';

export default function ProductionPlanning() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const orderIdParam = searchParams.get('order_id');

  const [orders, setOrders] = useState<MfgOrder[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<number>(
    orderIdParam ? Number(orderIdParam) : 0
  );
  const [plan, setPlan] = useState<MaterialRequirementPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [generatingPo, setGeneratingPo] = useState(false);

  useEffect(() => {
    manufacturingApi
      .getOrders()
      .then((res) => {
        setOrders(res.data);
        if (!selectedOrderId && res.data.length > 0) {
          const firstPending = res.data.find(
            (o) => o.status === 'APPROVED' || o.status === 'DRAFT'
          );
          if (firstPending) setSelectedOrderId(firstPending.id);
          else setSelectedOrderId(res.data[0].id);
        }
      })
      .catch((err) => console.error(err));
  }, []);

  useEffect(() => {
    if (selectedOrderId) {
      loadPlan(selectedOrderId);
    }
  }, [selectedOrderId]);

  const loadPlan = (id: number) => {
    setLoading(true);
    manufacturingApi
      .planOrder(id)
      .then((res) => setPlan(res.data))
      .catch((err) => {
        console.error(err);
        toast.error('Failed to calculate material plan');
      })
      .finally(() => setLoading(false));
  };

  const handleCreateShortagePo = async () => {
    if (!plan || !plan.has_shortage) {
      toast('No material shortages detected for this order');
      return;
    }

    const shortageItems = plan.items
      .filter((it) => it.is_shortage)
      .map((it) => ({
        product_id: it.product_id,
        qty: it.shortage_qty,
        rate: 100, // standard default
      }));

    if (shortageItems.length === 0) return;

    setGeneratingPo(true);
    try {
      const res = await manufacturingApi.createShortagePo(plan.order_id, {
        items: shortageItems,
      });
      toast.success(res.data.message || `PO #${res.data.po_number} generated!`);
      // Refresh plan
      loadPlan(plan.order_id);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Failed to create Shortage PO');
    } finally {
      setGeneratingPo(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h1 className="text-xl font-black text-slate-800 flex items-center gap-2">
            <span className="p-2 bg-rose-600 text-white rounded-lg">
              <i className="fas fa-boxes-stacked text-sm" />
            </span>
            Production Planning & Material Shortage Matrix
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            BOM material explosion, FEFO batch availability, stock reservation balance, and procurement shortage linkage.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {plan?.has_shortage && (
            <button
              onClick={handleCreateShortagePo}
              disabled={generatingPo}
              className="px-4 py-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white rounded-lg font-bold text-xs flex items-center gap-2 shadow-sm transition"
            >
              {generatingPo ? (
                <i className="fas fa-spinner fa-spin" />
              ) : (
                <i className="fas fa-cart-arrow-down" />
              )}
              Generate Shortage PO ({plan.total_shortage_items} items)
            </button>
          )}

          {selectedOrderId > 0 && (
            <button
              onClick={() => navigate(`/manufacturing/orders/${selectedOrderId}`)}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold text-xs flex items-center gap-2 shadow-sm transition"
            >
              <i className="fas fa-external-link-alt" /> Open MO Workbench
            </button>
          )}
        </div>
      </div>

      {/* Order Selector */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="w-full md:w-1/2">
          <label className="block text-xs font-bold text-slate-700 mb-1">
            Select Manufacturing Order to Explode BOM Requirements:
          </label>
          <select
            value={selectedOrderId}
            onChange={(e) => setSelectedOrderId(Number(e.target.value))}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {orders.map((o) => (
              <option key={o.id} value={o.id}>
                {o.order_no} — {o.product_name} ({Number(o.planned_qty)} {o.unit}) [{o.status}]
              </option>
            ))}
          </select>
        </div>

        {plan && (
          <div className="flex items-center gap-6 text-xs">
            <div>
              <span className="text-slate-400 block text-[10px] font-bold">Planned Qty</span>
              <span className="font-bold font-mono text-slate-800 text-sm">
                {plan.planned_qty} {plan.unit}
              </span>
            </div>
            <div>
              <span className="text-slate-400 block text-[10px] font-bold">Shortage Status</span>
              {plan.has_shortage ? (
                <span className="inline-flex items-center gap-1 text-rose-600 font-black">
                  <i className="fas fa-exclamation-triangle" /> {plan.total_shortage_items} Critical Shortages
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-emerald-600 font-black">
                  <i className="fas fa-check-circle" /> 100% Stock Available
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Material Matrix Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 text-slate-500 font-bold text-[10px] border-b border-slate-200">
                <th className="py-3 px-3">Item / Material</th>
                <th className="py-3 px-3">Type</th>
                <th className="py-3 px-3 text-right">Required Qty</th>
                <th className="py-3 px-3 text-right">Available Stock</th>
                <th className="py-3 px-3 text-right">Reserved Stock</th>
                <th className="py-3 px-3 text-right">Shortage Deficit</th>
                <th className="py-3 px-3">Eligible FEFO Batches</th>
                <th className="py-3 px-3 text-center">Procurement Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    <i className="fas fa-spinner fa-spin mr-2" /> Calculating Material Explosion...
                  </td>
                </tr>
              ) : !plan || plan.items.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    No items found for this manufacturing plan.
                  </td>
                </tr>
              ) : (
                plan.items.map((it) => (
                  <tr
                    key={it.product_id}
                    className={`hover:bg-slate-50 transition ${
                      it.is_shortage ? 'bg-rose-50/20' : ''
                    }`}
                  >
                    <td className="py-3 px-3">
                      <div className="font-bold text-slate-800">{it.product_name}</div>
                      <div className="text-[10px] text-slate-400 font-mono">{it.item_code}</div>
                    </td>
                    <td className="py-3 px-3">
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700">
                        {it.material_type}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right font-mono font-bold text-slate-800">
                      {Number(it.required_qty).toFixed(2)} {it.unit}
                    </td>
                    <td className="py-3 px-3 text-right font-mono font-semibold text-slate-700">
                      {Number(it.available_stock).toFixed(2)} {it.unit}
                    </td>
                    <td className="py-3 px-3 text-right font-mono text-amber-600">
                      {Number(it.reserved_qty).toFixed(2)} {it.unit}
                    </td>
                    <td className="py-3 px-3 text-right font-mono font-black">
                      {it.is_shortage ? (
                        <span className="text-rose-600">
                          -{Number(it.shortage_qty).toFixed(2)} {it.unit}
                        </span>
                      ) : (
                        <span className="text-emerald-600">0.00</span>
                      )}
                    </td>
                    <td className="py-3 px-3">
                      <div className="flex flex-wrap gap-1 max-w-xs">
                        {it.eligible_batches.length === 0 ? (
                          <span className="text-slate-400 text-[10px] italic">No active batches</span>
                        ) : (
                          it.eligible_batches.map((b) => (
                            <span
                              key={b.batch_id}
                              className="px-1.5 py-0.5 bg-indigo-50 border border-indigo-200 rounded text-[9px] font-mono text-indigo-800"
                              title={`Avail: ${b.available_qty} | Exp: ${b.expiry_date || 'N/A'}`}
                            >
                              {b.batch_no} ({b.available_qty})
                            </span>
                          ))
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-3 text-center">
                      {it.is_shortage ? (
                        <span className="px-2 py-1 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-300">
                          CRITICAL SHORTAGE
                        </span>
                      ) : (
                        <span className="px-2 py-1 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                          IN STOCK
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

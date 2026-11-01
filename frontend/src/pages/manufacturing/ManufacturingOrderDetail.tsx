import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import {
  manufacturingApi,
  type MfgOrder,
  type MaterialRequirementPlan,
  type MfgOrderItem,
  type MfgOrderBatch,
  type MfgOrderOutput,
} from '../../api/manufacturing';
import Modal from '../../components/ui/Modal';

const STATUS_BADGE: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-700 border-slate-300',
  APPROVED: 'bg-blue-100 text-blue-800 border-blue-300',
  MATERIALS_RESERVED: 'bg-amber-100 text-amber-800 border-amber-300',
  MATERIALS_ISSUED: 'bg-purple-100 text-purple-800 border-purple-300',
  IN_PRODUCTION: 'bg-indigo-100 text-indigo-800 border-indigo-300',
  QC_PENDING: 'bg-orange-100 text-orange-800 border-orange-300',
  COMPLETED: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  CANCELLED: 'bg-rose-100 text-rose-700 border-rose-300',
};

const QC_BADGE: Record<string, string> = {
  PENDING: 'bg-yellow-50 text-yellow-700 border-yellow-300',
  RELEASED: 'bg-emerald-50 text-emerald-700 border-emerald-300',
  REJECTED: 'bg-rose-50 text-rose-700 border-rose-300',
  QUARANTINED: 'bg-purple-50 text-purple-700 border-purple-300',
};

export default function ManufacturingOrderDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const orderId = Number(id);

  const [order, setOrder] = useState<MfgOrder | null>(null);
  const [plan, setPlan] = useState<MaterialRequirementPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'plan' | 'batches' | 'consumption' | 'output'>('plan');

  // Modals
  const [outputModalOpen, setOutputModalOpen] = useState(false);
  const [qcModalOpen, setQcModalOpen] = useState(false);
  const [selectedOutput, setSelectedOutput] = useState<MfgOrderOutput | null>(null);

  // Form states for Output
  const [outputGoodQty, setOutputGoodQty] = useState<number>(0);
  const [outputRejQty, setOutputRejQty] = useState<number>(0);
  const [outputScrapQty, setOutputScrapQty] = useState<number>(0);
  const [outputBatchNo, setOutputBatchNo] = useState('');
  const [outputMfgDate, setOutputMfgDate] = useState(new Date().toISOString().split('T')[0]);
  const [outputExpDate, setOutputExpDate] = useState(
    new Date(Date.now() + 86400000 * 270).toISOString().split('T')[0]
  );
  const [outputNotes, setOutputNotes] = useState('');

  // Form states for QC Release
  const [qcDecision, setQcDecision] = useState<'RELEASED' | 'REJECTED' | 'QUARANTINED'>('RELEASED');
  const [qcNotes, setQcNotes] = useState('');
  const [qcCoa, setQcCoa] = useState('COA-PASSED-STANDARD-TEST-v1.pdf');

  const fetchOrderDetail = () => {
    if (!orderId) return;
    setLoading(true);
    manufacturingApi
      .getOrder(orderId)
      .then((res) => {
        setOrder(res.data);
        setOutputGoodQty(Number(res.data.planned_qty) - Number(res.data.completed_qty || 0));
      })
      .catch((err) => {
        console.error(err);
        toast.error('Failed to load Manufacturing Order');
      })
      .finally(() => setLoading(false));

    manufacturingApi
      .planOrder(orderId)
      .then((res) => setPlan(res.data))
      .catch((err) => console.error(err));
  };

  useEffect(() => {
    fetchOrderDetail();
  }, [orderId]);

  // Actions
  const handleApprove = async () => {
    try {
      await manufacturingApi.approveOrder(orderId);
      toast.success('Order approved! Ready for material reservation.');
      fetchOrderDetail();
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Failed to approve order');
    }
  };

  const handleReserve = async () => {
    try {
      await manufacturingApi.reserveMaterials(orderId);
      toast.success('Materials reserved via FEFO! Allocated batches are locked.');
      fetchOrderDetail();
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Failed to reserve materials');
    }
  };

  const handleIssue = async () => {
    if (!order?.batches || order.batches.length === 0) {
      toast.error('No reserved batches found to issue');
      return;
    }
    const issueItems = order.batches.map((b) => ({
      product_id: b.product_id,
      batch_id: b.batch_id,
      batch_no: b.batch_no,
      qty: Number(b.reserved_qty) > 0 ? Number(b.reserved_qty) : Number(b.issued_qty || 0),
    }));

    try {
      await manufacturingApi.issueMaterials(orderId, issueItems);
      toast.success('Materials issued to floor! Stock ledger deducted.');
      fetchOrderDetail();
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Failed to issue materials');
    }
  };

  const handleRecordOutput = async (e: React.FormEvent) => {
    e.preventDefault();
    if (outputGoodQty <= 0) {
      toast.error('Good quantity must be greater than zero');
      return;
    }

    try {
      await manufacturingApi.recordOutput(orderId, {
        batch_no: outputBatchNo.trim() || undefined,
        good_qty: outputGoodQty,
        rejected_qty: outputRejQty,
        scrap_qty: outputScrapQty,
        unit: order?.unit || 'PCS',
        mfg_date: outputMfgDate,
        exp_date: outputExpDate,
        notes: outputNotes.trim() || undefined,
      });
      toast.success('Production output recorded! Finished Batch generated in Quarantine.');
      setOutputModalOpen(false);
      fetchOrderDetail();
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Failed to record production output');
    }
  };

  const handleQcRelease = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOutput) return;

    try {
      await manufacturingApi.qcRelease(selectedOutput.id, {
        qc_status: qcDecision,
        qc_notes: qcNotes.trim() || undefined,
        coa_attachment: qcCoa.trim() || undefined,
      });
      toast.success(
        qcDecision === 'RELEASED'
          ? 'QC Release Approved! Finished goods moved to available stock ledger.'
          : `Quality decision applied: ${qcDecision}`
      );
      setQcModalOpen(false);
      fetchOrderDetail();
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Failed to apply QC release');
    }
  };

  if (loading || !order) {
    return (
      <div className="flex items-center justify-center p-12 text-slate-500">
        <i className="fas fa-spinner fa-spin text-2xl mr-3 text-indigo-600" />
        <span>Loading Production Workbench...</span>
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-12">
      {/* Back and Breadcrumbs */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigate('/manufacturing/orders')}
          className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold flex items-center gap-1.5"
        >
          <i className="fas fa-arrow-left" /> Back to Orders
        </button>

        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate(`/manufacturing/traceability?batch=${order.production_batch_no || ''}`)}
            className="px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg text-xs font-bold text-slate-700 shadow-sm flex items-center gap-1.5"
          >
            <i className="fas fa-sitemap text-purple-600" /> Batch Genealogy
          </button>
          <button
            onClick={fetchOrderDetail}
            className="p-1.5 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg text-xs text-slate-600 shadow-sm"
          >
            <i className="fas fa-sync-alt" />
          </button>
        </div>
      </div>

      {/* Main Order Header Card */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-100">
          <div>
            <div className="flex items-center gap-3">
              <span className="p-2.5 bg-indigo-50 text-indigo-600 rounded-xl font-mono font-black text-sm border border-indigo-200">
                {order.order_no}
              </span>
              <div>
                <h1 className="text-xl font-black text-slate-800">{order.product_name}</h1>
                <p className="text-xs text-slate-500 font-mono">
                  SKU: {order.item_code} | BOM: {order.bom_no} (Rev v{order.bom_revision}.0) | Dept:{' '}
                  {order.department || 'Production'}
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-right">
              <span className="text-[10px] text-slate-400 font-bold block">Lifecycle</span>
              <span
                className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${
                  STATUS_BADGE[order.status] || 'bg-slate-100 text-slate-700'
                }`}
              >
                {order.status.replace(/_/g, ' ')}
              </span>
            </div>

            <div className="text-right">
              <span className="text-[10px] text-slate-400 font-bold block">QC Gate</span>
              <span
                className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${
                  QC_BADGE[order.qc_status] || 'bg-slate-100 text-slate-700'
                }`}
              >
                {order.qc_status}
              </span>
            </div>
          </div>
        </div>

        {/* Quantities & Schedule Info */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs">
          <div>
            <span className="text-slate-400 font-bold text-[10px] block">Planned Quantity</span>
            <span className="text-sm font-black font-mono text-slate-800">
              {Number(order.planned_qty).toLocaleString()} {order.unit}
            </span>
          </div>

          <div>
            <span className="text-slate-400 font-bold text-[10px] block">Completed Output</span>
            <span className="text-sm font-black font-mono text-emerald-700">
              {Number(order.completed_qty).toLocaleString()} {order.unit}
            </span>
          </div>

          <div>
            <span className="text-slate-400 font-bold text-[10px] block">Schedule Window</span>
            <span className="text-slate-700 font-medium">
              {order.planned_start_date || '—'} → {order.planned_end_date || '—'}
            </span>
          </div>

          <div>
            <span className="text-slate-400 font-bold text-[10px] block">Generated Finished Batch</span>
            <span className="font-mono font-bold text-indigo-700">
              {order.production_batch_no || 'Pending Output'}
            </span>
          </div>
        </div>

        {/* Dynamic Action Buttons based on Order Stage */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <div className="flex items-center gap-2 text-xs">
            {order.status === 'DRAFT' && (
              <button
                onClick={handleApprove}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold flex items-center gap-2 shadow-sm transition"
              >
                <i className="fas fa-check" /> 1. Approve Production Order
              </button>
            )}

            {order.status === 'APPROVED' && (
              <button
                onClick={handleReserve}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-bold flex items-center gap-2 shadow-sm transition"
              >
                <i className="fas fa-lock" /> 2. Reserve Materials (FEFO)
              </button>
            )}

            {order.status === 'MATERIALS_RESERVED' && (
              <button
                onClick={handleIssue}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-bold flex items-center gap-2 shadow-sm transition"
              >
                <i className="fas fa-truck-loading" /> 3. Issue Materials to Production Floor
              </button>
            )}

            {(order.status === 'MATERIALS_ISSUED' || order.status === 'IN_PRODUCTION') && (
              <button
                onClick={() => setOutputModalOpen(true)}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold flex items-center gap-2 shadow-sm transition"
              >
                <i className="fas fa-box-check" /> 4. Record Production Output & Finished Batch
              </button>
            )}

            {order.status === 'QC_PENDING' && (
              <button
                onClick={() => {
                  const lastOut = order.outputs?.[0];
                  if (lastOut) {
                    setSelectedOutput(lastOut);
                    setQcModalOpen(true);
                  } else {
                    toast.error('No output batch pending release');
                  }
                }}
                className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg font-bold flex items-center gap-2 shadow-sm transition"
              >
                <i className="fas fa-microscope" /> 5. QC Inspection & Release Gate
              </button>
            )}

            {order.status === 'COMPLETED' && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-800 font-bold text-xs">
                <i className="fas fa-check-double text-emerald-600" /> Order Completed & Finished Goods Released to Warehouse!
              </div>
            )}
          </div>

          {plan?.has_shortage && (
            <div className="flex items-center gap-2 text-rose-600 text-xs font-bold">
              <i className="fas fa-exclamation-triangle" />
              <span>{plan.total_shortage_items} Material Shortages Detected</span>
              <button
                onClick={() => navigate(`/manufacturing/planning?order_id=${orderId}`)}
                className="underline hover:text-rose-800 ml-1"
              >
                Open Shortage Matrix →
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 text-xs font-bold">
        {[
          { id: 'plan', label: '1. Material Requirements & Shortages', icon: 'fas fa-list-check' },
          { id: 'batches', label: '2. Batch Allocations (FEFO)', icon: 'fas fa-cubes' },
          { id: 'consumption', label: '3. Actual Floor Consumption', icon: 'fas fa-fire-burner' },
          { id: 'output', label: '4. Outputs & QC Release Gate', icon: 'fas fa-award' },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id as any)}
            className={`px-4 py-3 flex items-center gap-2 border-b-2 transition ${
              activeTab === t.id
                ? 'border-indigo-600 text-indigo-600 bg-indigo-50/30'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <i className={t.icon} />
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab 1: Material Requirements & Shortages */}
      {activeTab === 'plan' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
            <h3 className="font-bold text-slate-800 text-xs flex items-center gap-2">
              <i className="fas fa-calculator text-indigo-600" />
              BOM Explosion Requirements for {order.planned_qty} {order.unit}
            </h3>
            {plan?.has_shortage && (
              <button
                onClick={() => navigate(`/manufacturing/planning?order_id=${orderId}`)}
                className="px-3 py-1 bg-rose-600 text-white rounded text-xs font-bold hover:bg-rose-700 shadow-sm"
              >
                Resolve Shortages in Matrix →
              </button>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 text-slate-500 font-bold text-[10px] border-b border-slate-200">
                  <th className="py-2.5 px-3">Item / Material</th>
                  <th className="py-2.5 px-3">Type</th>
                  <th className="py-2.5 px-3 text-right">Required Qty</th>
                  <th className="py-2.5 px-3 text-right">Available Stock</th>
                  <th className="py-2.5 px-3 text-right">Reserved Qty</th>
                  <th className="py-2.5 px-3 text-right">Issued Qty</th>
                  <th className="py-2.5 px-3 text-right">Shortage</th>
                  <th className="py-2.5 px-3 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {order.items?.map((it: MfgOrderItem) => {
                  const isShortage = Number(it.required_qty) > (Number(it.reserved_qty) + Number(it.issued_qty));
                  return (
                    <tr key={it.id} className="hover:bg-slate-50">
                      <td className="py-2.5 px-3">
                        <div className="font-bold text-slate-800">{it.product_name}</div>
                        <div className="text-[10px] text-slate-400 font-mono">{it.item_code}</div>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700">
                          {it.material_type}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-800">
                        {Number(it.required_qty).toFixed(2)} {it.unit}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-slate-600">
                        {Number(it.cost_per_unit ? it.cost_per_unit : 0).toFixed(2)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-amber-600 font-bold">
                        {Number(it.reserved_qty).toFixed(2)} {it.unit}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-purple-600 font-bold">
                        {Number(it.issued_qty).toFixed(2)} {it.unit}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-black">
                        {isShortage && Number(it.issued_qty) === 0 ? (
                          <span className="text-rose-600">
                            -{(Number(it.required_qty) - Number(it.reserved_qty)).toFixed(2)} {it.unit}
                          </span>
                        ) : (
                          <span className="text-emerald-600">0.00</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700">
                          {it.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 2: Batch Allocations */}
      {activeTab === 'batches' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
            <h3 className="font-bold text-slate-800 text-xs flex items-center gap-2">
              <i className="fas fa-cubes text-indigo-600" />
              FEFO Allocated Material Batches
            </h3>
            {order.status === 'MATERIALS_RESERVED' && (
              <button
                onClick={handleIssue}
                className="px-3 py-1 bg-purple-600 text-white rounded text-xs font-bold hover:bg-purple-700 shadow-sm"
              >
                Confirm Issue to Floor →
              </button>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 text-slate-500 font-bold text-[10px] border-b border-slate-200">
                  <th className="py-2.5 px-3">Material</th>
                  <th className="py-2.5 px-3">Batch / Lot No</th>
                  <th className="py-2.5 px-3">Supplier Batch</th>
                  <th className="py-2.5 px-3">Expiry Date</th>
                  <th className="py-2.5 px-3 text-right">Reserved Qty</th>
                  <th className="py-2.5 px-3 text-right">Issued Qty</th>
                  <th className="py-2.5 px-3 text-right">Consumed Qty</th>
                  <th className="py-2.5 px-3 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(!order.batches || order.batches.length === 0) ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-slate-400">
                      No batches allocated yet. Click "Reserve Materials (FEFO)" to lock batches.
                    </td>
                  </tr>
                ) : (
                  order.batches.map((b: MfgOrderBatch) => (
                    <tr key={b.id} className="hover:bg-slate-50">
                      <td className="py-2.5 px-3">
                        <div className="font-bold text-slate-800">{b.product_name}</div>
                        <div className="text-[10px] text-slate-400 font-mono">{b.item_code}</div>
                      </td>
                      <td className="py-2.5 px-3 font-mono font-bold text-indigo-700">
                        {b.batch_no}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-slate-500">
                        {b.supplier_batch_no || '—'}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-slate-600">
                        {b.expiry_date || '—'}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-amber-600">
                        {Number(b.reserved_qty).toFixed(2)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-purple-600">
                        {Number(b.issued_qty).toFixed(2)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-700">
                        {Number(b.consumed_qty).toFixed(2)}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700">
                          {b.status}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 3: Floor Consumption */}
      {activeTab === 'consumption' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
            <div>
              <h3 className="font-bold text-slate-800 text-xs flex items-center gap-2">
                <i className="fas fa-fire-burner text-indigo-600" />
                Actual Material Floor Consumption & Variance
              </h3>
              <p className="text-[11px] text-slate-500">
                Track exact quantities consumed during manufacturing and return any unused lots back to store.
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 text-slate-500 font-bold text-[10px] border-b border-slate-200">
                  <th className="py-2.5 px-3">Material</th>
                  <th className="py-2.5 px-3 text-right">Required (BOM)</th>
                  <th className="py-2.5 px-3 text-right">Issued to Floor</th>
                  <th className="py-2.5 px-3 text-right">Actually Consumed</th>
                  <th className="py-2.5 px-3 text-right">Returned Unused</th>
                  <th className="py-2.5 px-3 text-right">Variance %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {order.items?.map((it: MfgOrderItem) => {
                  const req = Number(it.required_qty);
                  const cons = Number(it.consumed_qty || it.issued_qty || 0);
                  const variancePct = req > 0 ? ((cons - req) / req) * 100 : 0;
                  return (
                    <tr key={it.id} className="hover:bg-slate-50">
                      <td className="py-2.5 px-3">
                        <div className="font-bold text-slate-800">{it.product_name}</div>
                        <div className="text-[10px] text-slate-400 font-mono">{it.item_code}</div>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-700">
                        {req.toFixed(2)} {it.unit}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-purple-600">
                        {Number(it.issued_qty).toFixed(2)} {it.unit}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-indigo-700">
                        {cons.toFixed(2)} {it.unit}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-amber-600">
                        {Number(it.returned_qty).toFixed(2)} {it.unit}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold">
                        <span
                          className={
                            variancePct > 2
                              ? 'text-rose-600'
                              : variancePct < -2
                              ? 'text-blue-600'
                              : 'text-emerald-600'
                          }
                        >
                          {variancePct > 0 ? `+${variancePct.toFixed(1)}%` : `${variancePct.toFixed(1)}%`}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 4: Outputs & QC Release */}
      {activeTab === 'output' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden space-y-4">
          <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
            <div>
              <h3 className="font-bold text-slate-800 text-xs flex items-center gap-2">
                <i className="fas fa-award text-indigo-600" />
                Finished Goods Output Batches & Quality Control Gate
              </h3>
              <p className="text-[11px] text-slate-500">
                Goods remain in Quarantine until QC Manager completes release testing and approves stock posting.
              </p>
            </div>
            <button
              onClick={() => setOutputModalOpen(true)}
              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-xs font-bold shadow-sm"
            >
              + Record Output Batch
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 text-slate-500 font-bold text-[10px] border-b border-slate-200">
                  <th className="py-2.5 px-3">Output No</th>
                  <th className="py-2.5 px-3">Generated Batch No</th>
                  <th className="py-2.5 px-3 text-right">Good Qty</th>
                  <th className="py-2.5 px-3 text-right">Rejected Qty</th>
                  <th className="py-2.5 px-3 text-right">Scrap Qty</th>
                  <th className="py-2.5 px-3">Mfg / Exp Date</th>
                  <th className="py-2.5 px-3">QC Status</th>
                  <th className="py-2.5 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(!order.outputs || order.outputs.length === 0) ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-slate-400">
                      No production outputs recorded yet.
                    </td>
                  </tr>
                ) : (
                  order.outputs.map((out: MfgOrderOutput) => (
                    <tr key={out.id} className="hover:bg-slate-50">
                      <td className="py-2.5 px-3 font-mono font-bold text-slate-700">
                        {out.output_no}
                      </td>
                      <td className="py-2.5 px-3 font-mono font-bold text-indigo-700">
                        {out.batch_no}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-700">
                        {Number(out.good_qty).toFixed(1)} {out.unit}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-rose-600 font-bold">
                        {Number(out.rejected_qty).toFixed(1)} {out.unit}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-slate-500">
                        {Number(out.scrap_qty).toFixed(1)} {out.unit}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-[11px] text-slate-600">
                        {out.mfg_date} → {out.exp_date || '—'}
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                            QC_BADGE[out.qc_status] || 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {out.qc_status}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        {out.qc_status === 'PENDING' ? (
                          <button
                            onClick={() => {
                              setSelectedOutput(out);
                              setQcModalOpen(true);
                            }}
                            className="px-2.5 py-1 bg-amber-500 hover:bg-amber-600 text-white rounded text-[11px] font-bold shadow-sm"
                          >
                            Quality Release Gate →
                          </button>
                        ) : (
                          <span className="text-[11px] text-emerald-700 font-bold">
                            <i className="fas fa-check-circle mr-1" /> Released
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
      )}

      {/* Record Output Modal */}
      <Modal
        open={outputModalOpen}
        onClose={() => setOutputModalOpen(false)}
        title="Record Production Output & Finished Batch"
        width="max-w-lg"
      >
        <form onSubmit={handleRecordOutput} className="space-y-4 text-xs">
          <div>
            <label className="block font-bold text-slate-700 mb-1">
              Production Batch Number (Leave blank to auto-generate)
            </label>
            <input
              type="text"
              value={outputBatchNo}
              onChange={(e) => setOutputBatchNo(e.target.value)}
              placeholder="e.g. NB-BAT-20261018-002"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono text-xs"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block font-bold text-slate-700 mb-1">Good Output ({order.unit})</label>
              <input
                type="number"
                step="any"
                min="0.1"
                value={outputGoodQty}
                onChange={(e) => setOutputGoodQty(Number(e.target.value))}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono font-bold text-emerald-700 text-xs"
                required
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Rejected Qty</label>
              <input
                type="number"
                step="any"
                min="0"
                value={outputRejQty}
                onChange={(e) => setOutputRejQty(Number(e.target.value))}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono text-rose-600 text-xs"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Scrap Qty</label>
              <input
                type="number"
                step="any"
                min="0"
                value={outputScrapQty}
                onChange={(e) => setOutputScrapQty(Number(e.target.value))}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono text-slate-600 text-xs"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-bold text-slate-700 mb-1">Production Date</label>
              <input
                type="date"
                value={outputMfgDate}
                onChange={(e) => setOutputMfgDate(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
                required
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Expiration Date</label>
              <input
                type="date"
                value={outputExpDate}
                onChange={(e) => setOutputExpDate(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
                required
              />
            </div>
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-1">Production Run Remarks</label>
            <textarea
              rows={2}
              value={outputNotes}
              onChange={(e) => setOutputNotes(e.target.value)}
              placeholder="Sensory checks, packing integrity, oven conditions..."
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
            />
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={() => setOutputModalOpen(false)}
              className="px-4 py-2 border border-slate-300 rounded-lg font-semibold text-slate-700 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold shadow-sm"
            >
              Generate Output Batch
            </button>
          </div>
        </form>
      </Modal>

      {/* QC Release Gate Modal */}
      <Modal
        open={qcModalOpen}
        onClose={() => setQcModalOpen(false)}
        title={`Quality Inspection & QC Release: ${selectedOutput?.batch_no || ''}`}
        width="max-w-md"
      >
        <form onSubmit={handleQcRelease} className="space-y-4 text-xs">
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-900">
            <div className="font-bold flex items-center gap-1.5">
              <i className="fas fa-shield-alt text-amber-600" /> Quality Release Sign-Off
            </div>
            <p className="text-[11px] mt-1">
              Approving release will post <span className="font-bold font-mono">production_output</span> to the stock ledger and transfer the batch from Quarantine to Finished Goods Warehouse.
            </p>
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-1">QC Decision</label>
            <select
              value={qcDecision}
              onChange={(e) => setQcDecision(e.target.value as any)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg font-bold text-xs"
            >
              <option value="RELEASED">RELEASED (Approved for commercial distribution)</option>
              <option value="REJECTED">REJECTED (Non-conforming, scrap)</option>
              <option value="QUARANTINED">QUARANTINED (Hold for further microbiological tests)</option>
            </select>
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-1">CoA Certificate of Analysis Reference</label>
            <input
              type="text"
              value={qcCoa}
              onChange={(e) => setQcCoa(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono text-xs"
            />
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-1">Inspector Notes & Lab Results</label>
            <textarea
              rows={3}
              value={qcNotes}
              onChange={(e) => setQcNotes(e.target.value)}
              placeholder="e.g. Moisture 4.2%, Protein 22.8%, Aerobic Plate Count < 10,000 CFU/g. Passed all specs."
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
            />
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={() => setQcModalOpen(false)}
              className="px-4 py-2 border border-slate-300 rounded-lg font-semibold text-slate-700 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold shadow-sm"
            >
              Confirm QC Release
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

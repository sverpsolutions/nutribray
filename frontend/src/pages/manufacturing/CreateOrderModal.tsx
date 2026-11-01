import { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import { manufacturingApi, type MfgBom } from '../../api/manufacturing';
import Modal from '../../components/ui/Modal';

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function CreateOrderModal({ open, onClose, onSuccess }: Props) {
  const [boms, setBoms] = useState<MfgBom[]>([]);
  const [selectedBomId, setSelectedBomId] = useState<number>(0);
  const [plannedQty, setPlannedQty] = useState<number>(100);
  const [department, setDepartment] = useState('Production & Baking');
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(
    new Date(Date.now() + 86400000 * 2).toISOString().split('T')[0]
  );
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      manufacturingApi
        .getBoms({ status: 'APPROVED' })
        .then((res) => {
          setBoms(res.data);
          if (res.data.length > 0) {
            setSelectedBomId(res.data[0].id);
            setPlannedQty(res.data[0].batch_size || 100);
          }
        })
        .catch((err) => console.error(err));
    }
  }, [open]);

  const selectedBom = boms.find((b) => b.id === selectedBomId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBom) {
      toast.error('Please select an approved BOM');
      return;
    }
    if (plannedQty <= 0) {
      toast.error('Planned quantity must be greater than zero');
      return;
    }

    setSubmitting(true);
    try {
      await manufacturingApi.createOrder({
        product_id: selectedBom.product_id,
        bom_id: selectedBom.id,
        planned_qty: plannedQty,
        unit: selectedBom.batch_unit || 'PCS',
        department,
        planned_start_date: startDate,
        planned_end_date: endDate,
        notes: notes.trim() || undefined,
      });
      toast.success('Manufacturing Order created in Draft status');
      onSuccess();
      onClose();
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Failed to create Manufacturing Order');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Create New Manufacturing Order" width="full">
      <form onSubmit={handleSubmit} className="space-y-4 text-xs">
        <div>
          <label className="block font-bold text-slate-700 mb-1">
            Approved Formulation / BOM <span className="text-red-500">*</span>
          </label>
          <select
            value={selectedBomId}
            onChange={(e) => {
              const bId = Number(e.target.value);
              setSelectedBomId(bId);
              const b = boms.find((x) => x.id === bId);
              if (b) setPlannedQty(b.batch_size);
            }}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {boms.length === 0 ? (
              <option value={0}>No approved BOMs found. Approve a BOM first.</option>
            ) : (
              boms.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.bom_no} — {b.bom_name} (Rev {b.version_label})
                </option>
              ))
            )}
          </select>
          {selectedBom && (
            <p className="text-[11px] text-slate-500 mt-1">
              Target SKU: <span className="font-bold text-slate-700">{selectedBom.product_name}</span> ({selectedBom.item_code})
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block font-bold text-slate-700 mb-1">Planned Production Quantity</label>
            <input
              type="number"
              min="1"
              step="any"
              value={plannedQty}
              onChange={(e) => setPlannedQty(Number(e.target.value))}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono font-bold text-slate-800"
              required
            />
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-1">Batch Unit</label>
            <input
              type="text"
              readOnly
              value={selectedBom?.batch_unit || 'PCS'}
              className="w-full px-3 py-2 bg-slate-100 border border-slate-300 rounded-lg text-xs font-bold uppercase text-slate-700 text-center"
            />
          </div>
        </div>

        <div>
          <label className="block font-bold text-slate-700 mb-1">Production Department / Line</label>
          <input
            type="text"
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
            placeholder="e.g. Line 1 - Baking & Roasting"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block font-bold text-slate-700 mb-1">Planned Start Date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
              required
            />
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-1">Planned Target Date</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
              required
            />
          </div>
        </div>

        <div>
          <label className="block font-bold text-slate-700 mb-1">Production Notes</label>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
            placeholder="Batch order priorities, packaging instructions..."
          />
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 border border-slate-300 rounded-lg font-semibold text-slate-700 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || boms.length === 0}
            className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg font-bold shadow-sm"
          >
            {submitting ? 'Creating...' : 'Create Order'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

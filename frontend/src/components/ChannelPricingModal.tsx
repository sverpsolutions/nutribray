import { useState, useEffect } from 'react';
import { channels_api, type channel_price } from '../api/channels';

interface Props {
  product_id: number;
  product_name: string;
  base_cost: string;
  onClose: () => void;
}

const ChannelPricingModal = ({ product_id, product_name, base_cost, onClose }: Props) => {
  const [prices, setPrices] = useState<channel_price[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchPrices();
  }, [product_id]);

  const fetchPrices = async () => {
    setLoading(true);
    try {
      const res = await channels_api.get_product_prices(product_id);
      setPrices(res.data.prices || []);
    } catch (err) {
      console.error("Failed to fetch channel prices", err);
    } finally {
      setLoading(false);
    }
  };

  const updatePrice = (idx: number, key: keyof channel_price, val: any) => {
    const updated = [...prices];
    updated[idx] = { ...updated[idx], [key]: val };
    setPrices(updated);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      for (const p of prices) {
        if (p.partner_id) {
          await channels_api.upsert_product_price(product_id, {
            partner_id: p.partner_id,
            mrp: p.mrp,
            base_cost: p.base_cost,
            margin_percent: p.margin_percent,
            partner_commission: p.partner_commission,
            selling_price: p.selling_price,
            final_settlement_rate: p.final_settlement_rate,
            minimum_profit: p.minimum_profit,
            is_active: p.is_active,
          });
        }
      }
      alert("Channel prices updated successfully!");
      onClose();
    } catch (err) {
      alert("Failed to save channel prices");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-[200] flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-5xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
        <div className="bg-gradient-to-r from-blue-600 to-indigo-700 p-6 text-white flex justify-between items-center shrink-0">
          <div>
            <h3 className="text-xl font-black uppercase tracking-tight">Channel Pricing Matrix</h3>
            <p className="text-[10px] font-bold text-indigo-100 uppercase tracking-widest mt-1">
              {product_name} · Base Cost: ₹{base_cost}
            </p>
          </div>
          <button onClick={onClose} className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-all">
            <i className="fas fa-times"></i>
          </button>
        </div>

        <div className="flex-1 overflow-auto p-6 custom-scrollbar">
          {loading ? (
            <div className="py-20 text-center"><i className="fas fa-spinner fa-spin text-3xl text-indigo-500"></i></div>
          ) : (
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-50 sticky top-0 z-10">
                <tr className="text-slate-500 border-b border-slate-200">
                  <th className="px-4 py-4 font-bold uppercase tracking-tighter">Channel Partner</th>
                  <th className="px-4 py-4 font-bold uppercase tracking-tighter text-right">Commission %</th>
                  <th className="px-4 py-4 font-bold uppercase tracking-tighter text-right">Selling Price</th>
                  <th className="px-4 py-4 font-bold uppercase tracking-tighter text-right">Settlement Rate</th>
                  <th className="px-4 py-4 font-bold uppercase tracking-tighter text-right">Min. Profit</th>
                  <th className="px-4 py-4 font-bold uppercase tracking-tighter text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {prices.map((p, idx) => (
                  <tr key={p.partner_id} className="hover:bg-blue-50/30 transition-colors">
                    <td className="px-4 py-4">
                      <div className="font-black text-slate-800 uppercase tracking-tight">{p.partner_name}</div>
                    </td>
                    <td className="px-4 py-4 text-right">
                      <input 
                        type="number" step="0.01" 
                        className="w-20 bg-slate-100 border-none rounded p-1.5 text-right font-bold text-indigo-600"
                        value={p.partner_commission ?? 0}
                        onChange={e => updatePrice(idx, 'partner_commission', parseFloat(e.target.value) || 0)}
                      /> %
                    </td>
                    <td className="px-4 py-4 text-right">
                      <input 
                        type="number" step="0.01" 
                        className="w-24 bg-slate-100 border-none rounded p-1.5 text-right font-black text-green-700"
                        value={p.selling_price ?? 0}
                        onChange={e => updatePrice(idx, 'selling_price', parseFloat(e.target.value) || 0)}
                      />
                    </td>
                    <td className="px-4 py-4 text-right font-mono font-bold text-slate-600">
                      ₹{(Number(p.final_settlement_rate) || 0).toFixed(2)}
                    </td>
                    <td className={`px-4 py-4 text-right font-mono font-bold ${(Number(p.minimum_profit) || 0) < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                      ₹{(Number(p.minimum_profit) || 0).toFixed(2)}
                    </td>
                    <td className="px-4 py-4 text-center">
                      <input 
                        type="checkbox" 
                        className="w-5 h-5 rounded text-indigo-600 focus:ring-indigo-500"
                        checked={p.is_active}
                        onChange={e => updatePrice(idx, 'is_active', e.target.checked)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="p-6 bg-slate-50 border-t border-slate-100 flex justify-end gap-4 shrink-0">
          <button onClick={onClose} className="px-6 py-3 text-slate-400 font-black uppercase tracking-widest text-[10px]">
            Cancel
          </button>
          <button 
            onClick={handleSave}
            disabled={saving}
            className="bg-indigo-600 text-white font-black py-3 px-10 rounded-xl shadow-xl hover:bg-indigo-700 disabled:opacity-50 transition-all uppercase tracking-widest text-[10px]"
          >
            {saving ? 'Saving...' : 'Sync All Rates'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChannelPricingModal;

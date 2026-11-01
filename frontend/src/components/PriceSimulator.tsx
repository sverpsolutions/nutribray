import React, { useState, useEffect } from 'react';
import { channels_api, simulate_request, simulate_result } from '../api/channels';

interface PriceSimulatorProps {
  isOpen: boolean;
  onClose: () => void;
  onApply: (result: simulate_result) => void;
  initialData: {
    mrp: number;
    cost_price: number;
    gst_percent: number;
    partner_commission: number;
    extra_margin: number;
    delivery_charge: number;
    packing_charge: number;
  };
  partnerName: string;
}

const PriceSimulator: React.FC<PriceSimulatorProps> = ({ isOpen, onClose, onApply, initialData, partnerName }) => {
  const [data, setData] = useState<simulate_request>(initialData);
  const [result, setResult] = useState<simulate_result | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      handleSimulate();
    }
  }, [isOpen, data]);

  const handleSimulate = async () => {
    setLoading(true);
    try {
      const res = await channels_api.simulate(data);
      setResult(res.data);
    } catch (error) {
      console.error('Simulation failed', error);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-800 w-full max-w-4xl rounded-3xl shadow-2xl overflow-hidden border border-slate-200 dark:border-slate-700 flex flex-col md:flex-row">
        
        {/* Left: Inputs */}
        <div className="p-8 border-r border-slate-100 dark:border-slate-700 w-full md:w-1/2">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
              <i className="fas fa-calculator text-lg"></i>
            </div>
            <div>
              <h2 className="text-lg font-bold">Price Simulator</h2>
              <p className="text-[10px] text-slate-400 uppercase tracking-widest font-black">Adjust values for {partnerName}</p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-slate-400">MRP (₹)</label>
                <input 
                  type="number" 
                  value={data.mrp} 
                  onChange={e => setData({...data, mrp: parseFloat(e.target.value) || 0})}
                  className="w-full px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-mono font-bold"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-slate-400">Cost Price (₹)</label>
                <input 
                  type="number" 
                  value={data.cost_price} 
                  onChange={e => setData({...data, cost_price: parseFloat(e.target.value) || 0})}
                  className="w-full px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-mono"
                />
              </div>
            </div>

            <div className="p-4 bg-blue-50/50 dark:bg-blue-900/10 rounded-2xl border border-blue-100 dark:border-blue-900/30 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-blue-600 dark:text-blue-400">Comm. %</label>
                  <input 
                    type="number" 
                    value={data.partner_commission} 
                    onChange={e => setData({...data, partner_commission: parseFloat(e.target.value) || 0})}
                    className="w-full px-4 py-2 rounded-xl border border-blue-200 dark:border-blue-800 bg-white dark:bg-slate-900"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-emerald-600 dark:text-emerald-400">Extra Margin %</label>
                  <input 
                    type="number" 
                    value={data.extra_margin} 
                    onChange={e => setData({...data, extra_margin: parseFloat(e.target.value) || 0})}
                    className="w-full px-4 py-2 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-white dark:bg-slate-900"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-slate-400">Delivery (₹)</label>
                  <input 
                    type="number" 
                    value={data.delivery_charge} 
                    onChange={e => setData({...data, delivery_charge: parseFloat(e.target.value) || 0})}
                    className="w-full px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-slate-400">Packing (₹)</label>
                  <input 
                    type="number" 
                    value={data.packing_charge} 
                    onChange={e => setData({...data, packing_charge: parseFloat(e.target.value) || 0})}
                    className="w-full px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Results */}
        <div className="p-8 bg-slate-50 dark:bg-slate-900/50 w-full md:w-1/2 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-8">
              <h3 className="text-sm font-black uppercase tracking-widest text-slate-400 italic">Live Calculation</h3>
              {loading && <i className="fas fa-spinner fa-spin text-primary"></i>}
            </div>

            {result ? (
              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase block">Selling Price</span>
                    <span className="text-2xl font-black text-slate-800 dark:text-white">₹{result.selling_price}</span>
                  </div>
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase block">Settlement Rate</span>
                    <span className="text-2xl font-black text-primary">₹{result.settlement_rate}</span>
                  </div>
                </div>

                <div className="p-6 bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700">
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-xs font-bold uppercase text-slate-500">Net Profit</span>
                    <span className={`text-lg font-black ${result.net_profit > 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                      ₹{result.net_profit}
                    </span>
                  </div>
                  <div className="w-full bg-slate-100 dark:bg-slate-700 h-2 rounded-full overflow-hidden">
                    <div 
                      className={`h-full transition-all duration-500 ${result.net_margin_pct > 20 ? 'bg-emerald-500' : result.net_margin_pct > 10 ? 'bg-amber-500' : 'bg-rose-500'}`}
                      style={{ width: `${Math.min(Math.max(result.net_margin_pct, 0), 100)}%` }}
                    ></div>
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-[10px] font-black text-slate-400 uppercase">Margin %</span>
                    <span className="text-sm font-black">{result.net_margin_pct}%</span>
                  </div>
                </div>

                {result.profit_warning && (
                  <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl flex gap-3 items-start">
                    <i className="fas fa-exclamation-triangle text-amber-500 mt-0.5"></i>
                    <p className="text-[10px] font-bold text-amber-700 dark:text-amber-400 leading-tight">{result.profit_warning}</p>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                    <div className="text-[10px] text-slate-400">
                        <span className="block font-bold">COMMISSION AMT</span>
                        <span className="font-mono">₹{result.commission_amount}</span>
                    </div>
                    <div className="text-[10px] text-slate-400">
                        <span className="block font-bold">EFFECTIVE COST</span>
                        <span className="font-mono">₹{result.effective_cp}</span>
                    </div>
                </div>
              </div>
            ) : (
              <div className="h-40 flex items-center justify-center text-slate-300">
                <i className="fas fa-chart-pie text-4xl opacity-20"></i>
              </div>
            )}
          </div>

          <div className="flex gap-3 mt-8">
            <button 
              onClick={onClose}
              className="flex-1 px-6 py-3 rounded-2xl font-bold text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800 transition-all"
            >
              Cancel
            </button>
            <button 
              disabled={!result || !result.is_profitable}
              onClick={() => result && onApply(result)}
              className="flex-1 bg-primary hover:bg-primary-dark text-white px-6 py-3 rounded-2xl font-bold shadow-lg shadow-primary/20 transition-all disabled:opacity-50 disabled:grayscale"
            >
              Apply Price
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};

export default PriceSimulator;

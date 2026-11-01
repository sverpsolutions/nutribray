import React, { useState, useEffect } from 'react';
import { channels_api, channel_partner } from '../../api/channels';
import toast from 'react-hot-toast';

const ChannelPartners = (_props?: { searchQuery?: string; onCountUpdate?: (count: number) => void }) => {
  const [partners, setPartners] = useState<channel_partner[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingPartner, setEditingPartner] = useState<Partial<channel_partner> | null>(null);

  useEffect(() => {
    fetchPartners();
  }, []);

  const fetchPartners = async () => {
    try {
      const res = await channels_api.get_partners();
      setPartners(res.data);
    } catch (error) {
      toast.error('Failed to load partners');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPartner?.partner_name || !editingPartner?.partner_code) {
      toast.error('Name and Code are required');
      return;
    }

    try {
      if (editingPartner.id) {
        await channels_api.update_partner(editingPartner.id, editingPartner);
        toast.success('Partner updated');
      } else {
        await channels_api.create_partner(editingPartner);
        toast.success('Partner created');
      }
      setShowModal(false);
      fetchPartners();
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to save partner');
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('Are you sure you want to deactivate this partner?')) return;
    try {
      await channels_api.delete_partner(id);
      toast.success('Partner deactivated');
      fetchPartners();
    } catch (error) {
      toast.error('Failed to deactivate');
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-white">Channel Partners</h1>
          <p className="text-slate-500 text-sm">Manage online marketplace integrations (Swiggy, Zomato, Amazon, etc.)</p>
        </div>
        <button
          onClick={() => {
            setEditingPartner({
              partner_name: '',
              partner_code: '',
              logo_url: '',
              commission_percent: 0,
              settlement_days: 7,
              gst_on_commission: true,
              extra_margin: 0,
              delivery_charge: 0,
              packing_charge: 0,
              is_active: true
            });
            setShowModal(true);
          }}
          className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white px-6 py-2.5 rounded-xl font-bold shadow-lg shadow-blue-500/25 transition-all flex items-center gap-2 group"
        >
          <i className="fas fa-plus group-hover:rotate-90 transition-transform"></i> Add Partner
        </button>
      </div>

      {loading ? (
        <div className="text-center py-20">
          <i className="fas fa-spinner fa-spin text-4xl text-primary/20"></i>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {partners.map(p => (
            <div key={p.id} className={`bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border ${p.is_active ? 'border-slate-200 dark:border-slate-700' : 'border-rose-200 opacity-60'} relative overflow-hidden group`}>
              {!p.is_active && (
                <div className="absolute top-2 right-2 bg-rose-500 text-white text-[8px] font-black px-2 py-0.5 rounded uppercase">Inactive</div>
              )}
              <div className="flex items-center justify-between mb-4">
                <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-white text-2xl font-black shadow-lg shadow-slate-200 dark:shadow-none overflow-hidden ${
                  p.partner_code === 'SWG' ? 'bg-orange-500' : 
                  p.partner_code === 'ZOM' ? 'bg-rose-500' :
                  p.partner_code === 'AMZ' ? 'bg-slate-900' :
                  'bg-gradient-to-br from-blue-500 to-indigo-600'
                }`}>
                  {p.logo_url ? (
                    <img src={p.logo_url} alt={p.partner_name} className="w-full h-full object-cover" />
                  ) : (
                    <span>{p.partner_name.charAt(0)}</span>
                  )}
                </div>
                <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => { setEditingPartner(p); setShowModal(true); }} className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg"><i className="fas fa-edit"></i></button>
                  {p.is_active && <button onClick={() => handleDelete(p.id)} className="p-2 text-rose-600 hover:bg-rose-50 rounded-lg"><i className="fas fa-trash"></i></button>}
                </div>
              </div>
              <h3 className="font-bold text-lg">{p.partner_name}</h3>
              <p className="text-xs font-mono text-slate-400 mb-4">{p.partner_code}</p>
              
              <div className="grid grid-cols-2 gap-4 text-xs">
                <div className="bg-slate-50 dark:bg-slate-900/50 p-2 rounded-lg">
                  <span className="text-slate-400 block mb-1 uppercase tracking-tighter font-bold">Commission</span>
                  <span className="font-bold text-primary">{p.commission_percent}%</span>
                </div>
                <div className="bg-slate-50 dark:bg-slate-900/50 p-2 rounded-lg">
                  <span className="text-slate-400 block mb-1 uppercase tracking-tighter font-bold">Settlement</span>
                  <span className="font-bold">{p.settlement_days} Days</span>
                </div>
                <div className="bg-slate-50 dark:bg-slate-900/50 p-2 rounded-lg">
                  <span className="text-slate-400 block mb-1 uppercase tracking-tighter font-bold">Extra Margin</span>
                  <span className="font-bold text-emerald-600">+{p.extra_margin}%</span>
                </div>
                <div className="bg-slate-50 dark:bg-slate-900/50 p-2 rounded-lg">
                  <span className="text-slate-400 block mb-1 uppercase tracking-tighter font-bold">GST on Comm.</span>
                  <span className="font-bold">{p.gst_on_commission ? 'Yes' : 'No'}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && editingPartner && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 w-full max-w-xl rounded-3xl shadow-2xl overflow-hidden border border-slate-200 dark:border-slate-700 animate-in zoom-in-95 duration-200">
            <div className="px-8 py-10 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 text-white relative overflow-hidden">
              <div className="relative z-10">
                <h2 className="text-2xl font-black italic tracking-tighter uppercase">{editingPartner.id ? 'Edit' : 'Add'} Channel Partner</h2>
                <p className="text-slate-400 text-xs font-medium uppercase tracking-widest mt-1">Integration Configuration</p>
              </div>
              <button onClick={() => setShowModal(false)} className="relative z-10 w-10 h-10 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors"><i className="fas fa-times"></i></button>
              <div className="absolute right-0 top-0 h-full w-1/3 bg-blue-600/10 blur-3xl rounded-full translate-x-1/2"></div>
            </div>
            
            <form onSubmit={handleSave} className="p-8 space-y-8 bg-slate-50/30 dark:bg-slate-900/10">
              <div className="space-y-6">
                <div className="grid grid-cols-1 gap-6 bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] font-black uppercase text-slate-400">Partner Name</label>
                      <input
                        type="text"
                        value={editingPartner.partner_name}
                        onChange={e => setEditingPartner({ ...editingPartner, partner_name: e.target.value })}
                        className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 outline-none focus:ring-2 focus:ring-blue-500/20 font-bold transition-all"
                        placeholder="e.g. Swiggy"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black uppercase text-slate-400">Unique Code</label>
                      <input
                        type="text"
                        value={editingPartner.partner_code}
                        onChange={e => setEditingPartner({ ...editingPartner, partner_code: e.target.value.toUpperCase() })}
                        className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 outline-none focus:ring-2 focus:ring-blue-500/20 font-mono font-bold transition-all"
                        placeholder="SWG"
                        disabled={!!editingPartner.id}
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase text-slate-400">Logo Image URL</label>
                    <div className="relative">
                      <input
                        type="text"
                        value={editingPartner.logo_url || ''}
                        onChange={e => setEditingPartner({ ...editingPartner, logo_url: e.target.value })}
                        className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 outline-none focus:ring-2 focus:ring-blue-500/20 text-xs transition-all"
                        placeholder="https://example.com/logo.png"
                      />
                      <div className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg bg-white dark:bg-slate-800 flex items-center justify-center overflow-hidden border border-slate-200 dark:border-slate-700 shadow-sm">
                         {editingPartner.logo_url ? <img src={editingPartner.logo_url} className="w-full h-full object-cover" /> : <i className="fas fa-image text-slate-300 text-[10px]"></i>}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-1 p-3 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm">
                    <label className="text-[9px] font-black uppercase text-slate-400">Commission %</label>
                    <input
                      type="number" step="0.01"
                      value={editingPartner.commission_percent}
                      onChange={e => setEditingPartner({ ...editingPartner, commission_percent: parseFloat(e.target.value) || 0 })}
                      className="w-full px-2 py-1 rounded-lg border-b-2 border-transparent focus:border-blue-500 bg-transparent outline-none font-bold text-blue-600"
                    />
                  </div>
                  <div className="space-y-1 p-3 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm">
                    <label className="text-[9px] font-black uppercase text-slate-400">Settlement Days</label>
                    <input
                      type="number"
                      value={editingPartner.settlement_days}
                      onChange={e => setEditingPartner({ ...editingPartner, settlement_days: parseInt(e.target.value) || 0 })}
                      className="w-full px-2 py-1 rounded-lg border-b-2 border-transparent focus:border-blue-500 bg-transparent outline-none font-bold"
                    />
                  </div>
                  <div className="space-y-1 p-3 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm">
                    <label className="text-[9px] font-black uppercase text-slate-400">Extra Margin %</label>
                    <input
                      type="number" step="0.01"
                      value={editingPartner.extra_margin}
                      onChange={e => setEditingPartner({ ...editingPartner, extra_margin: parseFloat(e.target.value) || 0 })}
                      className="w-full px-2 py-1 rounded-lg border-b-2 border-transparent focus:border-blue-500 bg-transparent outline-none font-bold text-emerald-600"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1 p-3 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm">
                    <label className="text-[9px] font-black uppercase text-slate-400">Delivery Charge (₹)</label>
                    <input
                      type="number" step="0.01"
                      value={editingPartner.delivery_charge}
                      onChange={e => setEditingPartner({ ...editingPartner, delivery_charge: parseFloat(e.target.value) || 0 })}
                      className="w-full px-2 py-1 rounded-lg border-b-2 border-transparent focus:border-blue-500 bg-transparent outline-none font-bold text-rose-500"
                    />
                  </div>
                  <div className="space-y-1 p-3 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm">
                    <label className="text-[9px] font-black uppercase text-slate-400">Packing Charge (₹)</label>
                    <input
                      type="number" step="0.01"
                      value={editingPartner.packing_charge}
                      onChange={e => setEditingPartner({ ...editingPartner, packing_charge: parseFloat(e.target.value) || 0 })}
                      className="w-full px-2 py-1 rounded-lg border-b-2 border-transparent focus:border-blue-500 bg-transparent outline-none font-bold text-rose-500"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-4 p-4 bg-blue-50 dark:bg-blue-900/10 rounded-2xl border border-blue-100 dark:border-blue-800/30">
                  <label className="flex items-center gap-2 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={editingPartner.gst_on_commission}
                      onChange={e => setEditingPartner({ ...editingPartner, gst_on_commission: e.target.checked })}
                      className="w-4 h-4 accent-blue-600 cursor-pointer"
                    />
                    <span className="text-xs font-bold text-slate-600 dark:text-slate-300 group-hover:text-blue-600 transition-colors">GST applicable on commission?</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer ml-auto group">
                    <input
                      type="checkbox"
                      checked={editingPartner.is_active}
                      onChange={e => setEditingPartner({ ...editingPartner, is_active: e.target.checked })}
                      className="w-4 h-4 accent-emerald-500 cursor-pointer"
                    />
                    <span className="text-xs font-bold text-slate-600 dark:text-slate-300 group-hover:text-emerald-500 transition-colors">Active Status</span>
                  </label>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-6 py-2.5 rounded-xl font-bold text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white px-10 py-3 rounded-xl font-black uppercase tracking-widest text-[10px] shadow-xl shadow-blue-500/25 transition-all active:scale-95"
                >
                  {editingPartner.id ? 'Update' : 'Confirm'} Partner
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChannelPartners;

import { useState } from 'react';

const ReceiveLot = () => {
  const [form, setForm] = useState({ item: '', supplier: '', qty: '', unit: 'kg', batch: '', notes: '' });

  const recentLots = [
    { id: 'LOT-0084', item: 'Pomfret (Large)', supplier: 'Oceanic Seafoods', qty: '80 kg', date: '18 May 2026', time: '08:30 AM' },
    { id: 'LOT-0083', item: 'Tiger Prawns', supplier: 'Fresh Catch', qty: '50 kg', date: '18 May 2026', time: '07:45 AM' },
    { id: 'LOT-0082', item: 'King Fish (Whole)', supplier: 'Deep Sea Traders', qty: '120 kg', date: '17 May 2026', time: '09:00 AM' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold flex items-center">
            <span className="bg-cyan-600 text-white p-1.5 rounded-lg mr-2"><i className="fas fa-truck-loading"></i></span>
            Receive New Lot
          </h1>
          <p className="text-xs text-slate-500 font-medium mt-1">Log incoming raw material for processing</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Form */}
        <div className="lg:col-span-2 card shadow-sm border-0 bg-white">
          <div className="card-header py-3 bg-gradient-to-r from-cyan-50 to-blue-50 border-b border-slate-100">
            <h5 className="text-sm font-bold text-slate-700 uppercase tracking-wider"><i className="fas fa-plus-circle mr-2 text-cyan-500"></i> New Lot Entry</h5>
          </div>
          <div className="card-body space-y-4">
            <div>
              <label className="text-[10px] text-slate-500 font-bold uppercase tracking-widest block mb-1">Product / Item</label>
              <select className="form-control h-10 text-sm w-full" value={form.item} onChange={e => setForm({ ...form, item: e.target.value })}>
                <option value="">Select item...</option>
                <option>King Fish (Whole)</option><option>Tiger Prawns (Jumbo)</option><option>Pomfret (Large)</option><option>Salmon Fillet</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-slate-500 font-bold uppercase tracking-widest block mb-1">Supplier</label>
              <select className="form-control h-10 text-sm w-full" value={form.supplier} onChange={e => setForm({ ...form, supplier: e.target.value })}>
                <option value="">Select supplier...</option>
                <option>Oceanic Seafoods</option><option>Fresh Catch Pvt Ltd</option><option>Deep Sea Traders</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] text-slate-500 font-bold uppercase tracking-widest block mb-1">Quantity</label>
                <input type="number" className="form-control h-10 text-sm w-full" placeholder="0" value={form.qty} onChange={e => setForm({ ...form, qty: e.target.value })} />
              </div>
              <div>
                <label className="text-[10px] text-slate-500 font-bold uppercase tracking-widest block mb-1">Unit</label>
                <select className="form-control h-10 text-sm w-full" value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })}>
                  <option>kg</option><option>pcs</option><option>box</option>
                </select>
              </div>
            </div>
            <div>
              <label className="text-[10px] text-slate-500 font-bold uppercase tracking-widest block mb-1">Batch / Vehicle No.</label>
              <input type="text" className="form-control h-10 text-sm w-full" placeholder="e.g. MH-01-AB-1234" value={form.batch} onChange={e => setForm({ ...form, batch: e.target.value })} />
            </div>
            <div>
              <label className="text-[10px] text-slate-500 font-bold uppercase tracking-widest block mb-1">Notes</label>
              <textarea className="form-control text-sm w-full" rows={2} placeholder="Quality notes, temp reading..." value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
            </div>
            <button className="w-full bg-cyan-600 text-white font-bold py-2.5 rounded-lg shadow-lg hover:bg-cyan-700 transition-all text-sm">
              <i className="fas fa-check-circle mr-2"></i> Receive & Log Lot
            </button>
          </div>
        </div>

        {/* Recent Lots */}
        <div className="lg:col-span-3 card shadow-sm border-0 overflow-hidden bg-white">
          <div className="card-header py-3 bg-slate-50 border-b border-slate-100">
            <h5 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Recently Received</h5>
          </div>
          <div className="card-body p-0">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 font-bold uppercase border-b border-slate-100">
                <tr><th className="px-4 py-3">Lot #</th><th className="px-4 py-3">Item</th><th className="px-4 py-3">Supplier</th><th className="px-4 py-3">Qty</th><th className="px-4 py-3">Date / Time</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recentLots.map(l => (
                  <tr key={l.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 font-bold text-cyan-600">{l.id}</td>
                    <td className="px-4 py-3 font-medium text-slate-700">{l.item}</td>
                    <td className="px-4 py-3 text-slate-500">{l.supplier}</td>
                    <td className="px-4 py-3 font-bold">{l.qty}</td>
                    <td className="px-4 py-3 text-slate-500">{l.date} <span className="text-slate-400">• {l.time}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ReceiveLot;

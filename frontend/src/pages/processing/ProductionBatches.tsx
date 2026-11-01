import { useState } from 'react';

const ProductionBatches = () => {
  const [filter, setFilter] = useState('all');

  const batches = [
    { id: 'BATCH-0045', recipe: 'Fish Finger Pack (500g)', lot: 'LOT-0082', input: '40 kg', output: '36.8 kg', yield: 92, packs: 74, started: '18 May 09:00', status: 'in-progress' },
    { id: 'BATCH-0044', recipe: 'Prawn Masala Ready Pack', lot: 'LOT-0083', input: '25 kg', output: '22 kg', yield: 88, packs: 88, started: '18 May 08:00', status: 'completed' },
    { id: 'BATCH-0043', recipe: 'Pomfret Steaks (4 pcs)', lot: 'LOT-0080', input: '55 kg', output: '40 kg', yield: 73, packs: 100, started: '17 May 10:00', status: 'completed' },
    { id: 'BATCH-0042', recipe: 'Fish Finger Pack (500g)', lot: 'LOT-0079', input: '30 kg', output: '27.6 kg', yield: 92, packs: 55, started: '17 May 08:30', status: 'completed' },
    { id: 'BATCH-0041', recipe: 'Surimi Balls (250g)', lot: 'LOT-0078', input: '20 kg', output: '—', yield: 0, packs: 0, started: '16 May 14:00', status: 'cancelled' },
  ];

  const filtered = filter === 'all' ? batches : batches.filter(b => b.status === filter);
  const statusStyles: Record<string, string> = { 'in-progress': 'bg-blue-100 text-blue-700', completed: 'bg-green-100 text-green-700', cancelled: 'bg-red-100 text-red-700' };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold flex items-center">
            <span className="bg-indigo-600 text-white p-1.5 rounded-lg mr-2"><i className="fas fa-industry"></i></span>
            Production Batches
          </h1>
          <p className="text-xs text-slate-500 font-medium mt-1">Track production runs, yield, and output packs</p>
        </div>
        <button className="bg-indigo-600 text-white font-bold py-2 px-5 rounded-lg shadow-lg hover:bg-indigo-700 transition-all flex items-center text-xs">
          <i className="fas fa-plus-circle mr-2"></i> Start New Batch
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Batches', value: batches.length, icon: 'fas fa-layer-group', bg: 'bg-indigo-100', fg: 'text-indigo-600' },
          { label: 'In Progress', value: batches.filter(b => b.status === 'in-progress').length, icon: 'fas fa-spinner', bg: 'bg-blue-100', fg: 'text-blue-600' },
          { label: 'Completed', value: batches.filter(b => b.status === 'completed').length, icon: 'fas fa-check-circle', bg: 'bg-green-100', fg: 'text-green-600' },
          { label: 'Total Packs', value: batches.reduce((s, b) => s + b.packs, 0), icon: 'fas fa-box', bg: 'bg-amber-100', fg: 'text-amber-600' },
        ].map(s => (
          <div key={s.label} className="bg-white p-4 rounded-xl shadow-sm border border-slate-100">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl ${s.bg} flex items-center justify-center`}><i className={`${s.icon} ${s.fg}`}></i></div>
              <div><div className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">{s.label}</div><div className="text-xl font-black text-slate-800">{s.value}</div></div>
            </div>
          </div>
        ))}
      </div>

      {/* Filter */}
      <div className="flex items-center gap-2 bg-white p-2 rounded-xl shadow-sm border border-slate-100">
        {['all', 'in-progress', 'completed', 'cancelled'].map(f => (
          <button key={f} onClick={() => setFilter(f)} className={`px-4 py-2 rounded-lg text-xs font-bold capitalize transition-all ${filter === f ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}>
            {f.replace('-', ' ')}
          </button>
        ))}
      </div>

      {/* Batch Table */}
      <div className="card shadow-sm border-0 overflow-hidden bg-white">
        <div className="card-body p-0 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#1a1a2e] text-white uppercase tracking-tighter">
              <tr>
                <th className="px-4 py-3">Batch #</th>
                <th className="px-4 py-3">Recipe</th>
                <th className="px-4 py-3">Source Lot</th>
                <th className="px-4 py-3 text-right">Input</th>
                <th className="px-4 py-3 text-right">Output</th>
                <th className="px-4 py-3 text-center">Yield</th>
                <th className="px-4 py-3 text-center">Packs</th>
                <th className="px-4 py-3">Started</th>
                <th className="px-4 py-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map(b => (
                <tr key={b.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 font-bold text-indigo-600">{b.id}</td>
                  <td className="px-4 py-3 font-medium text-slate-700">{b.recipe}</td>
                  <td className="px-4 py-3"><span className="px-2 py-0.5 rounded text-[9px] font-bold bg-cyan-50 text-cyan-600">{b.lot}</span></td>
                  <td className="px-4 py-3 text-right font-medium">{b.input}</td>
                  <td className="px-4 py-3 text-right font-bold">{b.output}</td>
                  <td className="px-4 py-3 text-center">
                    {b.yield > 0 ? (
                      <span className={`font-black ${b.yield >= 85 ? 'text-green-600' : b.yield >= 70 ? 'text-amber-600' : 'text-red-600'}`}>{b.yield}%</span>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3 text-center font-bold">{b.packs || '—'}</td>
                  <td className="px-4 py-3 text-slate-500">{b.started}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${statusStyles[b.status]}`}>{b.status.replace('-', ' ')}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default ProductionBatches;

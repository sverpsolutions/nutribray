import { Link } from 'react-router-dom';

const ProcessingDashboard = () => {
  const activeLots = [
    { id: 'LOT-0082', item: 'King Fish (Whole)', received: '17 May', qty: '120 kg', stage: 'Cutting', yield: '78%', status: 'in-progress' },
    { id: 'LOT-0083', item: 'Tiger Prawns', received: '18 May', qty: '50 kg', stage: 'Deveining', yield: '85%', status: 'in-progress' },
    { id: 'LOT-0084', item: 'Pomfret (Large)', received: '18 May', qty: '80 kg', stage: 'Receiving', yield: '—', status: 'queued' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold flex items-center">
            <span className="bg-cyan-600 text-white p-1.5 rounded-lg mr-2"><i className="fas fa-fish"></i></span>
            Processing Dashboard
          </h1>
          <p className="text-xs text-slate-500 font-medium mt-1">Fish & meat processing, lot tracking, yield management</p>
        </div>
        <div className="flex space-x-2">
          <Link to="/processing/receive" className="bg-cyan-600 text-white font-bold py-2 px-5 rounded-lg shadow-lg hover:bg-cyan-700 transition-all flex items-center text-xs">
            <i className="fas fa-plus-circle mr-2"></i> Receive New Lot
          </Link>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {[
          { label: 'Active Lots', value: '3', icon: 'fas fa-boxes', bg: 'bg-cyan-100', fg: 'text-cyan-600', vc: 'text-slate-800' },
          { label: 'Today Received', value: '250 kg', icon: 'fas fa-truck-loading', bg: 'bg-blue-100', fg: 'text-blue-600', vc: 'text-blue-600' },
          { label: 'In Processing', value: '170 kg', icon: 'fas fa-cogs', bg: 'bg-amber-100', fg: 'text-amber-600', vc: 'text-amber-600' },
          { label: 'Avg Yield', value: '81%', icon: 'fas fa-chart-line', bg: 'bg-green-100', fg: 'text-green-600', vc: 'text-green-600' },
          { label: 'Waste Today', value: '42 kg', icon: 'fas fa-trash', bg: 'bg-red-100', fg: 'text-red-600', vc: 'text-red-500' },
        ].map(k => (
          <div key={k.label} className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 hover:shadow-md transition-shadow">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl ${k.bg} flex items-center justify-center`}><i className={`${k.icon} ${k.fg}`}></i></div>
              <div><div className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">{k.label}</div><div className={`text-xl font-black ${k.vc}`}>{k.value}</div></div>
            </div>
          </div>
        ))}
      </div>

      {/* Processing Pipeline */}
      <div className="card shadow-sm border-0 bg-white">
        <div className="card-header py-3 bg-slate-50 border-b border-slate-100">
          <h5 className="text-sm font-bold text-slate-700 uppercase tracking-wider"><i className="fas fa-stream mr-2 text-cyan-500"></i> Processing Pipeline</h5>
        </div>
        <div className="card-body">
          <div className="grid grid-cols-5 gap-2 text-center">
            {['Receiving', 'Cleaning', 'Cutting', 'Packing', 'QC & Storage'].map((stage, i) => (
              <div key={stage} className="relative">
                <div className={`p-3 rounded-xl border-2 ${i < 3 ? 'border-cyan-300 bg-cyan-50' : 'border-slate-200 bg-slate-50'}`}>
                  <div className="text-lg font-black text-slate-700">{[2, 1, 1, 0, 0][i]}</div>
                  <div className="text-[9px] text-slate-500 font-bold uppercase mt-1">{stage}</div>
                </div>
                {i < 4 && <div className="absolute top-1/2 -right-2 text-slate-300"><i className="fas fa-chevron-right text-[10px]"></i></div>}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Active Lots Table */}
      <div className="card shadow-sm border-0 overflow-hidden bg-white">
        <div className="card-header py-3 bg-slate-50 border-b border-slate-100 flex justify-between items-center">
          <h5 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Active Lots</h5>
          <span className="text-[10px] text-slate-400 font-bold">Today: {new Date().toLocaleDateString('en-IN')}</span>
        </div>
        <div className="card-body p-0 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#1a1a2e] text-white uppercase tracking-tighter">
              <tr><th className="px-4 py-3">Lot #</th><th className="px-4 py-3">Item</th><th className="px-4 py-3">Received</th><th className="px-4 py-3">Quantity</th><th className="px-4 py-3">Current Stage</th><th className="px-4 py-3 text-center">Yield</th><th className="px-4 py-3 text-center">Status</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {activeLots.map(lot => (
                <tr key={lot.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 font-bold text-cyan-600">{lot.id}</td>
                  <td className="px-4 py-3 font-medium text-slate-700">{lot.item}</td>
                  <td className="px-4 py-3 text-slate-500">{lot.received}</td>
                  <td className="px-4 py-3 font-bold">{lot.qty}</td>
                  <td className="px-4 py-3"><span className="px-2 py-0.5 rounded text-[9px] font-bold bg-cyan-50 text-cyan-600">{lot.stage}</span></td>
                  <td className="px-4 py-3 text-center font-black text-green-600">{lot.yield}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${lot.status === 'in-progress' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>{lot.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Receive New Lot', icon: 'fas fa-truck-loading', color: 'bg-cyan-600', to: '/processing/receive' },
          { label: 'BOM Recipes', icon: 'fas fa-book', color: 'bg-purple-600', to: '/production/recipes' },
          { label: 'Production Batches', icon: 'fas fa-industry', color: 'bg-indigo-600', to: '/production/batches' },
          { label: 'Yield Reports', icon: 'fas fa-chart-pie', color: 'bg-green-600', to: '/reports/center' },
        ].map(a => (
          <Link key={a.label} to={a.to} className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 hover:shadow-md hover:-translate-y-0.5 transition-all flex items-center gap-3 group">
            <div className={`w-10 h-10 rounded-xl ${a.color} flex items-center justify-center text-white shadow-lg group-hover:scale-110 transition-transform`}><i className={a.icon}></i></div>
            <span className="text-sm font-bold text-slate-700">{a.label}</span>
            <i className="fas fa-chevron-right text-[10px] text-slate-300 ml-auto"></i>
          </Link>
        ))}
      </div>
    </div>
  );
};

export default ProcessingDashboard;

import { useState } from 'react';

interface LeaveRequest {
  id: number; emp: string; emp_id: string; dept: string; type: string;
  from: string; to: string; days: number; reason: string; status: 'pending' | 'approved' | 'rejected';
  applied: string;
}

const LeaveRequests = () => {
  const [filter, setFilter] = useState('all');

  const requests: LeaveRequest[] = [
    { id: 1, emp: 'Priya Singh', emp_id: 'EMP-042', dept: 'Accounts', type: 'Casual Leave', from: '20 May 2026', to: '22 May 2026', days: 3, reason: 'Family function', status: 'pending', applied: '15 May 2026' },
    { id: 2, emp: 'Ravi Patel', emp_id: 'EMP-015', dept: 'Logistics', type: 'Sick Leave', from: '21 May 2026', to: '21 May 2026', days: 1, reason: 'Fever & cold', status: 'pending', applied: '21 May 2026' },
    { id: 3, emp: 'Anita Das', emp_id: 'EMP-023', dept: 'Production', type: 'Earned Leave', from: '25 May 2026', to: '28 May 2026', days: 4, reason: 'Vacation trip', status: 'pending', applied: '12 May 2026' },
    { id: 4, emp: 'Sanjay Kumar', emp_id: 'EMP-001', dept: 'Production', type: 'Casual Leave', from: '10 May 2026', to: '10 May 2026', days: 1, reason: 'Personal work', status: 'approved', applied: '08 May 2026' },
    { id: 5, emp: 'Meera Nair', emp_id: 'EMP-055', dept: 'Sales', type: 'Sick Leave', from: '05 May 2026', to: '06 May 2026', days: 2, reason: 'Medical checkup', status: 'approved', applied: '04 May 2026' },
    { id: 6, emp: 'Rahul Sharma', emp_id: 'EMP-031', dept: 'Admin', type: 'Casual Leave', from: '01 May 2026', to: '01 May 2026', days: 1, reason: 'Personal', status: 'rejected', applied: '28 Apr 2026' },
  ];

  const filtered = filter === 'all' ? requests : requests.filter(r => r.status === filter);
  const pending = requests.filter(r => r.status === 'pending').length;

  const statusColors: Record<string, string> = {
    pending: 'bg-amber-100 text-amber-700',
    approved: 'bg-green-100 text-green-700',
    rejected: 'bg-red-100 text-red-700',
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold flex items-center">
            <span className="bg-amber-500 text-white p-1.5 rounded-lg mr-2"><i className="fas fa-calendar-times"></i></span>
            Leave Requests
          </h1>
          <p className="text-xs text-slate-500 font-medium mt-1">Manage employee leave applications</p>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Pending Approval', value: pending, color: 'text-amber-500', bg: 'bg-amber-100', icon: 'fas fa-hourglass-half text-amber-500' },
          { label: 'Approved (Month)', value: 2, color: 'text-green-600', bg: 'bg-green-100', icon: 'fas fa-check-circle text-green-500' },
          { label: 'Rejected (Month)', value: 1, color: 'text-red-500', bg: 'bg-red-100', icon: 'fas fa-times-circle text-red-500' },
          { label: 'Total This Month', value: requests.length, color: 'text-slate-800', bg: 'bg-blue-100', icon: 'fas fa-calendar text-blue-500' },
        ].map(s => (
          <div key={s.label} className="bg-white p-4 rounded-xl shadow-sm border border-slate-100">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl ${s.bg} flex items-center justify-center`}><i className={s.icon}></i></div>
              <div>
                <div className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">{s.label}</div>
                <div className={`text-2xl font-black ${s.color}`}>{s.value}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-2 bg-white p-2 rounded-xl shadow-sm border border-slate-100">
        {['all', 'pending', 'approved', 'rejected'].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-lg text-xs font-bold capitalize transition-all ${filter === f ? 'bg-violet-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}>
            {f} {f === 'pending' && pending > 0 && <span className="ml-1 bg-white/20 px-1.5 rounded-full text-[10px]">{pending}</span>}
          </button>
        ))}
      </div>

      {/* Leave Table */}
      <div className="card shadow-sm border-0 overflow-hidden bg-white">
        <div className="card-body p-0 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#1a1a2e] text-white uppercase tracking-tighter">
              <tr>
                <th className="px-4 py-3">Employee</th>
                <th className="px-4 py-3">Leave Type</th>
                <th className="px-4 py-3">Duration</th>
                <th className="px-4 py-3 text-center">Days</th>
                <th className="px-4 py-3">Reason</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map(r => (
                <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-violet-100 flex items-center justify-center text-violet-600 text-[10px] font-bold">{r.emp.charAt(0)}</div>
                      <div>
                        <div className="font-bold text-slate-700">{r.emp}</div>
                        <div className="text-[10px] text-slate-400">{r.emp_id} • {r.dept}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3"><span className="px-2 py-0.5 rounded text-[9px] font-bold bg-blue-50 text-blue-600">{r.type}</span></td>
                  <td className="px-4 py-3 font-medium text-slate-600">{r.from} — {r.to}</td>
                  <td className="px-4 py-3 text-center font-black text-slate-800">{r.days}</td>
                  <td className="px-4 py-3 text-slate-500 max-w-[150px] truncate">{r.reason}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${statusColors[r.status]}`}>{r.status}</span>
                  </td>
                  <td className="px-4 py-3">
                    {r.status === 'pending' ? (
                      <div className="flex justify-center gap-1">
                        <button className="bg-green-50 text-green-600 px-2.5 py-1 rounded font-bold hover:bg-green-100 text-[10px]">Approve</button>
                        <button className="bg-red-50 text-red-600 px-2.5 py-1 rounded font-bold hover:bg-red-100 text-[10px]">Reject</button>
                      </div>
                    ) : (
                      <div className="text-center text-[10px] text-slate-400 italic">Processed</div>
                    )}
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

export default LeaveRequests;

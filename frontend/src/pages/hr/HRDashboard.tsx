import { Link } from 'react-router-dom';

const HRDashboard = () => {
  const departments = [
    { name: 'Production', count: 18, color: '#0E5C63' },
    { name: 'Accounts', count: 6, color: '#059669' },
    { name: 'Logistics', count: 8, color: '#d97706' },
    { name: 'Sales', count: 5, color: '#7c3aed' },
    { name: 'Admin', count: 5, color: '#dc2626' },
  ];

  const leaves = [
    { emp: 'Priya Singh', dept: 'Accounts', from: '20 May', to: '22 May', type: 'Casual', status: 'approved' },
    { emp: 'Ravi Patel', dept: 'Logistics', from: '21 May', to: '21 May', type: 'Sick', status: 'pending' },
    { emp: 'Anita Das', dept: 'Production', from: '25 May', to: '28 May', type: 'Earned', status: 'pending' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold flex items-center">
            <span className="bg-violet-600 text-white p-1.5 rounded-lg mr-2"><i className="fas fa-users-cog"></i></span>
            HR Dashboard
          </h1>
          <p className="text-xs text-slate-500 font-medium mt-1">Human Resources & Workforce Management</p>
        </div>
        <div className="flex space-x-2">
          <Link to="/hr/attendance" className="btn btn-outline-dark text-xs px-4 h-9 flex items-center">
            <i className="fas fa-clock mr-2"></i> Attendance
          </Link>
          <Link to="/hr/employees" className="bg-violet-600 text-white font-bold py-2 px-5 rounded-lg shadow-lg hover:bg-violet-700 transition-all flex items-center text-xs">
            <i className="fas fa-users mr-2"></i> Employee Directory
          </Link>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {[
          { label: 'Total Staff', value: '42', icon: 'fas fa-users', bg: 'bg-violet-100', fg: 'text-violet-600', valColor: 'text-slate-800' },
          { label: 'Present Today', value: '38', icon: 'fas fa-user-check', bg: 'bg-green-100', fg: 'text-green-600', valColor: 'text-green-600' },
          { label: 'On Leave', value: '4', icon: 'fas fa-calendar-times', bg: 'bg-amber-100', fg: 'text-amber-600', valColor: 'text-amber-500' },
          { label: 'Absent', value: '0', icon: 'fas fa-user-times', bg: 'bg-red-100', fg: 'text-red-600', valColor: 'text-red-500' },
          { label: 'Monthly Payroll', value: '₹8.45L', icon: 'fas fa-rupee-sign', bg: 'bg-indigo-100', fg: 'text-indigo-600', valColor: 'text-indigo-600' },
        ].map(k => (
          <div key={k.label} className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 hover:shadow-md transition-shadow">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl ${k.bg} flex items-center justify-center`}><i className={`${k.icon} ${k.fg}`}></i></div>
              <div>
                <div className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">{k.label}</div>
                <div className={`text-2xl font-black ${k.valColor}`}>{k.value}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Department + Attendance */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 card shadow-sm border-0 bg-white">
          <div className="card-header py-3 bg-slate-50 border-b border-slate-100">
            <h5 className="text-sm font-bold text-slate-700 uppercase tracking-wider"><i className="fas fa-sitemap mr-2 text-violet-500"></i> Department Distribution</h5>
          </div>
          <div className="card-body">
            <div className="space-y-3">
              {departments.map(d => (
                <div key={d.name} className="flex items-center gap-4">
                  <div className="w-28 text-xs font-semibold text-slate-600">{d.name}</div>
                  <div className="flex-1 h-7 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full flex items-center justify-end pr-3 text-[10px] font-bold text-white" style={{ width: `${(d.count / 42) * 100}%`, backgroundColor: d.color }}>{d.count}</div>
                  </div>
                  <div className="w-12 text-right text-xs font-bold text-slate-500">{((d.count / 42) * 100).toFixed(0)}%</div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="card shadow-sm border-0 bg-white">
          <div className="card-header py-3 bg-slate-50 border-b border-slate-100">
            <h5 className="text-sm font-bold text-slate-700 uppercase tracking-wider"><i className="fas fa-clock mr-2 text-green-500"></i> Today's Status</h5>
          </div>
          <div className="card-body flex flex-col items-center justify-center py-6">
            <div className="relative w-36 h-36">
              <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#e2e8f0" strokeWidth="3" />
                <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#16a34a" strokeWidth="3" strokeDasharray="90.5, 100" strokeLinecap="round" />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-3xl font-black text-slate-800">90%</span>
                <span className="text-[10px] text-slate-400 font-bold uppercase">Attendance</span>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-4 text-center w-full">
              <div><div className="text-lg font-black text-green-600">38</div><div className="text-[9px] text-slate-400 font-bold uppercase">Present</div></div>
              <div><div className="text-lg font-black text-amber-500">4</div><div className="text-[9px] text-slate-400 font-bold uppercase">Leave</div></div>
              <div><div className="text-lg font-black text-red-500">0</div><div className="text-[9px] text-slate-400 font-bold uppercase">Absent</div></div>
            </div>
          </div>
        </div>
      </div>

      {/* Upcoming Leaves */}
      <div className="card shadow-sm border-0 bg-white">
        <div className="card-header py-3 bg-slate-50 border-b border-slate-100 flex justify-between items-center">
          <h5 className="text-sm font-bold text-slate-700 uppercase tracking-wider"><i className="fas fa-calendar-alt mr-2 text-amber-500"></i> Upcoming Leaves</h5>
          <Link to="/hr/leaves" className="text-blue-600 text-[10px] font-bold uppercase hover:underline">View All →</Link>
        </div>
        <div className="card-body p-0">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 font-bold uppercase border-b border-slate-100">
              <tr><th className="px-4 py-3">Employee</th><th className="px-4 py-3">Department</th><th className="px-4 py-3">Duration</th><th className="px-4 py-3">Type</th><th className="px-4 py-3 text-center">Status</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {leaves.map((l, i) => (
                <tr key={i} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 font-bold text-slate-700">{l.emp}</td>
                  <td className="px-4 py-3 text-slate-500">{l.dept}</td>
                  <td className="px-4 py-3 font-medium text-slate-600">{l.from} — {l.to}</td>
                  <td className="px-4 py-3"><span className="px-2 py-0.5 rounded text-[9px] font-bold bg-blue-50 text-blue-600">{l.type}</span></td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${l.status === 'approved' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>{l.status}</span>
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
          { label: 'Mark Attendance', icon: 'fas fa-clipboard-check', color: 'bg-green-600', to: '/hr/attendance' },
          { label: 'Leave Requests', icon: 'fas fa-calendar-times', color: 'bg-amber-600', to: '/hr/leaves' },
          { label: 'Generate Salary', icon: 'fas fa-file-invoice-dollar', color: 'bg-indigo-600', to: '/hr/salary' },
          { label: 'Employee Master', icon: 'fas fa-id-card', color: 'bg-violet-600', to: '/hr/employees' },
        ].map(a => (
          <Link key={a.label} to={a.to} className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 hover:shadow-md hover:-translate-y-0.5 transition-all flex items-center gap-3 group">
            <div className={`w-10 h-10 rounded-xl ${a.color} flex items-center justify-center text-white shadow-lg group-hover:scale-110 transition-transform`}><i className={a.icon}></i></div>
            <span className="text-sm font-bold text-slate-700">{a.label}</span>
            <i className="fas fa-chevron-right text-[10px] text-slate-300 ml-auto group-hover:text-slate-500"></i>
          </Link>
        ))}
      </div>
    </div>
  );
};

export default HRDashboard;

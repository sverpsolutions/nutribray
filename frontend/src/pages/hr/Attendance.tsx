import React, { useState, useEffect } from 'react';

const Attendance = () => {
  const [lastUpdated, setLastUpdated] = useState(new Date().toLocaleTimeString());

  const stats = [
    { label: 'Total Employees', value: 42, icon: 'fas fa-users', color: 'text-blue-600' },
    { label: 'Present Today', value: 38, icon: 'fas fa-user-check', color: 'text-green-600' },
    { label: 'In Office', value: 34, icon: 'fas fa-building', color: 'text-amber-500' },
    { label: 'Absent', value: 4, icon: 'fas fa-user-times', color: 'text-red-600' },
  ];

  const attendance = [
    { id: 1, name: 'Sanjay Kumar', code: 'EMP-001', in: '09:05 AM', out: '06:15 PM', dur: '9h 10m', status: 'complete' },
    { id: 2, name: 'Priya Singh', code: 'EMP-042', in: '09:30 AM', out: '—', dur: '—', status: 'in-office' },
    { id: 3, name: 'Rahul Dev', code: 'FLD-09', in: '10:00 AM', out: '—', dur: '—', status: 'field-in' },
    { id: 4, name: 'Ankit Sharma', code: 'EMP-112', in: '09:15 AM', out: '—', dur: '—', status: 'in-office' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold flex items-center">
            <span className="bg-amber-500 text-white p-1 rounded mr-2"><i className="fas fa-calendar-check"></i></span>
            Today's Attendance
          </h1>
          <p className="text-xs text-slate-500 font-medium mt-1">{new Date().toDateString()}</p>
        </div>
        <div className="flex items-center space-x-4">
           <span className="text-[10px] text-slate-400 font-bold uppercase">Updated: {lastUpdated}</span>
           <button className="btn btn-outline-dark btn-sm"><i className="fas fa-sync-alt mr-2"></i> Refresh</button>
           <button className="bg-slate-900 text-white font-bold py-2 px-6 rounded shadow-lg hover:bg-slate-800 transition-all text-xs">
             <i className="fas fa-plus mr-2"></i> Manual Entry
           </button>
        </div>
      </div>

      {/* Attendance Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
         {stats.map((s, i) => (
           <div key={i} className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 flex items-center space-x-4">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg bg-slate-50 ${s.color}`}>
                 <i className={s.icon}></i>
              </div>
              <div>
                 <div className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">{s.label}</div>
                 <div className="text-xl font-black text-slate-800">{s.value}</div>
              </div>
           </div>
         ))}
      </div>

      {/* Attendance Table */}
      <div className="card shadow-sm border-0 overflow-hidden bg-white">
         <div className="card-header bg-slate-50 py-3 px-4 border-b border-slate-100 flex justify-between items-center">
            <h5 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Punch Log</h5>
            <div className="flex space-x-2">
               <span className="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded font-bold uppercase">Manual entries allowed</span>
            </div>
         </div>
         <div className="card-body p-0 overflow-x-auto">
            <table className="w-full text-left text-xs">
               <thead className="bg-slate-800 text-white uppercase tracking-tighter">
                  <tr>
                    <th className="px-4 py-3">Employee</th>
                    <th className="px-4 py-3">IN Time</th>
                    <th className="px-4 py-3">OUT Time</th>
                    <th className="px-4 py-3">Duration</th>
                    <th className="px-4 py-3 text-center">Status</th>
                  </tr>
               </thead>
               <tbody className="divide-y divide-slate-100">
                  {attendance.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50 transition-colors">
                       <td className="px-4 py-3">
                          <div className="font-bold text-slate-800">{row.name}</div>
                          <div className="text-[10px] text-slate-400 font-mono">{row.code}</div>
                       </td>
                       <td className="px-4 py-3">
                          <span className="text-green-600 font-bold font-mono">{row.in}</span>
                       </td>
                       <td className="px-4 py-3">
                          <span className={`${row.out === '—' ? 'text-slate-300' : 'text-rose-600 font-bold font-mono'}`}>{row.out}</span>
                       </td>
                       <td className="px-4 py-3">
                          <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-bold font-mono text-[10px]">{row.dur}</span>
                       </td>
                       <td className="px-4 py-3 text-center">
                          <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase ${
                            row.status === 'complete' ? 'bg-green-100 text-green-700' : 
                            row.status === 'in-office' ? 'bg-amber-100 text-amber-700' : 
                            'bg-blue-100 text-blue-700'
                          }`}>
                             {row.status.replace('-', ' ')}
                          </span>
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

export default Attendance;

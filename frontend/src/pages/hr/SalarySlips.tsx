import { useState } from 'react';

const SalarySlips = () => {
  const [month, setMonth] = useState('May 2026');
  const slips = [
    { id: 1, emp: 'Sanjay Kumar', emp_id: 'EMP-001', dept: 'Production', basic: 25000, hra: 10000, da: 5000, pf: 3000, esi: 1500, tax: 2000, net: 33500, status: 'paid' },
    { id: 2, emp: 'Priya Singh', emp_id: 'EMP-042', dept: 'Accounts', basic: 30000, hra: 12000, da: 6000, pf: 3600, esi: 1800, tax: 3500, net: 39100, status: 'paid' },
    { id: 3, emp: 'Ravi Patel', emp_id: 'EMP-015', dept: 'Logistics', basic: 18000, hra: 7200, da: 3600, pf: 2160, esi: 1080, tax: 0, net: 25560, status: 'pending' },
    { id: 4, emp: 'Anita Das', emp_id: 'EMP-023', dept: 'Production', basic: 20000, hra: 8000, da: 4000, pf: 2400, esi: 1200, tax: 500, net: 27900, status: 'pending' },
    { id: 5, emp: 'Vikram Shah', emp_id: 'EMP-098', dept: 'Sales', basic: 28000, hra: 11200, da: 5600, pf: 3360, esi: 1680, tax: 2800, net: 36960, status: 'draft' },
  ];

  const totalGross = slips.reduce((s, e) => s + e.basic + e.hra + e.da, 0);
  const totalDeductions = slips.reduce((s, e) => s + e.pf + e.esi + e.tax, 0);
  const totalNet = slips.reduce((s, e) => s + e.net, 0);

  const statusStyles: Record<string, string> = { paid: 'bg-green-100 text-green-700', pending: 'bg-amber-100 text-amber-700', draft: 'bg-slate-100 text-slate-600' };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold flex items-center">
            <span className="bg-indigo-600 text-white p-1.5 rounded-lg mr-2"><i className="fas fa-file-invoice-dollar"></i></span>
            Salary Slips
          </h1>
          <p className="text-xs text-slate-500 font-medium mt-1">Monthly payroll & salary management</p>
        </div>
        <div className="flex space-x-2">
          <select className="form-control w-40 h-9 text-xs" value={month} onChange={e => setMonth(e.target.value)}>
            <option>May 2026</option><option>April 2026</option><option>March 2026</option>
          </select>
          <button className="bg-indigo-600 text-white font-bold py-2 px-5 rounded-lg shadow-lg hover:bg-indigo-700 transition-all flex items-center text-xs">
            <i className="fas fa-calculator mr-2"></i> Generate Payroll
          </button>
        </div>
      </div>

      {/* Payroll Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Gross', value: `₹${(totalGross / 100000).toFixed(2)}L`, icon: 'fas fa-coins', bg: 'bg-blue-100', fg: 'text-blue-600' },
          { label: 'Total Deductions', value: `₹${(totalDeductions / 1000).toFixed(1)}K`, icon: 'fas fa-minus-circle', bg: 'bg-red-100', fg: 'text-red-600' },
          { label: 'Net Payable', value: `₹${(totalNet / 100000).toFixed(2)}L`, icon: 'fas fa-hand-holding-usd', bg: 'bg-green-100', fg: 'text-green-600' },
          { label: 'Employees', value: slips.length, icon: 'fas fa-users', bg: 'bg-violet-100', fg: 'text-violet-600' },
        ].map(s => (
          <div key={s.label} className="bg-white p-4 rounded-xl shadow-sm border border-slate-100">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl ${s.bg} flex items-center justify-center`}><i className={`${s.icon} ${s.fg}`}></i></div>
              <div>
                <div className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">{s.label}</div>
                <div className="text-xl font-black text-slate-800">{s.value}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Salary Table */}
      <div className="card shadow-sm border-0 overflow-hidden bg-white">
        <div className="card-header py-3 bg-slate-50 border-b border-slate-100 flex justify-between items-center">
          <h5 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Salary Breakdown — {month}</h5>
          <button className="text-xs text-blue-600 font-bold hover:underline"><i className="fas fa-download mr-1"></i> Export Excel</button>
        </div>
        <div className="card-body p-0 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#1a1a2e] text-white uppercase tracking-tighter">
              <tr>
                <th className="px-4 py-3">Employee</th>
                <th className="px-4 py-3 text-right">Basic</th>
                <th className="px-4 py-3 text-right">HRA</th>
                <th className="px-4 py-3 text-right">DA</th>
                <th className="px-4 py-3 text-right">PF</th>
                <th className="px-4 py-3 text-right">ESI</th>
                <th className="px-4 py-3 text-right">Tax</th>
                <th className="px-4 py-3 text-right">Net Pay</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {slips.map(s => (
                <tr key={s.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-bold text-slate-700">{s.emp}</div>
                    <div className="text-[10px] text-slate-400">{s.emp_id} • {s.dept}</div>
                  </td>
                  <td className="px-4 py-3 text-right font-medium">₹{s.basic.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right">₹{s.hra.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right">₹{s.da.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right text-red-500">-₹{s.pf.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right text-red-500">-₹{s.esi.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right text-red-500">-₹{s.tax.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right font-black text-slate-900">₹{s.net.toLocaleString()}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${statusStyles[s.status]}`}>{s.status}</span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button className="p-1.5 text-slate-400 hover:text-blue-600" title="Download PDF"><i className="fas fa-file-pdf"></i></button>
                    <button className="p-1.5 text-slate-400 hover:text-green-600" title="Send to Employee"><i className="fas fa-paper-plane"></i></button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-slate-50 font-bold text-xs border-t-2 border-slate-200">
              <tr>
                <td className="px-4 py-3 uppercase text-slate-600">Totals</td>
                <td className="px-4 py-3 text-right">₹{slips.reduce((s, e) => s + e.basic, 0).toLocaleString()}</td>
                <td className="px-4 py-3 text-right">₹{slips.reduce((s, e) => s + e.hra, 0).toLocaleString()}</td>
                <td className="px-4 py-3 text-right">₹{slips.reduce((s, e) => s + e.da, 0).toLocaleString()}</td>
                <td className="px-4 py-3 text-right text-red-500">-₹{slips.reduce((s, e) => s + e.pf, 0).toLocaleString()}</td>
                <td className="px-4 py-3 text-right text-red-500">-₹{slips.reduce((s, e) => s + e.esi, 0).toLocaleString()}</td>
                <td className="px-4 py-3 text-right text-red-500">-₹{slips.reduce((s, e) => s + e.tax, 0).toLocaleString()}</td>
                <td className="px-4 py-3 text-right text-green-700">₹{totalNet.toLocaleString()}</td>
                <td></td><td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
};

export default SalarySlips;

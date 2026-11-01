import React, { useState } from 'react';

const EmployeeDirectory = () => {
  const [searchQuery, setSearchQuery] = useState('');

  const employees = [
    { id: 1, name: 'Sanjay Kumar', emp_id: 'EMP-001', dept: 'Production', design: 'Executive', status: 'active', mobile: '9876543210', joined: '01 Jan 2022' },
    { id: 2, name: 'Priya Singh', emp_id: 'EMP-042', dept: 'Accounts', design: 'Sr. Accountant', status: 'active', mobile: '9123456789', joined: '15 Mar 2023' },
    { id: 3, name: 'Amit Verma', emp_id: 'EMP-088', dept: 'Logistics', design: 'Driver', status: 'on-leave', mobile: '8877665544', joined: '10 Feb 2024' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold flex items-center">
            <span className="bg-rose-600 text-white p-1 rounded mr-2"><i className="fas fa-users"></i></span>
            Employee Management
          </h1>
          <p className="text-xs text-slate-500 font-medium mt-1">HRIS & Payroll Administration</p>
        </div>
        <div className="flex space-x-2">
           <button className="bg-rose-600 text-white font-bold py-2 px-6 rounded shadow-lg hover:bg-rose-700 transition-all flex items-center">
             <i className="fas fa-user-plus mr-2"></i> Onboard Employee
           </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100">
           <div className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1">Total Strength</div>
           <div className="text-2xl font-black text-slate-800">42 Employees</div>
        </div>
        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100">
           <div className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1">Present Today</div>
           <div className="text-2xl font-black text-green-600">38 (90%)</div>
        </div>
        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100">
           <div className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1">On Leave</div>
           <div className="text-2xl font-black text-amber-500">4 Employees</div>
        </div>
        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100">
           <div className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1">Monthly Payroll</div>
           <div className="text-2xl font-black text-indigo-600">₹ 8.45 L</div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="card shadow-sm border-0 bg-white p-3 flex space-x-4 items-center">
        <div className="flex-1 relative">
          <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"></i>
          <input 
            type="text" 
            placeholder="Search by name, ID, department..." 
            className="form-control pl-10 h-10 text-sm"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <select className="form-control w-48 h-10 text-sm">
           <option value="">All Departments</option>
           <option value="1">Production</option>
           <option value="2">Accounts</option>
           <option value="3">Logistics</option>
        </select>
        <button className="btn btn-outline-dark h-10 text-xs px-4">
          <i className="fas fa-filter mr-2"></i> Filters
        </button>
      </div>

      {/* Employee List */}
      <div className="card shadow-sm border-0 overflow-hidden bg-white">
        <div className="card-body p-0 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#1a1a2e] text-white uppercase tracking-tighter">
              <tr>
                <th className="px-4 py-3">Employee</th>
                <th className="px-4 py-3">ID</th>
                <th className="px-4 py-3">Dept / Designation</th>
                <th className="px-4 py-3">Contact</th>
                <th className="px-4 py-3">Joined Date</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {employees.map((emp) => (
                <tr key={emp.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 flex items-center space-x-3">
                    <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center font-bold text-slate-500">
                      {emp.name.charAt(0)}
                    </div>
                    <div>
                      <div className="font-bold text-slate-800">{emp.name}</div>
                      <div className="text-[10px] text-slate-400">Verified</div>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono font-bold text-slate-600">{emp.emp_id}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-700">{emp.dept}</div>
                    <div className="text-[10px] text-slate-500">{emp.design}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-slate-600">{emp.mobile}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{emp.joined}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${emp.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                      {emp.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-center space-x-1">
                       <button className="p-1.5 text-slate-400 hover:text-blue-600" title="View Profile"><i className="fas fa-id-badge"></i></button>
                       <button className="p-1.5 text-slate-400 hover:text-orange-600" title="Attendance"><i className="fas fa-calendar-check"></i></button>
                       <button className="p-1.5 text-slate-400 hover:text-green-600" title="Payroll"><i className="fas fa-file-invoice-dollar"></i></button>
                    </div>
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

export default EmployeeDirectory;

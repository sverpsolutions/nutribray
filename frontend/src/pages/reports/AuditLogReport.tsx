import React, { useState, useEffect } from 'react';
import { audit_api } from '../../api/audit';
import { toast } from 'react-hot-toast';

export default function AuditLogReport() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    module: '',
    action: '',
    limit: 100
  });

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const res = await audit_api.list(filters);
      setLogs(res.data);
    } catch (e) {
      toast.error('Failed to fetch audit logs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [filters]);

  const getActionColor = (action: string) => {
    switch (action.toUpperCase()) {
      case 'CREATE': case 'ADD': return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
      case 'UPDATE': case 'EDIT': return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';
      case 'DELETE': return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
      case 'OPEN': return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
      case 'CLOSE': return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400';
      default: return 'bg-slate-100 text-slate-700';
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950">
      <div className="p-6 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-800 dark:text-white">Audit Logs</h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">Full activity history of all users</p>
          </div>
          <button 
            onClick={fetchLogs}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg font-bold text-sm hover:bg-blue-700 transition-colors shadow-lg shadow-blue-500/20"
          >
            <i className="fas fa-sync-alt mr-2"></i> Refresh
          </button>
        </div>

        <div className="flex flex-wrap gap-4">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-[10px] font-black uppercase text-slate-400 mb-1">Module</label>
            <input 
              type="text" 
              placeholder="e.g. products"
              className="w-full h-10 px-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-sm outline-none focus:ring-2 focus:ring-blue-500/20"
              value={filters.module}
              onChange={e => setFilters({...filters, module: e.target.value})}
            />
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="block text-[10px] font-black uppercase text-slate-400 mb-1">Action</label>
            <select 
              className="w-full h-10 px-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-sm outline-none focus:ring-2 focus:ring-blue-500/20"
              value={filters.action}
              onChange={e => setFilters({...filters, action: e.target.value})}
            >
              <option value="">All Actions</option>
              <option value="CREATE">CREATE</option>
              <option value="UPDATE">UPDATE</option>
              <option value="DELETE">DELETE</option>
              <option value="OPEN">OPEN</option>
              <option value="CLOSE">CLOSE</option>
              <option value="LOGIN">LOGIN</option>
            </select>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <i className="fas fa-spinner fa-spin text-3xl text-blue-500"></i>
          </div>
        ) : (
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/50">
                  <th className="px-6 py-4 text-[11px] font-black uppercase text-slate-400">Timestamp</th>
                  <th className="px-6 py-4 text-[11px] font-black uppercase text-slate-400">User</th>
                  <th className="px-6 py-4 text-[11px] font-black uppercase text-slate-400">Module</th>
                  <th className="px-6 py-4 text-[11px] font-black uppercase text-slate-400">Action</th>
                  <th className="px-6 py-4 text-[11px] font-black uppercase text-slate-400">Details</th>
                  <th className="px-6 py-4 text-[11px] font-black uppercase text-slate-400">IP Address</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
                    <td className="px-6 py-4 text-xs font-medium text-slate-600 dark:text-slate-300">
                      {new Date(log.created_at).toLocaleString('en-IN', {
                        day: '2-digit', month: 'short', year: 'numeric',
                        hour: '2-digit', minute: '2-digit', second: '2-digit'
                      })}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center text-[10px] font-bold text-blue-600 dark:text-blue-400">
                          {log.user_name?.charAt(0).toUpperCase()}
                        </div>
                        <span className="text-xs font-bold text-slate-700 dark:text-slate-200">{log.user_name}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-tighter">
                        {log.module}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 rounded text-[9px] font-black uppercase ${getActionColor(log.action)}`}>
                        {log.action}
                      </span>
                    </td>
                    <td className="px-6 py-4 max-w-xs">
                      <p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-2" title={log.description || log.details}>
                        {log.description || log.details || 'No details provided'}
                      </p>
                    </td>
                    <td className="px-6 py-4 text-xs text-slate-400 font-mono">
                      {log.ip_address || 'N/A'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {logs.length === 0 && (
              <div className="p-12 text-center text-slate-400 italic text-sm">
                No logs found for the selected filters.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

import React, { useState } from 'react';
import { X, Database, Folder, ShieldCheck, RefreshCw } from 'lucide-react';
import api from '../../api/axios';
import toast from 'react-hot-toast';

interface BackupModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function BackupModal({ isOpen, onClose }: BackupModalProps) {
  const [backupPath, setBackupPath] = useState('C:\\Backups\\Nutribray');
  const [backingUp, setBackingUp] = useState(false);

  const handleBackup = async () => {
    if (!backupPath) {
      toast.error("Please provide a destination path");
      return;
    }
    setBackingUp(true);
    try {
      const res = await api.post('/stock-reports/backup', { path: backupPath });
      toast.success(res.data.message || "Database backup successful!");
      onClose();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Backup failed");
    } finally {
      setBackingUp(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden border border-slate-200 animate-in zoom-in-95 duration-200 text-left">
        <div className="bg-slate-800 p-6 text-white flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="bg-slate-700 p-2 rounded-xl"><Database size={24} className="text-indigo-400" /></div>
            <div>
              <h3 className="text-lg font-black uppercase tracking-widest leading-none">Database Backup</h3>
              <p className="text-[9px] opacity-70 font-bold uppercase mt-1.5 tracking-tighter">System-level data preservation (PostgreSQL)</p>
            </div>
          </div>
          <button onClick={onClose} className="hover:bg-white/20 p-2 rounded-xl transition-colors"><X size={20} /></button>
        </div>
        <div className="p-8 space-y-6">
          <div className="bg-amber-50 border border-amber-200 p-4 rounded-2xl flex gap-3">
            <ShieldCheck className="text-amber-600 shrink-0" size={20} />
            <div>
              <p className="text-[10px] font-black text-amber-800 uppercase tracking-widest mb-1">Administrator Notice</p>
              <p className="text-xs text-amber-700 leading-relaxed font-medium">This process will create a full binary archive of the <b>nutribay_erp</b> database. Ensure the destination folder has write permissions.</p>
            </div>
          </div>
          
          <div className="space-y-3">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Destination Path (Server-side)</label>
            <div className="relative group">
              <Folder className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-500 transition-colors" size={18} />
              <input 
                type="text" 
                placeholder="C:\Backups\Nutribray" 
                className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all text-sm font-bold font-mono" 
                value={backupPath} 
                onChange={e => setBackupPath(e.target.value)} 
              />
            </div>
          </div>

          <div className="flex items-center gap-2 px-2 py-1">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Format: PostgreSQL Custom Archive (.backup)</span>
          </div>

          <button 
            onClick={handleBackup} 
            disabled={backingUp || !backupPath} 
            className="w-full bg-slate-900 hover:bg-black disabled:bg-slate-300 text-white py-4 rounded-2xl font-black uppercase tracking-widest text-xs flex items-center justify-center gap-3 shadow-xl shadow-slate-900/20 active:scale-[0.98] transition-all"
          >
            {backingUp ? <RefreshCw size={18} className="animate-spin" /> : <Database size={18} />} 
            {backingUp ? 'Creating Archive...' : 'Initialize Backup'}
          </button>
        </div>
      </div>
    </div>
  );
}

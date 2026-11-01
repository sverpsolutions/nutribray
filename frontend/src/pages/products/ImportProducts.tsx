import { useState, useEffect, useRef } from 'react';
import { import_export_api } from '../../api/import_export';
import toast from 'react-hot-toast';
import PageHeader from '../../components/ui/PageHeader';
import { downloadProfessionalTemplate } from '../../utils/templateGenerator';

// ── Main Component ──────────────────────────────────────────────────────────
const ImportProducts = () => {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'upload' | 'history'>('upload');
  const [autoCreate, setAutoCreate] = useState(true);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { loadHistory(); }, []);

  const loadHistory = async () => {
    try {
      const res = await import_export_api.getHistory();
      setHistory(res.data || []);
    } catch (e) { console.error(e); setHistory([]); }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) { setFile(f); setPreview(null); }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const f = e.dataTransfer.files?.[0];
    if (f && (f.name.endsWith('.xlsx') || f.name.endsWith('.xls') || f.name.endsWith('.csv'))) {
      setFile(f); setPreview(null);
    } else {
      toast.error('Please drop an Excel (.xlsx) or CSV file');
    }
  };

  const handlePreview = async () => {
    if (!file) return;
    setLoading(true);
    try {
      const res = await import_export_api.previewImport(file);
      setPreview(res.data);
      toast.success(`Validated! ${res.data.total_valid} valid, ${res.data.total_error} errors`);
    } catch (e: any) {
      toast.error(e.response?.data?.detail || "Validation failed — check backend server");
    } finally { setLoading(false); }
  };

  const handleProcess = async () => {
    if (!file || !preview) return;
    setLoading(true);
    try {
      const res = await import_export_api.processImport(file.name, autoCreate);
      toast.success(`Imported ${res.data.imported} items successfully!`);
      setPreview(null);
      setFile(null);
      loadHistory();
      setActiveTab('history');
    } catch (e: any) {
      toast.error(e.response?.data?.detail || "Import failed");
    } finally { setLoading(false); }
  };

  const handleDownload = async () => {
    try {
      await downloadProfessionalTemplate();
      toast.success('Professional Excel template downloaded!');
    } catch (e) {
      console.error(e);
      toast.error('Template generation failed');
    }
  };

  return (
    <div className="w-full">
      <PageHeader 
        title="Excel Import System" 
        subtitle="Bulk import and manage your product catalog efficiently"
        icon="fa-file-import"
        action={
          <div className="flex gap-2">
            <button onClick={handleDownload}
              className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black uppercase tracking-widest rounded-xl shadow-lg shadow-emerald-500/20 transition-all italic">
              <i className="fas fa-download"></i> Download Template
            </button>
          </div>
        }
      />

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        <button onClick={() => setActiveTab('upload')} className={`px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest italic transition-all ${activeTab === 'upload' ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' : 'bg-white dark:bg-slate-800 text-slate-400 hover:text-slate-600'}`}>
          <i className="fas fa-upload mr-2"></i> Upload & Import
        </button>
        <button onClick={() => setActiveTab('history')} className={`px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest italic transition-all ${activeTab === 'history' ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' : 'bg-white dark:bg-slate-800 text-slate-400 hover:text-slate-600'}`}>
          <i className="fas fa-history mr-2"></i> Import History
        </button>
      </div>

      {/* ── Upload Tab ────────────────────────────────────────────────────── */}
      {activeTab === 'upload' && (
        <div className="space-y-6">
          {!preview ? (
            <div
              onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleDrop}
              className={`bg-white dark:bg-slate-900 rounded-2xl border-2 border-dashed p-16 text-center transition-all cursor-pointer ${
                dragActive 
                  ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-900/10 scale-[1.01]' 
                  : 'border-slate-200 dark:border-slate-700 hover:border-blue-400'
              }`}
              onClick={() => !file && fileInputRef.current?.click()}
            >
              <div className={`w-24 h-24 rounded-2xl flex items-center justify-center mx-auto mb-6 transition-all ${
                dragActive ? 'bg-blue-100 dark:bg-blue-900/30' : 'bg-gradient-to-br from-emerald-50 to-blue-50 dark:from-emerald-900/20 dark:to-blue-900/20'
              }`}>
                <i className={`fas ${dragActive ? 'fa-bullseye fa-pulse' : file ? 'fa-file-excel' : 'fa-cloud-upload-alt'} text-4xl ${
                  dragActive ? 'text-blue-500' : file ? 'text-emerald-500' : 'text-blue-400'
                }`}></i>
              </div>
              
              {file ? (
                <>
                  <h3 className="text-lg font-black text-slate-800 dark:text-slate-100 mb-1 italic">{file.name}</h3>
                  <p className="text-slate-400 text-sm mb-6">{(file.size / 1024).toFixed(1)} KB • Ready for validation</p>
                </>
              ) : (
                <>
                  <h3 className="text-xl font-black text-slate-800 dark:text-slate-100 mb-2 italic">
                    {dragActive ? 'Drop it here!' : 'Ready to import items?'}
                  </h3>
                  <p className="text-slate-400 dark:text-slate-500 max-w-lg mx-auto mb-8 text-sm">
                    Drag & drop your Excel/CSV file here, or click to browse.<br/>
                    Use the <strong className="text-emerald-500">Download Template</strong> button above to get the correct format.
                  </p>
                </>
              )}
              
              <input type="file" ref={fileInputRef} onChange={handleFileSelect} className="hidden" accept=".xlsx,.xls,.csv" />
              
              <div className="flex items-center justify-center gap-3">
                <button onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                  className="px-6 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl text-xs font-black uppercase tracking-widest text-slate-600 dark:text-slate-300 transition-all">
                  <i className="fas fa-folder-open mr-2"></i> {file ? 'Change File' : 'Browse Files'}
                </button>
                {file && (
                  <button onClick={(e) => { e.stopPropagation(); handlePreview(); }} disabled={loading}
                    className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-black uppercase tracking-widest italic shadow-lg shadow-blue-500/20 transition-all flex items-center gap-2">
                    {loading ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-vial"></i>}
                    Validate & Preview
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Summary Cards */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm">
                  <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1 italic">Total Rows</p>
                  <p className="text-3xl font-black text-slate-800 dark:text-slate-100 italic">{preview.total_rows}</p>
                </div>
                <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-emerald-200 dark:border-emerald-900/30 shadow-sm">
                  <p className="text-[10px] font-black uppercase text-emerald-500 tracking-widest mb-1 italic">Valid Rows</p>
                  <p className="text-3xl font-black text-emerald-600 italic">{preview.total_valid}</p>
                </div>
                <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-rose-200 dark:border-rose-900/30 shadow-sm">
                  <p className="text-[10px] font-black uppercase text-rose-500 tracking-widest mb-1 italic">Error Rows</p>
                  <p className="text-3xl font-black text-rose-600 italic">{preview.total_error}</p>
                </div>
                <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm flex flex-col items-center justify-center gap-3">
                  <label className="flex items-center gap-2 cursor-pointer group">
                    <input type="checkbox" checked={autoCreate} onChange={e => setAutoCreate(e.target.checked)} 
                      className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                    <span className="text-[10px] font-black uppercase text-slate-400 group-hover:text-blue-500 italic transition-colors">Auto-create masters</span>
                  </label>
                  <button onClick={handleProcess} disabled={loading || preview.total_valid === 0}
                    className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white rounded-xl font-black uppercase tracking-widest italic shadow-lg shadow-blue-500/20 transition-all text-xs flex items-center justify-center gap-2">
                    {loading ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-cloud-upload-alt"></i>}
                    Import {preview.total_valid} Items
                  </button>
                </div>
              </div>

              {/* Preview Grid */}
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 overflow-hidden shadow-sm">
                <div className="bg-slate-50 dark:bg-slate-800/50 px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                  <h4 className="text-xs font-black uppercase tracking-widest italic text-slate-500">
                    <i className="fas fa-table mr-2 text-blue-500"></i> Import Preview
                  </h4>
                  <button onClick={() => { setPreview(null); setFile(null); }}
                    className="text-[10px] font-bold text-rose-500 hover:text-rose-600 uppercase transition-colors">
                    <i className="fas fa-times mr-1"></i> Cancel
                  </button>
                </div>
                <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="sticky top-0 z-10">
                      <tr className="bg-slate-50 dark:bg-slate-800/80">
                        <th className="px-4 py-3 font-bold text-slate-400 uppercase tracking-tighter">Row</th>
                        <th className="px-4 py-3 font-bold text-slate-400 uppercase tracking-tighter">Status</th>
                        <th className="px-4 py-3 font-bold text-slate-400 uppercase tracking-tighter">Item Code</th>
                        <th className="px-4 py-3 font-bold text-slate-400 uppercase tracking-tighter">Item Name</th>
                        <th className="px-4 py-3 font-bold text-slate-400 uppercase tracking-tighter">Hierarchy</th>
                        <th className="px-4 py-3 font-bold text-slate-400 uppercase tracking-tighter">Barcode</th>
                        <th className="px-4 py-3 font-bold text-slate-400 uppercase tracking-tighter min-w-[300px]">Errors</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                      {preview.rows.map((row: any, i: number) => (
                        <tr key={i} className={`transition-colors ${row.is_valid ? 'hover:bg-emerald-50/30 dark:hover:bg-emerald-900/5' : 'bg-rose-50/30 dark:bg-rose-900/5 hover:bg-rose-50/50'}`}>
                          <td className="px-4 py-3 font-mono font-bold text-slate-500">{row.row}</td>
                          <td className="px-4 py-3">
                            <span className={`px-2.5 py-1 rounded-full text-[9px] font-black uppercase ${row.is_valid ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400'}`}>
                              {row.is_valid ? '✓ VALID' : '✗ ERROR'}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-mono text-[10px] text-slate-500">{row.data['ITEM CODE']}</td>
                          <td className="px-4 py-3 font-bold text-slate-700 dark:text-slate-200">{row.data['ITEM NAME']}</td>
                          <td className="px-4 py-3 text-slate-400 text-[10px]">
                            {row.data['GROUP']} › {row.data['CATEGORY']} › {row.data['BRAND']}
                          </td>
                          <td className="px-4 py-3 font-mono text-slate-500 dark:text-slate-400 text-[10px]">{row.data['BARCODE']}</td>
                          <td className="px-4 py-3">
                            {row.errors?.length > 0 && row.errors.map((e: string, ei: number) => (
                              <p key={ei} className="text-rose-500 font-bold mb-0.5 text-[10px]">
                                <i className="fas fa-exclamation-triangle mr-1"></i> {e}
                              </p>
                            ))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── History Tab ───────────────────────────────────────────────────── */}
      {activeTab === 'history' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 overflow-hidden shadow-sm">
          {history.length === 0 ? (
            <div className="p-16 text-center">
              <div className="w-16 h-16 bg-slate-100 dark:bg-slate-800 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <i className="fas fa-inbox text-2xl text-slate-300"></i>
              </div>
              <p className="text-slate-400 font-bold italic">No import history yet</p>
              <p className="text-slate-300 text-sm mt-1">Your import logs will appear here after the first import</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/30">
                    <th className="px-6 py-4 font-bold text-slate-400 uppercase tracking-widest italic">Date</th>
                    <th className="px-6 py-4 font-bold text-slate-400 uppercase tracking-widest italic">File Name</th>
                    <th className="px-6 py-4 font-bold text-slate-400 uppercase tracking-widest italic text-center">Total</th>
                    <th className="px-6 py-4 font-bold text-slate-400 uppercase tracking-widest italic text-center">Success</th>
                    <th className="px-6 py-4 font-bold text-slate-400 uppercase tracking-widest italic text-center">Failed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                  {history.map((log: any, i: number) => (
                    <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                      <td className="px-6 py-4 font-bold text-slate-600 dark:text-slate-300 text-[11px]">
                        {new Date(log.created_at).toLocaleString('en-IN')}
                      </td>
                      <td className="px-6 py-4 font-medium text-slate-500">
                        <i className="fas fa-file-excel text-emerald-500 mr-2"></i> {log.filename}
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 px-3 py-1 rounded-full font-black italic">{log.total_rows}</span>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span className="bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 px-3 py-1 rounded-full font-black italic">{log.success_rows}</span>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span className={`px-3 py-1 rounded-full font-black italic ${log.failed_rows > 0 ? 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400' : 'bg-slate-100 dark:bg-slate-800 text-slate-400'}`}>{log.failed_rows}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ImportProducts;

// BOM import from Excel: preview (nothing saved) → create missing components + DRAFT BOMs → approve on BOM Approvals.
import { useState } from 'react';
import { toast } from 'react-hot-toast';
import api from '../../api/axios';
import Modal from '../../components/ui/Modal';
import { btnPri, btnSec, err, inp } from './mfgShared';

export default function BomImport({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [p, setP] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const send = async (commit: boolean) => {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    setBusy(true);
    try {
      const r = await api.post('/manufacturing/import/boms', fd, { params: { commit }, headers: { 'Content-Type': 'multipart/form-data' } });
      setP(r.data);
      if (commit) {
        const x = r.data.result;
        toast.success(`${x.boms.length} BOM(s) created as Draft${x.components ? `, ${x.components} new component item(s)` : ''} — approve them on BOM Approvals`);
        onDone();
      }
    } catch (e) { err(e); } finally { setBusy(false); }
  };
  const s = p?.summary;
  return (
    <>
      <button onClick={() => { setOpen(true); setP(null); setFile(null); }}
        className="px-4 py-2 border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg font-bold text-xs flex items-center gap-2">
        <i className="fas fa-file-excel" /> Import BOMs
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Import BOMs from Excel" width="full">
        <div className="space-y-3 text-sm">
          <p className="text-xs text-slate-500">Columns: <b>FINISHED ITEM | COMPONENT | QTY PER UNIT | UNIT | WASTAGE % | MATERIAL TYPE | ROUND UP | CREATE AS</b>.
            Quantities are for ONE unit (one tin); “1/36” = one carton per 36 tins. Items by code or exact name; CREATE AS = RM / PM makes a missing component.
            BOMs are created as Draft — approve them on BOM Approvals.</p>
          <div className="flex gap-2 items-end">
            <label className="flex-1 block"><span className="text-xs text-slate-600">Excel file</span>
              <input className={inp} type="file" accept=".xlsx" onChange={e => { setFile(e.target.files?.[0] || null); setP(null); }} /></label>
            <button className={btnSec} disabled={!file || busy} onClick={() => send(false)}>Preview</button>
          </div>
          {p && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-center">
                {[['Finished items', s.boms], ['Ready', s.ready], ['Already have a BOM', s.exists], ['With problems', s.with_problems], ['New components', s.new_components]].map(([k, v]) => (
                  <div key={k as string} className="border border-slate-200 rounded p-2"><div className="text-[11px] text-slate-500">{k}</div><div className="text-lg font-semibold">{v}</div></div>
                ))}
              </div>
              <div className="max-h-96 overflow-y-auto space-y-3">
                {p.boms.map((b: any) => (
                  <div key={b.fg_key} className={`border rounded-lg p-3 ${b.ok ? 'border-emerald-200' : 'border-rose-200'}`}>
                    <div className="font-semibold">{b.fg?.name || b.fg_key} {b.fg?.item_code && <span className="font-mono text-xs text-slate-500">{b.fg.item_code}</span>}
                      {b.exists && <span className="ml-2 text-amber-700 text-xs">already has BOM {b.exists} — skipped</span>}
                      {b.ok && <span className="ml-2 text-emerald-700 text-xs">ready</span>}</div>
                    {b.problems.map((x: string) => <div key={x} className="text-rose-600 text-xs">{x}</div>)}
                    <table className="w-full text-xs mt-2">
                      <thead className="text-slate-500"><tr><th className="text-left">Component</th><th className="text-right">Qty / unit</th><th>Unit</th><th className="text-right">Wastage</th><th>Type</th><th>Round up</th><th className="text-left">Note</th></tr></thead>
                      <tbody>{b.lines.map((l: any) => (
                        <tr key={l.row} className="border-t border-slate-100">
                          <td>{l.item ? <>{l.item.name} <span className="font-mono text-slate-400">{l.item.item_code}</span></> : l.comp}</td>
                          <td className="text-right">{l.qty_raw}</td><td className="text-center">{l.unit}</td><td className="text-right">{l.wastage}%</td>
                          <td className="text-center">{l.mtype}</td><td className="text-center">{l.round_up ? 'Y' : ''}</td>
                          <td>{l.will_create && <span className="text-indigo-700">new {l.create_as} item</span>}{l.problems.map((x: string) => <div key={x} className="text-rose-600">{x}</div>)}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                ))}
              </div>
              <div className="flex justify-end gap-2">
                <button className={btnSec} onClick={() => setOpen(false)}>Close</button>
                <button className={btnPri} disabled={busy || !s.ready} onClick={() => send(true)}>Create {s.ready} BOM(s)</button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </>
  );
}

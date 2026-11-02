import React, { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { stock_take_api, type StockTakeDetail, type StockTakeItem } from '../../api/stockTake'
import { getCompanySettings, type CompanySettings } from '../../api/company'

export default function StockTakeVariancePrint() {
  const { id } = useParams<{ id: string }>()
  const [session, setSession] = useState<StockTakeDetail | null>(null)
  const [company, setCompany] = useState<CompanySettings | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) return
    Promise.all([
      stock_take_api.get(Number(id)),
      getCompanySettings().catch(() => null)
    ])
      .then(([takeRes, compRes]) => {
        setSession(takeRes.data)
        if (compRes) setCompany(compRes)
      })
      .finally(() => setLoading(false))
  }, [id])

  if (loading) {
    return <div className="p-8 text-center text-slate-400">Loading variance report…</div>
  }

  if (!session) {
    return <div className="p-8 text-center text-red-600">Stock take session not found.</div>
  }

  // Shortages first, then surpluses
  const shortages = session.items.filter(i => i.variance !== null && i.variance < 0)
  const surpluses = session.items.filter(i => i.variance !== null && i.variance > 0)

  const totalShortageQty = shortages.reduce((acc, i) => acc + Math.abs(i.variance || 0), 0)
  const totalShortageVal = shortages.reduce((acc, i) => acc + Math.abs(i.value_impact || 0), 0)

  const totalSurplusQty = surpluses.reduce((acc, i) => acc + (i.variance || 0), 0)
  const totalSurplusVal = surpluses.reduce((acc, i) => acc + (i.value_impact || 0), 0)

  const netVarianceVal = totalSurplusVal - totalShortageVal

  return (
    <div className="bg-white p-8 max-w-5xl mx-auto font-sans text-slate-900 text-xs print:p-0">
      {/* ── TOP PRINT BUTTON BAR (Hidden in Print) ── */}
      <div className="flex justify-between items-center mb-6 pb-4 border-b border-slate-200 print:hidden">
        <div className="text-slate-500 font-medium">
          Stock Take Variance Report — Ready for Printing / PDF
        </div>
        <div className="space-x-2">
          <button
            onClick={() => window.print()}
            className="px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white font-bold rounded-lg text-xs shadow-xs cursor-pointer"
          >
            <i className="fas fa-print mr-1.5"></i> Print / Save as PDF
          </button>
          <button
            onClick={() => window.close()}
            className="px-4 py-2 border border-slate-300 text-slate-700 font-semibold rounded-lg text-xs hover:bg-slate-50 cursor-pointer"
          >
            Close Window
          </button>
        </div>
      </div>

      {/* ── COMPANY LETTERHEAD ── */}
      <div className="border-b-2 border-slate-800 pb-4 mb-4">
        <div className="flex justify-between items-start">
          <div className="flex items-start gap-4">
            <div className="w-16 h-16 rounded-xl border border-slate-200 bg-white p-1 flex items-center justify-center shrink-0 shadow-2xs">
              <img
                src={company?.logo_path || '/nutribay_logo.svg'}
                alt="NUTRIBRAY Logo"
                className="max-h-14 max-w-14 object-contain"
                onError={(e) => {
                  e.currentTarget.src = '/nutribay_logo.svg';
                }}
              />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-black uppercase tracking-wider px-2 py-0.5 rounded bg-[#8c2785] text-white">
                  {company?.brand_name || 'nutribray'}
                </span>
                <span className="text-xs font-bold text-slate-800">
                  {company?.legal_name || 'Nutribray'}
                </span>
              </div>
              <p className="text-[11px] text-slate-600 mt-1 max-w-xl leading-tight">
                {company?.ho_address || 'TR-311, 312, ALTF Mohan Cooperative Industrial Estate, Mathura Road, South Delhi – 110076'}
              </p>
              <p className="text-[10px] text-slate-500 font-mono mt-0.5">
                Ph: <strong className="text-slate-700">{company?.ho_phone || '74003 39365 / 82934 14222'}</strong> &nbsp;|&nbsp;
                Email: <strong className="text-slate-700">{company?.ho_email || ''}</strong> &nbsp;|&nbsp;
                GSTIN: <strong className="text-slate-700">{company?.gstin || '07AAACG1234F1Z5'}</strong>
              </p>
            </div>
          </div>
          <div className="text-right">
            <h2 className="text-lg font-black text-blue-900 bg-blue-50 px-3 py-1 rounded border border-blue-200 uppercase tracking-wide inline-block">
              PHYSICAL STOCK VARIANCE REPORT
            </h2>
            <div className="text-xs font-mono font-bold text-slate-800 mt-2">
              Ref #: {session.take_no}
            </div>
            <div className="text-[11px] text-slate-500">
              Date: {new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
            </div>
          </div>
        </div>
      </div>

      {/* ── SESSION META ── */}
      <div className="grid grid-cols-3 gap-4 mb-5 bg-slate-50 p-3 rounded border border-slate-200 text-xs">
        <div>
          <span className="text-slate-500 block font-bold text-[10px] uppercase">Outlet / Location</span>
          <b className="text-slate-800 text-sm">{session.location_name}</b>
        </div>
        <div>
          <span className="text-slate-500 block font-bold text-[10px] uppercase">Audit Timing</span>
          <div>Started: {new Date(session.started_at).toLocaleString()}</div>
          {session.finalized_at && <div>Finalized: {new Date(session.finalized_at).toLocaleString()}</div>}
        </div>
        <div>
          <span className="text-slate-500 block font-bold text-[10px] uppercase">Audited By</span>
          <div>Staff: <b>{session.started_by_name || 'System'}</b></div>
          <div>Status: <b className="uppercase">{session.status}</b> ({session.adjust_stock ? 'Adjusted' : 'Not Adjusted'})</div>
        </div>
      </div>

      {/* ── EXECUTIVE VARIANCE SUMMARY ── */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        <div className="border border-red-200 bg-red-50/50 p-3 rounded text-center">
          <div className="text-[10px] font-bold text-red-700 uppercase">Shortages Count</div>
          <div className="text-xl font-black text-red-700 font-mono mt-0.5">{shortages.length} items</div>
          <div className="text-[10px] text-red-600">Qty: −{totalShortageQty.toFixed(2)} | −₹{totalShortageVal.toFixed(2)}</div>
        </div>

        <div className="border border-blue-200 bg-blue-50/50 p-3 rounded text-center">
          <div className="text-[10px] font-bold text-blue-700 uppercase">Surpluses Count</div>
          <div className="text-xl font-black text-blue-700 font-mono mt-0.5">{surpluses.length} items</div>
          <div className="text-[10px] text-blue-600">Qty: +{totalSurplusQty.toFixed(2)} | +₹{totalSurplusVal.toFixed(2)}</div>
        </div>

        <div className="border border-slate-200 bg-slate-50 p-3 rounded text-center">
          <div className="text-[10px] font-bold text-slate-600 uppercase">Total Items Audited</div>
          <div className="text-xl font-black text-slate-800 font-mono mt-0.5">{session.counted_items}</div>
          <div className="text-[10px] text-slate-500">Out of {session.total_items} total</div>
        </div>

        <div className="border border-slate-300 bg-slate-100 p-3 rounded text-center">
          <div className="text-[10px] font-bold text-slate-700 uppercase">Net Value Impact</div>
          <div className={`text-xl font-black font-mono mt-0.5 ${netVarianceVal >= 0 ? 'text-blue-800' : 'text-red-700'}`}>
            {netVarianceVal >= 0 ? '+' : ''}₹{netVarianceVal.toFixed(2)}
          </div>
          <div className="text-[10px] text-slate-600">At Purchase Cost</div>
        </div>
      </div>

      {/* ── 1. SHORTAGES TABLE (FIRST) ── */}
      <div className="mb-6">
        <div className="bg-red-800 text-white px-3 py-1.5 font-bold uppercase tracking-wider text-xs flex justify-between">
          <span>1. Shortage Items (Missing Stock) — [{shortages.length} Items]</span>
          <span>Loss: −₹{totalShortageVal.toFixed(2)}</span>
        </div>
        <table className="w-full text-left text-xs border border-slate-300 border-collapse">
          <thead className="bg-slate-100 font-bold uppercase text-[10px] border-b border-slate-300">
            <tr>
              <th className="py-1.5 px-2 w-8">#</th>
              <th className="py-1.5 px-2 w-28">Item Code</th>
              <th className="py-1.5 px-2">Product Description</th>
              <th className="py-1.5 px-2 text-center w-12">Unit</th>
              <th className="py-1.5 px-2 text-right w-20">System Qty</th>
              <th className="py-1.5 px-2 text-right w-20">Counted</th>
              <th className="py-1.5 px-2 text-right w-20 text-red-700">Shortage</th>
              <th className="py-1.5 px-2 text-right w-20">Cost Rate</th>
              <th className="py-1.5 px-2 text-right w-24 text-red-700">Value Impact</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {shortages.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-3 text-center text-slate-400 italic">No shortages recorded.</td>
              </tr>
            ) : (
              shortages.map((it, idx) => (
                <tr key={it.id} className="border-b border-slate-200">
                  <td className="py-1 px-2 font-mono text-slate-500">{idx + 1}</td>
                  <td className="py-1 px-2 font-mono font-medium">{it.item_code || '—'}</td>
                  <td className="py-1 px-2 font-semibold text-slate-800">{it.product_name}</td>
                  <td className="py-1 px-2 text-center text-slate-500">{it.unit}</td>
                  <td className="py-1 px-2 text-right font-mono">{Number(it.system_qty).toFixed(2)}</td>
                  <td className="py-1 px-2 text-right font-mono font-bold">{Number(it.counted_qty || 0).toFixed(2)}</td>
                  <td className="py-1 px-2 text-right font-mono font-black text-red-700">
                    {it.variance !== null ? it.variance.toFixed(2) : '—'}
                  </td>
                  <td className="py-1 px-2 text-right font-mono text-slate-600">₹{it.cost_price.toFixed(2)}</td>
                  <td className="py-1 px-2 text-right font-mono font-bold text-red-700">
                    −₹{Math.abs(it.value_impact).toFixed(2)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ── 2. SURPLUSES TABLE (SECOND) ── */}
      <div className="mb-6">
        <div className="bg-blue-900 text-white px-3 py-1.5 font-bold uppercase tracking-wider text-xs flex justify-between">
          <span>2. Surplus Items (Excess Stock) — [{surpluses.length} Items]</span>
          <span>Surplus: +₹{totalSurplusVal.toFixed(2)}</span>
        </div>
        <table className="w-full text-left text-xs border border-slate-300 border-collapse">
          <thead className="bg-slate-100 font-bold uppercase text-[10px] border-b border-slate-300">
            <tr>
              <th className="py-1.5 px-2 w-8">#</th>
              <th className="py-1.5 px-2 w-28">Item Code</th>
              <th className="py-1.5 px-2">Product Description</th>
              <th className="py-1.5 px-2 text-center w-12">Unit</th>
              <th className="py-1.5 px-2 text-right w-20">System Qty</th>
              <th className="py-1.5 px-2 text-right w-20">Counted</th>
              <th className="py-1.5 px-2 text-right w-20 text-blue-700">Surplus</th>
              <th className="py-1.5 px-2 text-right w-20">Cost Rate</th>
              <th className="py-1.5 px-2 text-right w-24 text-blue-700">Value Impact</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {surpluses.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-3 text-center text-slate-400 italic">No surpluses recorded.</td>
              </tr>
            ) : (
              surpluses.map((it, idx) => (
                <tr key={it.id} className="border-b border-slate-200">
                  <td className="py-1 px-2 font-mono text-slate-500">{idx + 1}</td>
                  <td className="py-1 px-2 font-mono font-medium">{it.item_code || '—'}</td>
                  <td className="py-1 px-2 font-semibold text-slate-800">{it.product_name}</td>
                  <td className="py-1 px-2 text-center text-slate-500">{it.unit}</td>
                  <td className="py-1 px-2 text-right font-mono">{Number(it.system_qty).toFixed(2)}</td>
                  <td className="py-1 px-2 text-right font-mono font-bold">{Number(it.counted_qty || 0).toFixed(2)}</td>
                  <td className="py-1 px-2 text-right font-mono font-black text-blue-700">
                    +{it.variance !== null ? it.variance.toFixed(2) : '—'}
                  </td>
                  <td className="py-1 px-2 text-right font-mono text-slate-600">₹{it.cost_price.toFixed(2)}</td>
                  <td className="py-1 px-2 text-right font-mono font-bold text-blue-700">
                    +₹{Math.abs(it.value_impact).toFixed(2)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ── SIGNATURE BLOCKS ── */}
      <div className="grid grid-cols-3 gap-8 pt-10 mt-6 border-t border-slate-300 text-center text-xs">
        <div>
          <div className="h-10"></div>
          <div className="border-t border-slate-400 font-bold text-slate-700 pt-1">
            Physical Auditor Signature
          </div>
          <div className="text-[10px] text-slate-400">Name & Date</div>
        </div>
        <div>
          <div className="h-10"></div>
          <div className="border-t border-slate-400 font-bold text-slate-700 pt-1">
            Store / Warehouse Manager
          </div>
          <div className="text-[10px] text-slate-400">Verified & Acknowledged</div>
        </div>
        <div>
          <div className="h-10"></div>
          <div className="border-t border-slate-400 font-bold text-slate-700 pt-1">
            Authorized HO Signatory
          </div>
          <div className="text-[10px] text-slate-400">Nutribray Central</div>
        </div>
      </div>
    </div>
  )
}

import React, { useState, useEffect } from 'react';
import api from '../../api/axios';


const PaymentMatrix = () => {
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [fromDate, setFromDate] = useState<string>(new Date(new Date().setDate(1)).toISOString().split('T')[0]);
    const [toDate, setToDate] = useState<string>(new Date().toISOString().split('T')[0]);
    const [outletId, setOutletId] = useState('');

    const fetchData = async () => {
        setLoading(true);
        try {
            const res = await api.get(`/reports/payments-matrix`, { params: { from_date: fromDate, to_date: toDate, outlet_id: outletId || undefined } });
            setData(res.data);
        } catch (err) {
            console.error("Failed to fetch payment matrix", err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, [fromDate, toDate, outletId]);

    const formatCurrency = (val: number) => {
        return new Intl.NumberFormat('en-IN', {
            style: 'currency',
            currency: 'INR',
            maximumFractionDigits: 0
        }).format(val);
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800">Payment Collection Matrix</h1>
                    <p className="text-slate-500 text-sm font-medium">Outlet wise breakdown of collections by payment mode</p>
                </div>
                <div className="flex gap-3">
                    <div className="flex items-center bg-white px-4 py-2 rounded-xl border border-slate-200 shadow-sm gap-2">
                        <span className="text-xs font-bold text-slate-400 uppercase">From</span>
                        <input
                            type="date"
                            value={fromDate}
                            onChange={(e) => setFromDate(e.target.value)}
                            className="text-sm font-bold text-slate-700 outline-none border-none bg-transparent"
                        />
                    </div>
                    <div className="flex items-center bg-white px-4 py-2 rounded-xl border border-slate-200 shadow-sm gap-2">
                        <span className="text-xs font-bold text-slate-400 uppercase">To</span>
                        <input
                            type="date"
                            value={toDate}
                            onChange={(e) => setToDate(e.target.value)}
                            className="text-sm font-bold text-slate-700 outline-none border-none bg-transparent"
                        />
                    </div>
                    <div className="flex items-center bg-white px-4 py-2 rounded-xl border border-slate-200 shadow-sm gap-2">
                        <span className="text-xs font-bold text-slate-400 uppercase">Outlet</span>
                        <select value={outletId} onChange={e => setOutletId(e.target.value)} className="text-sm font-bold text-slate-700 outline-none border-none bg-transparent">
                            <option value="">All my outlets</option>
                            {(data?.outlets || []).map((o: any) => <option key={o.id} value={o.id}>{o.name}</option>)}
                        </select>
                    </div>
                    <button 
                        onClick={() => window.print()}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl font-bold text-sm transition-all shadow-lg shadow-indigo-100 flex items-center gap-2"
                    >
                        <i className="fas fa-print"></i> Print
                    </button>
                </div>
            </div>

            {loading ? (
                <div className="text-center py-20 text-slate-400">Loading matrix data...</div>
            ) : data && data.rows.length > 0 ? (
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-slate-50">
                                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider border-b border-slate-100 sticky left-0 bg-slate-50 z-10">Outlet Name</th>
                                    {data.modes.map((mode: string) => (
                                        <th key={mode} className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider border-b border-slate-100 text-right">{mode}</th>
                                    ))}
                                    <th className="px-6 py-4 text-xs font-bold text-indigo-600 uppercase tracking-wider border-b border-slate-100 text-right bg-indigo-50/50">Grand Total</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                                {data.rows.map((row: any, idx: number) => (
                                    <tr key={idx} className="hover:bg-slate-50 transition-colors group">
                                        <td className="px-6 py-4 text-sm font-bold text-slate-700 border-b border-slate-50 sticky left-0 bg-white group-hover:bg-slate-50 z-10">{row.outlet}</td>
                                        {data.modes.map((mode: string) => (
                                            <td key={mode} className="px-6 py-4 text-sm font-medium text-slate-600 text-right border-b border-slate-50">
                                                {row[mode] > 0 ? formatCurrency(row[mode]) : '-'}
                                            </td>
                                        ))}
                                        <td className="px-6 py-4 text-sm font-bold text-indigo-600 text-right border-b border-slate-50 bg-indigo-50/30">
                                            {formatCurrency(row.total)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr className="bg-slate-800 text-white font-bold">
                                    <td className="px-6 py-4 text-sm uppercase tracking-wider sticky left-0 bg-slate-800 z-10">Total Collections</td>
                                    {data.modes.map((mode: string) => (
                                        <td key={mode} className="px-6 py-4 text-sm text-right">
                                            {formatCurrency(data.grand_totals[mode])}
                                        </td>
                                    ))}
                                    <td className="px-6 py-4 text-sm text-right bg-indigo-600">
                                        {formatCurrency(data.grand_totals.total)}
                                    </td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </div>
            ) : (
                <div className="text-center py-20 text-slate-400 bg-white rounded-2xl border-2 border-dashed border-slate-200">
                    No payment records found for the selected period.
                </div>
            )}
        </div>
    );
};

export default PaymentMatrix;

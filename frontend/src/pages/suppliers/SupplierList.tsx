import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { suppliers_api, type supplier_list_item, type paginated } from '../../api/suppliers'
import PageHeader from '../../components/ui/PageHeader'
import StatusBadge from '../../components/ui/StatusBadge'

const TYPE_LABEL: Record<string, string> = { L: 'Local', I: 'Interstate', U: 'Unregistered' }
const TYPE_COLOR: Record<string, string> = {
  L: 'bg-green-100 text-green-700',
  I: 'bg-blue-100 text-blue-700',
  U: 'bg-gray-100 text-gray-600',
}


export default function supplier_list_page() {
  const [result, set_result] = useState<paginated<supplier_list_item> | null>(null)
  const [page, set_page] = useState(1)
  const [search, set_search] = useState('')
  const [loading, set_loading] = useState(true)

  async function load(p = page, s = search) {
    set_loading(true)
    try { const res = await suppliers_api.list({ page: p, per_page: 25, search: s }); set_result(res.data) }
    finally { set_loading(false) }
  }

  useEffect(() => { load(page, search) }, [page])

  function handle_search(val: string) { set_search(val); set_page(1); load(1, val) }

  async function handle_delete(id: number, name: string) {
    if (!confirm(`Deactivate supplier "${name}"?`)) return
    await suppliers_api.delete(id); load()
  }

  const rows = result?.data ?? []

  return (
    <div>
      <PageHeader
        title="Suppliers"
        subtitle={result ? `${result.total} suppliers` : 'Supplier master'}
        action={
          <>
            <Link to="/masters/suppliers/approvals" className="bg-orange-50 text-orange-600 px-4 py-2 rounded-lg text-sm border border-orange-200 hover:bg-orange-100">
              Pending Approvals
            </Link>
            <button 
              onClick={async () => {
                const name = prompt("Vendor Name (Optional)");
                const phone = prompt("Vendor Mobile Number *");
                if (phone) {
                  try {
                    const res = await suppliers_api.generateOnboardingLink(phone, name || 'Pending Vendor');
                    const link = `${window.location.origin}/vendor-registration/${res.data.onboarding_token}`;
                    await navigator.clipboard.writeText(link);
                    alert(`Onboarding link generated and copied to clipboard!\n\n${link}`);
                  } catch (err) { alert("Failed to generate link"); }
                }
              }}
              className="bg-slate-800 text-white px-4 py-2 rounded-lg text-sm hover:bg-slate-900">
              Generate Onboarding Link
            </button>
            <Link to="/suppliers/new" className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700">+ Add Supplier</Link>
          </>
        }
      />

      <div className="mb-4">
        <input value={search} onChange={e => handle_search(e.target.value)}
          placeholder="Search name, phone, GST, code…"
          className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-72" />
      </div>

      <div className="bg-white rounded-xl shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-left">
            <tr>
              <th className="px-4 py-3">Code</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Phone</th>
              <th className="px-4 py-3">City</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">GST No.</th>
              <th className="px-4 py-3 text-right">Opening Bal.</th>
              <th className="px-4 py-3 text-center">Credit Days</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={10} className="text-center py-10 text-gray-400">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={10} className="text-center py-10 text-gray-400">No suppliers found</td></tr>
            ) : rows.map(s => (
              <tr key={s.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-mono text-xs text-gray-500">{s.supplier_code ?? '—'}</td>
                <td className="px-4 py-3 font-medium text-gray-800">{s.name}</td>
                <td className="px-4 py-3 text-gray-600">{s.phone}</td>
                <td className="px-4 py-3 text-gray-500">{s.city ?? '—'}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_COLOR[s.supplier_type] ?? ''}`}>
                    {TYPE_LABEL[s.supplier_type] ?? s.supplier_type}
                  </span>
                </td>
                <td className="px-4 py-3 font-mono text-xs">{s.gst_number ?? '—'}</td>
                <td className="px-4 py-3 text-right text-gray-700">₹{Number(s.opening_balance).toFixed(2)}</td>
                <td className="px-4 py-3 text-center text-gray-600">{s.credit_limit_days} days</td>
                <td className="px-4 py-3"><StatusBadge active={s.status} /></td>
                <td className="px-4 py-3">
                  <div className="flex gap-3">
                    <Link to={`/suppliers/${s.id}`} className="text-gray-500 hover:text-gray-700 text-xs">View</Link>
                    <Link to={`/suppliers/${s.id}/edit`} className="text-blue-600 hover:text-blue-800 text-xs">Edit</Link>
                    {s.status && <button onClick={() => handle_delete(s.id, s.name)} className="text-red-500 hover:text-red-700 text-xs">Delete</button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {result && result.total_pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t text-sm text-gray-600">
            <span>Showing {rows.length} of {result.total}</span>
            <div className="flex gap-2">
              <button disabled={page === 1} onClick={() => set_page(p => p - 1)} className="px-3 py-1 border rounded disabled:opacity-40">Prev</button>
              <span className="px-3 py-1">Page {page} / {result.total_pages}</span>
              <button disabled={page === result.total_pages} onClick={() => set_page(p => p + 1)} className="px-3 py-1 border rounded disabled:opacity-40">Next</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

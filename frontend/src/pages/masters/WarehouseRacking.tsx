import { useEffect, useState, useCallback } from 'react'
import api from '../../api/axios'
import toast from 'react-hot-toast'

// ── Types ────────────────────────────────────────────────────────────────────

interface RackNode {
  id: number
  rack_code: string
  rack_number: string
  shelf_level: string | null
  capacity: number | null
  current_qty: number
  status: boolean
}

interface DivisionNode {
  id: number
  division_code: string
  division_name: string
  aisle_code: string
  sequence_no: number
  status: boolean
  racks: RackNode[]
}

interface AisleNode {
  id: number
  aisle_code: string
  aisle_name: string
  warehouse_code: string | null
  status: boolean
  divisions: DivisionNode[]
}

interface ItemMapping {
  id: number
  product_id: number | null
  rack_id: number | null
  rack_code: string | null
  priority: string
  min_qty: number | null
  max_qty: number | null
  created_at: string
}

interface RackDetail {
  id: number
  rack_code: string
  aisle_id: number | null
  division_id: number | null
  aisle_code: string | null
  division_code: string | null
  rack_number: string
  shelf_level: string | null
  bin_code: string | null
  capacity: number | null
  current_qty: number
  status: boolean
  created_at: string
}

interface RackSummary {
  id: number
  rack_code: string
  capacity: number | null
  current_qty: number
  fill_pct: number
  status_color: string
  status: boolean
}

type PanelTab = 'details' | 'qr' | 'items' | 'reports'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fillPct(qty: number, cap: number | null): number {
  if (!cap || cap === 0) return 0
  return Math.round((qty / cap) * 100)
}

function rackDotColor(qty: number, cap: number | null): string {
  const pct = fillPct(qty, cap)
  if (qty === 0) return 'bg-green-500'
  if (pct >= 80) return 'bg-red-500'
  return 'bg-yellow-400'
}

function statusBadge(color: string): string {
  if (color === 'green') return 'bg-green-100 text-green-700'
  if (color === 'red') return 'bg-red-100 text-red-700'
  return 'bg-yellow-100 text-yellow-700'
}

function statusLabel(qty: number, cap: number | null): string {
  const pct = fillPct(qty, cap)
  if (qty === 0) return 'Empty'
  if (pct >= 100) return 'Full'
  if (pct >= 80) return 'Near Full'
  return 'In Use'
}

// ── Sub-components ────────────────────────────────────────────────────────────

const InputField = ({
  label, value, onChange, placeholder = '', type = 'text', required = false, readOnly = false,
}: {
  label: string; value: string; onChange?: (v: string) => void;
  placeholder?: string; type?: string; required?: boolean; readOnly?: boolean
}) => (
  <div className="space-y-1.5">
    <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest">
      {label}{required && <span className="text-red-500 ml-1">*</span>}
    </label>
    <input
      type={type}
      value={value}
      readOnly={readOnly}
      onChange={e => onChange?.(e.target.value)}
      placeholder={placeholder}
      className={`w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-sm ${readOnly ? 'bg-slate-50 text-slate-400 cursor-default' : 'bg-white'}`}
    />
  </div>
)

const SelectField = ({
  label, value, onChange, options, required = false,
}: {
  label: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[]; required?: boolean
}) => (
  <div className="space-y-1.5">
    <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest">
      {label}{required && <span className="text-red-500 ml-1">*</span>}
    </label>
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-sm bg-white"
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  </div>
)

// ── Main Component ─────────────────────────────────────────────────────────────

export default function WarehouseRacking() {
  const [tree, setTree] = useState<AisleNode[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedAisles, setExpandedAisles] = useState<Set<number>>(new Set())
  const [expandedDivisions, setExpandedDivisions] = useState<Set<number>>(new Set())
  const [selectedRack, setSelectedRack] = useState<RackDetail | null>(null)
  const [activeTab, setActiveTab] = useState<PanelTab>('details')
  const [mappings, setMappings] = useState<ItemMapping[]>([])
  const [summary, setSummary] = useState<RackSummary[]>([])

  // Modal states
  const [showAisleForm, setShowAisleForm] = useState(false)
  const [showDivisionForm, setShowDivisionForm] = useState(false)
  const [showRackForm, setShowRackForm] = useState(false)
  const [targetAisleForDiv, setTargetAisleForDiv] = useState<AisleNode | null>(null)
  const [_targetDivForRack, setTargetDivForRack] = useState<DivisionNode | null>(null)

  // Aisle form
  const [aisleCode, setAisleCode] = useState('')
  const [aisleName, setAisleName] = useState('')
  const [warehouseCode, setWarehouseCode] = useState('')

  // Division form
  const [divCode, setDivCode] = useState('')
  const [divName, setDivName] = useState('')
  const [divSeq, setDivSeq] = useState('1')

  // Rack form
  const [rackAisleId, setRackAisleId] = useState('')
  const [rackAisleCode, setRackAisleCode] = useState('')
  const [rackDivId, setRackDivId] = useState('')
  const [rackDivCode, setRackDivCode] = useState('')
  const [rackNumber, setRackNumber] = useState('')
  const [shelfLevel, setShelfLevel] = useState('')
  const [rackCapacity, setRackCapacity] = useState('')

  // Item mapping form
  const [newProductId, setNewProductId] = useState('')
  const [newPriority, setNewPriority] = useState('Primary')

  // Edit rack inline
  const [editRack, setEditRack] = useState(false)
  const [editCapacity, setEditCapacity] = useState('')
  const [editBinCode, setEditBinCode] = useState('')
  const [editShelfLevel, setEditShelfLevel] = useState('')
  const [editStatus, setEditStatus] = useState(true)

  // ── Load tree ──────────────────────────────────────────────────────────────
  const loadTree = useCallback(async () => {
    try {
      setLoading(true)
      const res = await api.get('/warehouse/tree')
      setTree(res.data)
    } catch {
      toast.error('Failed to load warehouse tree')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadSummary = useCallback(async () => {
    try {
      const res = await api.get('/warehouse/reports/summary')
      setSummary(res.data)
    } catch {
      // summary optional
    }
  }, [])

  useEffect(() => {
    loadTree()
    loadSummary()
  }, [loadTree, loadSummary])

  // ── Load mappings when rack selected ──────────────────────────────────────
  const loadMappings = useCallback(async (rackId: number) => {
    try {
      const res = await api.get(`/warehouse/item-mappings?rack_id=${rackId}`)
      setMappings(res.data)
    } catch {
      setMappings([])
    }
  }, [])

  const selectRack = useCallback(async (rack: RackNode) => {
    try {
      // Fetch rack detail from racks list
      const allRacks = await api.get('/warehouse/racks')
      const detail = allRacks.data.find((r: RackDetail) => r.id === rack.id) || null
      setSelectedRack(detail)
      setActiveTab('details')
      if (detail) {
        setEditCapacity(String(detail.capacity ?? ''))
        setEditBinCode(detail.bin_code ?? '')
        setEditShelfLevel(detail.shelf_level ?? '')
        setEditStatus(detail.status)
        loadMappings(detail.id)
      }
    } catch {
      toast.error('Failed to load rack details')
    }
  }, [loadMappings])

  // ── Aisle CRUD ─────────────────────────────────────────────────────────────
  const handleCreateAisle = async () => {
    if (!aisleName.trim()) { toast.error('Aisle name is required'); return }
    try {
      await api.post('/warehouse/aisles', {
        aisle_code: aisleCode || undefined,
        aisle_name: aisleName,
        warehouse_code: warehouseCode || undefined,
      })
      toast.success('Aisle created')
      setShowAisleForm(false)
      setAisleCode(''); setAisleName(''); setWarehouseCode('')
      loadTree()
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Failed to create aisle')
    }
  }

  // ── Division CRUD ──────────────────────────────────────────────────────────
  const openDivisionForm = (aisle: AisleNode) => {
    setTargetAisleForDiv(aisle)
    setDivCode(''); setDivName(''); setDivSeq('1')
    setShowDivisionForm(true)
  }

  const handleCreateDivision = async () => {
    if (!targetAisleForDiv) return
    if (!divName.trim()) { toast.error('Division name is required'); return }
    try {
      await api.post('/warehouse/divisions', {
        division_code: divCode || undefined,
        division_name: divName,
        aisle_id: targetAisleForDiv.id,
        aisle_code: targetAisleForDiv.aisle_code,
        sequence_no: parseInt(divSeq) || 1,
      })
      toast.success('Division created')
      setShowDivisionForm(false)
      loadTree()
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Failed to create division')
    }
  }

  // ── Rack CRUD ──────────────────────────────────────────────────────────────
  const openRackForm = (div: DivisionNode) => {
    // find parent aisle
    const aisle = tree.find(a => a.divisions.some(d => d.id === div.id))
    setTargetDivForRack(div)
    setRackAisleId(String(aisle?.id ?? ''))
    setRackAisleCode(div.aisle_code)
    setRackDivId(String(div.id))
    setRackDivCode(div.division_code)
    setRackNumber(''); setShelfLevel(''); setRackCapacity('')
    setShowRackForm(true)
  }

  const rackCodePreview = rackAisleCode && rackDivCode && rackNumber
    ? `${rackAisleCode}-${rackDivCode}-${rackNumber}${shelfLevel ? '-' + shelfLevel : ''}`
    : '—'

  const handleCreateRack = async () => {
    if (!rackNumber.trim()) { toast.error('Rack number is required'); return }
    if (!rackAisleCode || !rackDivCode) { toast.error('Aisle and division are required'); return }
    try {
      await api.post('/warehouse/racks', {
        aisle_id: parseInt(rackAisleId) || undefined,
        division_id: parseInt(rackDivId) || undefined,
        aisle_code: rackAisleCode,
        division_code: rackDivCode,
        rack_number: rackNumber,
        shelf_level: shelfLevel || undefined,
        capacity: rackCapacity ? parseInt(rackCapacity) : undefined,
      })
      toast.success('Rack created')
      setShowRackForm(false)
      loadTree()
      loadSummary()
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Failed to create rack')
    }
  }

  // ── Rack inline edit ───────────────────────────────────────────────────────
  const handleSaveRack = async () => {
    if (!selectedRack) return
    try {
      await api.put(`/warehouse/racks/${selectedRack.id}`, {
        capacity: editCapacity ? parseInt(editCapacity) : null,
        bin_code: editBinCode || null,
        shelf_level: editShelfLevel || null,
        status: editStatus,
      })
      toast.success('Rack updated')
      setEditRack(false)
      const res = await api.get('/warehouse/racks')
      const updated = res.data.find((r: RackDetail) => r.id === selectedRack.id) || null
      setSelectedRack(updated)
      loadTree()
      loadSummary()
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Failed to update rack')
    }
  }

  // ── Item mapping ───────────────────────────────────────────────────────────
  const handleAddMapping = async () => {
    if (!selectedRack || !newProductId) { toast.error('Product ID is required'); return }
    try {
      await api.post('/warehouse/item-mappings', {
        product_id: parseInt(newProductId),
        rack_id: selectedRack.id,
        priority: newPriority,
      })
      toast.success('Item mapped to rack')
      setNewProductId('')
      loadMappings(selectedRack.id)
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Failed to map item')
    }
  }

  const handleDeleteMapping = async (id: number) => {
    if (!selectedRack) return
    try {
      await api.delete(`/warehouse/item-mappings/${id}`)
      toast.success('Mapping removed')
      loadMappings(selectedRack.id)
    } catch {
      toast.error('Failed to remove mapping')
    }
  }

  // ── QR URL ─────────────────────────────────────────────────────────────────
  const qrUrl = selectedRack
    ? `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(selectedRack.rack_code)}`
    : ''

  // ── Selected rack divisions for rack form ──────────────────────────────────
  const divisionsForRackForm = rackAisleId
    ? tree.find(a => a.id === parseInt(rackAisleId))?.divisions ?? []
    : []

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between shadow-sm">
        <div>
          <h1 className="text-2xl font-black text-slate-800 tracking-tight">Warehouse Racking System</h1>
          <p className="text-xs text-slate-400 mt-0.5 font-medium uppercase tracking-widest">
            Aisle &rarr; Division &rarr; Rack hierarchy
          </p>
        </div>
        <button
          onClick={() => { setShowAisleForm(true) }}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold px-4 py-2 rounded-xl shadow transition-all"
        >
          <span className="text-lg leading-none">+</span> New Aisle
        </button>
      </div>

      <div className="flex h-[calc(100vh-73px)]">
        {/* ── LEFT PANEL: Tree ─────────────────────────────────────────────── */}
        <div className="w-72 min-w-[18rem] bg-white border-r border-slate-200 overflow-y-auto flex-shrink-0">
          <div className="p-3 border-b border-slate-100">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Warehouse Tree</p>
          </div>

          {loading ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
            </div>
          ) : tree.length === 0 ? (
            <div className="p-6 text-center text-slate-400 text-sm">
              <div className="text-3xl mb-2">📦</div>
              No aisles yet.<br />
              <button onClick={() => setShowAisleForm(true)} className="text-blue-500 underline mt-1 text-xs">Add first aisle</button>
            </div>
          ) : (
            <div className="py-2">
              {tree.map(aisle => (
                <div key={aisle.id}>
                  {/* Aisle Row */}
                  <div
                    className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50 cursor-pointer group"
                    onClick={() => setExpandedAisles(prev => {
                      const s = new Set(prev)
                      s.has(aisle.id) ? s.delete(aisle.id) : s.add(aisle.id)
                      return s
                    })}
                  >
                    <span className="text-slate-400 text-xs w-3">
                      {expandedAisles.has(aisle.id) ? '▼' : '▶'}
                    </span>
                    <span className="text-base">📦</span>
                    <span className="flex-1 text-sm font-bold text-slate-700 truncate">
                      {aisle.aisle_code} — {aisle.aisle_name}
                    </span>
                    {aisle.warehouse_code && (
                      <span className="text-[10px] text-slate-400 bg-slate-100 rounded px-1">{aisle.warehouse_code}</span>
                    )}
                    <button
                      title="Add division"
                      onClick={e => { e.stopPropagation(); openDivisionForm(aisle) }}
                      className="opacity-0 group-hover:opacity-100 text-blue-400 hover:text-blue-600 text-xs font-bold px-1 transition-all"
                    >
                      +Div
                    </button>
                  </div>

                  {/* Divisions */}
                  {expandedAisles.has(aisle.id) && (
                    <div className="ml-4">
                      {aisle.divisions.length === 0 ? (
                        <div className="px-6 py-1 text-xs text-slate-400 italic">No divisions</div>
                      ) : (
                        aisle.divisions.map(div => (
                          <div key={div.id}>
                            {/* Division Row */}
                            <div
                              className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 cursor-pointer group"
                              onClick={() => setExpandedDivisions(prev => {
                                const s = new Set(prev)
                                s.has(div.id) ? s.delete(div.id) : s.add(div.id)
                                return s
                              })}
                            >
                              <span className="text-slate-400 text-xs w-3">
                                {expandedDivisions.has(div.id) ? '▼' : '▶'}
                              </span>
                              <span className="text-sm">📁</span>
                              <span className="flex-1 text-xs font-semibold text-slate-600 truncate">
                                {div.division_code} — {div.division_name}
                              </span>
                              <button
                                title="Add rack"
                                onClick={e => { e.stopPropagation(); openRackForm(div) }}
                                className="opacity-0 group-hover:opacity-100 text-green-500 hover:text-green-700 text-xs font-bold px-1 transition-all"
                              >
                                +Rack
                              </button>
                            </div>

                            {/* Racks */}
                            {expandedDivisions.has(div.id) && (
                              <div className="ml-6">
                                {div.racks.length === 0 ? (
                                  <div className="px-4 py-1 text-xs text-slate-400 italic">No racks</div>
                                ) : (
                                  div.racks.map(rack => (
                                    <div
                                      key={rack.id}
                                      onClick={() => selectRack(rack)}
                                      className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer rounded-lg mx-1 my-0.5 transition-all ${selectedRack?.id === rack.id ? 'bg-blue-50 border border-blue-200' : 'hover:bg-slate-50'}`}
                                    >
                                      <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${rackDotColor(rack.current_qty, rack.capacity)}`}></span>
                                      <span className="text-xs font-mono font-semibold text-slate-700 truncate">{rack.rack_code}</span>
                                      {rack.capacity && (
                                        <span className="text-[10px] text-slate-400 ml-auto flex-shrink-0">
                                          {fillPct(rack.current_qty, rack.capacity)}%
                                        </span>
                                      )}
                                    </div>
                                  ))
                                )}
                              </div>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── RIGHT PANEL ──────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto p-6">
          {!selectedRack ? (
            <div className="flex flex-col items-center justify-center h-full text-center text-slate-400">
              <div className="text-6xl mb-4">🏭</div>
              <p className="text-lg font-bold text-slate-500">Select a rack from the tree</p>
              <p className="text-sm mt-1">Click any rack in the left panel to view details</p>
              {/* Summary cards */}
              {summary.length > 0 && (
                <div className="mt-8 w-full max-w-3xl">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 text-left">Rack Summary</p>
                  <div className="grid grid-cols-3 gap-3">
                    {summary.slice(0, 9).map(s => (
                      <div key={s.id} className="bg-white rounded-xl border border-slate-200 p-3 text-left shadow-sm">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`w-2.5 h-2.5 rounded-full ${s.status_color === 'green' ? 'bg-green-500' : s.status_color === 'red' ? 'bg-red-500' : 'bg-yellow-400'}`}></span>
                          <span className="text-xs font-mono font-bold text-slate-700">{s.rack_code}</span>
                        </div>
                        <div className="text-[10px] text-slate-500">
                          {s.capacity ? `${s.fill_pct}% full (${s.current_qty}/${s.capacity})` : `Qty: ${s.current_qty}`}
                        </div>
                        <div className="mt-1.5 bg-slate-100 rounded-full h-1.5 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${s.status_color === 'green' ? 'bg-green-400' : s.status_color === 'red' ? 'bg-red-500' : 'bg-yellow-400'}`}
                            style={{ width: `${Math.min(s.fill_pct, 100)}%` }}
                          ></div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="max-w-2xl mx-auto">
              {/* Rack header */}
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 mb-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-3 mb-1">
                      <span className={`w-3 h-3 rounded-full ${rackDotColor(selectedRack.current_qty, selectedRack.capacity)}`}></span>
                      <h2 className="text-xl font-black text-slate-800 font-mono">{selectedRack.rack_code}</h2>
                      <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${statusBadge(rackDotColor(selectedRack.current_qty, selectedRack.capacity).replace('bg-', '').replace('-500', '').replace('-400', ''))}`}>
                        {statusLabel(selectedRack.current_qty, selectedRack.capacity)}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 font-medium">
                      Aisle: {selectedRack.aisle_code} &nbsp;|&nbsp; Division: {selectedRack.division_code}
                      {selectedRack.shelf_level && ` | Shelf: ${selectedRack.shelf_level}`}
                    </p>
                  </div>
                  <button onClick={() => setSelectedRack(null)} className="text-slate-400 hover:text-slate-600 text-xl font-bold">&times;</button>
                </div>
                {selectedRack.capacity != null && (
                  <div className="mt-3">
                    <div className="flex justify-between text-xs text-slate-500 mb-1">
                      <span>Capacity usage</span>
                      <span>{fillPct(selectedRack.current_qty, selectedRack.capacity)}%</span>
                    </div>
                    <div className="bg-slate-100 rounded-full h-2 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${fillPct(selectedRack.current_qty, selectedRack.capacity) >= 80 ? 'bg-red-500' : fillPct(selectedRack.current_qty, selectedRack.capacity) > 0 ? 'bg-yellow-400' : 'bg-green-400'}`}
                        style={{ width: `${Math.min(fillPct(selectedRack.current_qty, selectedRack.capacity), 100)}%` }}
                      ></div>
                    </div>
                    <div className="flex justify-between text-[10px] text-slate-400 mt-1">
                      <span>Current: {selectedRack.current_qty}</span>
                      <span>Max: {selectedRack.capacity}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Tabs */}
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="flex border-b border-slate-100">
                  {(['details', 'qr', 'items', 'reports'] as PanelTab[]).map(tab => (
                    <button
                      key={tab}
                      onClick={() => { setActiveTab(tab); if (tab === 'items' && selectedRack) loadMappings(selectedRack.id) }}
                      className={`flex-1 py-3 text-[11px] font-black uppercase tracking-widest transition-all border-b-2 ${activeTab === tab ? 'border-blue-600 text-blue-600 bg-blue-50/50' : 'border-transparent text-slate-400 hover:text-slate-600 hover:bg-slate-50'}`}
                    >
                      {tab === 'details' && '📋 Details'}
                      {tab === 'qr' && '⬛ QR Code'}
                      {tab === 'items' && '📦 Items'}
                      {tab === 'reports' && '📊 Reports'}
                    </button>
                  ))}
                </div>

                {/* Details Tab */}
                {activeTab === 'details' && (
                  <div className="p-5">
                    {!editRack ? (
                      <div>
                        <div className="grid grid-cols-2 gap-4 mb-5">
                          {[
                            ['Rack Code', selectedRack.rack_code],
                            ['Aisle Code', selectedRack.aisle_code],
                            ['Division Code', selectedRack.division_code],
                            ['Rack Number', selectedRack.rack_number],
                            ['Shelf Level', selectedRack.shelf_level || '—'],
                            ['Bin Code', selectedRack.bin_code || '—'],
                            ['Capacity', selectedRack.capacity != null ? String(selectedRack.capacity) : '—'],
                            ['Current Qty', String(selectedRack.current_qty)],
                            ['Status', selectedRack.status ? 'Active' : 'Inactive'],
                            ['Created', new Date(selectedRack.created_at).toLocaleDateString()],
                          ].map(([k, v]) => (
                            <div key={k} className="bg-slate-50 rounded-lg p-3">
                              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-0.5">{k}</p>
                              <p className="text-sm font-semibold text-slate-700">{v}</p>
                            </div>
                          ))}
                        </div>
                        <button
                          onClick={() => { setEditRack(true); setEditCapacity(String(selectedRack.capacity ?? '')); setEditBinCode(selectedRack.bin_code ?? ''); setEditShelfLevel(selectedRack.shelf_level ?? ''); setEditStatus(selectedRack.status) }}
                          className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-4 py-2 rounded-lg transition-all"
                        >
                          Edit Rack
                        </button>
                      </div>
                    ) : (
                      <div>
                        <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-4 border-l-4 border-blue-500 pl-3">Edit Rack Details</p>
                        <div className="grid grid-cols-2 gap-4 mb-5">
                          <InputField label="Rack Code" value={selectedRack.rack_code} readOnly />
                          <InputField label="Capacity" value={editCapacity} onChange={setEditCapacity} placeholder="e.g. 100" type="number" />
                          <InputField label="Shelf Level" value={editShelfLevel} onChange={setEditShelfLevel} placeholder="L1, L2..." />
                          <InputField label="Bin Code" value={editBinCode} onChange={setEditBinCode} placeholder="optional" />
                          <div className="flex items-center gap-2 col-span-2">
                            <input type="checkbox" checked={editStatus} onChange={e => setEditStatus(e.target.checked)} id="edit_status" className="w-4 h-4 accent-blue-600" />
                            <label htmlFor="edit_status" className="text-sm font-semibold text-slate-600">Active</label>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button onClick={handleSaveRack} className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-4 py-2 rounded-lg transition-all">Save</button>
                          <button onClick={() => setEditRack(false)} className="bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-bold px-4 py-2 rounded-lg transition-all">Cancel</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* QR Tab */}
                {activeTab === 'qr' && (
                  <div className="p-5 flex flex-col items-center">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Scan to identify rack</p>
                    <div className="bg-white border-2 border-slate-200 rounded-2xl p-4 shadow-sm inline-block mb-4">
                      <img
                        src={qrUrl}
                        alt={`QR for ${selectedRack.rack_code}`}
                        width={200}
                        height={200}
                        className="block"
                        onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                      />
                    </div>
                    <p className="text-sm font-mono font-bold text-slate-700 mb-2">{selectedRack.rack_code}</p>
                    <p className="text-xs text-slate-400 mb-4">
                      {selectedRack.aisle_code} &rarr; {selectedRack.division_code} &rarr; {selectedRack.rack_number}
                      {selectedRack.shelf_level && ` (${selectedRack.shelf_level})`}
                    </p>
                    <button
                      onClick={() => {
                        const win = window.open('', '_blank')
                        if (win) {
                          const code = selectedRack.rack_code
                          const qr = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(code)}&ecc=H`
                          win.document.write(`<!DOCTYPE html><html><head>
<title>Rack Label — ${code}</title>
<script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"><\/script>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: 'Courier New', monospace; background:#fff; display:flex; align-items:center; justify-content:center; min-height:100vh; }
  .label { border:3px solid #000; border-radius:8px; padding:18px 20px; width:340px; text-align:center; background:#fff; }
  .store { font-size:10px; font-weight:900; letter-spacing:4px; color:#666; text-transform:uppercase; margin-bottom:6px; }
  .rack-name { font-size:28px; font-weight:900; letter-spacing:2px; color:#000; margin-bottom:2px; }
  .location { font-size:11px; color:#444; margin-bottom:12px; font-weight:700; }
  .divider { border-top:1.5px dashed #ccc; margin:10px 0; }
  .codes { display:flex; gap:12px; align-items:center; justify-content:center; margin:10px 0; }
  .qr-wrap { border:2px solid #eee; border-radius:6px; padding:6px; background:#fff; }
  .qr-wrap img { display:block; width:160px; height:160px; }
  .barcode-wrap { flex:1; }
  .barcode-wrap svg { width:100%; }
  .label-row { display:flex; justify-content:space-between; font-size:10px; font-weight:700; color:#555; margin-top:8px; }
  .badge { background:#000; color:#fff; font-size:9px; font-weight:900; letter-spacing:2px; padding:2px 8px; border-radius:3px; display:inline-block; margin-top:6px; }
  @media print {
    body { min-height:unset; }
    .label { border:3px solid #000; }
  }
</style>
</head><body>
<div class="label">
  <div class="store">Nutribay Warehouse</div>
  <div class="rack-name">${code}</div>
  <div class="location">
    Aisle: ${selectedRack.aisle_code || '—'} &nbsp;|&nbsp;
    Division: ${selectedRack.division_code || '—'} &nbsp;|&nbsp;
    Rack: ${selectedRack.rack_number || '—'}
    ${selectedRack.shelf_level ? ` &nbsp;|&nbsp; Shelf: ${selectedRack.shelf_level}` : ''}
    ${selectedRack.bin_code ? ` &nbsp;|&nbsp; Bin: ${selectedRack.bin_code}` : ''}
  </div>
  <div class="divider"></div>
  <div class="codes">
    <div class="qr-wrap">
      <img src="${qr}" alt="QR" />
    </div>
    <div class="barcode-wrap">
      <svg id="bc1d"></svg>
      <div style="font-size:9px;color:#666;margin-top:3px;">Code 128</div>
    </div>
  </div>
  <div class="divider"></div>
  <div class="label-row">
    <span>Capacity: ${selectedRack.capacity ?? '—'}</span>
    <span>Status: ${selectedRack.status ? 'Active' : 'Inactive'}</span>
  </div>
  <div class="badge">SCAN TO IDENTIFY RACK</div>
</div>
<script>
  window.onload = function() {
    JsBarcode('#bc1d', '${code}', {
      format: 'CODE128',
      width: 2,
      height: 70,
      displayValue: true,
      fontSize: 10,
      margin: 4,
      background: '#ffffff',
      lineColor: '#000000',
    });
    setTimeout(function() { window.print(); }, 600);
  };
<\/script>
</body></html>`)
                          win.document.close()
                        }
                      }}
                      className="flex items-center gap-2 bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold px-4 py-2 rounded-lg transition-all"
                    >
                      🖨️ Print Label
                    </button>
                  </div>
                )}

                {/* Items Tab */}
                {activeTab === 'items' && (
                  <div className="p-5">
                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-4 border-l-4 border-blue-500 pl-3">Items Stored in This Rack</p>

                    {/* Add mapping */}
                    <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 mb-5 grid grid-cols-3 gap-3 items-end">
                      <InputField label="Product ID" value={newProductId} onChange={setNewProductId} placeholder="Enter product ID" type="number" />
                      <SelectField
                        label="Priority"
                        value={newPriority}
                        onChange={setNewPriority}
                        options={[
                          { value: 'Primary', label: 'Primary' },
                          { value: 'Secondary', label: 'Secondary' },
                          { value: 'Overflow', label: 'Overflow' },
                        ]}
                      />
                      <button
                        onClick={handleAddMapping}
                        className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-4 py-2 rounded-lg transition-all h-9"
                      >
                        + Map Item
                      </button>
                    </div>

                    {mappings.length === 0 ? (
                      <div className="text-center text-slate-400 py-6 text-sm">No items mapped to this rack yet</div>
                    ) : (
                      <div className="space-y-2">
                        {mappings.map(m => (
                          <div key={m.id} className="flex items-center justify-between bg-slate-50 rounded-xl px-4 py-3 border border-slate-200">
                            <div>
                              <p className="text-sm font-bold text-slate-700">Product #{m.product_id}</p>
                              <p className="text-[11px] text-slate-400">
                                Priority: <span className="font-semibold">{m.priority}</span>
                                {m.min_qty != null && ` | Min: ${m.min_qty}`}
                                {m.max_qty != null && ` | Max: ${m.max_qty}`}
                              </p>
                            </div>
                            <button
                              onClick={() => handleDeleteMapping(m.id)}
                              className="text-slate-300 hover:text-red-500 text-lg transition-colors"
                              title="Remove mapping"
                            >
                              &times;
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Reports Tab */}
                {activeTab === 'reports' && (
                  <div className="p-5">
                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-4 border-l-4 border-blue-500 pl-3">All Rack Summary</p>
                    {summary.length === 0 ? (
                      <div className="text-center text-slate-400 py-6 text-sm">No rack data</div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-slate-800 text-white text-[10px] uppercase tracking-widest">
                              <th className="px-3 py-2.5 text-left rounded-tl-lg">Rack Code</th>
                              <th className="px-3 py-2.5 text-right">Capacity</th>
                              <th className="px-3 py-2.5 text-right">Current</th>
                              <th className="px-3 py-2.5 text-right">Fill %</th>
                              <th className="px-3 py-2.5 text-center rounded-tr-lg">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {summary.map((s, i) => (
                              <tr key={s.id} className={`border-b border-slate-100 ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'} ${s.rack_code === selectedRack?.rack_code ? 'ring-1 ring-blue-300 bg-blue-50/30' : ''}`}>
                                <td className="px-3 py-2 font-mono font-semibold text-slate-700">{s.rack_code}</td>
                                <td className="px-3 py-2 text-right text-slate-500">{s.capacity ?? '—'}</td>
                                <td className="px-3 py-2 text-right text-slate-700 font-semibold">{String(s.current_qty)}</td>
                                <td className="px-3 py-2 text-right">
                                  <div className="flex items-center justify-end gap-1.5">
                                    <div className="w-16 bg-slate-100 rounded-full h-1.5 overflow-hidden">
                                      <div
                                        className={`h-full rounded-full ${s.status_color === 'green' ? 'bg-green-400' : s.status_color === 'red' ? 'bg-red-500' : 'bg-yellow-400'}`}
                                        style={{ width: `${Math.min(s.fill_pct, 100)}%` }}
                                      ></div>
                                    </div>
                                    <span className="text-xs text-slate-600 font-medium w-8 text-right">{s.fill_pct}%</span>
                                  </div>
                                </td>
                                <td className="px-3 py-2 text-center">
                                  <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full ${statusBadge(s.status_color)}`}>
                                    {s.status_color === 'green' ? 'Empty' : s.status_color === 'red' ? 'Near Full' : 'In Use'}
                                  </span>
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
            </div>
          )}
        </div>
      </div>

      {/* ── Modal: Add Aisle ──────────────────────────────────────────────────── */}
      {showAisleForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 animate-fade-in">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-black text-slate-800 border-l-4 border-blue-600 pl-3">Add New Aisle</h3>
              <button onClick={() => setShowAisleForm(false)} className="text-slate-400 hover:text-slate-600 text-xl">&times;</button>
            </div>
            <div className="space-y-4">
              <InputField label="Aisle Code" value={aisleCode} onChange={setAisleCode} placeholder="Auto-generated if blank (A01, A02...)" />
              <InputField label="Aisle Name" value={aisleName} onChange={setAisleName} placeholder="e.g. Main Aisle" required />
              <InputField label="Warehouse Code" value={warehouseCode} onChange={setWarehouseCode} placeholder="e.g. WH01 (optional)" />
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={handleCreateAisle} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold py-2.5 rounded-xl transition-all">Create Aisle</button>
              <button onClick={() => setShowAisleForm(false)} className="bg-slate-100 hover:bg-slate-200 text-slate-600 text-sm font-bold px-4 py-2.5 rounded-xl transition-all">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Add Division ───────────────────────────────────────────────── */}
      {showDivisionForm && targetAisleForDiv && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 animate-fade-in">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-black text-slate-800 border-l-4 border-blue-600 pl-3">
                Add Division — <span className="text-blue-600">{targetAisleForDiv.aisle_code}</span>
              </h3>
              <button onClick={() => setShowDivisionForm(false)} className="text-slate-400 hover:text-slate-600 text-xl">&times;</button>
            </div>
            <div className="space-y-4">
              <InputField label="Division Code" value={divCode} onChange={setDivCode} placeholder="Auto-generated if blank (D01, D02...)" />
              <InputField label="Division Name" value={divName} onChange={setDivName} placeholder="e.g. Zone A" required />
              <InputField label="Sequence No" value={divSeq} onChange={setDivSeq} placeholder="1" type="number" />
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={handleCreateDivision} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold py-2.5 rounded-xl transition-all">Create Division</button>
              <button onClick={() => setShowDivisionForm(false)} className="bg-slate-100 hover:bg-slate-200 text-slate-600 text-sm font-bold px-4 py-2.5 rounded-xl transition-all">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Add Rack ───────────────────────────────────────────────────── */}
      {showRackForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 animate-fade-in">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-black text-slate-800 border-l-4 border-blue-600 pl-3">Add New Rack</h3>
              <button onClick={() => setShowRackForm(false)} className="text-slate-400 hover:text-slate-600 text-xl">&times;</button>
            </div>
            <div className="space-y-4">
              <SelectField
                label="Aisle"
                value={rackAisleId}
                onChange={val => {
                  const a = tree.find(x => x.id === parseInt(val))
                  setRackAisleId(val)
                  setRackAisleCode(a?.aisle_code ?? '')
                  setRackDivId('')
                  setRackDivCode('')
                }}
                options={[{ value: '', label: '— Select Aisle —' }, ...tree.map(a => ({ value: String(a.id), label: `${a.aisle_code} — ${a.aisle_name}` }))]}
                required
              />
              <SelectField
                label="Division"
                value={rackDivId}
                onChange={val => {
                  const d = divisionsForRackForm.find(x => x.id === parseInt(val))
                  setRackDivId(val)
                  setRackDivCode(d?.division_code ?? '')
                }}
                options={[{ value: '', label: '— Select Division —' }, ...divisionsForRackForm.map(d => ({ value: String(d.id), label: `${d.division_code} — ${d.division_name}` }))]}
                required
              />
              <InputField label="Rack Number" value={rackNumber} onChange={setRackNumber} placeholder="e.g. R01" required />
              <SelectField
                label="Shelf Level"
                value={shelfLevel}
                onChange={setShelfLevel}
                options={[
                  { value: '', label: '— None —' },
                  { value: 'L1', label: 'L1' },
                  { value: 'L2', label: 'L2' },
                  { value: 'L3', label: 'L3' },
                  { value: 'L4', label: 'L4' },
                ]}
              />
              <InputField label="Capacity" value={rackCapacity} onChange={setRackCapacity} placeholder="optional" type="number" />

              {/* Live preview */}
              <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
                <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest mb-0.5">Rack Code Preview</p>
                <p className="text-base font-mono font-black text-blue-700">{rackCodePreview}</p>
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={handleCreateRack} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold py-2.5 rounded-xl transition-all">Create Rack</button>
              <button onClick={() => setShowRackForm(false)} className="bg-slate-100 hover:bg-slate-200 text-slate-600 text-sm font-bold px-4 py-2.5 rounded-xl transition-all">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

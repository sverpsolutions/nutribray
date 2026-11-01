import React, { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { stock_take_api, type StockTakeDetail, type StockTakeLookupProduct, type StockTakeProductBatch } from '../../api/stockTake'
import { products_api } from '../../api/products'
import { masters_api, type category_type, type brand_type, type unit_type } from '../../api/masters'

interface LogEntry {
  id: string
  item_code: string
  product_name: string
  product_id: number
  qoh: number
  scanned_qty: number
  total_counted: number | null
  variance: number | null
  time: string
  corrected?: boolean
  batches_summary?: string
}

export default function StockTakeCount() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [session, setSession] = useState<StockTakeDetail | null>(null)
  const [loading, setLoading] = useState(true)

  // KPIs
  const [scansThisSession, setScansThisSession] = useState(0)

  // Rapid Scan Mode (Auto-save +1 on Enter without opening card)
  const [rapidScanMode, setRapidScanMode] = useState<boolean>(true)
  const [scanMultiplier, setScanMultiplier] = useState<number>(1)

  // Scanner state
  const [scanText, setScanText] = useState('')
  const [statusMsg, setStatusMsg] = useState<{ text: string; type: 'success' | 'error' | 'loading' } | null>(null)
  const scanInputRef = useRef<HTMLInputElement>(null)

  // Picker state (when > 1 matches)
  const [pickerProducts, setPickerProducts] = useState<StockTakeLookupProduct[]>([])
  const [pickerHighlightIndex, setPickerHighlightIndex] = useState(0)

  // Active Item Card State (used in manual mode or for editing)
  const [activeProduct, setActiveProduct] = useState<StockTakeLookupProduct | null>(null)
  const [enteredQty, setEnteredQty] = useState<string>('1')
  const qtyInputRef = useRef<HTMLInputElement>(null)
  const [activeBatches, setActiveBatches] = useState<StockTakeProductBatch[]>([])

  // Add New Product Modal State
  const [showAddProductModal, setShowAddProductModal] = useState(false)
  const [newProdName, setNewProdName] = useState('')
  const [newProdBarcode, setNewProdBarcode] = useState('')
  const [newProdItemCode, setNewProdItemCode] = useState('')
  const [newProdCategoryId, setNewProdCategoryId] = useState<number | ''>('')
  const [newProdBrandId, setNewProdBrandId] = useState<number | ''>('')
  const [newProdUnit, setNewProdUnit] = useState('PCS')
  const [newProdMrp, setNewProdMrp] = useState<string>('0')
  const [newProdSp, setNewProdSp] = useState<string>('0')
  const [newProdCost, setNewProdCost] = useState<string>('0')
  const [newProdGst, setNewProdGst] = useState<number>(0)
  const [newProdCountQty, setNewProdCountQty] = useState<string>('1')
  const [creatingProduct, setCreatingProduct] = useState(false)

  // Masters for Add Product Modal
  const [categories, setCategories] = useState<category_type[]>([])
  const [brands, setBrands] = useState<brand_type[]>([])
  const [units, setUnits] = useState<unit_type[]>([])

  // Scan Log
  const [scanLogs, setScanLogs] = useState<LogEntry[]>([])

  // Finalize Modal
  const [showFinalizeModal, setShowFinalizeModal] = useState(false)
  const [unscannedOption, setUnscannedOption] = useState<'leave' | 'zero'>('leave')
  const [adjustStock, setAdjustStock] = useState(true)
  const [finalizing, setFinalizing] = useState(false)

  // Import Modal
  const [showImportModal, setShowImportModal] = useState(false)
  const [importCsvText, setImportCsvText] = useState('')
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<any | null>(null)

  // Timer ref for status msg auto-clear
  const statusTimerRef = useRef<any>(null)

  const showStatus = (text: string, type: 'success' | 'error' | 'loading') => {
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current)
    setStatusMsg({ text, type })
    if (type !== 'loading') {
      statusTimerRef.current = setTimeout(() => {
        setStatusMsg(null)
      }, 2500)
    }
  }

  // Refocus scan box helper
  const refocusScan = (delay = 80) => {
    setTimeout(() => {
      setScanText('')
      scanInputRef.current?.focus()
      scanInputRef.current?.select()
    }, delay)
  }

  // 1. Load Session
  const loadSession = () => {
    if (!id) return
    stock_take_api.get(Number(id))
      .then(res => {
        const d = res.data
        if (d.status !== 'in_progress') {
          toast('Stock take is completed or cancelled. Redirecting to view.', { icon: 'ℹ️' })
          navigate(`/inventory/stock-take/view/${d.id}`)
          return
        }
        setSession(d)
      })
      .catch(() => {
        toast.error('Failed to load stock take session')
        navigate('/inventory/stock-take')
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadSession()
    refocusScan(150)
    // Preload categories, brands, and units for the Add Product modal
    masters_api.get_categories().then(r => setCategories(r.data || [])).catch(() => {})
    masters_api.get_brands().then(r => setBrands(r.data || [])).catch(() => {})
    masters_api.get_units().then(r => setUnits(r.data || [])).catch(() => {})
  }, [id])

  // 2. Debounced live search
  useEffect(() => {
    const q = scanText.trim()
    if (q.length < 3 || activeProduct) {
      if (!q) setPickerProducts([])
      return
    }

    const t = setTimeout(() => {
      if (!session) return
      stock_take_api.lookup(session.id, q)
        .then(res => {
          const list = res.data.products || []
          if (list.length > 1) {
            setPickerProducts(list)
            setPickerHighlightIndex(0)
          } else {
            setPickerProducts([])
          }
        })
        .catch(() => {})
    }, 300)

    return () => clearTimeout(t)
  }, [scanText, activeProduct, session])

  // Direct Save for Rapid Scanning without opening item card
  const quickSaveProductCount = async (prod: StockTakeLookupProduct, qtyToAdd: number = 1) => {
    if (!session) return
    showStatus('Saving…', 'loading')
    try {
      const res = await stock_take_api.scan_save({
        stock_take_id: session.id,
        product_id: prod.id,
        qty: qtyToAdd,
      })
      const resData = res.data

      // Update KPI
      setScansThisSession(s => s + 1)
      setSession(prev => prev ? {
        ...prev,
        counted_items: resData.counted_items,
        not_yet_scanned: Math.max(0, prev.total_items - resData.counted_items),
      } : prev)

      // Add to Log at the top
      const newLog: LogEntry = {
        id: Math.random().toString(),
        item_code: prod.item_code,
        product_name: prod.name,
        product_id: prod.id,
        qoh: prod.system_qty,
        scanned_qty: qtyToAdd,
        total_counted: resData.new_qty,
        variance: resData.variance,
        time: new Date().toTimeString().split(' ')[0],
      }
      setScanLogs(prev => [newLog, ...prev])
      showStatus(`✓ Counted: ${prod.name} (+${qtyToAdd}) Total: ${resData.new_qty}`, 'success')
      refocusScan(50)
    } catch (err: any) {
      showStatus(err?.response?.data?.detail || 'Save failed', 'error')
      refocusScan(80)
    }
  }

  // Open modal to register a new product
  const openAddProductModal = (barcodeOrQuery = '') => {
    setNewProdName('')
    setNewProdBarcode(barcodeOrQuery)
    setNewProdItemCode(barcodeOrQuery)
    setNewProdCategoryId('')
    setNewProdBrandId('')
    setNewProdUnit('PCS')
    setNewProdMrp('0')
    setNewProdSp('0')
    setNewProdCost('0')
    setNewProdGst(0)
    setNewProdCountQty(String(scanMultiplier || 1))
    setShowAddProductModal(true)
  }

  // Submit new product creation and immediately count it in stock take
  const handleCreateProductAndCount = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newProdName.trim()) {
      toast.error('Product name is required')
      return
    }
    if (!session) return

    setCreatingProduct(true)
    try {
      const payload: any = {
        name: newProdName.trim(),
        barcode: newProdBarcode.trim() || undefined,
        item_code: newProdItemCode.trim() || undefined,
        category_id: newProdCategoryId ? Number(newProdCategoryId) : undefined,
        brand_id: newProdBrandId ? Number(newProdBrandId) : undefined,
        unit: newProdUnit || 'PCS',
        mrp: parseFloat(newProdMrp) || 0,
        selling_price: parseFloat(newProdSp) || 0,
        cost_price: parseFloat(newProdCost) || 0,
        basic_cost: parseFloat(newProdCost) || 0,
        gst_percent: newProdGst || 0,
      }

      // 1. Create product in catalog
      const createRes = await products_api.create(payload)
      const createdProd = createRes.data

      // 2. Count it in current stock take session
      const countQtyNum = parseFloat(newProdCountQty) || 1
      const scanRes = await stock_take_api.scan_save({
        stock_take_id: session.id,
        product_id: createdProd.id,
        qty: countQtyNum,
      })
      const scanData = scanRes.data

      // 3. Update session KPI
      setScansThisSession(s => s + 1)
      setSession(prev => prev ? {
        ...prev,
        total_items: prev.total_items + 1,
        counted_items: scanData.counted_items,
        not_yet_scanned: Math.max(0, (prev.total_items + 1) - scanData.counted_items),
      } : prev)

      // 4. Prepend to scan log
      const newLog: LogEntry = {
        id: Math.random().toString(),
        item_code: createdProd.item_code || newProdBarcode,
        product_name: createdProd.name,
        product_id: createdProd.id,
        qoh: 0,
        scanned_qty: countQtyNum,
        total_counted: scanData.new_qty,
        variance: scanData.variance,
        time: new Date().toTimeString().split(' ')[0],
      }
      setScanLogs(prev => [newLog, ...prev])

      toast.success(`Product "${createdProd.name}" created and counted (+${countQtyNum})!`)
      setShowAddProductModal(false)
      refocusScan(100)
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Failed to create product')
    } finally {
      setCreatingProduct(false)
    }
  }

  // Handle Scan Box Enter
  const handleScanKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (pickerProducts.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setPickerHighlightIndex(p => (p + 1) % pickerProducts.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setPickerHighlightIndex(p => (p - 1 + pickerProducts.length) % pickerProducts.length)
        return
      }
      if (e.key === 'Escape') {
        setPickerProducts([])
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        const selected = pickerProducts[pickerHighlightIndex] || pickerProducts[0]
        setPickerProducts([])
        const isBatch = Boolean(selected.has_batch_tracking || (selected.batches && selected.batches.length > 0))
        if (rapidScanMode && !isBatch) {
          quickSaveProductCount(selected, scanMultiplier || 1)
        } else {
          selectProductForCount(selected)
        }
        return
      }
    }

    if (e.key === 'Enter') {
      e.preventDefault()
      const query = scanText.trim()
      if (!query || !session) return

      showStatus('Looking up…', 'loading')
      try {
        const res = await stock_take_api.lookup(session.id, query)
        const list = res.data.products || []
        if (list.length === 1) {
          const prod = list[0]
          const isBatch = Boolean(prod.has_batch_tracking || (prod.batches && prod.batches.length > 0))
          if (rapidScanMode && !isBatch) {
            quickSaveProductCount(prod, scanMultiplier || 1)
          } else {
            selectProductForCount(prod)
          }
        } else if (list.length > 1) {
          // Check for exact barcode/item_code match
          const exact = list.find(
            p => p.barcode?.toLowerCase() === query.toLowerCase() || p.item_code?.toLowerCase() === query.toLowerCase()
          )
          if (exact) {
            const isBatch = Boolean(exact.has_batch_tracking || (exact.batches && exact.batches.length > 0))
            if (rapidScanMode && !isBatch) {
              quickSaveProductCount(exact, scanMultiplier || 1)
            } else {
              selectProductForCount(exact)
            }
          } else {
            setPickerProducts(list)
            setPickerHighlightIndex(0)
            showStatus(`${list.length} matches found`, 'success')
          }
        } else {
          // NOT FOUND: Prompt and open Add New Product Modal!
          showStatus(`Not found: ${query}`, 'error')
          openAddProductModal(query)
        }
      } catch (err) {
        showStatus('Lookup error', 'error')
        refocusScan(80)
      }
    }
  }

  // Select product -> open item card (manual mode or batch-tracked item)
  const selectProductForCount = (p: StockTakeLookupProduct) => {
    setActiveProduct(p)
    setPickerProducts([])
    setEnteredQty(String(scanMultiplier || 1))

    const isBatch = Boolean(p.has_batch_tracking || (p.batches && p.batches.length > 0))
    if (isBatch) {
      if (p.batches && p.batches.length > 0) {
        const initBatches: StockTakeProductBatch[] = p.batches.map(b => {
          const sys = Number(b.system_qty || 0)
          const cnt = b.counted_qty !== undefined && b.counted_qty !== null ? Number(b.counted_qty) : sys
          return {
            ...b,
            system_qty: sys,
            counted_qty: cnt,
            variance: cnt - sys,
            reason: b.reason || (cnt === sys ? 'Normal / Verified' : ''),
          }
        })
        setActiveBatches(initBatches)
      } else {
        setActiveBatches([{
          batch_id: undefined,
          batch_no: '',
          mfg_date: '',
          expiry_date: '',
          system_qty: 0,
          counted_qty: 1,
          variance: 1,
          reason: 'Initial Lot',
          status: 'Active'
        }])
      }
    } else {
      setActiveBatches([])
      setTimeout(() => {
        qtyInputRef.current?.focus()
        qtyInputRef.current?.select()
      }, 50)
    }
  }

  // Batch Management Helpers
  const updateBatchCount = (index: number, field: keyof StockTakeProductBatch, value: any) => {
    setActiveBatches(prev => {
      const updated = [...prev]
      const row = { ...updated[index], [field]: value }
      if (field === 'counted_qty') {
        const cnt = parseFloat(value) || 0
        row.variance = cnt - Number(row.system_qty || 0)
      }
      updated[index] = row
      return updated
    })
  }

  const addFoundBatchRow = () => {
    setActiveBatches(prev => [
      ...prev,
      {
        batch_id: undefined,
        batch_no: `LOT-${Date.now().toString().slice(-4)}`,
        mfg_date: '',
        expiry_date: '',
        system_qty: 0,
        counted_qty: 1,
        variance: 1,
        reason: 'Found on Shelf',
        status: 'Active'
      }
    ])
  }

  const removeBatchRow = (index: number) => {
    setActiveBatches(prev => prev.filter((_, idx) => idx !== index))
  }

  const getExpiryBadge = (expStr?: string | null) => {
    if (!expStr) return null
    const expDate = new Date(expStr)
    if (isNaN(expDate.getTime())) return null
    const now = new Date()
    now.setHours(0, 0, 0, 0)
    const diffDays = Math.ceil((expDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))

    if (diffDays < 0) {
      return (
        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-700 border border-red-200">
          EXPIRED ({Math.abs(diffDays)}d ago)
        </span>
      )
    } else if (diffDays <= 30) {
      return (
        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
          NEAR EXPIRY ({diffDays}d)
        </span>
      )
    } else {
      return (
        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
          ACTIVE
        </span>
      )
    }
  }

  const handleSaveBatchCount = async () => {
    if (!session || !activeProduct) return

    for (let i = 0; i < activeBatches.length; i++) {
      if (!activeBatches[i].batch_no || !activeBatches[i].batch_no.trim()) {
        toast.error(`Batch #${i + 1} has an empty batch number`)
        return
      }
    }

    const totalCounted = activeBatches.reduce((acc, b) => acc + (parseFloat(String(b.counted_qty ?? 0)) || 0), 0)

    showStatus('Saving batches…', 'loading')
    try {
      const res = await stock_take_api.save_batches({
        stock_take_id: session.id,
        product_id: activeProduct.id,
        batches: activeBatches.map(b => ({
          batch_id: b.batch_id,
          batch_no: b.batch_no.trim(),
          mfg_date: b.mfg_date || null,
          expiry_date: b.expiry_date || b.exp_date || null,
          system_qty: Number(b.system_qty || 0),
          counted_qty: b.counted_qty !== null && b.counted_qty !== undefined ? parseFloat(String(b.counted_qty)) : null,
          reason: b.reason || null
        }))
      })
      const resData = res.data

      // Update KPI
      setScansThisSession(s => s + 1)
      setSession(prev => prev ? {
        ...prev,
        counted_items: resData.counted_items,
        not_yet_scanned: Math.max(0, prev.total_items - resData.counted_items),
      } : prev)

      // Add to Log at the top
      const bSummary = activeBatches.map(b => `${b.batch_no}: ${b.counted_qty ?? 0}`).join(', ')
      const newLog: LogEntry = {
        id: Math.random().toString(),
        item_code: activeProduct.item_code,
        product_name: activeProduct.name,
        product_id: activeProduct.id,
        qoh: activeProduct.system_qty,
        scanned_qty: totalCounted,
        total_counted: resData.new_qty,
        variance: resData.variance,
        time: new Date().toTimeString().split(' ')[0],
        batches_summary: bSummary
      }
      setScanLogs(prev => [newLog, ...prev])

      showStatus(`✓ Saved ${activeBatches.length} batch(es)`, 'success')
      toast.success(`Batches counted for "${activeProduct.name}" (Total: ${resData.new_qty} ${activeProduct.unit})`)
      setActiveProduct(null)
      setActiveBatches([])
      refocusScan(60)
    } catch (err: any) {
      showStatus(err?.response?.data?.detail || 'Save failed', 'error')
      toast.error(err?.response?.data?.detail || 'Failed to save batch counts')
      refocusScan(80)
    }
  }

  // Cumulative Save (Adds to count)
  const handleSaveCount = async (mode: 'add' | 'exact' = 'add') => {
    if (!session || !activeProduct) return
    const num = parseFloat(enteredQty)
    if (isNaN(num) || num < 0) {
      toast.error('Please enter a valid quantity >= 0')
      return
    }

    showStatus('Saving…', 'loading')
    try {
      let resData: any
      if (mode === 'add') {
        const res = await stock_take_api.scan_save({
          stock_take_id: session.id,
          product_id: activeProduct.id,
          qty: num,
        })
        resData = res.data
      } else {
        const res = await stock_take_api.edit_count({
          stock_take_id: session.id,
          product_id: activeProduct.id,
          qty: num,
        })
        resData = res.data
      }

      // Update KPI
      setScansThisSession(s => s + 1)
      setSession(prev => prev ? {
        ...prev,
        counted_items: resData.counted_items,
        not_yet_scanned: Math.max(0, prev.total_items - resData.counted_items),
      } : prev)

      // Add to Log at the top
      const newLog: LogEntry = {
        id: Math.random().toString(),
        item_code: activeProduct.item_code,
        product_name: activeProduct.name,
        product_id: activeProduct.id,
        qoh: activeProduct.system_qty,
        scanned_qty: mode === 'add' ? num : (resData.new_qty - (activeProduct.counted_qty || 0)),
        total_counted: resData.new_qty,
        variance: resData.variance,
        time: new Date().toTimeString().split(' ')[0],
      }
      setScanLogs(prev => [newLog, ...prev])

      showStatus('Saved ✓', 'success')
      setActiveProduct(null)
      refocusScan(60)
    } catch (err: any) {
      showStatus(err?.response?.data?.detail || 'Save failed', 'error')
      refocusScan(80)
    }
  }

  // Remove count for active item
  const handleRemoveActiveCount = async () => {
    if (!session || !activeProduct) return
    if (!window.confirm(`Remove count for "${activeProduct.name}"? It will go back to NOT COUNTED.`)) return

    try {
      const res = await stock_take_api.edit_count({
        stock_take_id: session.id,
        product_id: activeProduct.id,
        clear: true,
      })
      setSession(prev => prev ? {
        ...prev,
        counted_items: res.data.counted_items,
        not_yet_scanned: Math.max(0, prev.total_items - res.data.counted_items),
      } : prev)

      const newLog: LogEntry = {
        id: Math.random().toString(),
        item_code: activeProduct.item_code,
        product_name: activeProduct.name,
        product_id: activeProduct.id,
        qoh: activeProduct.system_qty,
        scanned_qty: 0,
        total_counted: null,
        variance: null,
        time: new Date().toTimeString().split(' ')[0],
      }
      setScanLogs(prev => [newLog, ...prev])

      showStatus('Count removed', 'success')
      setActiveProduct(null)
      refocusScan(60)
    } catch (err) {
      toast.error('Failed to remove count')
    }
  }

  // Edit log row total count
  const handleCorrectLogRow = async (log: LogEntry) => {
    const current = log.total_counted !== null ? log.total_counted : ''
    const val = window.prompt(`Correct TOTAL counted qty for "${log.product_name}":`, String(current))
    if (val === null) return
    const num = parseFloat(val)
    if (isNaN(num) || num < 0) {
      toast.error('Invalid quantity')
      return
    }

    try {
      const res = await stock_take_api.edit_count({
        stock_take_id: session!.id,
        product_id: log.product_id,
        qty: num,
      })
      // Update all log rows of this product
      setScanLogs(prev => prev.map(l =>
        l.product_id === log.product_id
          ? { ...l, total_counted: res.data.new_qty, variance: res.data.variance, corrected: true }
          : l
      ))
      setSession(prev => prev ? { ...prev, counted_items: res.data.counted_items } : prev)
      toast.success('Count updated')
    } catch (err) {
      toast.error('Correction failed')
    }
  }

  // Remove count from log row
  const handleRemoveFromLog = async (log: LogEntry) => {
    if (!window.confirm(`Remove count for "${log.product_name}"? It goes back to NOT COUNTED.`)) return
    try {
      const res = await stock_take_api.edit_count({
        stock_take_id: session!.id,
        product_id: log.product_id,
        clear: true,
      })
      setScanLogs(prev => prev.map(l =>
        l.product_id === log.product_id
          ? { ...l, total_counted: null, variance: null, corrected: true }
          : l
      ))
      setSession(prev => prev ? { ...prev, counted_items: res.data.counted_items } : prev)
      toast.success('Count removed')
    } catch (err) {
      toast.error('Removal failed')
    }
  }

  // Finalize Submission
  const handleFinalize = async () => {
    if (!session) return
    setFinalizing(true)
    try {
      await stock_take_api.finalize(session.id, {
        adjust_stock: adjustStock,
        zero_uncounted: unscannedOption === 'zero',
      })
      toast.success('Stock take finalized successfully!')
      setShowFinalizeModal(false)
      navigate(`/inventory/stock-take/view/${session.id}`)
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Failed to finalize')
    } finally {
      setFinalizing(false)
    }
  }

  // Import batch text submit
  const handleImportSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!session || !importCsvText.trim()) return

    const lines = importCsvText.trim().split('\n')
    const items: Array<{
      item_code: string
      qty: number
      batch_no?: string
      expiry_date?: string
      mfg_date?: string
      mrp?: number
    }> = []

    for (const line of lines) {
      const parts = line.split(/[,\t|]/).map(s => s.trim())
      if (parts.length >= 2) {
        const code = parts[0]
        const q = parseFloat(parts[1])
        if (code && !isNaN(q)) {
          let batch_no: string | undefined = undefined
          let expiry_date: string | undefined = undefined
          let mrp: number | undefined = undefined

          if (parts.length >= 4) {
            // 4 columns: item_code, qty, batch_no, expiry_date
            batch_no = parts[2] || undefined
            expiry_date = parts[3] || undefined
          } else if (parts.length === 3 && parts[2]) {
            // 3 columns: check if numeric mrp or batch_no
            if (/^[0-9]+(\.[0-9]+)?$/.test(parts[2]) && parts[2].length < 6) {
              mrp = parseFloat(parts[2])
            } else {
              batch_no = parts[2]
            }
          }

          items.push({ item_code: code, qty: q, batch_no, expiry_date, mrp })
        }
      }
    }

    if (items.length === 0) {
      toast.error('No valid rows found. Please format as: item_code, qty or item_code, qty, batch_no, expiry_date')
      return
    }

    setImporting(true)
    try {
      const res = await stock_take_api.import_batch(session.id, items)
      setImportResult(res.data)
      setSession(prev => prev ? { ...prev, counted_items: res.data.counted_items } : prev)
      toast.success(`Imported ${res.data.applied_count} item(s)!`)
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400 text-sm">
        <i className="fas fa-spinner fa-spin text-2xl mr-2"></i> Loading stock count session…
      </div>
    )
  }

  if (!session) return null

  // Live variance calculation for active card
  const currentCounted = activeProduct ? Number(activeProduct.counted_qty || 0) : 0
  const typedQtyNum = activeProduct ? (parseFloat(enteredQty) || 0) : 0
  const previewTotal = currentCounted + typedQtyNum
  const previewVariance = activeProduct ? round3(previewTotal - activeProduct.system_qty) : 0

  function round3(n: number) {
    return Math.round(n * 1000) / 1000
  }

  return (
    <div className="p-4 space-y-4 font-sans text-slate-800 max-w-7xl mx-auto">
      {/* ── HEADER ── */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="text-xl font-bold flex items-center gap-2 text-slate-800">
              <i className="fas fa-barcode text-blue-700 text-2xl"></i> Stock Count
            </span>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider bg-amber-100 text-amber-800 border border-amber-300 font-mono">
              {session.take_no}
            </span>
          </div>
          <div className="text-xs text-slate-500 font-medium mt-1 flex items-center gap-1.5">
            <i className="fas fa-map-marker-alt text-red-500"></i> Location: <b className="text-slate-700">{session.location_name}</b>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => navigate('/inventory/stock-take')}
            className="px-3 py-2 border border-slate-300 text-slate-700 font-semibold rounded-xl text-xs hover:bg-slate-50 transition-colors"
          >
            ← All Stock Takes
          </button>
          <button
            onClick={() => { setImportResult(null); setShowImportModal(true) }}
            className="px-3 py-2 border border-blue-300 text-blue-700 font-semibold rounded-xl text-xs hover:bg-blue-50 transition-colors flex items-center gap-1.5"
          >
            <i className="fas fa-file-excel text-emerald-600"></i> Import Excel / CSV
          </button>
          <button
            onClick={() => setShowFinalizeModal(true)}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs shadow transition-colors flex items-center gap-1.5"
          >
            <i className="fas fa-check-circle"></i> ✔ Scanning Complete
          </button>
        </div>
      </div>

      {/* ── KPI STRIP ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-xs text-center">
          <div className="text-2xl font-black text-blue-700 font-mono">{session.counted_items}</div>
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mt-0.5">Items Scanned</div>
        </div>
        <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-xs text-center">
          <div className="text-2xl font-black text-slate-800 font-mono">{session.total_items}</div>
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mt-0.5">Total Items</div>
        </div>
        <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-xs text-center">
          <div className="text-2xl font-black text-amber-600 font-mono">{session.not_yet_scanned}</div>
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mt-0.5">Not Yet Scanned</div>
        </div>
        <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-xs text-center">
          <div className="text-2xl font-black text-emerald-600 font-mono">{scansThisSession}</div>
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mt-0.5">Scans This Session</div>
        </div>
      </div>

      {/* ── SCAN BOX ── */}
      <div className="bg-white p-4 rounded-xl border-l-4 border-l-blue-600 border border-slate-200 shadow-sm">
        <div className="flex flex-wrap justify-between items-center gap-2 mb-2">
          <div className="flex flex-wrap items-center gap-2.5">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
              <i className="fas fa-barcode text-blue-600"></i> Scan Barcode / Item Code / Name:
            </label>

            {/* Rapid Scan Mode Toggle */}
            <button
              type="button"
              onClick={() => {
                setRapidScanMode(!rapidScanMode)
                refocusScan(50)
              }}
              title={rapidScanMode ? "Rapid Scan Mode: Item is automatically counted (+1) on scan" : "Manual Mode: Opens item card to enter count"}
              className={`text-xs px-2.5 py-1 rounded-full font-bold flex items-center gap-1.5 transition-colors cursor-pointer border ${
                rapidScanMode
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-300 hover:bg-emerald-100'
                  : 'bg-slate-100 text-slate-600 border-slate-300 hover:bg-slate-200'
              }`}
            >
              <i className={`fas ${rapidScanMode ? 'fa-bolt text-emerald-600' : 'fa-hand-paper text-slate-400'}`}></i>
              {rapidScanMode ? 'Rapid Scan (Auto +Count)' : 'Manual Mode (Open Card)'}
            </button>

            {/* Scan Multiplier (when rapid scan is active) */}
            {rapidScanMode && (
              <div className="flex items-center gap-1 text-xs bg-slate-100 px-2 py-0.5 rounded-lg border border-slate-200">
                <span className="text-slate-500 font-medium">Qty/Scan:</span>
                <input
                  type="number"
                  min="1"
                  step="any"
                  value={scanMultiplier}
                  onChange={e => setScanMultiplier(Math.max(1, parseFloat(e.target.value) || 1))}
                  className="w-12 bg-white text-center font-bold text-slate-800 border border-slate-300 rounded px-1 py-0.5 text-xs focus:outline-hidden focus:border-blue-500"
                />
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => openAddProductModal(scanText)}
              className="text-xs px-2.5 py-1 rounded-lg font-bold bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 flex items-center gap-1 transition-colors cursor-pointer"
              title="Add a brand new product directly to catalog and stock take"
            >
              <i className="fas fa-plus-circle text-blue-600"></i> + New Product
            </button>

            {statusMsg && (
              <div
                className={`text-xs font-bold px-2.5 py-0.5 rounded transition-all ${
                  statusMsg.type === 'success'
                    ? 'bg-emerald-100 text-emerald-800'
                    : statusMsg.type === 'error'
                    ? 'bg-red-100 text-red-800'
                    : 'bg-blue-100 text-blue-800'
                }`}
              >
                {statusMsg.type === 'loading' && <i className="fas fa-spinner fa-spin mr-1"></i>}
                {statusMsg.text}
              </div>
            )}
          </div>
        </div>

        <div className="relative">
          <input
            ref={scanInputRef}
            type="text"
            value={scanText}
            onChange={e => setScanText(e.target.value)}
            onKeyDown={handleScanKeyDown}
            placeholder={rapidScanMode ? "Scan barcode or enter code (Auto-counts and stays focused)…" : "Scan or type here… (press Enter to look up)"}
            autoComplete="off"
            className="w-full text-lg font-bold tracking-wide px-3 py-2 border-2 border-slate-300 rounded-lg focus:border-blue-600 focus:outline-hidden bg-slate-50/50"
          />
        </div>

        {/* Multiple Matches Picker */}
        {pickerProducts.length > 0 && (
          <div className="mt-2 bg-white border border-blue-400 rounded-lg shadow-lg overflow-hidden animate-in fade-in duration-100">
            <div className="bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-900 border-b border-blue-200 flex justify-between">
              <span>Multiple matches — use ↑/↓ and Enter to select:</span>
              <span className="text-slate-500 font-normal">Esc to dismiss</span>
            </div>
            <div className="max-h-60 overflow-y-auto divide-y divide-slate-100">
              {pickerProducts.map((p, idx) => {
                const isSelected = idx === pickerHighlightIndex
                return (
                  <div
                    key={p.id}
                    onClick={() => selectProductForCount(p)}
                    className={`px-3 py-2 text-xs flex justify-between items-center cursor-pointer transition-colors ${
                      isSelected ? 'bg-blue-600 text-white font-medium' : 'hover:bg-blue-50 text-slate-800'
                    }`}
                  >
                    <div>
                      <span className="font-bold">{p.name}</span>
                      <span className={`ml-2 font-mono text-[11px] ${isSelected ? 'text-blue-100' : 'text-slate-500'}`}>
                        {p.item_code}
                      </span>
                    </div>
                    <div className="text-right flex items-center gap-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        isSelected ? 'bg-blue-800 text-white' : 'bg-slate-100 text-slate-700'
                      }`}>
                        QOH: {p.system_qty}
                      </span>
                      <span>₹{p.selling_price.toFixed(2)}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── ACTIVE ITEM CARD (Hidden until selected) ── */}
      {activeProduct && (
        <div className="bg-white p-5 rounded-xl border-l-4 border-l-emerald-600 border border-slate-200 shadow-md animate-in slide-in-from-top-2 duration-150">
          {Boolean(activeProduct.has_batch_tracking || (activeProduct.batches && activeProduct.batches.length > 0) || activeBatches.length > 0) ? (
            <div className="space-y-4">
              {/* Product Info Header */}
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center pb-3 border-b border-slate-100 gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-black text-slate-800">{activeProduct.name}</span>
                    <span className="px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider bg-purple-100 text-purple-800 border border-purple-200 flex items-center gap-1">
                      <i className="fas fa-boxes"></i> Batch Tracked
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 font-mono mt-0.5">
                    Item Code: <b className="text-slate-800">{activeProduct.item_code}</b>
                    {activeProduct.barcode && <> &nbsp;·&nbsp; EAN: <b>{activeProduct.barcode}</b></>}
                    &nbsp;·&nbsp; Unit: <b>{activeProduct.unit}</b>
                    &nbsp;·&nbsp; MRP: <b>₹{Number(activeProduct.mrp || 0).toFixed(2)}</b>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="bg-blue-50 text-blue-800 border border-blue-200 px-2.5 py-1 rounded-lg text-xs font-bold font-mono">
                    System QOH: {activeProduct.system_qty} {activeProduct.unit}
                  </span>
                  <button
                    onClick={() => {
                      setActiveProduct(null)
                      setActiveBatches([])
                      refocusScan(50)
                    }}
                    className="text-slate-400 hover:text-slate-700 text-lg px-2 py-0.5 rounded-lg hover:bg-slate-100 cursor-pointer"
                    title="Close (Esc)"
                  >
                    ✕
                  </button>
                </div>
              </div>

              {/* Batch Breakdown Table */}
              <div className="overflow-x-auto border border-slate-200 rounded-xl">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-100 text-slate-700 font-bold uppercase text-[10.5px]">
                    <tr>
                      <th className="py-2.5 px-3">#</th>
                      <th className="py-2.5 px-3">Batch / Lot No</th>
                      <th className="py-2.5 px-3">Mfg Date</th>
                      <th className="py-2.5 px-3">Expiry Date</th>
                      <th className="py-2.5 px-3 text-right">System Qty</th>
                      <th className="py-2.5 px-3 text-center w-36">Physical Count</th>
                      <th className="py-2.5 px-3 text-right">Variance</th>
                      <th className="py-2.5 px-3">Reason for Difference</th>
                      <th className="py-2.5 px-3 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {activeBatches.map((b, bIdx) => {
                      const expStr = b.expiry_date || b.exp_date
                      const isPos = (b.variance || 0) > 0
                      const isNeg = (b.variance || 0) < 0

                      return (
                        <tr key={bIdx} className="hover:bg-slate-50/70">
                          <td className="py-2.5 px-3 text-slate-400 font-mono">{bIdx + 1}</td>
                          <td className="py-2.5 px-3">
                            {b.batch_id ? (
                              <span className="font-mono font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded text-xs border border-slate-200">
                                {b.batch_no}
                              </span>
                            ) : (
                              <input
                                type="text"
                                placeholder="Batch No"
                                value={b.batch_no}
                                onChange={e => updateBatchCount(bIdx, 'batch_no', e.target.value)}
                                className="font-mono font-bold text-xs px-2 py-1 border border-blue-400 rounded bg-white w-32 focus:outline-hidden"
                              />
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-slate-600 font-mono">
                            {b.batch_id ? (
                              b.mfg_date || '—'
                            ) : (
                              <input
                                type="date"
                                value={b.mfg_date || ''}
                                onChange={e => updateBatchCount(bIdx, 'mfg_date', e.target.value)}
                                className="text-xs px-1.5 py-0.5 border border-slate-300 rounded bg-white"
                              />
                            )}
                          </td>
                          <td className="py-2.5 px-3 font-mono">
                            {b.batch_id ? (
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span>{expStr || '—'}</span>
                                {getExpiryBadge(expStr)}
                              </div>
                            ) : (
                              <input
                                type="date"
                                value={expStr || ''}
                                onChange={e => {
                                  updateBatchCount(bIdx, 'expiry_date', e.target.value)
                                  updateBatchCount(bIdx, 'exp_date', e.target.value)
                                }}
                                className="text-xs px-1.5 py-0.5 border border-slate-300 rounded bg-white"
                              />
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-600">
                            {Number(b.system_qty).toFixed(3)}
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <input
                                type="number"
                                step="any"
                                min="0"
                                value={b.counted_qty !== null && b.counted_qty !== undefined ? b.counted_qty : ''}
                                onChange={e => updateBatchCount(bIdx, 'counted_qty', e.target.value)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault()
                                    handleSaveBatchCount()
                                  }
                                  if (e.key === 'Escape') {
                                    setActiveProduct(null)
                                    setActiveBatches([])
                                    refocusScan(50)
                                  }
                                }}
                                className="w-24 text-center font-bold text-sm px-2 py-1 border-2 border-emerald-500 rounded-lg focus:outline-hidden bg-emerald-50 text-emerald-900"
                              />
                              <span className="text-[10px] text-slate-500 font-medium">{activeProduct.unit}</span>
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold">
                            <span className={isPos ? 'text-blue-600' : isNeg ? 'text-red-600' : 'text-emerald-600'}>
                              {isPos ? `+${Number(b.variance).toFixed(3)}` : Number(b.variance || 0).toFixed(3)}
                            </span>
                          </td>
                          <td className="py-2.5 px-3">
                            <select
                              value={b.reason || ''}
                              onChange={e => updateBatchCount(bIdx, 'reason', e.target.value)}
                              className="text-xs px-2 py-1 border border-slate-300 rounded bg-white focus:outline-hidden"
                            >
                              <option value="">-- Select Reason --</option>
                              <option value="Normal / Verified">Normal / Verified</option>
                              <option value="Damaged">Damaged</option>
                              <option value="Expired Stock">Expired Stock</option>
                              <option value="Found on Shelf">Found on Shelf</option>
                              <option value="Shortage / Leakage">Shortage / Leakage</option>
                              <option value="Wrong Placement">Wrong Placement</option>
                              <option value="Other">Other</option>
                            </select>
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            {!b.batch_id ? (
                              <button
                                onClick={() => removeBatchRow(bIdx)}
                                className="text-red-500 hover:text-red-700 px-1.5 py-0.5 rounded text-xs cursor-pointer"
                                title="Remove newly added batch"
                              >
                                🗑
                              </button>
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Add Found Batch & Totals & Actions */}
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={addFoundBatchRow}
                  className="px-3 py-1.5 rounded-lg border border-purple-300 bg-purple-50 text-purple-700 font-bold text-xs hover:bg-purple-100 transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <i className="fas fa-plus-circle text-purple-600"></i> + Add Found Batch / New Lot
                </button>

                <div className="flex items-center gap-4 flex-wrap bg-slate-50 px-4 py-2 rounded-xl border border-slate-200">
                  <div className="text-xs">
                    <span className="text-slate-500">Total System: </span>
                    <b className="font-mono text-slate-700">{activeBatches.reduce((a, b) => a + Number(b.system_qty || 0), 0).toFixed(3)}</b>
                  </div>
                  <div className="text-xs">
                    <span className="text-slate-500">Total Physical: </span>
                    <b className="font-mono text-emerald-700">{activeBatches.reduce((a, b) => a + (parseFloat(String(b.counted_qty ?? 0)) || 0), 0).toFixed(3)}</b>
                  </div>
                  <div className="text-xs">
                    <span className="text-slate-500">Net Variance: </span>
                    <b className={`font-mono ${
                      activeBatches.reduce((a, b) => a + (parseFloat(String(b.variance ?? 0)) || 0), 0) > 0
                        ? 'text-blue-600'
                        : activeBatches.reduce((a, b) => a + (parseFloat(String(b.variance ?? 0)) || 0), 0) < 0
                        ? 'text-red-600'
                        : 'text-slate-600'
                    }`}>
                      {activeBatches.reduce((a, b) => a + (parseFloat(String(b.variance ?? 0)) || 0), 0).toFixed(3)}
                    </b>
                  </div>

                  <button
                    type="button"
                    onClick={handleSaveBatchCount}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-xs shadow transition-colors flex items-center gap-1.5 cursor-pointer"
                  >
                    <i className="fas fa-save"></i> 💾 Save Batch Counts
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 items-center">
              {/* Col 1 & 2: Product Info (50%) */}
              <div className="md:col-span-2 space-y-2">
                <div className="text-lg font-black text-slate-800">
                  {activeProduct.name}
                </div>
                <div className="text-xs text-slate-600 font-mono">
                  Item Code: <b className="text-slate-800">{activeProduct.item_code}</b>
                  {activeProduct.barcode && <> &nbsp;·&nbsp; EAN: <b>{activeProduct.barcode}</b></>}
                </div>
                <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
                  <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded font-medium">
                    MRP: ₹{activeProduct.mrp.toFixed(2)}
                  </span>
                  <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded font-medium">
                    SP: ₹{activeProduct.selling_price.toFixed(2)}
                  </span>
                  <span className="bg-blue-100 text-blue-800 px-2.5 py-0.5 rounded font-bold">
                    QOH (Frozen): {activeProduct.system_qty} {activeProduct.unit}
                  </span>
                  <span className="bg-slate-200 text-slate-800 px-2 py-0.5 rounded font-semibold">
                    Already Counted: {activeProduct.counted_qty !== null ? activeProduct.counted_qty : '—'}
                  </span>
                </div>
              </div>

              {/* Col 3: Enter Qty Counted (25%) */}
              <div className="space-y-1.5 text-center">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-600 block">
                  Enter Qty Counted:
                </label>
                <div className="flex items-center justify-center gap-2">
                  <input
                    ref={qtyInputRef}
                    type="number"
                    step="any"
                    min="0"
                    value={enteredQty}
                    onChange={e => setEnteredQty(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        handleSaveCount('add')
                      }
                      if (e.key === 'Escape') {
                        setActiveProduct(null)
                        refocusScan(50)
                      }
                    }}
                    className="w-28 text-center text-2xl font-black p-1 border-2 border-emerald-500 rounded-lg focus:outline-hidden bg-emerald-50 text-emerald-900"
                  />
                  <button
                    onClick={() => handleSaveCount('add')}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-3 py-2 rounded-lg text-xs shadow transition-colors flex items-center gap-1 cursor-pointer"
                  >
                    <i className="fas fa-check"></i> Save
                  </button>
                </div>
                <p className="text-[10px] text-slate-500 italic">
                  Press Enter to save & scan next (adds to count)
                </p>

                {activeProduct.counted_qty !== null && (
                  <div className="flex items-center justify-center gap-2 pt-1">
                    <button
                      onClick={() => handleSaveCount('exact')}
                      className="text-[10px] text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 px-2 py-0.5 rounded font-semibold cursor-pointer"
                      title="Replace the total count with this exact quantity"
                    >
                      = Set as total
                    </button>
                    <button
                      onClick={handleRemoveActiveCount}
                      className="text-[10px] text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 px-2 py-0.5 rounded font-semibold cursor-pointer"
                      title="Remove count and set to uncounted"
                    >
                      🗑 Remove count
                    </button>
                  </div>
                )}
              </div>

              {/* Col 4: Live Variance Indicator (25%) */}
              <div className="text-center p-3 rounded-xl bg-slate-50 border border-slate-200">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                  Variance after save
                </span>
                <span
                  className={`text-2xl font-black block font-mono mt-0.5 ${
                    previewVariance > 0
                      ? 'text-blue-600'
                      : previewVariance < 0
                      ? 'text-red-600'
                      : 'text-slate-400'
                  }`}
                >
                  {previewVariance >= 0 ? `+${previewVariance}` : previewVariance}
                </span>
                <span className="text-[10px] text-slate-400">
                  (Count: {previewTotal} − System: {activeProduct.system_qty})
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── SCAN LOG ── */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="bg-slate-900 text-white px-4 py-2.5 flex justify-between items-center text-xs">
          <div className="font-bold flex items-center gap-2">
            <i className="fas fa-history text-slate-400"></i> Scan Log [{scanLogs.length}]
          </div>
          <div className="text-[11px] text-slate-400">
            Most recent first — all saved to server
          </div>
        </div>

        <div className="max-h-80 overflow-y-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-slate-100 text-slate-700 sticky top-0 font-bold uppercase text-[10.5px]">
              <tr>
                <th className="py-2 px-3">#</th>
                <th className="py-2 px-3">Item Code</th>
                <th className="py-2 px-3">Product Name</th>
                <th className="py-2 px-3 text-right">QOH</th>
                <th className="py-2 px-3 text-right">Scanned Qty</th>
                <th className="py-2 px-3 text-right">Total Counted</th>
                <th className="py-2 px-3 text-right">Variance</th>
                <th className="py-2 px-3 text-center">Time</th>
                <th className="py-2 px-3 text-center">Fix</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {scanLogs.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-10 text-slate-400 italic">
                    Scanned items in this session will appear here in real time.
                  </td>
                </tr>
              ) : (
                scanLogs.map((log, idx) => {
                  const isPositive = (log.variance || 0) > 0
                  const isNegative = (log.variance || 0) < 0

                  return (
                    <tr
                      key={log.id}
                      className="hover:bg-slate-50/70 transition-colors animate-in fade-in slide-in-from-top-1 duration-150"
                    >
                      <td className="py-2 px-3 text-slate-400 font-mono">{idx + 1}</td>
                      <td className="py-2 px-3 font-mono text-slate-600">{log.item_code}</td>
                      <td className="py-2 px-3 font-semibold text-slate-800">
                        <div>{log.product_name}</div>
                        {log.batches_summary && (
                          <div className="text-[10px] text-purple-700 font-mono mt-0.5 flex items-center gap-1 font-normal">
                            <i className="fas fa-boxes text-purple-500"></i> Lots: {log.batches_summary}
                          </div>
                        )}
                      </td>
                      <td className="py-2 px-3 text-right font-mono text-slate-600">{log.qoh}</td>
                      <td className="py-2 px-3 text-right font-bold text-blue-700 font-mono">
                        +{Number(log.scanned_qty).toFixed(2)}
                      </td>
                      <td className="py-2 px-3 text-right font-bold text-slate-900 font-mono">
                        {log.total_counted !== null ? log.total_counted : '—'}
                      </td>
                      <td className="py-2 px-3 text-right font-bold font-mono">
                        {log.variance === null ? (
                          <span className="text-slate-400">removed</span>
                        ) : (
                          <span className={isPositive ? 'text-blue-600' : isNegative ? 'text-red-600' : 'text-slate-400'}>
                            {isPositive ? `+${log.variance}` : log.variance}
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-center text-slate-500 font-mono text-[11px]">
                        {log.time}
                        {log.corrected && (
                          <span className="ml-1 px-1 rounded bg-yellow-100 text-yellow-800 text-[9px] font-bold">
                            corrected
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-center space-x-1.5 whitespace-nowrap">
                        <button
                          onClick={() => handleCorrectLogRow(log)}
                          className="text-blue-600 hover:text-blue-800 px-1 py-0.5 text-xs cursor-pointer"
                          title="Correct total count"
                        >
                          ✏️
                        </button>
                        <button
                          onClick={() => handleRemoveFromLog(log)}
                          className="text-red-500 hover:text-red-700 px-1 py-0.5 text-xs cursor-pointer"
                          title="Remove count"
                        >
                          🗑
                        </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── FINALIZE MODAL ("✔ Scanning Complete") ── */}
      {showFinalizeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden border border-slate-200 animate-in fade-in zoom-in-95 duration-150 text-xs">
            <div className="bg-emerald-700 text-white px-6 py-4 flex justify-between items-center">
              <h2 className="text-base font-bold flex items-center gap-2">
                <i className="fas fa-check-circle"></i> Complete Stock Count
              </h2>
              <button
                onClick={() => setShowFinalizeModal(false)}
                className="text-white/70 hover:text-white text-lg cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="bg-slate-50 border border-slate-200 p-3 rounded-xl space-y-1">
                <div className="font-bold text-slate-800">
                  Session Summary:
                </div>
                <div className="text-slate-600 flex justify-between">
                  <span>Items scanned:</span>
                  <b className="text-emerald-700 font-mono">{session.counted_items}</b>
                </div>
                <div className="text-slate-600 flex justify-between">
                  <span>Items not yet counted:</span>
                  <b className="text-amber-700 font-mono">{session.not_yet_scanned}</b>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-800 mb-2">
                  What should happen to items you did NOT scan?
                </label>
                <div className="space-y-2">
                  <label className="flex items-start gap-2.5 p-3 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer">
                    <input
                      type="radio"
                      name="unscanned"
                      checked={unscannedOption === 'leave'}
                      onChange={() => setUnscannedOption('leave')}
                      className="mt-0.5 text-blue-600"
                    />
                    <div>
                      <div className="font-bold text-slate-800">Leave un-scanned items as not counted (Default)</div>
                      <div className="text-[11px] text-slate-500">Only adjusts stock for items you actually scanned. Uncounted items remain unchanged.</div>
                    </div>
                  </label>

                  <label className="flex items-start gap-2.5 p-3 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer">
                    <input
                      type="radio"
                      name="unscanned"
                      checked={unscannedOption === 'zero'}
                      onChange={() => setUnscannedOption('zero')}
                      className="mt-0.5 text-blue-600"
                    />
                    <div>
                      <div className="font-bold text-slate-800">Set all un-scanned items to ZERO</div>
                      <div className="text-[11px] text-slate-500">Treats missing items as out-of-stock and zeroes their counted quantity.</div>
                    </div>
                  </label>
                </div>
              </div>

              <div className="pt-2 border-t border-slate-100">
                <label className="flex items-center gap-2 cursor-pointer font-bold text-slate-800">
                  <input
                    type="checkbox"
                    checked={adjustStock}
                    onChange={e => setAdjustStock(e.target.checked)}
                    className="w-4 h-4 text-emerald-600 rounded"
                  />
                  Apply stock adjustment (update actual inventory to counted quantities)
                </label>
                <p className="text-[11px] text-slate-500 ml-6 mt-0.5">
                  If checked, inventory balances in the outlet will be updated to match physical counts.
                </p>
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowFinalizeModal(false)}
                  className="px-4 py-2 border border-slate-300 rounded-xl text-slate-600 font-semibold hover:bg-slate-50"
                >
                  Continue Scanning
                </button>
                <button
                  type="button"
                  onClick={handleFinalize}
                  disabled={finalizing}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold shadow flex items-center gap-1.5"
                >
                  {finalizing ? (
                    <>
                      <i className="fas fa-spinner fa-spin"></i> Finalizing…
                    </>
                  ) : (
                    <>
                      <i className="fas fa-check"></i> ✔ Finalize Stock Take
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── IMPORT EXCEL / CSV MODAL ── */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden border border-slate-200 animate-in fade-in zoom-in-95 duration-150 text-xs">
            <div className="bg-blue-900 text-white px-6 py-4 flex justify-between items-center">
              <h2 className="text-base font-bold flex items-center gap-2">
                <i className="fas fa-file-excel"></i> Import Stock Counts
              </h2>
              <button
                onClick={() => setShowImportModal(false)}
                className="text-white/70 hover:text-white text-lg cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleImportSubmit} className="p-6 space-y-4">
              <div className="bg-blue-50 border border-blue-200 text-blue-900 p-3.5 rounded-xl leading-relaxed space-y-2">
                <div className="font-bold flex items-center justify-between">
                  <span>Excel / CSV Paste Format:</span>
                  <button
                    type="button"
                    onClick={() => setImportCsvText("1807, 10, LOT-1111, 2026-11-30\n1807, 12, LOT-2222, 2027-01-15\n4801, 24\n1806, 5")}
                    className="text-[10px] text-blue-700 hover:text-blue-900 font-semibold underline cursor-pointer"
                  >
                    Paste Batch Sample
                  </button>
                </div>
                <div className="space-y-1 font-mono text-[11px] bg-white/70 p-2 rounded-lg border border-blue-100">
                  <div><span className="font-bold text-slate-700">Format 1 (Simple):</span> <code className="bg-white px-1.5 py-0.5 rounded border border-blue-300">item_code, qty</code></div>
                  <div><span className="font-bold text-blue-800">Format 2 (With Batch):</span> <code className="bg-white px-1.5 py-0.5 rounded border border-blue-300">item_code, qty, batch_no, expiry_date</code></div>
                </div>
                <p className="text-[11px] text-slate-600">
                  <i className="fas fa-info-circle text-blue-600 mr-1"></i>
                  <b>Excel Tip:</b> In Excel, use columns: <code>Item Code | Qty | Batch No | Expiry (YYYY-MM-DD)</code>. Select the cells, press <b>Ctrl+C</b>, and paste directly below. Multiple batches for the same item are automatically summed and grouped!
                </p>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1 flex justify-between items-center">
                  <span>Paste rows (one per line):</span>
                  <span className="text-[10px] text-slate-400 font-normal">Tab or comma separated</span>
                </label>
                <textarea
                  value={importCsvText}
                  onChange={e => setImportCsvText(e.target.value)}
                  placeholder={`1807, 10, LOT-1111, 2026-11-30\n1807, 12, LOT-2222, 2027-01-15\n4801, 24\n1806, 5`}
                  rows={6}
                  className="w-full font-mono text-xs border border-slate-300 rounded-lg p-2.5 focus:border-blue-500 focus:outline-hidden"
                />
              </div>

              {importResult && (
                <div className="bg-slate-50 border border-slate-200 p-3 rounded-xl space-y-1">
                  <div className="font-bold text-emerald-700">
                    Applied: {importResult.applied_count} item(s)
                  </div>
                  {importResult.not_found_codes?.length > 0 && (
                    <div className="text-red-600">
                      Not found ({importResult.not_found_codes.length}): {importResult.not_found_codes.slice(0, 5).join(', ')}...
                    </div>
                  )}
                  {importResult.duplicate_codes?.length > 0 && (
                    <div className="text-amber-600">
                      Duplicate codes (last one wins): {importResult.duplicate_codes.slice(0, 5).join(', ')}...
                    </div>
                  )}
                </div>
              )}

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowImportModal(false)}
                  className="px-4 py-2 border border-slate-300 rounded-xl text-slate-600 font-semibold hover:bg-slate-50"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={importing || !importCsvText.trim()}
                  className="px-5 py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-xl font-bold shadow flex items-center gap-1.5"
                >
                  {importing ? (
                    <>
                      <i className="fas fa-spinner fa-spin"></i> Processing…
                    </>
                  ) : (
                    <>
                      <i className="fas fa-upload"></i> Process Import
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── ADD NEW PRODUCT TO STOCK TAKE MODAL ── */}
      {showAddProductModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-xl w-full overflow-hidden border border-slate-200 animate-in fade-in zoom-in-95 duration-150 text-xs">
            <div className="bg-gradient-to-r from-blue-900 to-indigo-900 text-white px-6 py-4 flex justify-between items-center">
              <div>
                <h2 className="text-base font-bold flex items-center gap-2">
                  <i className="fas fa-box-open text-blue-300"></i> Add New Product to Stock Take
                </h2>
                <p className="text-[11px] text-blue-200 mt-0.5">
                  Item was not found in catalog. Create it now to count immediately.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowAddProductModal(false)
                  refocusScan(100)
                }}
                className="text-white/70 hover:text-white text-lg cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateProductAndCount} className="p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="md:col-span-2">
                  <label className="block font-bold text-slate-700 mb-1">
                    Product Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={newProdName}
                    onChange={e => setNewProdName(e.target.value)}
                    placeholder="e.g. Amul Butter 500g"
                    className="w-full font-medium text-xs border border-slate-300 rounded-lg px-3 py-2 focus:border-blue-500 focus:outline-hidden"
                    autoFocus
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Barcode / EAN
                  </label>
                  <input
                    type="text"
                    value={newProdBarcode}
                    onChange={e => setNewProdBarcode(e.target.value)}
                    placeholder="e.g. 8901030383321"
                    className="w-full font-mono text-xs border border-slate-300 rounded-lg px-3 py-2 focus:border-blue-500 focus:outline-hidden"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Item Code
                  </label>
                  <input
                    type="text"
                    value={newProdItemCode}
                    onChange={e => setNewProdItemCode(e.target.value)}
                    placeholder="Leave blank for auto-code"
                    className="w-full font-mono text-xs border border-slate-300 rounded-lg px-3 py-2 focus:border-blue-500 focus:outline-hidden"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Category
                  </label>
                  <select
                    value={newProdCategoryId || ''}
                    onChange={e => setNewProdCategoryId(e.target.value ? Number(e.target.value) : '')}
                    className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 focus:border-blue-500 focus:outline-hidden"
                  >
                    <option value="">-- Select Category --</option>
                    {categories.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Brand
                  </label>
                  <select
                    value={newProdBrandId || ''}
                    onChange={e => setNewProdBrandId(e.target.value ? Number(e.target.value) : '')}
                    className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 focus:border-blue-500 focus:outline-hidden"
                  >
                    <option value="">-- Select Brand --</option>
                    {brands.map(b => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Unit
                  </label>
                  <select
                    value={newProdUnit}
                    onChange={e => setNewProdUnit(e.target.value)}
                    className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 focus:border-blue-500 focus:outline-hidden"
                  >
                    {units.length > 0 ? (
                      units.map(u => (
                        <option key={u.id} value={(u as any).unit_code || u.unit_name}>{(u as any).unit_name || (u as any).unit_code} ({(u as any).unit_code || u.unit_name})</option>
                      ))
                    ) : (
                      <>
                        <option value="PCS">PCS</option>
                        <option value="KG">KG</option>
                        <option value="GM">GM</option>
                        <option value="LTR">LTR</option>
                        <option value="BOX">BOX</option>
                        <option value="PACK">PACK</option>
                      </>
                    )}
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    GST %
                  </label>
                  <select
                    value={newProdGst}
                    onChange={e => setNewProdGst(Number(e.target.value))}
                    className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 focus:border-blue-500 focus:outline-hidden"
                  >
                    <option value={0}>0%</option>
                    <option value={5}>5%</option>
                    <option value={12}>12%</option>
                    <option value={18}>18%</option>
                    <option value={28}>28%</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    MRP (₹)
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={newProdMrp || ''}
                    onChange={e => setNewProdMrp(e.target.value)}
                    placeholder="0.00"
                    className="w-full font-mono text-xs border border-slate-300 rounded-lg px-3 py-2 focus:border-blue-500 focus:outline-hidden"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Selling Price (₹)
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={newProdSp || ''}
                    onChange={e => setNewProdSp(e.target.value)}
                    placeholder="0.00"
                    className="w-full font-mono text-xs border border-slate-300 rounded-lg px-3 py-2 focus:border-blue-500 focus:outline-hidden"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Cost Price (₹)
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={newProdCost || ''}
                    onChange={e => setNewProdCost(e.target.value)}
                    placeholder="0.00"
                    className="w-full font-mono text-xs border border-slate-300 rounded-lg px-3 py-2 focus:border-blue-500 focus:outline-hidden"
                  />
                </div>

                <div>
                  <label className="block font-bold text-emerald-800 mb-1 flex items-center gap-1">
                    <i className="fas fa-check-circle text-emerald-600"></i> Count Qty in Stock Take
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="0.001"
                    required
                    value={newProdCountQty}
                    onChange={e => setNewProdCountQty(e.target.value)}
                    placeholder="1"
                    className="w-full font-bold font-mono text-xs border-2 border-emerald-500 bg-emerald-50/50 rounded-lg px-3 py-2 text-emerald-900 focus:border-emerald-600 focus:outline-hidden"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddProductModal(false)
                    refocusScan(100)
                  }}
                  className="px-4 py-2 border border-slate-300 rounded-xl text-slate-600 font-semibold hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingProduct || !newProdName.trim()}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold shadow flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {creatingProduct ? (
                    <>
                      <i className="fas fa-spinner fa-spin"></i> Saving & Counting…
                    </>
                  ) : (
                    <>
                      <i className="fas fa-plus"></i> Create & Count (+{newProdCountQty || 1})
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

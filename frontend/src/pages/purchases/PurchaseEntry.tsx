import React, { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { purchases_api, type purchase_detail, type po_list_item } from '../../api/purchases'
import { products_api, type product_search_item } from '../../api/products'
import { masters_api } from '../../api/masters'
import { suppliers_api } from '../../api/suppliers'
import { getCompanySettings, type CompanySettings } from '../../api/company'

/* ─── Interfaces ──────────────────────────────────────────────────────────── */
export interface SubBatch {
  batch_no: string
  qty: number
  free_qty: number
  mfg_date?: string
  expiry_date?: string
}

interface PurchaseRow {
  product_id: number
  product_name: string
  item_code: string
  barcode: string
  basic_cost: number       // Unit purchase rate excl. GST
  disc_val: number         // Discount value
  disc_type: '%' | '₹'     // Discount type
  hsn_code: string
  tax_percent: number      // GST %
  mrp: number
  selling_price: number    // SP
  old_qoh: number          // Current stock
  lp_date: string          // Last purchase date
  lp_qty: number           // Last purchase qty
  sales_lp: number         // Sales since last purchase
  qty: number
  free_qty: number
  batch_no?: string
  mfg_date?: string
  expiry_date?: string
  shelf_life_days?: number | null
  has_batch_tracking?: boolean
  has_expiry_tracking?: boolean
  batches?: SubBatch[]
  po_item_id?: number      // GRN against PO: linked PO line
  po_pending?: number      // PO qty still to receive
}

const COMMON_TAX_RATES = [0, 3, 5, 12, 18, 28, 40]
const DRAFT_STORAGE_KEY = 'mb_purchase_entry_draft_v1'

const fmt = (v: number | string | null | undefined) =>
  `₹${Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const fmt_date = (d: string | null | undefined) => {
  if (!d) return '—'
  try {
    const dt = new Date(d)
    return isNaN(dt.getTime()) ? d : dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch {
    return d
  }
}

export default function PurchaseEntry() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  // Company Settings for GRN Slip
  const [company, setCompany] = useState<CompanySettings | null>(null)
  const [savedGrn, setSavedGrn] = useState<purchase_detail | any | null>(null)

  // Header State
  const [suppliers, setSuppliers] = useState<any[]>([])
  const [selectedSupplierId, setSelectedSupplierId] = useState<number | ''>('')
  const [supplierGstin, setSupplierGstin] = useState('')
  const [supplierAddress, setSupplierAddress] = useState('')

  const [outlets, setOutlets] = useState<any[]>([])
  const [selectedOutletId, setSelectedOutletId] = useState<number | ''>('')

  const [paymentMode, setPaymentMode] = useState<string>('credit')
  const [invoiceNo, setInvoiceNo] = useState('')
  const [invoiceError, setInvoiceError] = useState<string | null>(null)
  const [checkingInvoice, setCheckingInvoice] = useState(false)
  const invoiceInputRef = useRef<HTMLInputElement>(null)
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split('T')[0])
  const [draftStatus, setDraftStatus] = useState<string | null>(null)

  // Scanner & Search State
  const [scanQuery, setScanQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchResults, setSearchResults] = useState<product_search_item[]>([])
  const [dropdownVisible, setDropdownVisible] = useState(false)
  const [activeHighlightIndex, setActiveHighlightIndex] = useState(-1)
  const [currentSearchQuery, setCurrentSearchQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Grid Items State
  const [rows, setRows] = useState<PurchaseRow[]>([])
  const [poId, setPoId] = useState<number | ''>('')
  const [openPos, setOpenPos] = useState<po_list_item[]>([])
  const [hsnList, setHsnList] = useState<{ hsn_code: string; gst_percent: number }[]>([])

  // Totals State
  const [additionalDiscount, setAdditionalDiscount] = useState<number>(0)
  const [roundOff, setRoundOff] = useState<number>(0)
  const [isManualRoundOff, setIsManualRoundOff] = useState(false)
  const [amountPaid, setAmountPaid] = useState<number>(0)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  // Ref to track last added row to focus Qty cell
  const lastAddedIndexRef = useRef<number | null>(null)
  const qtyInputRefs = useRef<{ [key: number]: HTMLInputElement | null }>({})
  const batchInputRefs = useRef<{ [key: number]: HTMLInputElement | null }>({})

  // Batch Allocation Modal State (for items arriving with multiple batches)
  const [batchModalRowIndex, setBatchModalRowIndex] = useState<number | null>(null)
  const [modalBatches, setModalBatches] = useState<SubBatch[]>([])

  /* ── 1. Load Initial Masters ────────────────────────────────────────────── */
  useEffect(() => {
    // Load suppliers
    suppliers_api.list({ per_page: 500 })
      .then(r => setSuppliers(r.data.data || []))
      .catch(() => {})

    // Load company settings for GRN print slip
    getCompanySettings()
      .then(r => setCompany(r))
      .catch(() => {})

    // Load outlets
    masters_api.get_outlets()
      .then(r => {
        const list = r.data || []
        setOutlets(list)
        if (list.length > 0 && !selectedOutletId) {
          setSelectedOutletId(list[0].id)
        }
      })
      .catch(() => {})

    // Load HSN master
    masters_api.get_hsn({ per_page: 500 })
      .then(r => {
        const raw = r.data.data || []
        setHsnList(raw.map((h: any) => ({
          hsn_code: h.hsn_code,
          gst_percent: Number(h.gst_percent || 0),
        })))
      })
      .catch(() => {})

    // Check query params for PO load
    const poId = searchParams.get('po_id')
    if (poId) {
      loadFromPO(Number(poId))
    } else {
      // Check for saved local draft
      checkSavedDraft()
    }

    // Autofocus scan input
    setTimeout(() => {
      searchInputRef.current?.focus()
    }, 150)
  }, [])

  /* ── 2. Supplier Details Auto-fill ──────────────────────────────────────── */
  const handleSupplierChange = (supId: number | '') => {
    setSelectedSupplierId(supId)
    unlinkPO()
    if (!supId) {
      setSupplierGstin('')
      setSupplierAddress('')
      return
    }
    const sup = suppliers.find(s => s.id === Number(supId))
    if (sup) {
      setSupplierGstin(sup.gst_number || sup.gstin || '')
      const addrParts = [sup.address, sup.city, sup.state].filter(Boolean)
      setSupplierAddress(addrParts.join(', '))
    }
  }

  /* ── 3. Draft Auto-save ─────────────────────────────────────────────────── */
  const checkSavedDraft = () => {
    try {
      const saved = localStorage.getItem(DRAFT_STORAGE_KEY)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (parsed && parsed.rows && parsed.rows.length > 0) {
          if (window.confirm(`A saved draft from ${parsed.timestamp || 'recently'} with ${parsed.rows.length} item(s) was found. Would you like to resume it?`)) {
            setSelectedSupplierId(parsed.selectedSupplierId || '')
            setSupplierGstin(parsed.supplierGstin || '')
            setSupplierAddress(parsed.supplierAddress || '')
            setSelectedOutletId(parsed.selectedOutletId || '')
            setPaymentMode(parsed.paymentMode || 'Credit')
            setInvoiceNo(parsed.invoiceNo || '')
            setInvoiceDate(parsed.invoiceDate || new Date().toISOString().split('T')[0])
            setRows(parsed.rows || [])
            setAdditionalDiscount(Number(parsed.additionalDiscount || 0))
            setAmountPaid(Number(parsed.amountPaid || 0))
            setNotes(parsed.notes || '')
            setPoId(parsed.poId || '')
            setDraftStatus(`Draft resumed (${parsed.timeStr || 'recently'})`)
            return
          }
        }
      }
    } catch (e) {
      console.warn('Draft load failed', e)
    }
  }

  // Periodic Auto-save
  useEffect(() => {
    if (rows.length === 0 && !selectedSupplierId && !invoiceNo) return
    const timer = setTimeout(() => {
      const now = new Date()
      const draftObj = {
        selectedSupplierId,
        supplierGstin,
        supplierAddress,
        selectedOutletId,
        paymentMode,
        invoiceNo,
        invoiceDate,
        rows,
        additionalDiscount,
        amountPaid,
        notes,
        poId,
        timestamp: now.toLocaleDateString(),
        timeStr: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }
      try {
        localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draftObj))
        setDraftStatus(`Draft saved ${draftObj.timeStr}`)
      } catch (e) {
        // storage full
      }
    }, 2500)
    return () => clearTimeout(timer)
  }, [selectedSupplierId, selectedOutletId, paymentMode, invoiceNo, invoiceDate, rows, additionalDiscount, amountPaid, notes, poId])

  /* ── 4. Load from Approved PO ───────────────────────────────────────────── */
  const loadFromPO = async (poId: number) => {
    try {
      toast.loading('Loading approved PO items…', { id: 'po-load' })
      const res = await purchases_api.get_po(poId)
      const po = res.data
      toast.dismiss('po-load')

      if (po.supplier_id) handleSupplierChange(po.supplier_id)
      if (po.outlet_id) setSelectedOutletId(po.outlet_id)
      if (po.vendor_invoice_no) setInvoiceNo(po.vendor_invoice_no)
      if (po.vendor_invoice_date) setInvoiceDate(po.vendor_invoice_date)
      setNotes(`Purchase against PO #${po.po_no}`)
      setPoId(po.id)

      const pendingOf = (it: any) => Math.max(0, Number(it.order_qty || it.qty || 0) - Number(it.received_qty || 0))
      const mappedRows: PurchaseRow[] = (po.items || []).filter(it => pendingOf(it) > 0).map(it => {
        const pendingQty = pendingOf(it)
        return {
          product_id: it.product_id,
          product_name: it.product_name,
          item_code: it.item_code || '',
          barcode: '',
          basic_cost: Number(it.rate || 0),
          disc_val: 0,
          disc_type: '₹',
          tax_percent: Number(it.gst_percent || 0),
          mrp: Number(it.mrp || 0),
          selling_price: Number(it.rate || 0) * 1.15,
          old_qoh: Number(it.outlet_stock || 0),
          lp_date: '-',
          lp_qty: 0,
          sales_lp: 0,
          qty: pendingQty,
          free_qty: 0,
          hsn_code: it.hsn_code || '',
          po_item_id: it.id,
          po_pending: pendingQty,
          batch_no: '',
          mfg_date: '',
          expiry_date: '',
          shelf_life_days: (it as any).shelf_life_days,
          has_batch_tracking: !!(it as any).has_batch_tracking,
          has_expiry_tracking: !!(it as any).has_expiry_tracking,
        }
      })
      setRows(mappedRows)
      toast.success(`Loaded ${mappedRows.length} item(s) from PO #${po.po_no}`)
    } catch (err: any) {
      toast.error('Failed to load PO details')
    }
  }

  // Open (approved / part-received) POs of the selected supplier
  useEffect(() => {
    setOpenPos([])
    if (!selectedSupplierId) return
    purchases_api.list_pos({ supplier_id: Number(selectedSupplierId), per_page: 100 })
      .then(r => setOpenPos((r.data.data || []).filter(p => p.status === 'approved' || p.status === 'partial')))
      .catch(() => {})
  }, [selectedSupplierId])

  const unlinkPO = () => {
    setPoId('')
    setRows(prev => prev.map(({ po_item_id, po_pending, ...r }) => r))
  }

  /* ── 5. Product Search & Scanner Logic ──────────────────────────────────── */
  useEffect(() => {
    const q = scanQuery.trim()
    if (q.length < 2) {
      setSearchResults([])
      setDropdownVisible(false)
      setActiveHighlightIndex(-1)
      setCurrentSearchQuery('')
      return
    }

    const t = setTimeout(() => {
      setSearching(true)
      products_api.search(q, 12, selectedOutletId ? Number(selectedOutletId) : undefined)
        .then(r => {
          const list = r.data || []
          setSearchResults(list)
          setCurrentSearchQuery(q)
          setDropdownVisible(list.length > 0)
          setActiveHighlightIndex(-1)
        })
        .catch(() => {
          setSearchResults([])
          setDropdownVisible(false)
        })
        .finally(() => setSearching(false))
    }, 220)

    return () => clearTimeout(t)
  }, [scanQuery, selectedOutletId])

  // Add a product item row to grid
  const addProductRow = async (p: product_search_item) => {
    const isBatchTracked = Boolean(p.has_batch_tracking || p.is_batch_required)
    const isExpiryTracked = Boolean(p.has_expiry_tracking)

    // Duplicate product check: if non-batch product, increment qty
    const existingIndex = rows.findIndex(r => r.product_id === p.id && (!r.batch_no || !isBatchTracked))
    if (existingIndex >= 0 && !isBatchTracked) {
      toast('Product already in list — updated row', { icon: 'ℹ️' })
      const updated = [...rows]
      updated[existingIndex].qty += 1
      setRows(updated)
      setScanQuery('')
      setSearchResults([])
      setDropdownVisible(false)
      setTimeout(() => {
        qtyInputRefs.current[existingIndex]?.focus()
        qtyInputRefs.current[existingIndex]?.select()
      }, 50)
      return
    }

    // Default basic cost = purchase_price or mrp * 0.8
    const basicCost = Number(p.purchase_price || 0) > 0
      ? Number(p.purchase_price)
      : (Number(p.basic_cost || 0) > 0 ? Number(p.basic_cost) : (Number(p.mrp || 0) * 0.8 || 100))

    const newRow: PurchaseRow = {
      product_id: p.id,
      product_name: p.name,
      item_code: p.item_code || '',
      barcode: p.barcode || p.barcode_crt || '',
      basic_cost: Math.round(basicCost * 100) / 100,
      disc_val: 0,
      disc_type: '₹',
      hsn_code: p.hsn_code || '',
      tax_percent: Number(p.gst_percent || 0),
      mrp: Number(p.mrp || 0),
      selling_price: Number(p.selling_price || 0) || Number(p.mrp || 0),
      old_qoh: Number(p.stock_qty || 0),
      lp_date: '-',
      lp_qty: 0,
      sales_lp: 0,
      qty: 1,
      free_qty: 0,
      batch_no: '',
      mfg_date: '',
      expiry_date: '',
      shelf_life_days: p.shelf_life_days,
      has_batch_tracking: isBatchTracked,
      has_expiry_tracking: isExpiryTracked,
    }

    const nextIndex = rows.length
    lastAddedIndexRef.current = nextIndex
    setRows(prev => [...prev, newRow])
    setScanQuery('')
    setSearchResults([])
    setDropdownVisible(false)
    setCurrentSearchQuery('')

    // Fetch product purchase history asynchronously
    purchases_api.get_product_history(p.id)
      .then(histRes => {
        const d = histRes.data
        setRows(curRows => curRows.map((r, idx) =>
          idx === nextIndex
            ? { ...r, lp_date: d.last_purchase_date || '-', lp_qty: d.last_purchase_qty || 0, sales_lp: d.sales_since_lp || 0 }
            : r
        ))
      })
      .catch(() => {})

    // Automatically focus the Qty input of newly added row
    setTimeout(() => {
      qtyInputRefs.current[nextIndex]?.focus()
      qtyInputRefs.current[nextIndex]?.select()
    }, 60)
  }

  // Scanner-safe Enter handling on scan input
  const handleScanKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (searchResults.length > 0) {
        setActiveHighlightIndex(prev => (prev + 1) % searchResults.length)
      }
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (searchResults.length > 0) {
        setActiveHighlightIndex(prev => (prev - 1 + searchResults.length) % searchResults.length)
      }
      return
    }
    if (e.key === 'Escape') {
      setDropdownVisible(false)
      setActiveHighlightIndex(-1)
      return
    }

    if (e.key === 'Enter') {
      e.preventDefault()
      const query = scanQuery.trim()
      if (!query) return

      const isFresh = dropdownVisible && currentSearchQuery === query

      // 1. If fresh results and an item is highlighted
      if (isFresh && activeHighlightIndex >= 0 && searchResults[activeHighlightIndex]) {
        addProductRow(searchResults[activeHighlightIndex])
        return
      }

      // 2. If fresh results and exactly 1 result
      if (isFresh && searchResults.length === 1) {
        addProductRow(searchResults[0])
        return
      }

      // 3. Otherwise scanner sent text + Enter before debounce: immediate search with autoPick
      try {
        setSearching(true)
        const res = await products_api.search(query, 12, selectedOutletId ? Number(selectedOutletId) : undefined)
        const items = res.data || []
        if (items.length === 1) {
          addProductRow(items[0])
        } else if (items.length > 1) {
          // Check for exact barcode / item_code match
          const exact = items.find(
            it => it.barcode?.toLowerCase() === query.toLowerCase() || it.item_code?.toLowerCase() === query.toLowerCase()
          )
          if (exact) {
            addProductRow(exact)
          } else {
            setSearchResults(items)
            setCurrentSearchQuery(query)
            setDropdownVisible(true)
            setActiveHighlightIndex(0)
          }
        } else {
          toast.error(`Product not found for: "${query}"`)
        }
      } catch (err) {
        toast.error('Search failed')
      } finally {
        setSearching(false)
      }
    }
  }

  /* ── 6. Row Calculations & Mathematics ──────────────────────────────────── */
  const calculatedRows = useMemo(() => {
    return rows.map(r => {
      const rate = Number(r.basic_cost || 0)
      const disc = Number(r.disc_val || 0)
      const gstPct = Number(r.tax_percent || 0)
      const qty = Number(r.qty || 0)
      const mrp = Number(r.mrp || 0)
      const sp = Number(r.selling_price || 0)

      const unitDisc = r.disc_type === '%' ? rate * Math.min(disc, 100) / 100 : Math.min(disc, rate)
      const cpBase = rate - unitDisc                  // Unit taxable
      const unitGst = cpBase * (gstPct / 100)
      const cp = cpBase + unitGst                     // Landed Cost Price

      const basicTotal = qty * rate
      const lineDisc = qty * unitDisc
      const costValue = qty * cpBase                  // Line taxable
      const taxTotal = qty * unitGst
      const mrpVal = qty * mrp
      const total = costValue + taxTotal

      const mgnCP = cp > 0 ? ((sp - cp) / cp) * 100 : 0
      const mgnMRP = mrp > 0 ? ((mrp - cp) / mrp) * 100 : 0
      const mgnSP = sp > 0 ? ((sp - cp) / sp) * 100 : 0

      return {
        ...r,
        unitDisc,
        cpBase,
        unitGst,
        cp,
        basicTotal,
        lineDisc,
        costValue,
        taxTotal,
        mrpVal,
        total,
        mgnCP,
        mgnMRP,
        mgnSP,
      }
    })
  }, [rows])

  /* ── 7. Totals Calculations ─────────────────────────────────────────────── */
  const sumBasic = useMemo(() => calculatedRows.reduce((s, r) => s + r.basicTotal, 0), [calculatedRows])
  const sumItemDisc = useMemo(() => calculatedRows.reduce((s, r) => s + r.lineDisc, 0), [calculatedRows])
  const sumTaxable = useMemo(() => calculatedRows.reduce((s, r) => s + r.costValue, 0), [calculatedRows])
  const sumGst = useMemo(() => calculatedRows.reduce((s, r) => s + r.taxTotal, 0), [calculatedRows])
  const sumTotalQty = useMemo(() => rows.reduce((s, r) => s + Number(r.qty || 0) + Number(r.free_qty || 0), 0), [rows])

  const netBeforeRound = (sumTaxable + sumGst) - Number(additionalDiscount || 0)

  // Auto round off calculation
  const autoRoundOffVal = Math.round(netBeforeRound) - netBeforeRound
  const effectiveRoundOff = isManualRoundOff ? Number(roundOff || 0) : autoRoundOffVal

  const grandTotal = Math.max(0, netBeforeRound + effectiveRoundOff)
  const amountDue = grandTotal - Number(amountPaid || 0)

  // Row update helper
  const updateRowField = <K extends keyof PurchaseRow>(index: number, field: K, value: PurchaseRow[K]) => {
    setRows(prev => {
      const copy = [...prev]
      copy[index] = { ...copy[index], [field]: value }

      // If HSN changed, update tax percent automatically
      if (field === 'hsn_code') {
        const foundHsn = hsnList.find(h => h.hsn_code === value)
        if (foundHsn) {
          copy[index].tax_percent = foundHsn.gst_percent
        }
      }

      // If mfg_date changed and product has shelf_life_days, auto-calc expiry_date
      if (field === 'mfg_date' && value) {
        const shelfDays = copy[index].shelf_life_days
        if (shelfDays && shelfDays > 0) {
          try {
            const mfg = new Date(value as string)
            if (!isNaN(mfg.getTime())) {
              mfg.setDate(mfg.getDate() + shelfDays)
              copy[index].expiry_date = mfg.toISOString().split('T')[0]
            }
          } catch {}
        }
      }

      // If updating quantity, batch or expiry directly for single-batch item, keep batches array in sync
      if (field === 'qty' || field === 'free_qty' || field === 'batch_no' || field === 'mfg_date' || field === 'expiry_date') {
        const curBatches = copy[index].batches
        if (!curBatches || curBatches.length <= 1) {
          copy[index].batches = [{
            batch_no: field === 'batch_no' ? (value as string) : (copy[index].batch_no || ''),
            qty: field === 'qty' ? Number(value || 0) : Number(copy[index].qty || 0),
            free_qty: field === 'free_qty' ? Number(value || 0) : Number(copy[index].free_qty || 0),
            mfg_date: field === 'mfg_date' ? (value as string) : (copy[index].mfg_date || ''),
            expiry_date: field === 'expiry_date' ? (value as string) : (copy[index].expiry_date || ''),
          }]
        }
      }

      return copy
    })
  }

  /* ── 7B. Batch Allocation Modal Handlers ────────────────────────────────── */
  const openBatchModal = (index: number) => {
    const r = rows[index]
    if (!r) return
    if (r.batches && r.batches.length > 0) {
      setModalBatches(r.batches.map(b => ({ ...b })))
    } else {
      setModalBatches([
        {
          batch_no: r.batch_no || '',
          qty: Number(r.qty || 1),
          free_qty: Number(r.free_qty || 0),
          mfg_date: r.mfg_date || '',
          expiry_date: r.expiry_date || '',
        }
      ])
    }
    setBatchModalRowIndex(index)
  }

  const closeBatchModal = () => {
    setBatchModalRowIndex(null)
    setModalBatches([])
  }

  const handleModalBatchChange = (bIdx: number, field: keyof SubBatch, value: any) => {
    setModalBatches(prev => {
      const copy = [...prev]
      copy[bIdx] = { ...copy[bIdx], [field]: value }
      return copy
    })
  }

  const handleModalMfgChange = (bIdx: number, value: string) => {
    if (batchModalRowIndex === null) return
    const row = rows[batchModalRowIndex]
    setModalBatches(prev => {
      const copy = [...prev]
      copy[bIdx] = { ...copy[bIdx], mfg_date: value }
      const shelfDays = row?.shelf_life_days
      if (shelfDays && shelfDays > 0 && value) {
        try {
          const d = new Date(value)
          if (!isNaN(d.getTime())) {
            d.setDate(d.getDate() + shelfDays)
            copy[bIdx].expiry_date = d.toISOString().split('T')[0]
          }
        } catch {}
      }
      return copy
    })
  }

  const addModalBatchRow = () => {
    setModalBatches(prev => [
      ...prev,
      {
        batch_no: '',
        qty: 1,
        free_qty: 0,
        mfg_date: '',
        expiry_date: '',
      }
    ])
  }

  const removeModalBatchRow = (bIdx: number) => {
    if (modalBatches.length <= 1) {
      toast.error('At least one batch row is required.')
      return
    }
    setModalBatches(prev => prev.filter((_, i) => i !== bIdx))
  }

  const applyModalBatches = () => {
    if (batchModalRowIndex === null) return
    const row = rows[batchModalRowIndex]
    if (!row) return

    const todayStr = new Date().toISOString().split('T')[0]
    for (let i = 0; i < modalBatches.length; i++) {
      const b = modalBatches[i]
      if (row.has_batch_tracking && !b.batch_no?.trim()) {
        toast.error(`Batch Number is required for Lot #${i + 1}`)
        return
      }
      if (modalBatches.length > 1 && !b.batch_no?.trim()) {
        toast.error(`Please enter Batch Number for Lot #${i + 1}`)
        return
      }
      if (b.mfg_date && b.expiry_date && b.expiry_date <= b.mfg_date) {
        toast.error(`Lot #${i + 1} (${b.batch_no || 'Batch'}): Expiry date must be after manufacturing date`)
        return
      }
      if (b.expiry_date && b.expiry_date < todayStr) {
        toast.error(`Lot #${i + 1} (${b.batch_no || 'Batch'}): Stock is already expired (${b.expiry_date})`)
        return
      }
      if (Number(b.qty || 0) <= 0 && Number(b.free_qty || 0) <= 0) {
        toast.error(`Lot #${i + 1} (${b.batch_no || 'Batch'}): Quantity must be greater than 0`)
        return
      }
    }

    const totalPur = modalBatches.reduce((s, b) => s + Number(b.qty || 0), 0)
    const totalFree = modalBatches.reduce((s, b) => s + Number(b.free_qty || 0), 0)

    setRows(prev => {
      const copy = [...prev]
      copy[batchModalRowIndex] = {
        ...copy[batchModalRowIndex],
        batches: modalBatches,
        qty: totalPur,
        free_qty: totalFree,
        batch_no: modalBatches[0].batch_no,
        mfg_date: modalBatches[0].mfg_date,
        expiry_date: modalBatches[0].expiry_date,
      }
      return copy
    })

    toast.success(`Allocated ${modalBatches.length} batch(es) for "${row.product_name}". Total Qty: ${totalPur}`)
    closeBatchModal()
  }

  const removeRow = (index: number) => {
    setRows(prev => prev.filter((_, i) => i !== index))
  }

  /* ── 8. Reset & Start New Inward Entry ──────────────────────────────────── */
  const resetAndStartNew = () => {
    setSavedGrn(null)
    setRows([])
    setInvoiceNo('')
    setSelectedSupplierId('')
    setPoId('')
    setSupplierGstin('')
    setSupplierAddress('')
    setAdditionalDiscount(0)
    setRoundOff(0)
    setIsManualRoundOff(false)
    setAmountPaid(0)
    setNotes('')
    setDraftStatus(null)
    localStorage.removeItem(DRAFT_STORAGE_KEY)
    setTimeout(() => {
      searchInputRef.current?.focus()
    }, 150)
  }

  const handleCheckInvoice = async (inv: string, supId: string | number) => {
    const clean = inv.trim()
    if (!clean) {
      setInvoiceError('Vendor Invoice Number is mandatory. Blank invoice is not allowed.')
      return
    }
    if (!supId) {
      setInvoiceError(null)
      return
    }
    setCheckingInvoice(true)
    try {
      const res = await purchases_api.check_invoice(Number(supId), clean)
      if (res.data.is_duplicate) {
        setInvoiceError(res.data.message)
      } else {
        setInvoiceError(null)
      }
    } catch {
      // ignore
    } finally {
      setCheckingInvoice(false)
    }
  }

  /* ── 9. Save Purchase (Draft / Final / Print) ────────────────────────────── */
  const handleSave = async (action: 'draft' | 'update', andPrint: boolean = false) => {
    if (!selectedSupplierId) {
      toast.error('Please select a Supplier.')
      return
    }
    if (!invoiceNo || !invoiceNo.trim()) {
      toast.error('Vendor Invoice Number is mandatory. Blank invoices are not allowed.')
      setInvoiceError('Vendor Invoice Number is mandatory. Blank invoices are not allowed.')
      invoiceInputRef.current?.focus()
      return
    }
    if (!invoiceDate) {
      toast.error('Please select an Invoice Date.')
      return
    }
    if (rows.length === 0) {
      toast.error('Please add at least one item.')
      return
    }

    // Verify duplicate invoice with backend before saving
    try {
      const chk = await purchases_api.check_invoice(Number(selectedSupplierId), invoiceNo.trim())
      if (chk.data.is_duplicate) {
        setInvoiceError(chk.data.message)
        toast.error(chk.data.message, { duration: 6000 })
        invoiceInputRef.current?.focus()
        return
      }
    } catch (err: any) {
      const msg = err?.response?.data?.detail
      if (msg) {
        toast.error(msg)
        return
      }
    }

    const cleanPaymentMode = (paymentMode || 'credit').trim().toLowerCase().includes('neft')
      ? 'neft'
      : (paymentMode || 'credit').trim().toLowerCase()

    // Validate batch/expiry requirements across all rows & sub-batches
    const todayStr = new Date().toISOString().split('T')[0]
    for (const r of rows) {
      const activeBatches = (r.batches && r.batches.length > 1)
        ? r.batches
        : [{
            batch_no: r.batch_no || '',
            qty: r.qty,
            free_qty: r.free_qty,
            mfg_date: r.mfg_date,
            expiry_date: r.expiry_date,
          }]

      for (let bIdx = 0; bIdx < activeBatches.length; bIdx++) {
        const b = activeBatches[bIdx]
        const lotLabel = activeBatches.length > 1 ? ` (Lot #${bIdx + 1} - ${b.batch_no || 'No Batch'})` : ''
        if (r.has_batch_tracking && !b.batch_no?.trim()) {
          toast.error(`Batch No is required for item "${r.product_name}"${lotLabel}`)
          return
        }
        if (b.mfg_date && b.expiry_date && b.expiry_date <= b.mfg_date) {
          toast.error(`Expiry date must be after manufacturing date for "${r.product_name}"${lotLabel}`)
          return
        }
        if (b.expiry_date && b.expiry_date < todayStr) {
          toast.error(`Item "${r.product_name}"${lotLabel} is already expired (${b.expiry_date})`)
          return
        }
      }
    }

    // Expand items with multiple batches into individual backend purchase lines
    const flatItems: any[] = []
    for (const r of rows) {
      if (r.batches && r.batches.length > 1) {
        for (const b of r.batches) {
          flatItems.push({
            product_id: r.product_id,
            item_code: r.item_code || undefined,
            qty: Number(b.qty || 0),
            free_qty: Number(b.free_qty || 0),
            pcs: 0,
            unit: 'PCS',
            price: Number(r.basic_cost || 0),
            disc_val: Number(r.disc_val || 0),
            disc_type: r.disc_type,
            gst_percent: Number(r.tax_percent || 0),
            hsn_code: r.hsn_code || undefined,
            mrp: Number(r.mrp || 0),
            selling_price: Number(r.selling_price || 0),
            batch_no: b.batch_no?.trim() || undefined,
            mfg_date: b.mfg_date || undefined,
            expiry_date: b.expiry_date || undefined,
            po_item_id: r.po_item_id,
          })
        }
      } else {
        flatItems.push({
          product_id: r.product_id,
          item_code: r.item_code || undefined,
          qty: Number(r.qty || 0),
          free_qty: Number(r.free_qty || 0),
          pcs: 0,
          unit: 'PCS',
          price: Number(r.basic_cost || 0),
          disc_val: Number(r.disc_val || 0),
          disc_type: r.disc_type,
          gst_percent: Number(r.tax_percent || 0),
          hsn_code: r.hsn_code || undefined,
          mrp: Number(r.mrp || 0),
          selling_price: Number(r.selling_price || 0),
          batch_no: (r.batches?.[0]?.batch_no || r.batch_no)?.trim() || undefined,
          mfg_date: r.batches?.[0]?.mfg_date || r.mfg_date || undefined,
          expiry_date: r.batches?.[0]?.expiry_date || r.expiry_date || undefined,
          po_item_id: r.po_item_id,
        })
      }
    }

    const payload = {
      outlet_id: selectedOutletId ? Number(selectedOutletId) : undefined,
      supplier_id: Number(selectedSupplierId),
      invoice_no: invoiceNo.trim(),
      invoice_date: invoiceDate,
      discount: Number(additionalDiscount || 0),
      round_off: effectiveRoundOff,
      paid_amount: Number(amountPaid || 0),
      payment_mode: cleanPaymentMode,
      notes: notes.trim() || undefined,
      action: action,
      po_id: poId || undefined,
      items: flatItems,
    }

    try {
      setSaving(true)
      const res = await purchases_api.create_grn(payload as any)
      const d = res.data
      // Clear draft in localStorage
      localStorage.removeItem(DRAFT_STORAGE_KEY)

      if (action === 'draft') {
        toast.success(`Draft saved successfully (${d.purchase_no})`)
        resetAndStartNew()
        navigate('/purchases/grn')
        return
      }

      // If Save & Print: open A4 Landscape print page in new tab and clear form immediately
      if (andPrint && d.purchase_id) {
        window.open(`/purchases/grn/print/${d.purchase_id}`, '_blank')
        resetAndStartNew()
        toast.success(`Purchase ${d.purchase_no} saved! Print opened in new tab. Form cleared for next inward.`, { duration: 6000 })
        return
      }

      // If Save Purchase & Update Stock (without immediate print tab)
      toast.success(`Purchase ${d.purchase_no} saved & stock updated!`)
      if (d.purchase_id) {
        try {
          const detailRes = await purchases_api.get_grn(d.purchase_id)
          setSavedGrn(detailRes.data)
        } catch {
          resetAndStartNew()
          navigate('/purchases/grn')
        }
      } else {
        resetAndStartNew()
        navigate('/purchases/grn')
      }
    } catch (err: any) {
      const msg = err?.response?.data?.detail || 'Database error. Purchase not saved.'
      toast.error(msg, { duration: 5000 })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      style={{
        backgroundColor: '#eef2f5',
        fontFamily: '"Segoe UI", Arial, sans-serif',
        fontSize: '12px',
        minHeight: '100vh',
        padding: '10px',
        color: '#222',
      }}
      className="select-none"
    >
      {/* ── TOP TITLE & TAB ── */}
      <div className="flex justify-between items-end mb-1">
        <div className="flex items-center">
          <div
            style={{
              backgroundColor: '#0055a5',
              color: '#fff',
              fontWeight: 700,
              fontSize: '13px',
              padding: '4px 16px',
              borderTopLeftRadius: '4px',
              borderTopRightRadius: '4px',
              letterSpacing: '0.02em',
            }}
          >
            Purchase Entry
          </div>
        </div>
        <div className="flex items-center gap-2">
          {draftStatus && (
            <span className="text-[11px] text-slate-500 font-semibold bg-white border border-slate-300 px-2 py-0.5 rounded shadow-xs">
              <i className="fas fa-save text-blue-600 mr-1"></i> {draftStatus}
            </span>
          )}
          {(rows.length > 0 || invoiceNo || selectedSupplierId) && (
            <button
              onClick={() => {
                if (window.confirm('Are you sure you want to clear this entry and reset all fields?')) {
                  resetAndStartNew()
                  toast.success('Form cleared')
                }
              }}
              className="text-[11px] text-red-600 hover:text-red-700 font-semibold bg-white hover:bg-red-50 border border-red-200 px-2.5 py-0.5 rounded shadow-xs cursor-pointer flex items-center gap-1 transition-colors"
            >
              <i className="fas fa-undo"></i> Clear Form
            </button>
          )}
        </div>
      </div>
      <div style={{ height: '1px', backgroundColor: '#0055a5', marginBottom: '8px' }}></div>

      {/* ── HEADER BLOCK ── */}
      <div
        style={{
          backgroundColor: '#fff',
          border: '1px solid #ccc',
          borderRadius: '2px',
          padding: '8px 12px',
          marginBottom: '8px',
        }}
        className="space-y-2 shadow-xs"
      >
        {/* ROW 1: Supplier, GSTIN, Address, Outlet */}
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center">
            <label style={{ width: '90px', textAlign: 'right', color: '#555', marginRight: '8px' }}>
              Supplier<span className="text-red-500">*</span>:
            </label>
            <select
              value={selectedSupplierId}
              onChange={e => handleSupplierChange(e.target.value ? Number(e.target.value) : '')}
              style={{
                width: '400px',
                height: '24px',
                border: '1px solid #ccc',
                borderRadius: '2px',
                padding: '2px 6px',
                fontSize: '12px',
              }}
              className="focus:border-blue-500 focus:outline-hidden"
            >
              <option value="">-- Select Supplier --</option>
              {suppliers.map(s => (
                <option
                  key={s.id}
                  value={s.id}
                  title={`GST: ${s.gst_number || s.gstin || 'None'} | ${s.address || ''}, ${s.city || ''}, ${s.state || ''}`}
                >
                  {s.name} {s.city ? `(${s.city})` : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center">
            <label style={{ width: '60px', textAlign: 'right', color: '#555', marginRight: '6px' }}>
              Against PO:
            </label>
            <select
              value={poId}
              onChange={e => (e.target.value ? loadFromPO(Number(e.target.value)) : unlinkPO())}
              disabled={!selectedSupplierId}
              style={{
                width: '220px',
                height: '24px',
                border: '1px solid #ccc',
                borderRadius: '2px',
                padding: '2px 6px',
                fontSize: '12px',
                backgroundColor: poId ? '#ecfdf5' : '#fff',
              }}
              className="focus:border-blue-500 focus:outline-hidden"
            >
              <option value="">{selectedSupplierId ? (openPos.length ? '-- Direct (no PO) --' : '-- No open PO --') : '-- Select supplier first --'}</option>
              {poId && !openPos.some(p => p.id === poId) && <option value={poId}>PO #{poId}</option>}
              {openPos.map(p => (
                <option key={p.id} value={p.id}>
                  {p.po_no} | {p.po_date} | {p.status === 'partial' ? 'Part received' : 'Approved'} | {p.item_count} items
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center">
            <label style={{ width: '60px', textAlign: 'right', color: '#555', marginRight: '6px' }}>
              GSTIN:
            </label>
            <input
              type="text"
              readOnly
              value={supplierGstin}
              style={{
                width: '160px',
                height: '24px',
                border: '1px solid #ccc',
                borderRadius: '2px',
                backgroundColor: '#f0f0f0',
                padding: '2px 6px',
                fontSize: '12px',
              }}
            />
          </div>

          <div className="flex items-center">
            <label style={{ width: '60px', textAlign: 'right', color: '#555', marginRight: '6px' }}>
              Address:
            </label>
            <input
              type="text"
              readOnly
              value={supplierAddress}
              title={supplierAddress}
              style={{
                width: '260px',
                height: '24px',
                border: '1px solid #ccc',
                borderRadius: '2px',
                backgroundColor: '#f0f0f0',
                padding: '2px 6px',
                fontSize: '11px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            />
          </div>

          <div className="flex items-center ml-auto">
            <label style={{ width: '70px', textAlign: 'right', color: '#555', marginRight: '6px' }}>
              Outlet / Loc:
            </label>
            <select
              value={selectedOutletId}
              onChange={e => setSelectedOutletId(e.target.value ? Number(e.target.value) : '')}
              style={{
                width: '180px',
                height: '24px',
                border: '1px solid #ccc',
                borderRadius: '2px',
                padding: '2px 6px',
                fontSize: '12px',
              }}
              className="focus:border-blue-500 focus:outline-hidden font-medium text-slate-700"
            >
              {outlets.map(o => (
                <option key={o.id} value={o.id}>{o.outlet_name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* ROW 2: Payment Mode, Invoice No., Invoice Date */}
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center">
            <label style={{ width: '90px', textAlign: 'right', color: '#555', marginRight: '8px' }}>
              Pay Mode:
            </label>
            <select
              value={paymentMode}
              onChange={e => setPaymentMode(e.target.value)}
              style={{
                width: '140px',
                height: '24px',
                border: '1px solid #ccc',
                borderRadius: '2px',
                padding: '2px 6px',
                fontSize: '12px',
              }}
              className="focus:border-blue-500 focus:outline-hidden font-medium text-slate-800"
            >
              <option value="credit">Credit / Payable</option>
              <option value="cash">Cash</option>
              <option value="neft">NEFT / RTGS</option>
              <option value="upi">UPI</option>
              <option value="cheque">Cheque</option>
            </select>
          </div>

          <div className="flex flex-col">
            <div className="flex items-center">
              <label style={{ width: '85px', textAlign: 'right', color: '#555', marginRight: '6px' }}>
                Invoice No<span className="text-red-500 font-bold">*</span>:
              </label>
              <div className="relative">
                <input
                  ref={invoiceInputRef}
                  type="text"
                  required
                  placeholder="e.g. INV-2026-001"
                  value={invoiceNo}
                  onChange={e => {
                    setInvoiceNo(e.target.value)
                    if (invoiceError) setInvoiceError(null)
                  }}
                  onBlur={() => handleCheckInvoice(invoiceNo, selectedSupplierId)}
                  style={{
                    width: '180px',
                    height: '24px',
                    border: invoiceError ? '1.5px solid #ef4444' : '1px solid #ccc',
                    backgroundColor: invoiceError ? '#fef2f2' : '#fff',
                    borderRadius: '2px',
                    padding: '2px 6px',
                    fontSize: '12px',
                  }}
                  className="focus:border-blue-500 focus:outline-hidden font-mono uppercase"
                />
                {checkingInvoice && (
                  <span className="absolute right-2 top-0.5 text-[10px] text-gray-400">checking…</span>
                )}
              </div>
            </div>
            {invoiceError && (
              <div className="text-[10px] text-red-600 font-bold ml-[91px] mt-0.5 max-w-[260px] leading-tight bg-red-50 p-1 rounded border border-red-200">
                ⚠ {invoiceError}
              </div>
            )}
          </div>

          <div className="flex items-center">
            <label style={{ width: '90px', textAlign: 'right', color: '#555', marginRight: '6px' }}>
              Invoice Date<span className="text-red-500">*</span>:
            </label>
            <input
              type="date"
              value={invoiceDate}
              onChange={e => setInvoiceDate(e.target.value)}
              style={{
                width: '140px',
                height: '24px',
                border: '1px solid #ccc',
                borderRadius: '2px',
                padding: '2px 6px',
                fontSize: '12px',
              }}
              className="focus:border-blue-500 focus:outline-hidden"
            />
          </div>
        </div>
      </div>

      {/* ── SCAN BAR ── */}
      <div className="relative mb-2 flex items-center gap-3">
        <span style={{ fontSize: '16px', fontWeight: 700, color: '#333' }}>Scan</span>
        <div
          style={{
            maxWidth: '630px',
            width: '100%',
            position: 'relative',
          }}
        >
          <div className="relative flex items-center">
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Type product name, item code or scan barcode..."
              value={scanQuery}
              onChange={e => setScanQuery(e.target.value)}
              onKeyDown={handleScanKeyDown}
              style={{
                height: '28px',
                width: '100%',
                border: '1px solid #aaa',
                borderRadius: '2px',
                padding: '2px 80px 2px 8px',
                fontSize: '13px',
                backgroundColor: '#fff',
              }}
              className="focus:border-blue-600 focus:outline-hidden shadow-xs"
              autoComplete="off"
            />
            {searching && (
              <span className="absolute right-2 text-slate-400 text-[11px] flex items-center">
                <i className="fas fa-spinner fa-spin mr-1"></i> Searching…
              </span>
            )}
            {!searching && searchResults.length > 0 && dropdownVisible && (
              <span className="absolute right-2 text-blue-600 text-[11px] font-semibold">
                {searchResults.length} result(s)
              </span>
            )}
          </div>

          {/* Autocomplete Dropdown */}
          {dropdownVisible && searchResults.length > 0 && (
            <div
              ref={dropdownRef}
              style={{
                position: 'absolute',
                top: '32px',
                left: 0,
                width: '100%',
                maxHeight: '280px',
                overflowY: 'auto',
                backgroundColor: '#fff',
                border: '1px solid #3b82f6',
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                zIndex: 9999,
                borderRadius: '2px',
              }}
            >
              {searchResults.map((item, idx) => {
                const stock = Number(item.stock_qty || 0)
                const stockColor = stock <= 0 ? 'text-red-600' : stock < 5 ? 'text-amber-600' : 'text-emerald-700'
                const isHighlighted = idx === activeHighlightIndex
                return (
                  <div
                    key={item.id}
                    onClick={() => addProductRow(item)}
                    style={{
                      padding: '6px 10px',
                      borderBottom: '1px solid #eee',
                      cursor: 'pointer',
                      backgroundColor: isHighlighted ? '#e6f0fa' : '#fff',
                    }}
                    className="flex justify-between items-center hover:bg-[#e6f0fa]"
                  >
                    <div>
                      <div style={{ color: '#1e40af', fontWeight: 600, fontSize: '13px' }}>
                        {item.name}
                      </div>
                      <div style={{ fontSize: '11px', color: '#666' }}>
                        Code: <span className="font-mono text-slate-700">{item.item_code || '—'}</span>
                        {item.barcode && <> &nbsp;·&nbsp; Barcode: <span className="font-mono">{item.barcode}</span></>}
                      </div>
                    </div>
                    <div className="text-right" style={{ fontSize: '11px' }}>
                      <div className={`font-bold ${stockColor}`}>
                        Stock: {stock} {item.unit || 'PCS'}
                      </div>
                      <div className="text-slate-600">
                        Pur: ₹{Number(item.purchase_price || item.basic_cost || 0).toFixed(2)} &nbsp;|&nbsp; MRP: ₹{Number(item.mrp || 0).toFixed(2)} &nbsp;|&nbsp; GST: {item.gst_percent || 0}%
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <button
          onClick={() => {
            if (scanQuery.trim()) {
              products_api.search(scanQuery.trim(), 12, selectedOutletId ? Number(selectedOutletId) : undefined)
                .then(r => {
                  setSearchResults(r.data || [])
                  setDropdownVisible((r.data || []).length > 0)
                  setCurrentSearchQuery(scanQuery.trim())
                })
            }
          }}
          style={{
            height: '28px',
            backgroundColor: '#0055a5',
            color: '#fff',
            fontWeight: 600,
            padding: '2px 14px',
            borderRadius: '2px',
            border: 'none',
            fontSize: '12px',
            cursor: 'pointer',
          }}
          className="hover:bg-blue-800"
        >
          <i className="fas fa-search mr-1"></i> Search
        </button>
      </div>

      {/* ── ITEMS GRID ── */}
      <div
        style={{
          backgroundColor: '#fff',
          border: '1px solid #aaa',
          borderRadius: '2px',
          height: 'calc(100vh - 410px)',
          minHeight: '260px',
          overflowX: 'auto',
          overflowY: 'auto',
          marginBottom: '8px',
        }}
        className="shadow-xs"
      >
        <table
          style={{
            tableLayout: 'fixed',
            whiteSpace: 'nowrap',
            width: 'max-content',
            borderCollapse: 'collapse',
            fontSize: '11.5px',
          }}
        >
          <thead>
            <tr
              style={{
                backgroundColor: '#0055a5',
                color: '#fff',
                fontWeight: 600,
                textAlign: 'center',
                position: 'sticky',
                top: 0,
                zIndex: 10,
              }}
            >
              <th style={{ width: '20px', padding: '4px 2px' }}>✕</th>
              <th style={{ width: '30px', padding: '4px' }}>SI</th>
              <th style={{ width: '200px', padding: '4px', textAlign: 'left' }}>Product</th>
              <th style={{ width: '100px', padding: '4px' }}>Item Code</th>
              <th style={{ width: '100px', padding: '4px' }}>EAN Code</th>
              <th style={{ width: '70px', padding: '4px' }}>Basic Cost</th>
              <th style={{ width: '80px', padding: '4px' }}>Discount</th>
              <th style={{ width: '80px', padding: '4px' }}>HSN</th>
              <th style={{ width: '50px', padding: '4px' }}>Tax %</th>
              <th style={{ width: '70px', padding: '4px' }}>Cost Price</th>
              <th style={{ width: '70px', padding: '4px' }}>MRP</th>
              <th style={{ width: '70px', padding: '4px' }}>SP</th>
              <th style={{ width: '60px', padding: '4px' }}>Mgn(CP)</th>
              <th style={{ width: '60px', padding: '4px' }}>Mgn(MRP)</th>
              <th style={{ width: '60px', padding: '4px' }}>Mgn(SP)</th>
              <th style={{ width: '65px', padding: '4px' }}>Old QOH</th>
              <th style={{ width: '70px', padding: '4px' }}>LP Date</th>
              <th style={{ width: '65px', padding: '4px' }}>Last Pur.</th>
              <th style={{ width: '65px', padding: '4px' }}>Sales/LP</th>
              <th style={{ width: '60px', padding: '4px', backgroundColor: '#004080' }}>Qty</th>
              <th style={{ width: '55px', padding: '4px', backgroundColor: '#004080' }}>Free</th>
              <th style={{ width: '85px', padding: '4px', backgroundColor: '#004080' }}>Batch No</th>
              <th style={{ width: '90px', padding: '4px', backgroundColor: '#004080' }}>Mfg Date</th>
              <th style={{ width: '90px', padding: '4px', backgroundColor: '#004080' }}>Exp Date</th>
              <th style={{ width: '80px', padding: '4px' }}>Basic Total</th>
              <th style={{ width: '70px', padding: '4px' }}>Tax Total</th>
              <th style={{ width: '80px', padding: '4px' }}>Cost Value</th>
              <th style={{ width: '80px', padding: '4px' }}>MRP Value</th>
              <th style={{ width: '80px', padding: '4px', backgroundColor: '#003366' }}>Total ₹</th>
            </tr>
          </thead>
          <tbody>
            {calculatedRows.length === 0 ? (
              <tr>
                <td colSpan={29} className="text-center py-16 text-slate-400">
                  <div className="text-2xl mb-1">📦</div>
                  No items added yet. Scan a barcode or search product name above.
                </td>
              </tr>
            ) : (
              calculatedRows.map((r, index) => (
                <tr
                  key={index}
                  style={{
                    borderBottom: '1px solid #ddd',
                    backgroundColor: index % 2 === 0 ? '#fff' : '#fafafa',
                  }}
                  className="hover:bg-blue-50/50"
                >
                  {/* 1. Remove Button */}
                  <td style={{ width: '20px', textAlign: 'center', borderRight: '1px solid #ddd' }}>
                    <button
                      onClick={() => removeRow(index)}
                      className="text-red-600 font-bold hover:text-red-800 text-xs px-1 cursor-pointer"
                      title="Remove row"
                    >
                      ✕
                    </button>
                  </td>

                  {/* 2. Serial */}
                  <td style={{ width: '30px', textAlign: 'center', color: '#666', borderRight: '1px solid #ddd' }}>
                    {index + 1}
                  </td>

                  {/* 3. Product Name & Code */}
                  <td style={{ width: '200px', padding: '2px 6px', borderRight: '1px solid #ddd' }}>
                    <div className="flex items-center justify-between gap-1">
                      <span style={{ color: '#1e40af', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {r.product_name}
                      </span>
                      {r.po_item_id && (
                        <span
                          title="Qty pending on the PO"
                          className={`text-[10px] px-1 rounded shrink-0 font-bold ${Number(r.qty || 0) > Number(r.po_pending || 0) ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}
                        >
                          PO bal {r.po_pending}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => openBatchModal(index)}
                        className={`text-[10px] px-1.5 py-0.5 rounded font-bold shrink-0 transition-all shadow-xs cursor-pointer flex items-center gap-1 active:scale-95 ${
                          r.batches && r.batches.length > 1
                            ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                            : 'bg-blue-600 hover:bg-blue-700 text-white'
                        }`}
                        title={r.batches && r.batches.length > 1 ? `${r.batches.length} batches allocated. Click to view/edit.` : 'Click to allocate multiple batches with different expiry dates'}
                      >
                        <i className="fas fa-boxes-stacked text-[8px]"></i>
                        {r.batches && r.batches.length > 1 ? `${r.batches.length} Batches` : '+ Batch'}
                      </button>
                    </div>
                    <div style={{ fontSize: '10px', color: '#888' }} className="flex items-center gap-2 mt-0.5">
                      <span>{r.item_code}</span>
                      {r.has_batch_tracking && (
                        <span className="text-[9px] px-1 rounded bg-amber-100 text-amber-800 font-medium">Batch Req</span>
                      )}
                      {r.shelf_life_days ? (
                        <span className="text-[9px] px-1 rounded bg-slate-100 text-slate-600">SL: {r.shelf_life_days}d</span>
                      ) : null}
                    </div>
                  </td>

                  {/* 4. Item Code */}
                  <td style={{ width: '100px', padding: '2px 4px', color: '#555', borderRight: '1px solid #ddd', textAlign: 'center' }}>
                    {r.item_code || '—'}
                  </td>

                  {/* 5. EAN Code */}
                  <td style={{ width: '100px', padding: '2px 4px', color: '#555', borderRight: '1px solid #ddd', textAlign: 'center' }}>
                    {r.barcode || '—'}
                  </td>

                  {/* 6. Basic Cost (Editable) */}
                  <td style={{ width: '70px', padding: '0', borderRight: '1px solid #ddd' }}>
                    <input
                      type="number"
                      step="0.01"
                      value={r.basic_cost}
                      onChange={e => updateRowField(index, 'basic_cost', parseFloat(e.target.value) || 0)}
                      style={{
                        width: '100%',
                        height: '22px',
                        border: 'none',
                        background: 'transparent',
                        textAlign: 'right',
                        padding: '0 4px',
                      }}
                      className="focus:bg-[#e6f0fa] focus:outline-blue-500 font-medium"
                    />
                  </td>

                  {/* 7. Discount (Editable value + %/₹) */}
                  <td style={{ width: '80px', padding: '0', borderRight: '1px solid #ddd' }}>
                    <div className="flex items-center">
                      <input
                        type="number"
                        step="0.01"
                        value={r.disc_val}
                        onChange={e => updateRowField(index, 'disc_val', parseFloat(e.target.value) || 0)}
                        style={{
                          width: '52px',
                          height: '22px',
                          border: 'none',
                          background: 'transparent',
                          textAlign: 'right',
                          padding: '0 2px',
                        }}
                        className="focus:bg-[#e6f0fa] focus:outline-blue-500"
                      />
                      <select
                        value={r.disc_type}
                        onChange={e => updateRowField(index, 'disc_type', e.target.value as any)}
                        style={{
                          width: '28px',
                          height: '22px',
                          border: 'none',
                          background: 'transparent',
                          fontSize: '11px',
                          cursor: 'pointer',
                        }}
                      >
                        <option value="₹">₹</option>
                        <option value="%">%</option>
                      </select>
                    </div>
                  </td>

                  {/* 8. HSN (Editable Select) */}
                  <td style={{ width: '80px', padding: '0', borderRight: '1px solid #ddd' }}>
                    <select
                      value={r.hsn_code}
                      onChange={e => updateRowField(index, 'hsn_code', e.target.value)}
                      style={{
                        width: '100%',
                        height: '22px',
                        border: 'none',
                        background: 'transparent',
                        fontSize: '11px',
                      }}
                    >
                      <option value="">Select</option>
                      {hsnList.map(h => (
                        <option key={h.hsn_code} value={h.hsn_code}>
                          {h.hsn_code} ({h.gst_percent}%)
                        </option>
                      ))}
                    </select>
                  </td>

                  {/* 9. Tax % (Editable Select) */}
                  <td style={{ width: '50px', padding: '0', borderRight: '1px solid #ddd' }}>
                    <select
                      value={r.tax_percent}
                      onChange={e => updateRowField(index, 'tax_percent', parseFloat(e.target.value) || 0)}
                      style={{
                        width: '100%',
                        height: '22px',
                        border: 'none',
                        background: 'transparent',
                        textAlign: 'center',
                        fontSize: '11px',
                      }}
                    >
                      {COMMON_TAX_RATES.map(rate => (
                        <option key={rate} value={rate}>{rate}%</option>
                      ))}
                    </select>
                  </td>

                  {/* 10. Cost Price (Readonly) */}
                  <td style={{ width: '70px', padding: '2px 4px', textAlign: 'right', backgroundColor: '#f9f9f9', borderRight: '1px solid #ddd' }}>
                    {r.cp.toFixed(2)}
                  </td>

                  {/* 11. MRP (Editable) */}
                  <td style={{ width: '70px', padding: '0', borderRight: '1px solid #ddd' }}>
                    <input
                      type="number"
                      step="0.01"
                      value={r.mrp}
                      onChange={e => updateRowField(index, 'mrp', parseFloat(e.target.value) || 0)}
                      style={{
                        width: '100%',
                        height: '22px',
                        border: 'none',
                        background: 'transparent',
                        textAlign: 'right',
                        padding: '0 4px',
                      }}
                      className="focus:bg-[#e6f0fa] focus:outline-blue-500"
                    />
                  </td>

                  {/* 12. SP (Editable) */}
                  <td style={{ width: '70px', padding: '0', borderRight: '1px solid #ddd' }}>
                    <input
                      type="number"
                      step="0.01"
                      value={r.selling_price}
                      onChange={e => updateRowField(index, 'selling_price', parseFloat(e.target.value) || 0)}
                      style={{
                        width: '100%',
                        height: '22px',
                        border: 'none',
                        background: 'transparent',
                        textAlign: 'right',
                        padding: '0 4px',
                      }}
                      className="focus:bg-[#e6f0fa] focus:outline-blue-500 font-medium"
                    />
                  </td>

                  {/* 13. Mgn(CP) (Readonly Green %) */}
                  <td style={{ width: '60px', padding: '2px 4px', textAlign: 'right', color: '#16a34a', fontWeight: 700, borderRight: '1px solid #ddd' }}>
                    {r.mgnCP.toFixed(1)}%
                  </td>

                  {/* 14. Mgn(MRP) (Readonly) */}
                  <td style={{ width: '60px', padding: '2px 4px', textAlign: 'right', color: '#555', borderRight: '1px solid #ddd' }}>
                    {r.mgnMRP.toFixed(1)}%
                  </td>

                  {/* 15. Mgn(SP) (Readonly) */}
                  <td style={{ width: '60px', padding: '2px 4px', textAlign: 'right', color: '#555', borderRight: '1px solid #ddd' }}>
                    {r.mgnSP.toFixed(1)}%
                  </td>

                  {/* 16. Old QOH (Readonly) */}
                  <td style={{ width: '65px', padding: '2px 4px', textAlign: 'center', color: '#666', borderRight: '1px solid #ddd' }}>
                    {r.old_qoh}
                  </td>

                  {/* 17. LP Date (Readonly blue 9px) */}
                  <td style={{ width: '70px', padding: '2px 4px', textAlign: 'center', color: '#2563eb', fontSize: '9.5px', borderRight: '1px solid #ddd' }}>
                    {r.lp_date || '—'}
                  </td>

                  {/* 18. Last Pur. (Readonly blue) */}
                  <td style={{ width: '65px', padding: '2px 4px', textAlign: 'center', color: '#2563eb', borderRight: '1px solid #ddd' }}>
                    {r.lp_qty > 0 ? r.lp_qty : '—'}
                  </td>

                  {/* 19. Sales/LP (Readonly orange) */}
                  <td style={{ width: '65px', padding: '2px 4px', textAlign: 'center', color: '#ea580c', borderRight: '1px solid #ddd' }}>
                    {r.sales_lp > 0 ? r.sales_lp : '—'}
                  </td>

                  {/* 20. Qty (Editable) */}
                  <td style={{ width: '60px', padding: '0', borderRight: '1px solid #ddd', backgroundColor: '#eef6ff' }}>
                    <input
                      ref={el => { qtyInputRefs.current[index] = el }}
                      type="number"
                      step="any"
                      min="0"
                      value={r.qty}
                      onChange={e => updateRowField(index, 'qty', parseFloat(e.target.value) || 0)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          searchInputRef.current?.focus()
                          searchInputRef.current?.select()
                        }
                      }}
                      style={{
                        width: '100%',
                        height: '22px',
                        border: 'none',
                        background: 'transparent',
                        textAlign: 'right',
                        padding: '0 4px',
                        fontWeight: 700,
                      }}
                      className="focus:bg-white focus:outline-blue-600 text-blue-900"
                    />
                  </td>

                  {/* 21. Free Qty (Editable Green) */}
                  <td style={{ width: '55px', padding: '0', borderRight: '1px solid #ddd', backgroundColor: '#f0fdf4' }}>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={r.free_qty}
                      onChange={e => updateRowField(index, 'free_qty', parseFloat(e.target.value) || 0)}
                      style={{
                        width: '100%',
                        height: '22px',
                        border: 'none',
                        background: 'transparent',
                        textAlign: 'right',
                        padding: '0 4px',
                        color: '#15803d',
                        fontWeight: 700,
                      }}
                      className="focus:bg-white focus:outline-emerald-600"
                    />
                  </td>

                  {/* Batch No */}
                  <td style={{ width: '85px', padding: '0', borderRight: '1px solid #ddd', backgroundColor: r.has_batch_tracking && !r.batch_no && (!r.batches || r.batches.length === 0) ? '#fffbeb' : 'transparent' }}>
                    {r.batches && r.batches.length > 1 ? (
                      <button
                        type="button"
                        onClick={() => openBatchModal(index)}
                        style={{
                          width: '100%',
                          height: '22px',
                          border: 'none',
                          background: '#ecfdf5',
                          padding: '0 4px',
                          fontWeight: 700,
                          fontSize: '10px',
                          color: '#065f46',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          cursor: 'pointer',
                        }}
                        className="hover:bg-emerald-100"
                        title="Click to view/edit multiple batches"
                      >
                        <span>📦 {r.batches.length} Lots</span>
                        <span className="font-mono text-[9px] text-emerald-700 font-bold">({r.batches.map(b => b.qty).join('+')})</span>
                      </button>
                    ) : (
                      <div className="flex items-center w-full">
                        <input
                          ref={el => { batchInputRefs.current[index] = el }}
                          type="text"
                          placeholder={r.has_batch_tracking ? 'Batch *' : 'Batch'}
                          value={r.batch_no || ''}
                          onChange={e => updateRowField(index, 'batch_no', e.target.value.toUpperCase())}
                          style={{
                            width: '100%',
                            height: '22px',
                            border: 'none',
                            background: 'transparent',
                            padding: '0 4px',
                            fontWeight: 600,
                            fontSize: '11px',
                          }}
                          className="focus:bg-white focus:outline-amber-600 font-mono"
                        />
                        <button
                          type="button"
                          onClick={() => openBatchModal(index)}
                          className="text-[9px] px-1 text-blue-600 hover:text-blue-800 shrink-0 cursor-pointer"
                          title="Open Batch Allocation Window"
                        >
                          <i className="fas fa-layer-group text-[9px]"></i>
                        </button>
                      </div>
                    )}
                  </td>

                  {/* Mfg Date */}
                  <td style={{ width: '90px', padding: '0', borderRight: '1px solid #ddd' }}>
                    {r.batches && r.batches.length > 1 ? (
                      <button
                        type="button"
                        onClick={() => openBatchModal(index)}
                        style={{
                          width: '100%',
                          height: '22px',
                          border: 'none',
                          background: '#f8fafc',
                          fontSize: '10px',
                          color: '#475569',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                        className="hover:bg-blue-50"
                        title="Click to view/edit batch mfg dates"
                      >
                        Multi Mfg ({r.batches.length})
                      </button>
                    ) : (
                      <input
                        type="date"
                        value={r.mfg_date || ''}
                        onChange={e => updateRowField(index, 'mfg_date', e.target.value)}
                        style={{
                          width: '100%',
                          height: '22px',
                          border: 'none',
                          background: 'transparent',
                          padding: '0 2px',
                          fontSize: '10px',
                        }}
                        className="focus:bg-white focus:outline-blue-600"
                      />
                    )}
                  </td>

                  {/* Exp Date */}
                  <td style={{ width: '90px', padding: '0', borderRight: '1px solid #ddd', backgroundColor: r.expiry_date && r.expiry_date < new Date().toISOString().split('T')[0] ? '#fee2e2' : 'transparent' }}>
                    {r.batches && r.batches.length > 1 ? (
                      <button
                        type="button"
                        onClick={() => openBatchModal(index)}
                        style={{
                          width: '100%',
                          height: '22px',
                          border: 'none',
                          background: '#ecfdf5',
                          fontSize: '10px',
                          color: '#065f46',
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                        className="hover:bg-emerald-100"
                        title="Click to view/edit batch expiry dates"
                      >
                        Multi Exp ({r.batches.length})
                      </button>
                    ) : (
                      <input
                        type="date"
                        value={r.expiry_date || ''}
                        onChange={e => updateRowField(index, 'expiry_date', e.target.value)}
                        style={{
                          width: '100%',
                          height: '22px',
                          border: 'none',
                          background: 'transparent',
                          padding: '0 2px',
                          fontSize: '10px',
                          color: r.expiry_date && r.expiry_date < new Date().toISOString().split('T')[0] ? '#dc2626' : undefined,
                          fontWeight: r.expiry_date && r.expiry_date < new Date().toISOString().split('T')[0] ? 700 : undefined,
                        }}
                        className="focus:bg-white focus:outline-blue-600"
                        title={r.expiry_date && r.expiry_date < new Date().toISOString().split('T')[0] ? 'Warning: Expired date!' : undefined}
                      />
                    )}
                  </td>

                  {/* 22. Basic Total (Readonly) */}
                  <td style={{ width: '80px', padding: '2px 4px', textAlign: 'right', borderRight: '1px solid #ddd' }}>
                    ₹{r.basicTotal.toFixed(2)}
                  </td>

                  {/* 23. Tax Total (Readonly) */}
                  <td style={{ width: '70px', padding: '2px 4px', textAlign: 'right', borderRight: '1px solid #ddd' }}>
                    ₹{r.taxTotal.toFixed(2)}
                  </td>

                  {/* 24. Cost Value (Readonly) */}
                  <td style={{ width: '80px', padding: '2px 4px', textAlign: 'right', borderRight: '1px solid #ddd' }}>
                    ₹{r.costValue.toFixed(2)}
                  </td>

                  {/* 25. MRP Value (Readonly) */}
                  <td style={{ width: '80px', padding: '2px 4px', textAlign: 'right', borderRight: '1px solid #ddd' }}>
                    ₹{r.mrpVal.toFixed(2)}
                  </td>

                  {/* 26. Total ₹ (Readonly bold) */}
                  <td style={{ width: '80px', padding: '2px 6px', textAlign: 'right', fontWeight: 700, backgroundColor: '#f1f5f9' }}>
                    ₹{r.total.toFixed(2)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ── BOTTOM SECTION: NOTES, TOTAL QTY & TOTALS GRID ── */}
      <div className="flex justify-between items-start gap-4 mb-2 flex-wrap">
        {/* Bottom Left: Notes + Big Total Qty Box */}
        <div className="flex items-start gap-4">
          <div>
            <label className="text-[11px] font-bold text-slate-500 block mb-1">Notes / Remarks:</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="e.g. Supplier challan reference or consignment notes…"
              style={{
                width: '320px',
                height: '45px',
                border: '1px solid #ccc',
                borderRadius: '2px',
                padding: '4px',
                fontSize: '11.5px',
              }}
              className="focus:border-blue-500 focus:outline-hidden"
            />
          </div>

          <div
            style={{
              width: '90px',
              height: '45px',
              border: '1px solid #0055a5',
              borderRadius: '2px',
              backgroundColor: '#fff',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            className="shadow-xs"
          >
            <span style={{ fontSize: '9px', fontWeight: 700, color: '#666', textTransform: 'uppercase' }}>Total Qty</span>
            <span style={{ fontSize: '20px', fontWeight: 800, color: '#0055a5', lineHeight: '22px' }}>
              {sumTotalQty}
            </span>
          </div>
        </div>

        {/* Bottom Right: 4-Column Totals CSS Grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '120px 100px 120px 100px',
            rowGap: '3px',
            columnGap: '8px',
            alignItems: 'center',
            backgroundColor: '#fff',
            border: '1px solid #ccc',
            padding: '6px 12px',
            borderRadius: '2px',
          }}
          className="shadow-xs"
        >
          {/* Row 1 */}
          <div style={{ textAlign: 'right', fontSize: '11px', color: '#666' }}>Total Basic:</div>
          <div style={{ textAlign: 'right', fontWeight: 700, backgroundColor: '#f9f9f9', padding: '1px 4px', borderRadius: '2px' }}>
            ₹{sumBasic.toFixed(2)}
          </div>

          <div style={{ textAlign: 'right', fontSize: '11px', color: '#666' }}>Item Discounts:</div>
          <div style={{ textAlign: 'right', fontWeight: 700, color: '#dc2626', backgroundColor: '#f9f9f9', padding: '1px 4px', borderRadius: '2px' }}>
            -₹{sumItemDisc.toFixed(2)}
          </div>

          {/* Row 2 */}
          <div style={{ textAlign: 'right', fontSize: '11px', color: '#666' }}>Total Taxable:</div>
          <div style={{ textAlign: 'right', fontWeight: 700, backgroundColor: '#f9f9f9', padding: '1px 4px', borderRadius: '2px' }}>
            ₹{sumTaxable.toFixed(2)}
          </div>

          <div style={{ textAlign: 'right', fontSize: '11px', color: '#666' }}>Total GST:</div>
          <div style={{ textAlign: 'right', fontWeight: 700, backgroundColor: '#f9f9f9', padding: '1px 4px', borderRadius: '2px' }}>
            ₹{sumGst.toFixed(2)}
          </div>

          {/* Row 3 */}
          <div style={{ textAlign: 'right', fontSize: '11px', color: '#666' }}>Addl. Discount:</div>
          <div style={{ textAlign: 'right' }}>
            <input
              type="number"
              step="0.01"
              value={additionalDiscount}
              onChange={e => setAdditionalDiscount(parseFloat(e.target.value) || 0)}
              style={{
                width: '100%',
                height: '20px',
                textAlign: 'right',
                border: '1px solid #ccc',
                padding: '0 4px',
                fontSize: '11px',
              }}
              className="focus:border-blue-500"
            />
          </div>

          <div style={{ textAlign: 'right', fontSize: '11px', color: '#666' }}>Round Off:</div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                setIsManualRoundOff(false)
                setRoundOff(autoRoundOffVal)
              }}
              title="Reset to automatic round off"
              style={{
                height: '20px',
                width: '18px',
                border: '1px solid #ccc',
                backgroundColor: isManualRoundOff ? '#f3f4f6' : '#dbeafe',
                fontSize: '10px',
                cursor: 'pointer',
              }}
            >
              ↕
            </button>
            <input
              type="number"
              step="0.01"
              value={effectiveRoundOff.toFixed(2)}
              onChange={e => {
                setIsManualRoundOff(true)
                setRoundOff(parseFloat(e.target.value) || 0)
              }}
              style={{
                width: '76px',
                height: '20px',
                textAlign: 'right',
                border: '1px solid #ccc',
                padding: '0 4px',
                fontSize: '11px',
              }}
              className="focus:border-blue-500 font-medium"
            />
          </div>

          {/* Row 4 */}
          <div style={{ textAlign: 'right', fontSize: '12px', fontWeight: 700, color: '#333' }}>Grand Total:</div>
          <div
            style={{
              textAlign: 'right',
              fontWeight: 800,
              fontSize: '14px',
              color: '#16a34a',
              backgroundColor: '#ecfdf5',
              padding: '2px 4px',
              borderRadius: '2px',
            }}
          >
            ₹{grandTotal.toFixed(2)}
          </div>

          <div style={{ textAlign: 'right', fontSize: '11px', color: '#666' }}>Amount Paid:</div>
          <div style={{ textAlign: 'right' }}>
            <input
              type="number"
              step="0.01"
              value={amountPaid}
              onChange={e => setAmountPaid(parseFloat(e.target.value) || 0)}
              style={{
                width: '100%',
                height: '20px',
                textAlign: 'right',
                border: '1px solid #ccc',
                padding: '0 4px',
                fontSize: '11px',
                fontWeight: 600,
              }}
              className="focus:border-blue-500"
            />
          </div>

          {/* Row 5: Amount Due */}
          <div style={{ gridColumn: 'span 2' }}></div>
          <div style={{ textAlign: 'right', fontSize: '12px', fontWeight: 700, color: '#333' }}>Amount Due:</div>
          <div
            style={{
              textAlign: 'right',
              fontWeight: 800,
              fontSize: '13px',
              color: amountDue > 0 ? '#dc2626' : '#16a34a',
              backgroundColor: amountDue > 0 ? '#fef2f2' : '#ecfdf5',
              padding: '2px 4px',
              borderRadius: '2px',
            }}
          >
            ₹{amountDue.toFixed(2)}
          </div>
        </div>
      </div>

      {/* ── FOOTER BUTTONS ── */}
      <div
        style={{
          borderTop: '1px solid #ccc',
          paddingTop: '8px',
          display: 'flex',
          justifyContent: 'flex-end',
          alignItems: 'center',
          gap: '8px',
        }}
        className="print:hidden"
      >
        <button
          type="button"
          onClick={() => {
            if (rows.length === 0 || window.confirm('Clear all entered items and reset form?')) {
              resetAndStartNew()
              toast.success('Form cleared')
            }
          }}
          disabled={saving}
          style={{
            height: '32px',
            backgroundColor: '#fff',
            color: '#dc2626',
            border: '1px solid #fca5a5',
            fontWeight: 600,
            fontSize: '12px',
            padding: '0 14px',
            borderRadius: '2px',
            cursor: 'pointer',
          }}
          className="hover:bg-red-50 transition-colors mr-auto"
        >
          <i className="fas fa-undo mr-1.5"></i> Clear Form
        </button>

        <button
          onClick={() => handleSave('draft')}
          disabled={saving}
          style={{
            height: '32px',
            backgroundColor: '#6b7280',
            color: '#fff',
            fontWeight: 700,
            fontSize: '12px',
            padding: '0 16px',
            border: 'none',
            borderRadius: '2px',
            cursor: saving ? 'not-allowed' : 'pointer',
          }}
          className="hover:bg-slate-600 transition-colors"
        >
          <i className="fas fa-file-alt mr-1.5"></i> Save Draft
        </button>

        <button
          onClick={() => handleSave('update', false)}
          disabled={saving}
          style={{
            height: '32px',
            backgroundColor: '#0055a5',
            color: '#fff',
            fontWeight: 700,
            fontSize: '12px',
            padding: '0 18px',
            border: 'none',
            borderRadius: '2px',
            cursor: saving ? 'not-allowed' : 'pointer',
          }}
          className="hover:bg-blue-800 transition-colors shadow-xs"
        >
          {saving ? (
            <>
              <i className="fas fa-spinner fa-spin mr-1.5"></i> Saving…
            </>
          ) : (
            <>
              <i className="fas fa-check-circle mr-1.5"></i> Save Purchase & Update Stock
            </>
          )}
        </button>

        <button
          onClick={() => handleSave('update', true)}
          disabled={saving}
          style={{
            height: '32px',
            backgroundColor: '#059669',
            color: '#fff',
            fontWeight: 700,
            fontSize: '12px',
            padding: '0 18px',
            border: 'none',
            borderRadius: '2px',
            cursor: saving ? 'not-allowed' : 'pointer',
          }}
          className="hover:bg-emerald-700 transition-colors shadow-xs"
        >
          {saving ? (
            <>
              <i className="fas fa-spinner fa-spin mr-1.5"></i> Saving…
            </>
          ) : (
            <>
              <i className="fas fa-print mr-1.5"></i> Save & Print GRN Slip
            </>
          )}
        </button>

        <button
          onClick={() => navigate('/purchases/grn')}
          disabled={saving}
          style={{
            height: '32px',
            backgroundColor: '#fff',
            color: '#0055a5',
            border: '1px solid #0055a5',
            fontWeight: 600,
            fontSize: '12px',
            padding: '0 16px',
            borderRadius: '2px',
            cursor: 'pointer',
          }}
          className="hover:bg-blue-50 transition-colors"
        >
          Close
        </button>
      </div>

      {/* ── GRN DETAIL & PRINT SLIP MODAL ── */}
      {savedGrn && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-2 sm:p-4 overflow-y-auto print:p-0 print:bg-white print:static print:z-auto">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl my-auto flex flex-col max-h-[95vh] overflow-hidden print:max-h-none print:shadow-none print:border-none print:w-full print:m-0 print:rounded-none">
            {/* Header / Actions - Hidden on print */}
            <div className="bg-slate-900 text-white px-5 py-3.5 flex justify-between items-center shrink-0 print:hidden">
              <div className="flex items-center gap-2.5">
                <span className="bg-emerald-600 text-white w-7 h-7 rounded-lg flex items-center justify-center text-xs">
                  <i className="fas fa-check"></i>
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm">Goods Receipt Note: {savedGrn.purchase_no}</span>
                    <span className="bg-emerald-500 text-white text-[10px] px-2 py-0.5 rounded-full uppercase font-bold">
                      {savedGrn.status || 'Saved'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400">Stock successfully updated in inventory & ledger recorded</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.open(`/purchases/grn/print/${savedGrn.id}`, '_blank')}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer"
                  title="Open exact SUPERPROMPT A4 Landscape GRN Print"
                >
                  <i className="fas fa-print"></i> 🖨 Print GRN (A4)
                </button>
                <button
                  type="button"
                  onClick={resetAndStartNew}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer"
                >
                  <i className="fas fa-plus"></i> + New Inward Entry
                </button>
                <button
                  type="button"
                  onClick={() => {
                    resetAndStartNew()
                    navigate('/purchases/grn')
                  }}
                  className="bg-slate-800 hover:bg-slate-700 text-white px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  View Inward List
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSavedGrn(null)
                    resetAndStartNew()
                  }}
                  className="text-slate-400 hover:text-white transition-colors w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/10"
                >
                  <i className="fas fa-times text-sm"></i>
                </button>
              </div>
            </div>

            {/* Printable Content (#grn-print-slip) */}
            <div className="p-6 overflow-y-auto print:p-0 print:m-0" id="grn-print-slip">
              <div className="space-y-5 text-slate-800 text-xs">
                {/* Top Company & GRN title */}
                <div className="border-b-2 border-slate-800 pb-4 flex justify-between items-start">
                  <div>
                    {company?.logo_path && (
                      <img
                        src={company.logo_path.startsWith('http') || company.logo_path.startsWith('/') ? company.logo_path : `/${company.logo_path}`}
                        alt="Logo"
                        className="h-12 mb-2 object-contain"
                      />
                    )}
                    <h1 className="text-2xl font-black text-slate-900 tracking-wide uppercase">
                      {company?.brand_name || 'NUTRIBRAY'}
                    </h1>
                    <p className="text-slate-500 mt-0.5">{company?.ho_address || 'Central Warehouse & Head Office'}</p>
                    {company?.gstin && (
                      <p className="text-slate-500">
                        GSTIN: <span className="font-mono font-bold text-slate-700">{company.gstin}</span>
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="inline-block bg-slate-900 text-white font-black text-sm px-3 py-1 rounded-md uppercase tracking-wider mb-2">
                      GOODS RECEIPT NOTE (GRN)
                    </div>
                    <p className="font-mono font-black text-base text-blue-700">{savedGrn.purchase_no}</p>
                    <p className="text-slate-500 mt-0.5">
                      Date: <span className="font-semibold text-slate-700">{fmt_date(savedGrn.created_at || savedGrn.invoice_date)}</span>
                    </p>
                  </div>
                </div>

                {/* Supplier & Invoice metadata */}
                <div className="grid grid-cols-2 gap-4 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                  <div>
                    <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Supplier Details</p>
                    <p className="font-bold text-sm text-slate-800 mt-0.5">{savedGrn.supplier_name}</p>
                    {savedGrn.supplier_details?.gst_number && (
                      <p className="text-slate-600 font-mono text-[11px] mt-0.5">
                        GSTIN: {savedGrn.supplier_details.gst_number}
                      </p>
                    )}
                    {savedGrn.supplier_details?.address && (
                      <p className="text-slate-500 text-[11px] mt-0.5">
                        {savedGrn.supplier_details.address}
                      </p>
                    )}
                    <p className="text-slate-500 mt-1">
                      Payment Mode: <span className="font-semibold uppercase">{savedGrn.payment_mode}</span>
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Vendor Bill & Destination</p>
                    <p className="font-mono font-bold text-sm text-slate-800 mt-0.5">
                      Invoice: {savedGrn.invoice_no || '—'}
                    </p>
                    <p className="text-slate-500 mt-1">
                      Invoice Date: <span className="font-semibold">{fmt_date(savedGrn.invoice_date)}</span>
                    </p>
                    <p className="text-slate-500 mt-1">
                      Location: <span className="font-semibold text-slate-800">{savedGrn.outlet_name || 'Central Warehouse'}</span>
                    </p>
                  </div>
                </div>

                {/* Items Table */}
                <table className="w-full text-left border border-slate-200 text-xs">
                  <thead className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200 uppercase text-[10px]">
                    <tr>
                      <th className="px-3 py-2 w-8">#</th>
                      <th className="px-3 py-2">Item Name & Code</th>
                      <th className="px-3 py-2 w-16 text-center">HSN</th>
                      <th className="px-3 py-2 w-14 text-center">Unit</th>
                      <th className="px-3 py-2 w-20 text-center">LP Date</th>
                      <th className="px-3 py-2 w-16 text-right">LP Qty</th>
                      <th className="px-3 py-2 w-16 text-right">Sales / LP</th>
                      <th className="px-3 py-2 w-20 text-right">Qty</th>
                      <th className="px-3 py-2 w-16 text-right">Free</th>
                      <th className="px-3 py-2 w-24 text-right">Rate (₹)</th>
                      <th className="px-3 py-2 w-16 text-center">GST %</th>
                      <th className="px-3 py-2 w-20 text-right">GST (₹)</th>
                      <th className="px-3 py-2 w-24 text-right font-bold">Total (₹)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(savedGrn.items || []).map((it: any, idx: number) => (
                      <tr key={it.id || idx}>
                        <td className="px-3 py-2 text-slate-400 font-mono">{idx + 1}</td>
                        <td className="px-3 py-2">
                          <span className="font-bold text-slate-800">{it.product_name}</span>
                          {it.product_code && (
                            <span className="text-slate-400 font-mono block text-[10px]">{it.product_code}</span>
                          )}
                          {it.batch_no && (
                            <span className="inline-block mt-0.5 px-1.5 py-0.2 rounded text-[10px] bg-amber-50 text-amber-800 border border-amber-200 font-mono">
                              Batch: {it.batch_no} {it.expiry_date ? `(Exp: ${it.expiry_date})` : ''}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-center font-mono text-slate-600">{it.hsn_code || '—'}</td>
                        <td className="px-3 py-2 text-center text-slate-600">{it.unit}</td>
                        <td className="px-3 py-2 text-center font-mono text-[11px] text-blue-700 font-medium">{it.lp_date || '—'}</td>
                        <td className="px-3 py-2 text-right font-mono text-blue-700">{it.lp_qty && it.lp_qty > 0 ? it.lp_qty : '—'}</td>
                        <td className="px-3 py-2 text-right font-mono text-orange-600">{it.sales_since_lp && it.sales_since_lp > 0 ? it.sales_since_lp : (it.sales_lp && it.sales_lp > 0 ? it.sales_lp : '—')}</td>
                        <td className="px-3 py-2 text-right font-mono font-bold text-slate-800">{it.qty}</td>
                        <td className="px-3 py-2 text-right font-mono text-slate-500">{it.free_qty || 0}</td>
                        <td className="px-3 py-2 text-right font-mono text-slate-600">{fmt(it.price)}</td>
                        <td className="px-3 py-2 text-center text-slate-600">{it.gst_percent}%</td>
                        <td className="px-3 py-2 text-right font-mono text-slate-600">{fmt(it.gst_amount)}</td>
                        <td className="px-3 py-2 text-right font-mono font-bold text-slate-900">{fmt(it.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-slate-50 border-t border-slate-200 font-semibold">
                    <tr>
                      <td colSpan={11} className="px-3 py-1.5 text-right text-slate-600">Subtotal:</td>
                      <td colSpan={2} className="px-3 py-1.5 text-right font-mono">{fmt(savedGrn.subtotal)}</td>
                    </tr>
                    {Number(savedGrn.discount || 0) > 0 && (
                      <tr>
                        <td colSpan={8} className="px-3 py-1.5 text-right text-slate-600">Discount:</td>
                        <td colSpan={2} className="px-3 py-1.5 text-right font-mono text-red-600">- {fmt(savedGrn.discount)}</td>
                      </tr>
                    )}
                    <tr>
                      <td colSpan={8} className="px-3 py-1.5 text-right text-slate-600">Total GST:</td>
                      <td colSpan={2} className="px-3 py-1.5 text-right font-mono text-orange-600">{fmt(savedGrn.total_gst)}</td>
                    </tr>
                    {Number(savedGrn.round_off || 0) !== 0 && (
                      <tr>
                        <td colSpan={8} className="px-3 py-1.5 text-right text-slate-600">Round Off:</td>
                        <td colSpan={2} className="px-3 py-1.5 text-right font-mono">{fmt(savedGrn.round_off)}</td>
                      </tr>
                    )}
                    <tr className="border-t-2 border-slate-800 text-slate-900 font-black text-sm">
                      <td colSpan={8} className="px-3 py-2 text-right">Grand Total:</td>
                      <td colSpan={2} className="px-3 py-2 text-right font-mono text-blue-700">{fmt(savedGrn.total_amount)}</td>
                    </tr>
                    <tr>
                      <td colSpan={8} className="px-3 py-1.5 text-right text-slate-600">Paid Amount:</td>
                      <td colSpan={2} className="px-3 py-1.5 text-right font-mono text-green-700">{fmt(savedGrn.paid_amount)}</td>
                    </tr>
                    <tr>
                      <td colSpan={8} className="px-3 py-1.5 text-right text-slate-600">Due Balance:</td>
                      <td colSpan={2} className={`px-3 py-1.5 text-right font-mono ${Number(savedGrn.due_amount) > 0 ? 'text-red-600' : 'text-slate-700'}`}>
                        {fmt(savedGrn.due_amount)}
                      </td>
                    </tr>
                  </tfoot>
                </table>

                {/* Signatures */}
                <div className="pt-8 grid grid-cols-3 gap-6 text-center text-slate-500 text-xs">
                  <div className="border-t border-slate-300 pt-2 font-medium">Received By (Store In-charge)</div>
                  <div className="border-t border-slate-300 pt-2 font-medium">Quality & Qty Verified By</div>
                  <div className="border-t border-slate-300 pt-2 font-medium">Authorized Signatory</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── BATCH ALLOCATION WINDOW / MODAL ── */}
      {batchModalRowIndex !== null && rows[batchModalRowIndex] && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-300 w-full max-w-3xl flex flex-col max-h-[90vh] overflow-hidden animate-in fade-in duration-150">
            {/* Modal Header */}
            <div className="bg-blue-800 text-white px-5 py-3.5 flex justify-between items-center">
              <div className="flex items-center gap-2.5">
                <span className="bg-white/20 text-white w-8 h-8 rounded-lg flex items-center justify-center text-sm">
                  <i className="fas fa-boxes-stacked"></i>
                </span>
                <div>
                  <h3 className="font-bold text-base tracking-wide flex items-center gap-2">
                    Batch &amp; Expiry Allocation
                    <span className="bg-blue-600 text-white text-[10px] px-2 py-0.5 rounded-full font-mono uppercase">
                      Multiple Lots
                    </span>
                  </h3>
                  <div className="text-xs text-blue-100 flex items-center gap-2 mt-0.5">
                    <span className="font-semibold text-white">{rows[batchModalRowIndex].product_name}</span>
                    <span>•</span>
                    <span className="font-mono">Code: {rows[batchModalRowIndex].item_code || '—'}</span>
                    {rows[batchModalRowIndex].shelf_life_days ? (
                      <>
                        <span>•</span>
                        <span className="bg-blue-900/60 px-1.5 py-0.5 rounded text-[11px]">
                          Shelf Life: {rows[batchModalRowIndex].shelf_life_days} Days
                        </span>
                      </>
                    ) : null}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={closeBatchModal}
                className="text-blue-200 hover:text-white text-lg w-8 h-8 rounded-lg hover:bg-white/10 flex items-center justify-center transition-colors cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Instruction banner */}
            <div className="bg-amber-50 border-b border-amber-200 px-5 py-2.5 text-xs text-amber-900 flex items-start gap-2">
              <i className="fas fa-info-circle text-amber-600 mt-0.5 shrink-0"></i>
              <div>
                When 2 or more batches arrive in 1 GRN for this product, enter each lot with its <strong>Batch No</strong>, <strong>Mfg Date</strong>, <strong>Expiry Date</strong>, and <strong>Quantity</strong>. The total quantity will automatically update this line item and appear consolidated on your GRN print slip.
              </div>
            </div>

            {/* Sub-batches table */}
            <div className="p-5 overflow-y-auto flex-1">
              <table className="w-full border-collapse border border-slate-300 text-xs">
                <thead>
                  <tr className="bg-slate-100 text-slate-700 font-bold uppercase text-[10px] border-b border-slate-300">
                    <th className="p-2 border-r border-slate-300 text-center w-10">#</th>
                    <th className="p-2 border-r border-slate-300 text-left">Batch / Lot No *</th>
                    <th className="p-2 border-r border-slate-300 text-left w-36">Mfg Date</th>
                    <th className="p-2 border-r border-slate-300 text-left w-36">Expiry Date *</th>
                    <th className="p-2 border-r border-slate-300 text-right w-24">Pur Qty *</th>
                    <th className="p-2 border-r border-slate-300 text-right w-20">Free Qty</th>
                    <th className="p-2 border-r border-slate-300 text-right w-20">Tot Units</th>
                    <th className="p-2 text-center w-12">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {modalBatches.map((b, bIdx) => {
                    const todayStr = new Date().toISOString().split('T')[0]
                    const isExpired = b.expiry_date && b.expiry_date < todayStr
                    const isBeforeMfg = b.mfg_date && b.expiry_date && b.expiry_date <= b.mfg_date
                    return (
                      <tr key={bIdx} className="border-b border-slate-200 hover:bg-blue-50/40">
                        <td className="p-2 text-center text-slate-500 font-bold border-r border-slate-200">
                          {bIdx + 1}
                        </td>
                        <td className="p-1 border-r border-slate-200">
                          <input
                            type="text"
                            placeholder="e.g. B2401, LOT-890"
                            value={b.batch_no || ''}
                            onChange={e => handleModalBatchChange(bIdx, 'batch_no', e.target.value.toUpperCase())}
                            className="w-full h-7 px-2 border border-slate-300 rounded font-mono font-semibold text-slate-800 uppercase focus:border-blue-600 focus:outline-hidden"
                            autoFocus={bIdx === 0}
                          />
                        </td>
                        <td className="p-1 border-r border-slate-200">
                          <input
                            type="date"
                            value={b.mfg_date || ''}
                            onChange={e => handleModalMfgChange(bIdx, e.target.value)}
                            className="w-full h-7 px-2 border border-slate-300 rounded text-slate-700 focus:border-blue-600 focus:outline-hidden"
                          />
                        </td>
                        <td className={`p-1 border-r border-slate-200 ${isExpired || isBeforeMfg ? 'bg-red-50' : ''}`}>
                          <input
                            type="date"
                            value={b.expiry_date || ''}
                            onChange={e => handleModalBatchChange(bIdx, 'expiry_date', e.target.value)}
                            className={`w-full h-7 px-2 border rounded focus:outline-hidden ${
                              isExpired || isBeforeMfg
                                ? 'border-red-500 text-red-600 font-bold'
                                : 'border-slate-300 text-slate-800'
                            }`}
                          />
                          {isExpired && (
                            <span className="text-[9px] text-red-600 font-bold block mt-0.5">⚠️ Date in past!</span>
                          )}
                          {isBeforeMfg && !isExpired && (
                            <span className="text-[9px] text-red-600 font-bold block mt-0.5">⚠️ Must be &gt; Mfg!</span>
                          )}
                        </td>
                        <td className="p-1 border-r border-slate-200">
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={b.qty}
                            onChange={e => handleModalBatchChange(bIdx, 'qty', parseFloat(e.target.value) || 0)}
                            className="w-full h-7 px-2 border border-slate-300 rounded text-right font-bold text-blue-900 focus:border-blue-600 focus:outline-hidden"
                          />
                        </td>
                        <td className="p-1 border-r border-slate-200">
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={b.free_qty}
                            onChange={e => handleModalBatchChange(bIdx, 'free_qty', parseFloat(e.target.value) || 0)}
                            className="w-full h-7 px-2 border border-slate-300 rounded text-right font-bold text-emerald-700 focus:border-emerald-600 focus:outline-hidden"
                          />
                        </td>
                        <td className="p-2 text-right font-bold text-slate-800 border-r border-slate-200">
                          {(Number(b.qty || 0) + Number(b.free_qty || 0))}
                        </td>
                        <td className="p-1 text-center">
                          <button
                            type="button"
                            onClick={() => removeModalBatchRow(bIdx)}
                            disabled={modalBatches.length <= 1}
                            className={`p-1.5 rounded transition-colors ${
                              modalBatches.length <= 1
                                ? 'text-slate-300 cursor-not-allowed'
                                : 'text-red-500 hover:text-red-700 hover:bg-red-50 cursor-pointer'
                            }`}
                            title={modalBatches.length <= 1 ? 'At least one lot is required' : 'Remove lot'}
                          >
                            <i className="fas fa-trash-alt"></i>
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>

              <div className="mt-3 flex justify-between items-center">
                <button
                  type="button"
                  onClick={addModalBatchRow}
                  className="bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-300 px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <i className="fas fa-plus"></i> + Add Another Batch
                </button>
                <div className="text-xs text-slate-500 italic">
                  Tip: Auto-expiry calculates from Shelf Life when Mfg Date is entered.
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="bg-slate-50 border-t border-slate-200 px-5 py-3 flex justify-between items-center">
              <div className="flex items-center gap-4 text-xs">
                <span className="text-slate-500">
                  Total Batches: <strong className="text-slate-800">{modalBatches.length}</strong>
                </span>
                <span className="text-slate-500">
                  Pur Qty: <strong className="text-blue-700">{modalBatches.reduce((s, b) => s + Number(b.qty || 0), 0)}</strong>
                </span>
                <span className="text-slate-500">
                  Free Qty: <strong className="text-emerald-700">{modalBatches.reduce((s, b) => s + Number(b.free_qty || 0), 0)}</strong>
                </span>
                <span className="bg-blue-100 text-blue-900 font-bold px-2 py-0.5 rounded">
                  Total Units: {modalBatches.reduce((s, b) => s + Number(b.qty || 0) + Number(b.free_qty || 0), 0)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={closeBatchModal}
                  className="px-4 py-1.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={applyModalBatches}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
                >
                  <i className="fas fa-check"></i> Apply &amp; Update Row
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

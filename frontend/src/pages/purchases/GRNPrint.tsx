import React, { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { purchases_api, type purchase_detail } from '../../api/purchases'
import { getCompanySettings, type CompanySettings } from '../../api/company'

export default function GRNPrint() {
  const { id } = useParams<{ id: string }>()
  const [grn, setGrn] = useState<purchase_detail | any | null>(null)
  const [company, setCompany] = useState<CompanySettings | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) return
    Promise.all([
      purchases_api.get_grn(Number(id)),
      getCompanySettings().catch(() => null),
    ])
      .then(([grnRes, compRes]) => {
        setGrn(grnRes.data)
        if (compRes) setCompany(compRes)
      })
      .catch(err => {
        console.error('Failed to load GRN print details:', err)
      })
      .finally(() => setLoading(false))
  }, [id])

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', fontFamily: 'sans-serif', color: '#666' }}>
        <i className="fas fa-spinner fa-spin" style={{ marginRight: '8px' }}></i> Loading Goods Receipt Note #{id}…
      </div>
    )
  }

  if (!grn) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', fontFamily: 'sans-serif', color: '#c00' }}>
        GRN #{id} not found or could not be loaded.
      </div>
    )
  }

  /* ── 1. Formatters ──────────────────────────────────────────────────────── */
  const fmt = (num: number | undefined | null) =>
    Number(num || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const fmtDate = (d: string | null | undefined) => {
    if (!d || d.startsWith('0000-00-00')) return '-'
    try {
      const dt = new Date(d)
      if (isNaN(dt.getTime())) return d
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
      const day = String(dt.getDate()).padStart(2, '0')
      const mon = months[dt.getMonth()]
      const yr = dt.getFullYear()
      return `${day}-${mon}-${yr}`
    } catch {
      return '-'
    }
  }

  /* ── 2. Line Item Calculations (Consolidated by Product & Cost) ────────── */
  const rawItems = grn.items || []
  let t_pur_qty = 0
  let t_free_qty = 0
  let t_tot_qty = 0
  let t_disc = 0
  let t_cp_value = 0
  let t_mrp_value = 0
  let t_gst = 0
  let t_lp_qty = 0
  let t_sales_lp = 0

  interface ConsolidatedLine {
    item_code: string
    barcode?: string
    name: string
    hsn: string
    pur_qty: number
    free_qty: number
    tot_qty: number
    basic_cp: number
    gst_pct: number
    disc_pct: number
    cp: number
    cp_value: number
    mrp: number
    margin_cp: number
    margin_mrp: number
    fixed_margin: number
    total_value: number
    taxable: number
    gst_amt: number
    lp_date: string
    lp_qty: number
    sales_lp: number
    batches: Array<{
      batch_no?: string
      mfg_date?: string
      expiry_date?: string
      qty: number
      free_qty: number
    }>
  }

  const groupMap: { [key: string]: ConsolidatedLine } = {}
  const groupKeys: string[] = []

  rawItems.forEach((it: any) => {
    const pur_qty = Number(it.qty || 0)
    const free_qty = Number(it.free_qty || 0)
    const tot_qty = pur_qty + free_qty

    const basic_cp = Number(it.price || 0) // per unit cost excl GST
    const disc_val = Number(it.disc_val || 0)
    const disc_pct = it.disc_type === '%' ? disc_val : (basic_cp > 0 ? (disc_val / basic_cp) * 100 : 0)

    const cp = basic_cp * (1 - disc_pct / 100) // net unit cost excl GST
    const cp_value = pur_qty * cp // free qty is NOT charged
    const taxable = cp_value
    const gst_pct = Number(it.gst_percent || 0)
    const gst_amt = taxable * (gst_pct / 100)

    const mrp = Number(it.mrp || 0)
    const mrp_value = tot_qty * mrp
    const margin_cp = cp > 0 && mrp > 0 ? ((mrp - cp) / cp) * 100 : 0
    const margin_mrp = mrp > 0 ? ((mrp - cp) / mrp) * 100 : 0
    const fixed_margin = 0
    const total_value = cp_value

    const lp_date = it.lp_date || '-'
    const lp_qty = Number(it.lp_qty || 0)
    const sales_lp = Number(it.sales_since_lp || it.sales_lp || 0)
    const barcode = it.barcode || ''

    t_pur_qty += pur_qty
    t_free_qty += free_qty
    t_tot_qty += tot_qty
    t_disc += (basic_cp * disc_pct / 100) * pur_qty
    t_cp_value += cp_value
    t_mrp_value += mrp_value
    t_gst += gst_amt

    // Group key based on product ID/code + unit purchase price + MRP
    const pKey = `${it.product_id || it.product_code || it.item_code}_${basic_cp}_${mrp}_${gst_pct}`

    if (!groupMap[pKey]) {
      groupKeys.push(pKey)
      groupMap[pKey] = {
        item_code: it.product_code || it.item_code || '-',
        barcode,
        name: it.product_name || `Item #${it.product_id}`,
        hsn: it.hsn_code || '-',
        pur_qty,
        free_qty,
        tot_qty,
        basic_cp,
        gst_pct,
        disc_pct,
        cp,
        cp_value,
        mrp,
        margin_cp,
        margin_mrp,
        fixed_margin,
        total_value,
        taxable,
        gst_amt,
        lp_date,
        lp_qty,
        sales_lp,
        batches: []
      }
      if (lp_date !== '-') {
        t_lp_qty += lp_qty
        t_sales_lp += sales_lp
      }
    } else {
      const g = groupMap[pKey]
      g.pur_qty += pur_qty
      g.free_qty += free_qty
      g.tot_qty += tot_qty
      g.cp_value += cp_value
      g.total_value += cp_value
      g.taxable += taxable
      g.gst_amt += gst_amt
    }

    if (it.batch_no || it.mfg_date || it.expiry_date) {
      groupMap[pKey].batches.push({
        batch_no: it.batch_no,
        mfg_date: it.mfg_date,
        expiry_date: it.expiry_date,
        qty: pur_qty,
        free_qty,
      })
    }
  })

  const lines = groupKeys.map((k, idx) => ({
    sl: idx + 1,
    ...groupMap[k]
  }))

  const t_margin_amount = t_mrp_value - t_cp_value
  const t_margin_cp = t_cp_value > 0 ? (t_margin_amount / t_cp_value) * 100 : 0
  const t_margin_mrp = t_mrp_value > 0 ? (t_margin_amount / t_mrp_value) * 100 : 0

  /* ── 3. GST Breakdown Calculations ──────────────────────────────────────── */
  const compGstin = (company?.gstin || '').trim()
  const supDetails = grn.supplier_details || {}
  const supGstin = (supDetails.gst_number || supDetails.gstin || '').trim()
  const compState = compGstin.substring(0, 2)
  const supState = supGstin.substring(0, 2)
  const isInterState = compState && supState && compState !== supState

  const gstRatesMap: { [rate: number]: { taxable: number; amt: number } } = {}
  let s_tax_free = 0

  lines.forEach(l => {
    if (l.gst_pct === 0) {
      s_tax_free += l.taxable
    } else {
      if (!gstRatesMap[l.gst_pct]) {
        gstRatesMap[l.gst_pct] = { taxable: 0, amt: 0 }
      }
      gstRatesMap[l.gst_pct].taxable += l.taxable
      gstRatesMap[l.gst_pct].amt += l.gst_amt
    }
  })

  let s_igst_taxable = 0
  let s_igst_amt = 0
  let s_cgst_taxable = 0
  let s_cgst_amt = 0
  let s_sgst_taxable = 0
  let s_sgst_amt = 0

  const sortedRates = Object.keys(gstRatesMap).map(Number).sort((a, b) => a - b)
  const gst_rows = sortedRates.map(rate => {
    const data = gstRatesMap[rate]
    if (isInterState) {
      s_igst_taxable += data.taxable
      s_igst_amt += data.amt
      return {
        rate,
        igst_pct: rate,
        igst_taxable: data.taxable,
        igst_amt: data.amt,
        cgst_pct: 0,
        cgst_taxable: 0,
        cgst_amt: 0,
        sgst_pct: 0,
        sgst_taxable: 0,
        sgst_amt: 0,
        tax_free: 0,
      }
    } else {
      const halfRate = rate / 2
      const halfAmt = data.amt / 2
      s_cgst_taxable += data.taxable
      s_cgst_amt += halfAmt
      s_sgst_taxable += data.taxable
      s_sgst_amt += halfAmt
      return {
        rate,
        igst_pct: 0,
        igst_taxable: 0,
        igst_amt: 0,
        cgst_pct: halfRate,
        cgst_taxable: data.taxable,
        cgst_amt: halfAmt,
        sgst_pct: halfRate,
        sgst_taxable: data.taxable,
        sgst_amt: halfAmt,
        tax_free: 0,
      }
    }
  })

  /* ── 4. Summary Totals ─────────────────────────────────────────────────── */
  const billDiscount = Number(grn.discount || 0)
  const roundOff = Number(grn.round_off || 0)
  const otherCharges = 0
  const grandTotal = Number(grn.total_amount != null ? grn.total_amount : (t_cp_value + t_gst - billDiscount + roundOff))

  // Shipping Address (Receiving Outlet or Central HO)
  const outletDetails = grn.outlet_details || {}
  const shipName = grn.outlet_name || company?.brand_name || 'NUTRIBRAY CENTRAL WAREHOUSE'
  const shipAddress = [
    outletDetails.address || company?.ho_address || 'Central Warehouse & Head Office',
    outletDetails.city || company?.ho_city,
    outletDetails.state || company?.company_state,
  ].filter(Boolean).join(', ')

  // Supplier Address
  const supplierAddress = [
    supDetails.address,
    supDetails.city,
    supDetails.state,
    supDetails.pincode ? `Pin: ${supDetails.pincode}` : '',
  ].filter(Boolean).join(', ')

  return (
    <div className="grn-print-page">
      <style>{`
        @page { size: A4 landscape; margin: 15mm; }
        body {
          font-family: "Segoe UI", Arial, sans-serif !important;
          font-size: 11px !important;
          color: #333 !important;
          margin: 0 !important;
          background: #fff !important;
          line-height: 1.4 !important;
        }
        .header-table { width: 100%; margin-bottom: 15px; border-bottom: 2px solid #0055a5; padding-bottom: 10px; border-collapse: collapse; }
        .company-name { font-size: 22px; font-weight: bold; color: #0055a5; margin-bottom: 4px; text-transform: uppercase; letter-spacing: .5px; }
        .company-address { font-size: 12px; color: #555; margin-bottom: 2px; }
        .company-contact { font-size: 12px; font-weight: bold; color: #333; }
        .doc-title-right { text-align: right; vertical-align: bottom; }
        .doc-title-text { font-size: 20px; font-weight: bold; text-transform: uppercase; color: #0055a5; letter-spacing: 1px; margin-bottom: 5px; }
        .status-table { width: auto; float: right; font-size: 11px; border-collapse: collapse; }
        .status-table td { padding: 2px 10px; border: 1px solid #ddd; }
        .status-table td:first-child { background: #f4f7f6; font-weight: bold; color: #0055a5; }
        .info-grid { display: table; width: 100%; font-size: 11px; margin-bottom: 15px; border-collapse: collapse; }
        .info-col { display: table-cell; vertical-align: top; width: 33%; padding: 10px; border: 1px solid #ddd; border-right: none; }
        .info-col:last-child { border-right: 1px solid #ddd; background: #fbfdfc; }
        .info-label-blue { font-size: 12px; font-weight: bold; color: #0055a5; margin-bottom: 8px; text-transform: uppercase; border-bottom: 1px solid #eee; padding-bottom: 3px; }
        .info-row-table { width: 100%; border-collapse: collapse; }
        .info-row-table td { padding: 3px 0; border-bottom: 1px dashed #eee; }
        .info-row-table tr:last-child td { border-bottom: none; }
        .info-row-table td:first-child { color: #555; font-weight: bold; width: 45%; }
        .info-row-table td:last-child { font-weight: bold; color: #000; text-align: right; }
        .auth-bar { display: flex; justify-content: space-between; font-size: 11px; font-weight: bold; margin: 15px 0 10px; padding: 6px 15px; background: #f4f7f6; border: 1px solid #ddd; border-radius: 3px; }
        .items-tbl { width: 100%; border-collapse: collapse; font-size: 10px; margin-bottom: 20px; }
        .items-tbl thead { display: table-header-group; }
        .items-tbl th, .items-tbl td { padding: 6px 4px; border: 1px solid #ddd; text-align: center; }
        .items-tbl th { background: #0055a5 !important; color: #fff !important; font-weight: bold; vertical-align: middle; text-transform: uppercase; font-size: 9px; letter-spacing: .5px; }
        .items-tbl tbody tr:nth-child(even) { background: #f9f9f9; }
        .items-tbl .l { text-align: left; } .items-tbl .r { text-align: right; }
        .items-tbl .green { color: #008000; font-weight: bold; }
        .tot-row td { font-weight: bold; background: #f4f7f6; border-top: 2px solid #aaa; border-bottom: 2px solid #aaa; color: #000; font-size: 11px; }
        .bottom-sections { display: flex; justify-content: space-between; margin-top: 10px; gap: 20px; }
        .gst-wrap { width: 65%; }
        .gst-title { font-size: 13px; font-weight: bold; margin-bottom: 8px; color: #0055a5; text-transform: uppercase; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
        .gst-tbl { width: 100%; border-collapse: collapse; font-size: 10px; }
        .gst-tbl th, .gst-tbl td { padding: 5px 4px; border: 1px solid #ddd; text-align: center; }
        .gst-tbl th { background: #f4f7f6; color: #333; font-weight: bold; }
        .gst-tbl .tot-row td { background: #eef2f5; }
        .summary-wrap { width: 33%; font-size: 11px; border: 1px solid #ddd; border-radius: 4px; overflow: hidden; }
        .summary-tbl { width: 100%; border-collapse: collapse; }
        .summary-tbl td { padding: 5px 10px; border-bottom: 1px solid #eee; text-align: right; font-weight: bold; }
        .summary-tbl tr:nth-child(even) { background: #fcfcfc; }
        .summary-tbl td:first-child { color: #555; text-align: left; font-weight: normal; }
        .grand-tot { font-size: 14px; background: #0055a5 !important; }
        .grand-tot td { color: #fff !important; font-weight: bold; padding: 8px 10px; border: none; }
        .footer-sigs { display: flex; justify-content: space-between; font-size: 11px; margin-top: 50px; }
        .sig-line { border-top: 1px dashed #777; width: 150px; margin: 50px auto 0; padding-top: 5px; font-weight: bold; color: #333; text-align: center; }
        .btn-bar { padding: 12px 20px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; margin-bottom: 20px; text-align: center; }
        .btn-bar button { padding: 6px 20px; cursor: pointer; background: #0055a5; color: #fff; border: none; border-radius: 4px; font-weight: bold; margin: 0 5px; font-size: 12px; }
        .btn-bar button.btn-close { background: #fff; color: #333; border: 1px solid #ccc; }
        @media print {
          .no-print { display: none !important; }
          body { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          .items-tbl th, .grand-tot { background: #0055a5 !important; color: #fff !important; }
          tr { page-break-inside: avoid; }
        }
      `}</style>

      {/* ── Screen Button Bar ── */}
      <div className="no-print btn-bar">
        <button onClick={() => window.print()}>🖨 Print GRN</button>
        <button className="btn-close" onClick={() => window.close()}>✕ Close</button>
      </div>

      {/* ── 1. Header ── */}
      <table className="header-table">
        <tbody>
          <tr>
            <td style={{ verticalAlign: 'top' }}>
              <div className="company-name">{company?.brand_name || 'NUTRIBRAY'}</div>
              <div className="company-address">
                {[company?.ho_address || 'Central Warehouse', company?.ho_city, `${company?.company_state || ''}-${company?.ho_pincode || ''}`].filter(Boolean).join(', ')}
              </div>
              <div className="company-contact">
                Phone: {company?.ho_phone || '-'} &nbsp;|&nbsp; GSTIN: {company?.gstin || '-'}
              </div>
            </td>
            <td className="doc-title-right">
              <div className="doc-title-text">GOODS RECEIPT NOTE</div>
              <table className="status-table">
                <tbody>
                  <tr>
                    <td>GRN STATUS</td>
                    <td style={{ textTransform: 'capitalize' }}>{grn.status || 'Updated'}</td>
                  </tr>
                  <tr>
                    <td>AUTHORIZE STATUS</td>
                    <td>{grn.status === 'draft' ? 'False' : 'True'}</td>
                  </tr>
                </tbody>
              </table>
            </td>
          </tr>
        </tbody>
      </table>

      {/* ── 2. Info Grid ── */}
      <div className="info-grid">
        {/* Box 1: Shipping Address */}
        <div className="info-col">
          <div className="info-label-blue">Shipping Address</div>
          <div style={{ fontSize: '12px', fontWeight: 'bold', marginBottom: '4px', textTransform: 'uppercase' }}>
            {shipName}
          </div>
          <div style={{ color: '#555', lineHeight: 1.5 }}>{shipAddress}</div>
        </div>

        {/* Box 2: Supplier Name & Address */}
        <div className="info-col">
          <div className="info-label-blue">Supplier Name &amp; Address</div>
          <div style={{ fontSize: '12px', fontWeight: 'bold', marginBottom: '4px' }}>
            {grn.supplier_name}
          </div>
          <div style={{ color: '#555', lineHeight: 1.5 }}>
            {supplierAddress || 'Address on file'}
            <br />
            <strong>GSTIN:</strong> {supGstin || '-'}
          </div>
        </div>

        {/* Box 3: Key/Value Metadata */}
        <div className="info-col">
          <table className="info-row-table">
            <tbody>
              <tr>
                <td>GRN No</td>
                <td>{grn.purchase_no}</td>
              </tr>
              <tr>
                <td>GRN Date</td>
                <td>{fmtDate(grn.created_at || grn.invoice_date)}</td>
              </tr>
              <tr>
                <td>Invoice No</td>
                <td>{grn.invoice_no || '-'}</td>
              </tr>
              <tr>
                <td>Invoice Date</td>
                <td>{fmtDate(grn.invoice_date)}</td>
              </tr>
              <tr>
                <td>Receipt No</td>
                <td>{grn.receipt_no || '-'}</td>
              </tr>
              <tr>
                <td>Credit Days</td>
                <td>{grn.credit_days || '-'}</td>
              </tr>
              <tr>
                <td>PO Number</td>
                <td>{grn.po_no || '-'}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* ── 3. Authorisation Bar ── */}
      <div className="auth-bar">
        <div><span style={{ color: '#555' }}>User Id:</span> {grn.created_by || 'Admin'}</div>
        <div><span style={{ color: '#555' }}>Authorize By:</span> {grn.status === 'draft' ? '-' : (grn.authorized_by || 'Store Manager')}</div>
        <div><span style={{ color: '#555' }}>Authorize Date:</span> {grn.status === 'draft' ? '-' : fmtDate(grn.updated_at || grn.created_at)}</div>
      </div>

      {/* ── 4. Items Table ── */}
      <table className="items-tbl">
        <thead>
          <tr>
            <th style={{ width: '2.5%' }}>Sl<br />No</th>
            <th className="l" style={{ width: '8%' }}>Item Code</th>
            <th className="l" style={{ width: '16%' }}>Description</th>
            <th style={{ width: '5.5%' }}>HSN<br />Code</th>
            <th className="r" style={{ width: '4.5%' }}>Basic<br />CP *</th>
            <th className="r" style={{ width: '3.5%' }}>GST %</th>
            <th className="r" style={{ width: '3.5%' }}>Disc%</th>
            <th className="r" style={{ width: '4.5%' }}>CP *</th>
            <th className="r" style={{ width: '4.5%' }}>MRP</th>
            <th className="r" style={{ width: '4.5%' }}>Margin<br />CP *</th>
            <th className="r" style={{ width: '4.5%' }}>Margin<br />MRP</th>
            <th style={{ width: '6.5%' }}>LP<br />Date</th>
            <th className="r" style={{ width: '4.5%' }}>LP<br />Qty</th>
            <th className="r" style={{ width: '4.5%' }}>Sales<br />/ LP</th>
            <th className="r" style={{ width: '4.5%' }}>Pur<br />Qty</th>
            <th className="r" style={{ width: '4%' }}>Free<br />Qty</th>
            <th className="r" style={{ width: '4.5%' }}>Tot<br />Qty</th>
            <th className="r" style={{ width: '5.5%' }}>CP<br />Value</th>
            <th className="r" style={{ width: '7%' }}>Total<br />Value</th>
          </tr>
        </thead>
        <tbody>
          {lines.map(l => (
            <tr key={l.sl}>
              <td>{l.sl}</td>
              <td className="l">
                <div>{l.item_code}</div>
                {l.barcode && <div style={{ fontSize: '7pt', color: '#777', fontFamily: 'monospace' }}>{l.barcode}</div>}
              </td>
              <td className="l">
                <strong>{l.name}</strong>
                {l.batches && l.batches.length > 0 && (
                  <div style={{ fontSize: '7.5pt', color: '#444', marginTop: '2px' }}>
                    {l.batches.length === 1 ? (
                      <div>
                        {l.batches[0].batch_no && <span>Batch: <b>{l.batches[0].batch_no}</b> </span>}
                        {l.batches[0].mfg_date && <span>Mfg: {l.batches[0].mfg_date} </span>}
                        {l.batches[0].expiry_date && <span>Exp: <b>{l.batches[0].expiry_date}</b></span>}
                      </div>
                    ) : (
                      <div style={{ background: '#f8fafc', padding: '2px 5px', borderLeft: '2px solid #0055a5', marginTop: '2px', borderRadius: '1px' }}>
                        <div style={{ fontWeight: 'bold', color: '#0055a5', fontSize: '7pt', marginBottom: '1px' }}>
                          📦 {l.batches.length} BATCHES RECEIVED:
                        </div>
                        {l.batches.map((b, bIdx) => (
                          <div key={bIdx} style={{ fontSize: '7.5pt', lineHeight: 1.3 }}>
                            • Lot/Batch: <b>{b.batch_no || '—'}</b> &nbsp;|&nbsp; Qty: <b>{b.qty}</b>{b.free_qty > 0 ? ` (+${b.free_qty} free)` : ''}
                            {b.expiry_date && <span style={{ color: '#b91c1c' }}> &nbsp;|&nbsp; Exp: <b>{b.expiry_date}</b></span>}
                            {b.mfg_date && <span style={{ color: '#666' }}> &nbsp;|&nbsp; Mfg: {b.mfg_date}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </td>
              <td>{l.hsn}</td>
              <td className="r">{fmt(l.basic_cp)}</td>
              <td className="r">{l.gst_pct}%</td>
              <td className="r">{fmt(l.disc_pct)}%</td>
              <td className="r">{fmt(l.cp)}</td>
              <td className="r">{fmt(l.mrp)}</td>
              <td className="r">{fmt(l.margin_cp)}%</td>
              <td className="r green">{fmt(l.margin_mrp)}%</td>
              <td style={{ color: l.lp_date !== '-' ? '#2563eb' : '#888', fontWeight: l.lp_date !== '-' ? 'bold' : 'normal', fontSize: '9px' }}>
                {l.lp_date !== '-' ? l.lp_date : '—'}
              </td>
              <td className="r" style={{ color: l.lp_date !== '-' ? '#2563eb' : '#888', fontWeight: l.lp_date !== '-' ? 'bold' : 'normal' }}>
                {l.lp_date !== '-' ? (l.lp_qty > 0 ? l.lp_qty : '0') : '—'}
              </td>
              <td className="r" style={{ color: l.lp_date !== '-' ? '#ea580c' : '#888', fontWeight: l.lp_date !== '-' ? 'bold' : 'normal' }}>
                {l.lp_date !== '-' ? (l.sales_lp > 0 ? l.sales_lp : '0') : '—'}
              </td>
              <td className="r">{fmt(l.pur_qty)}</td>
              <td className="r">{fmt(l.free_qty)}</td>
              <td className="r" style={{ fontWeight: 'bold' }}>{fmt(l.tot_qty)}</td>
              <td className="r">{fmt(l.cp_value)}</td>
              <td className="r" style={{ fontWeight: 'bold', color: '#0055a5' }}>{fmt(l.total_value)}</td>
            </tr>
          ))}
          {/* Total Row */}
          <tr className="tot-row">
            <td colSpan={11} className="r" style={{ paddingRight: '10px' }}>TOTAL</td>
            <td></td>
            <td className="r" style={{ color: '#2563eb' }}>{t_lp_qty > 0 ? t_lp_qty : '—'}</td>
            <td className="r" style={{ color: '#ea580c' }}>{t_sales_lp > 0 ? t_sales_lp : '—'}</td>
            <td className="r">{fmt(t_pur_qty)}</td>
            <td className="r">{fmt(t_free_qty)}</td>
            <td className="r">{fmt(t_tot_qty)}</td>
            <td className="r">{fmt(t_cp_value)}</td>
            <td className="r" style={{ color: '#0055a5' }}>{fmt(t_cp_value)}</td>
          </tr>
        </tbody>
      </table>

      {/* ── 5. Bottom Area ── */}
      <div className="bottom-sections">
        {/* Left: GST Details Breakdown */}
        <div className="gst-wrap">
          <div className="gst-title">GST Details Breakdown</div>
          <table className="gst-tbl">
            <thead>
              <tr>
                <th>TAX<br />%</th>
                <th>IGST<br />%</th>
                <th>IGST<br />TAXABLE</th>
                <th>IGST<br />AMT</th>
                <th>CGST<br />%</th>
                <th>CGST<br />TAXABLE</th>
                <th>CGST<br />AMT</th>
                <th>SGST<br />%</th>
                <th>SGST<br />TAXABLE</th>
                <th>SGST<br />AMT</th>
                <th>TAX<br />FREE<br />PUR</th>
              </tr>
            </thead>
            <tbody>
              {gst_rows.map(g => (
                <tr key={g.rate}>
                  <td style={{ fontWeight: 'bold' }}>GST {g.rate}%</td>
                  <td>{g.igst_pct ? `${g.igst_pct}%` : '-'}</td>
                  <td>{g.igst_taxable ? fmt(g.igst_taxable) : '-'}</td>
                  <td>{g.igst_amt ? fmt(g.igst_amt) : '-'}</td>
                  <td>{g.cgst_pct ? `${g.cgst_pct}%` : '-'}</td>
                  <td>{g.cgst_taxable ? fmt(g.cgst_taxable) : '-'}</td>
                  <td>{g.cgst_amt ? fmt(g.cgst_amt) : '-'}</td>
                  <td>{g.sgst_pct ? `${g.sgst_pct}%` : '-'}</td>
                  <td>{g.sgst_taxable ? fmt(g.sgst_taxable) : '-'}</td>
                  <td>{g.sgst_amt ? fmt(g.sgst_amt) : '-'}</td>
                  <td>{g.tax_free ? fmt(g.tax_free) : '-'}</td>
                </tr>
              ))}
              <tr className="tot-row">
                <td style={{ color: '#0055a5' }}>Grand<br />Total</td>
                <td></td>
                <td>{s_igst_taxable ? fmt(s_igst_taxable) : '0.00'}</td>
                <td style={{ color: '#0055a5' }}>{s_igst_amt ? fmt(s_igst_amt) : '0.00'}</td>
                <td></td>
                <td>{s_cgst_taxable ? fmt(s_cgst_taxable) : '0.00'}</td>
                <td style={{ color: '#0055a5' }}>{s_cgst_amt ? fmt(s_cgst_amt) : '0.00'}</td>
                <td></td>
                <td>{s_sgst_taxable ? fmt(s_sgst_taxable) : '0.00'}</td>
                <td style={{ color: '#0055a5' }}>{s_sgst_amt ? fmt(s_sgst_amt) : '0.00'}</td>
                <td>{fmt(s_tax_free)}</td>
              </tr>
            </tbody>
          </table>

          <div style={{ marginTop: '30px', fontWeight: 'bold', color: '#555', fontSize: '10px' }}>
            NOTE : All quantities are subject to final QC inspection.
          </div>

          <div className="footer-sigs">
            <div><div className="sig-line">Prepared By</div></div>
            <div><div className="sig-line">Checked By</div></div>
            <div><div className="sig-line">Store Operation</div></div>
          </div>
        </div>

        {/* Right: Summary Box */}
        <div className="summary-wrap">
          <table className="summary-tbl">
            <tbody>
              <tr>
                <td>Purchase Value</td>
                <td>{fmt(t_cp_value)}</td>
              </tr>
              <tr>
                <td>MRP Value</td>
                <td>{fmt(t_mrp_value)}</td>
              </tr>
              <tr>
                <td>Margin Amount</td>
                <td>{fmt(t_margin_amount)}</td>
              </tr>
              <tr>
                <td>C.P Margin%</td>
                <td>{fmt(t_margin_cp)}%</td>
              </tr>
              <tr>
                <td>MRP Margin%</td>
                <td>{fmt(t_margin_mrp)}%</td>
              </tr>
              <tr>
                <td colSpan={2} style={{ borderTop: '2px solid #ccc', padding: 0 }}></td>
              </tr>
              <tr>
                <td>Sub Total (Before GST)</td>
                <td>{fmt(t_cp_value)}</td>
              </tr>
              <tr>
                <td>Discount Amount</td>
                <td>{fmt(t_disc)}</td>
              </tr>
              <tr>
                <td>GST In Value</td>
                <td>{fmt(t_gst)}</td>
              </tr>
              <tr>
                <td>Discount In value</td>
                <td>{fmt(billDiscount)}</td>
              </tr>
              <tr>
                <td>Other Charge</td>
                <td>{fmt(otherCharges)}</td>
              </tr>
              <tr>
                <td>Round Off ({roundOff < 0 ? '−' : '+'})</td>
                <td>{fmt(Math.abs(roundOff))}</td>
              </tr>
              <tr className="grand-tot">
                <td>GRAND TOTAL</td>
                <td>{fmt(grandTotal)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

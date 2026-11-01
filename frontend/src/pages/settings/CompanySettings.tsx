// Company Profile: legal identity, tax registrations, addresses, bank & invoice details, compliance documents
// (ported from bombayfishries Settings / sps_company / hr_company_settings) + software settings.
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'react-hot-toast'
import { getCompanySettings, updateCompanySettings, company_api, type CompanySettings, type company_doc } from '../../api/company'
import { states_api, type state_item } from '../../api/suppliers'
import { useBrandingStore } from '../../store/brandingStore'
import { useAuthStore } from '../../store/authStore'
import PageHeader from '../../components/ui/PageHeader'
import Modal from '../../components/ui/Modal'

type S = Partial<CompanySettings>
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const TABS = [['company', 'Company'], ['tax', 'Tax & Registration'], ['address', 'Addresses & Contact'], ['bank', 'Bank & Invoice'], ['docs', 'Compliance Documents'], ['software', 'Software Settings']] as const
const DOC_TONE: Record<string, [string, string]> = {
  valid: ['bg-green-100 text-green-700', 'Valid'], expiring: ['bg-amber-100 text-amber-700', 'Expiring soon'],
  expired: ['bg-red-100 text-red-700', 'Expired'], missing: ['bg-gray-100 text-gray-500', 'Missing'], no_expiry: ['bg-amber-100 text-amber-700', 'Add expiry date'],
}
// fields that make the profile complete enough for invoices & compliance
const KEY_FIELDS: [keyof CompanySettings, string][] = [
  ['legal_name', 'Legal name'], ['gstin', 'GSTIN'], ['company_pan', 'PAN'], ['company_cin', 'CIN'], ['reg_address', 'Registered office'],
  ['ho_address', 'Head office'], ['ho_phone', 'Phone'], ['ho_email', 'Email'], ['fssai_no', 'FSSAI'], ['bank_account_no', 'Bank account'],
  ['authorized_signatory', 'Signatory'], ['invoice_terms', 'Invoice terms'],
]
const errMsg = (e: any) => {
  const d = e?.response?.data?.detail
  if (typeof d !== 'string') return e?.message || 'Something went wrong'
  const m = [...d.matchAll(/'msg': ["'](?:Value error, )?(.*?)["'], 'input'/g)].map(x => x[1])
  return m.length ? m.join(' • ') : d
}
const dmy = (v?: string | null) => v ? new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

export default function CompanySettingsPage() {
  const { updateSettings } = useBrandingStore()
  const role = useAuthStore(s => s.user?.role)
  const canEdit = role === 'admin' || role === 'superadmin'
  const [s, setS] = useState<S | null>(null)
  const [saved, setSaved] = useState<S | null>(null)
  const [tab, setTab] = useState<string>('company')
  const [types, setTypes] = useState<string[]>([])
  const [states, setStates] = useState<state_item[]>([])
  const [docs, setDocs] = useState<company_doc[]>([])
  const [up, setUp] = useState<{ d: company_doc; file?: File; doc_number: string; issue_date: string; expiry_date: string; notes: string } | null>(null)
  const [gstMsg, setGstMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [saving, setSaving] = useState(false)

  const loadDocs = () => company_api.documents().then(r => setDocs(r.data)).catch(() => {})
  useEffect(() => {
    getCompanySettings().then(d => { setS(d); setSaved(d) }).catch(() => toast.error('Failed to load company profile'))
    company_api.meta().then(r => setTypes(r.data.company_types)).catch(() => {})
    states_api.list().then(r => setStates(r.data)).catch(() => {})
    loadDocs()
  }, [])

  const dirty = useMemo(() => !!s && !!saved && JSON.stringify(s) !== JSON.stringify(saved), [s, saved])
  const filled = s ? KEY_FIELDS.filter(([k]) => String(s[k] ?? '').trim()) : []
  const docAlerts = docs.filter(d => d.status === 'expired' || d.status === 'expiring' || d.status === 'no_expiry').length

  if (!s) return <div className="p-8 text-center text-text-muted">Loading company profile…</div>
  const set = (k: keyof CompanySettings, v: unknown) => setS(x => ({ ...x!, [k]: v }))

  const onGstin = async (raw: string) => {
    const g = raw.toUpperCase().replace(/\s/g, '')
    set('gstin', g); setGstMsg(null)
    if (g.length !== 15) return
    try {
      const r = (await states_api.validate_gstin(g)).data
      if (!r.valid) return setGstMsg({ ok: false, text: r.error || 'Invalid GSTIN' })
      setS(x => ({ ...x!, gstin: g, company_state: r.state_name || x!.company_state, state_code: r.state_code || x!.state_code, company_pan: x!.company_pan || r.pan || null }))
      setGstMsg({ ok: true, text: `Valid • ${r.state_name} (${r.state_code}) • PAN ${r.pan}` })
    } catch { /* checked again on save */ }
  }

  const save = async () => {
    setSaving(true)
    try {
      // send only what changed: an untouched field (e.g. an old GSTIN) must not block saving a toggle
      const changed = Object.fromEntries(Object.entries(s!).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify((saved as any)?.[k])))
      const updated = await updateCompanySettings(changed)
      setS(updated); setSaved(updated); updateSettings(updated)
      toast.success('Company profile saved')
    } catch (e) { toast.error(errMsg(e)) } finally { setSaving(false) }
  }

  const uploadLogo = async (file?: File) => {
    if (!file) return
    try { const p = (await company_api.upload_logo(file)).data.logo_path; set('logo_path', p); setSaved(x => ({ ...x!, logo_path: p })); updateSettings({ ...(s as CompanySettings), logo_path: p }); toast.success('Logo updated') }
    catch (e) { toast.error(errMsg(e)) }
  }

  const uploadDoc = async () => {
    if (!up?.file) return toast.error('Choose the file')
    const f = new FormData()
    f.append('doc_type', up.d.type); f.append('file', up.file)
    if (up.doc_number) f.append('doc_number', up.doc_number)
    if (up.issue_date) f.append('issue_date', up.issue_date)
    if (up.expiry_date) f.append('expiry_date', up.expiry_date)
    if (up.notes) f.append('notes', up.notes)
    try { await company_api.upload_document(f); toast.success(`${up.d.label} uploaded`); setUp(null); loadDocs() } catch (e) { toast.error(errMsg(e)) }
  }

  // ── small field helpers ──
  const input = (label: string, k: keyof CompanySettings, o: { span?: string; placeholder?: string; upper?: boolean; maxLength?: number; type?: string; help?: string; required?: boolean } = {}) => (
    <div className={o.span}>
      <label className="form-label">{label}{o.required && <span className="text-red-500"> *</span>}</label>
      <input className={`form-input ${o.upper ? 'uppercase font-mono' : ''}`} type={o.type || 'text'} disabled={!canEdit} placeholder={o.placeholder} maxLength={o.maxLength}
        value={(s[k] as string | number | null) ?? ''} onChange={e => set(k, o.type === 'number' ? Number(e.target.value) : (o.upper ? e.target.value.toUpperCase() : e.target.value))} />
      {o.help && <span className="form-helper">{o.help}</span>}
    </div>
  )
  const area = (label: string, k: keyof CompanySettings, span = 'md:col-span-2', rows = 3) => (
    <div className={span}><label className="form-label">{label}</label>
      <textarea className="form-input !h-auto" rows={rows} disabled={!canEdit} value={(s[k] as string | null) ?? ''} onChange={e => set(k, e.target.value)} /></div>
  )
  const stateSelect = (label: string, k: keyof CompanySettings, disabled = false) => (
    <div><label className="form-label">{label}</label>
      <select className="form-input" disabled={!canEdit || disabled} value={(s[k] as string | null) ?? ''} onChange={e => set(k, e.target.value)}>
        <option value="">Select state</option>
        {states.map(st => <option key={st.id} value={st.state_name}>{st.state_code} - {st.state_name}</option>)}
      </select></div>
  )
  const toggle = (label: string, help: string, k: keyof CompanySettings, tone = '') => (
    <label className="flex items-center justify-between gap-3 p-3 rounded-lg border border-border bg-app-bg cursor-pointer">
      <span><span className={`block text-[14px] font-semibold ${tone}`}>{label}</span><span className="block text-[12px] text-text-muted">{help}</span></span>
      <input type="checkbox" className="w-5 h-5 accent-primary" disabled={!canEdit} checked={!!s[k]} onChange={e => set(k, e.target.checked)} />
    </label>
  )
  const card = (title: string, children: React.ReactNode, right?: React.ReactNode) => (
    <section className="bg-app-card border border-border rounded-fiori p-4">
      <div className="flex items-center justify-between mb-3"><h3 className="text-[12px] font-semibold uppercase tracking-wider text-primary m-0">{title}</h3>{right}</div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-3">{children}</div>
    </section>
  )

  const groups = [...new Set(docs.map(d => d.group))]

  return (
    <div className="p-4 space-y-4 pb-24">
      <PageHeader title="Company Profile" subtitle="Legal identity, registrations, addresses, bank details and compliance documents"
        action={<div className="flex items-center gap-3">
          {s.logo_path && <img src={s.logo_path} alt="Company logo" className="h-10 max-w-[120px] object-contain rounded" onError={e => (e.currentTarget.style.display = 'none')} />}
          <div className="text-right">
            <div className="text-[12px] text-text-muted">Profile {filled.length}/{KEY_FIELDS.length} complete</div>
            <div className="w-40 h-1.5 bg-app-bg rounded-full overflow-hidden"><div className="h-full bg-primary" style={{ width: `${filled.length / KEY_FIELDS.length * 100}%` }} /></div>
          </div>
        </div>} />

      {!canEdit && <div className="rounded-fiori border border-border bg-app-bg px-4 py-2 text-[13px] text-text-secondary"><i className="fas fa-lock mr-2" />Only admins can change company details.</div>}
      {filled.length < KEY_FIELDS.length && <div className="text-[12px] text-text-muted">Still missing: {KEY_FIELDS.filter(([k]) => !String(s[k] ?? '').trim()).map(([, l]) => l).join(', ')}</div>}

      <div className="tab-bar !px-2 bg-app-card border border-border rounded-fiori overflow-x-auto" role="tablist">
        {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={`tab-item whitespace-nowrap ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>
          {l}{k === 'docs' && docAlerts > 0 && <span className="ml-1.5 text-[10px] px-1.5 rounded-full bg-red-100 text-red-700">{docAlerts}</span>}</button>)}
      </div>

      {tab === 'company' && <>
        {card('Identity', <>
          {input('Legal / registered name', 'legal_name', { span: 'md:col-span-2', placeholder: 'As on GST & MCA records', required: true, help: 'Printed on tax invoices and statutory documents' })}
          {input('Brand / display name', 'brand_name', { help: 'Shown in the app header, login and receipts' })}
          <div><label className="form-label">Company type</label>
            <select className="form-input" disabled={!canEdit} value={s.company_type ?? ''} onChange={e => set('company_type', e.target.value || null)}>
              <option value="">Select</option>{types.map(t => <option key={t}>{t}</option>)}</select></div>
          {input('Website', 'company_website', { placeholder: 'www.example.com' })}
          <div><label className="form-label">Financial year starts in</label>
            <select className="form-input" disabled={!canEdit} value={s.fy_start_month ?? 4} onChange={e => set('fy_start_month', Number(e.target.value))}>
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></div>
        </>)}
        {card('Logo', <>
          <div className="flex items-center gap-4 md:col-span-2">
            <div className="w-28 h-20 rounded-lg border border-border bg-app-bg flex items-center justify-center overflow-hidden">
              {s.logo_path ? <img src={s.logo_path} alt="Logo preview" className="max-w-full max-h-full object-contain" /> : <i className="fas fa-image text-text-muted text-2xl" />}
            </div>
            {canEdit && <div><input className="form-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={e => uploadLogo(e.target.files?.[0])} />
              <span className="form-helper">PNG / JPG / WEBP, up to 2 MB. Used on the app, bills and reports.</span></div>}
          </div>
        </>)}
      </>}

      {tab === 'tax' && card('Tax & registration numbers', <>
        <div><label className="form-label">GSTIN</label>
          <input className="form-input uppercase font-mono" maxLength={15} disabled={!canEdit} placeholder="07ABCDE1234F1Z5" value={s.gstin ?? ''} onChange={e => onGstin(e.target.value)} />
          {gstMsg ? <span className={`form-helper ${gstMsg.ok ? '!text-green-600' : '!text-red-600'}`}>{gstMsg.text}</span> : <span className="form-helper">State and PAN are taken from the GSTIN</span>}</div>
        <div className="grid grid-cols-[1fr_90px] gap-2">{stateSelect('GST state (place of business)', 'company_state', !!s.gstin)}
          <div><label className="form-label">Code</label><input className="form-input font-mono" disabled value={s.state_code ?? ''} /></div></div>
        {input('PAN', 'company_pan', { upper: true, maxLength: 10, placeholder: 'ABCDE1234F' })}
        {input(s.company_type === 'LLP' ? 'LLPIN' : 'CIN', 'company_cin', { upper: true, maxLength: 21, placeholder: s.company_type === 'LLP' ? 'AAB-1234' : 'U52190DL2013PTC251948',
          help: ['Private Limited', 'Public Limited', 'LLP'].includes(s.company_type || '') ? 'Required for this company type' : undefined })}
        {input('TAN', 'company_tan', { upper: true, maxLength: 10, placeholder: 'DELA12345B', help: 'For TDS deduction / returns' })}
        {input('FSSAI licence no.', 'fssai_no', { maxLength: 14, placeholder: '14 digits', help: 'Must be printed on bills when selling food items' })}
        {input('MSME / Udyam no.', 'msme_no', { upper: true, maxLength: 30, placeholder: 'UDYAM-DL-07-0012345' })}
        {input('IEC (Import Export Code)', 'iec_no', { upper: true, maxLength: 10 })}
      </>)}

      {tab === 'address' && <>
        {card('Registered office', <>
          {area('Address', 'reg_address')}
          {input('City', 'reg_city')}
          {stateSelect('State', 'reg_state')}
          {input('PIN code', 'reg_pincode', { maxLength: 6 })}
        </>)}
        {card('Head office (billing address)', <>
          {area('Address', 'ho_address')}
          {input('City', 'ho_city')}
          {input('PIN code', 'ho_pincode', { maxLength: 6 })}
        </>, canEdit && <button type="button" className="btn btn-secondary !py-1 text-[12px]" onClick={() => setS(x => ({ ...x!, ho_address: x!.reg_address ?? '', ho_city: x!.reg_city, ho_pincode: x!.reg_pincode }))}>Same as registered</button>)}
        {card('Contact', <>
          {input('Email', 'ho_email', { type: 'email' })}
          {input('Phone', 'ho_phone')}
          {input('Alternate phone', 'alt_phone')}
        </>)}
      </>}

      {tab === 'bank' && <>
        {card('Bank details printed on invoices', <>
          {input('Account holder name', 'bank_account_name', { span: 'md:col-span-2' })}
          {input('Bank', 'bank_name')}
          {input('Branch', 'bank_branch')}
          {input('Account number', 'bank_account_no', { maxLength: 18 })}
          {input('IFSC', 'bank_ifsc', { upper: true, maxLength: 11, placeholder: 'HDFC0001234' })}
          {input('UPI ID', 'upi_id', { placeholder: 'name@bank', help: 'For “pay by UPI” on wholesale invoices' })}
        </>)}
        {card('Invoice & signatory', <>
          {input('Authorised signatory', 'authorized_signatory')}
          {input('Designation', 'signatory_designation', { placeholder: 'Director' })}
          {area('Terms & conditions (printed on invoices)', 'invoice_terms', 'md:col-span-2', 4)}
          {input('Invoice footer line', 'invoice_footer', { span: 'md:col-span-2', maxLength: 200, placeholder: 'Thank you for shopping with us!' })}
        </>)}
      </>}

      {tab === 'docs' && <section className="bg-app-card border border-border rounded-fiori overflow-x-auto">
        <table className="ent-table min-w-[900px]">
          <thead><tr><th>Document</th><th>Status</th><th>Number</th><th>Valid till</th><th>Uploaded</th><th className="!text-right">Actions</th></tr></thead>
          <tbody>{groups.map(g => <>
            <tr key={g}><td colSpan={6} className="!py-1 !h-auto bg-app-bg text-[11px] font-semibold uppercase tracking-wider text-text-muted">{g}</td></tr>
            {docs.filter(d => d.group === g).map(d => {
              const [tone, lbl] = DOC_TONE[d.status]
              return (
                <tr key={d.type}>
                  <td className="font-semibold">{d.label}{d.has_expiry && <span className="text-[11px] text-text-muted font-normal"> · renewable</span>}</td>
                  <td><span className={`text-[11px] px-2 py-0.5 rounded-full ${tone}`}>{lbl}</span></td>
                  <td className="font-mono text-[12px]">{d.current?.doc_number || '—'}</td>
                  <td className={d.status === 'expired' ? 'text-red-600 font-semibold' : d.status === 'expiring' ? 'text-amber-600' : ''}>{d.has_expiry ? dmy(d.current?.expiry_date) : 'Not needed'}</td>
                  <td className="text-[12px]">{d.current ? <>{dmy(d.current.created_at)}<div className="text-text-muted">{d.current.uploaded_by_name}</div></> : '—'}
                    {d.history.length > 0 && <div className="text-text-muted">{d.history.length} older version(s)</div>}</td>
                  <td className="text-right whitespace-nowrap">
                    {d.current && <a className="btn btn-secondary !py-1 !px-2 text-[12px] mr-1" href={d.current.file_path} target="_blank" rel="noreferrer"><i className="fas fa-eye mr-1" />View</a>}
                    {canEdit && <button className="btn btn-primary !py-1 !px-2 text-[12px]" onClick={() => setUp({ d, doc_number: d.current?.doc_number || '', issue_date: '', expiry_date: '', notes: '' })}>
                      <i className="fas fa-upload mr-1" />{d.current ? 'Renew / replace' : 'Upload'}</button>}
                  </td>
                </tr>
              )
            })}
          </>)}</tbody>
        </table>
      </section>}

      {tab === 'software' && <>
        {card('Billing & stock', <>
          {toggle('Enable GST', 'Calculate CGST/SGST/IGST on bills', 'enable_gst')}
          {toggle('Show product images', 'Thumbnails in lists and POS', 'show_product_img')}
          {toggle('Allow bill modification', 'Edit saved bills (logged)', 'enable_bill_modify')}
          {toggle('Excel import', 'Allow bulk import from Excel', 'enable_excel_import')}
          {toggle('Estimate stock check', 'Warn when estimating without stock', 'enable_estimate_stock_check')}
          {toggle('Block estimate without stock', 'Stop the estimate instead of warning', 'block_estimate_if_no_stock')}
          {toggle('Block negative inventory', 'Stop sales, transfers and returns that would take an item below zero stock (items marked "Allow Neg. Stock" are exempt). Each outlet can override this in Outlet Master.', 'block_negative_stock', 'text-red-600')}
          {input('Low stock threshold', 'low_stock_threshold', { type: 'number' })}
          {input('Auto item code format', 'item_code_format', { help: 'Tokens: [PREFIX] [BRAND] [VARIANT] [SIZE]' })}
        </>)}
        {card('HSN compliance', <>
          <div><label className="form-label">HSN code length</label>
            <select className="form-input" disabled={!canEdit} value={s.hsn_code_length ?? 8} onChange={e => set('hsn_code_length', Number(e.target.value))}>
              {[4, 6, 8].map(n => <option key={n} value={n}>{n} digits</option>)}</select>
            <span className="form-helper">Services (SAC) are always 6 digits</span></div>
          {toggle('Strict HSN compliance', 'Block saving items whose HSN does not match the subcategory', 'strict_hsn_validation', 'text-red-600')}
        </>)}
        {card('Pricing engine & channels', <>
          {toggle('Markdown calculation', 'Cost price from MRP and margin', 'enable_markdown_calc')}
          {toggle('Online channel pricing', 'Swiggy, Zomato, Amazon… per-item prices', 'enable_channel_pricing')}
          {toggle('Admin-only margins', 'Hide purchase margins from staff', 'markdown_admin_only')}
          <div />
          {input('Minimum global margin (%)', 'minimum_global_margin', { type: 'number', help: 'Alert when net margin falls below this' })}
          {input('Default markdown margin (%)', 'default_markdown_margin', { type: 'number' })}
        </>)}
      </>}

      {canEdit && tab !== 'docs' && (
        <div className="fixed bottom-0 right-0 left-0 md:left-auto md:w-[calc(100%-260px)] z-30 bg-app-card border-t border-border px-4 py-3 flex items-center justify-end gap-3">
          <span className={`text-[13px] ${dirty ? 'text-amber-600' : 'text-text-muted'}`}>{dirty ? 'Unsaved changes' : s.updated_at ? `Saved ${new Date(s.updated_at).toLocaleString('en-IN')}` : 'No changes'}</span>
          <button className="btn btn-secondary" disabled={!dirty || saving} onClick={() => { setS(saved); setGstMsg(null) }}>Discard</button>
          <button className="btn btn-primary" disabled={!dirty || saving} onClick={save}>{saving ? 'Saving…' : <><i className="fas fa-save mr-2" />Save changes</>}</button>
        </div>
      )}

      <Modal open={!!up} onClose={() => setUp(null)} title={up ? `${up.d.current ? 'Renew / replace' : 'Upload'} • ${up.d.label}` : ''} width="max-w-lg">
        {up && <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><label className="form-label">File (PDF / image, up to 5 MB) <span className="text-red-500">*</span></label>
            <input className="form-input" type="file" accept="application/pdf,image/*" onChange={e => setUp({ ...up, file: e.target.files?.[0] })} /></div>
          <div className="col-span-2"><label className="form-label">Document / licence number</label>
            <input className="form-input font-mono" value={up.doc_number} onChange={e => setUp({ ...up, doc_number: e.target.value })} /></div>
          <div><label className="form-label">Issue date</label><input className="form-input" type="date" value={up.issue_date} onChange={e => setUp({ ...up, issue_date: e.target.value })} /></div>
          <div><label className="form-label">Valid till{up.d.has_expiry && <span className="text-red-500"> *</span>}</label>
            <input className="form-input" type="date" value={up.expiry_date} onChange={e => setUp({ ...up, expiry_date: e.target.value })} /></div>
          <div className="col-span-2"><label className="form-label">Notes</label><input className="form-input" value={up.notes} onChange={e => setUp({ ...up, notes: e.target.value })} /></div>
          {up.d.current && <p className="col-span-2 text-[12px] text-text-muted m-0">The current file is kept as history.</p>}
          <div className="col-span-2 flex justify-end gap-2">
            <button className="btn btn-secondary" onClick={() => setUp(null)}>Cancel</button>
            <button className="btn btn-primary" disabled={!up.file || (up.d.has_expiry && !up.expiry_date)} onClick={uploadDoc}>Upload</button>
          </div>
        </div>}
      </Modal>
    </div>
  )
}

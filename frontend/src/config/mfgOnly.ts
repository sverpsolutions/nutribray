// Manufacturing-only mode: only these screens are shown and reachable; everything else is hidden.
// Set MFG_ONLY to false to bring the full ERP back.
export const MFG_ONLY = true
export const MFG_HOME = '/manufacturing/plant'

const ALLOWED = [
  '/manufacturing', '/approvals',
  '/products',
  '/masters/suppliers', '/masters/customers', '/masters/units', '/masters/hsn', '/masters/gst',
  '/masters/groups', '/masters/subgroups', '/masters/categories', '/masters/warehouse-racking',
  '/purchases', '/imports',
  '/inventory/status', '/inventory/batches', '/inventory/expiry-dashboard',
  '/settings/company', '/settings/users', '/settings/theme', '/help',
]

export function isAllowed(path: string): boolean {
  if (!MFG_ONLY) return true
  const p = path.split('?')[0]
  return ALLOWED.some(a => p === a || p.startsWith(a + '/'))
}

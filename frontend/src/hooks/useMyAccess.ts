import { useEffect, useState } from 'react'
import api from '../api/axios'

export type Store = { id: number; outlet_name: string; unit_code?: string }
type Access = { admin: boolean; perms: Set<string>; stores: Store[]; paths: Record<string, string> }

let cache: Promise<Access> | null = null

/** The logged-in user's permissions and the stores they may work in (server enforces the same rules). */
export function loadMyAccess(force = false): Promise<Access> {
  if (!cache || force) {
    cache = Promise.all([api.get('/access/me'), api.get('/outlets', { params: { per_page: 500 } })]).then(([me, o]) => {
      const all: Store[] = (o.data?.data || o.data || []).filter((x: any) => x.is_active !== false)
      const mine: number[] | null = me.data.scope?.outlets ?? null
      return { admin: me.data.admin, perms: new Set<string>(me.data.permissions), stores: mine ? all.filter((s) => mine.includes(s.id)) : all, paths: me.data.path_modules || {} }
    })
    cache.catch(() => { cache = null })
  }
  return cache
}

export function useMyAccess() {
  const [a, setA] = useState<Access | null>(null)
  useEffect(() => { loadMyAccess().then(setA).catch(() => setA({ admin: false, perms: new Set(), stores: [], paths: {} })) }, [])
  return {
    ready: !!a,
    admin: a?.admin ?? false,
    stores: a?.stores ?? [],
    can: (slug: string) => !!a && (a.admin || a.perms.has(slug)),
    /** Menu link visible? Same path -> module rule the server enforces; unmapped paths stay visible. */
    canPath: (path: string) => {
      if (!a || a.admin) return true
      const p = path.split('?')[0]
      const key = Object.keys(a.paths).filter((k) => p === k || p.startsWith(k + '/')).sort((x, y) => y.length - x.length)[0]
      return !key || a.perms.has(`${a.paths[key]}.view`)
    },
  }
}

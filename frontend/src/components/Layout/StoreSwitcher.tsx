import { useEffect, useState } from 'react';
import { useMyAccess } from '../../hooks/useMyAccess';
import { useAuthStore } from '../../store/authStore';

const KEY = 'pos_outlet_id';   // the working store POS, Day & Shift and Cash already use

/** Working store, always visible. "Head Office — all stores" is for reports only: transaction screens ask for a store. */
export default function StoreSwitcher() {
  const me = useMyAccess();
  const home = useAuthStore((s) => s.user?.outlet_id) ?? null;
  const [cur, setCur] = useState<number>(() => { try { return Number(localStorage.getItem(KEY) ?? home ?? 0) } catch { return 0 } });
  useEffect(() => {   // a store you are no longer assigned to falls back to your first store
    if (me.ready && cur && !me.stores.some((s) => s.id === cur)) setCur(me.stores[0]?.id ?? 0);
  }, [me.ready]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!me.ready || me.stores.length === 0) return null;
  const name = cur ? me.stores.find((s) => s.id === cur)?.outlet_name : 'Head Office — all stores';
  const change = (id: number) => {
    try { localStorage.setItem(KEY, String(id)) } catch { /* storage blocked */ }
    window.location.reload();
  };
  if (me.stores.length === 1) return (
    <span className="hidden md:inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-indigo-50 text-indigo-800 text-xs font-bold">
      <i className="fas fa-store" />{me.stores[0].outlet_name}</span>
  );
  return (
    <label className="hidden md:inline-flex items-center gap-2 px-2 py-1 rounded-md bg-indigo-50 text-indigo-800 text-xs font-bold" title="Working store">
      <i className="fas fa-store" />
      <select className="bg-transparent font-bold outline-none max-w-[220px]" value={cur} onChange={(e) => change(Number(e.target.value))} aria-label="Working store">
        <option value={0}>Head Office — all stores (reports)</option>
        {me.stores.map((s) => <option key={s.id} value={s.id}>{s.outlet_name}</option>)}
      </select>
      <span className="sr-only">{name}</span>
    </label>
  );
}

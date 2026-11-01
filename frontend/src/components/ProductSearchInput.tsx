import { useEffect, useRef, useState } from 'react'
import { products_api, type product_search_item } from '../api/products'

interface props {
  onSelect: (p: product_search_item) => void
  placeholder?: string
}

export default function ProductSearchInput({ onSelect, placeholder = 'Search by name, code, barcode…' }: props) {
  const [query, set_query] = useState('')
  const [results, set_results] = useState<product_search_item[]>([])
  const [highlighted, set_highlighted] = useState(-1)
  const [open, set_open] = useState(false)
  const [loading, set_loading] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const list_ref = useRef<HTMLUListElement>(null)
  const input_ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    if (query.trim().length < 1) { set_results([]); set_open(false); return }
    timer.current = setTimeout(async () => {
      set_loading(true)
      try {
        const res = await products_api.search(query.trim(), 20)
        set_results(res.data)
        set_highlighted(-1)
        set_open(true)
      } catch { set_results([]) }
      finally { set_loading(false) }
    }, 250)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [query])

  function select(item: product_search_item) {
    onSelect(item)
    set_query(item.name)
    set_open(false)
    set_results([])
  }

  function on_key(e: React.KeyboardEvent) {
    if (!open) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      set_highlighted(h => Math.min(h + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      set_highlighted(h => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (highlighted >= 0 && results[highlighted]) select(results[highlighted])
      else if (results.length === 1) select(results[0])
    } else if (e.key === 'Escape') {
      set_open(false)
    }
  }

  // scroll highlighted row into view
  useEffect(() => {
    if (highlighted < 0 || !list_ref.current) return
    const el = list_ref.current.children[highlighted] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [highlighted])

  return (
    <div className="relative w-full">
      <div className="relative">
        <input
          ref={input_ref}
          type="text"
          value={query}
          onChange={e => { set_query(e.target.value); set_open(true) }}
          onKeyDown={on_key}
          onBlur={() => setTimeout(() => set_open(false), 150)}
          onFocus={() => results.length > 0 && set_open(true)}
          placeholder={placeholder}
          className="w-full border rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          autoComplete="off"
        />
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm pointer-events-none">
          {loading ? '⟳' : '🔍'}
        </span>
      </div>

      {open && results.length > 0 && (
        <ul
          ref={list_ref}
          className="absolute z-50 left-0 right-0 mt-1 max-h-72 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg text-sm"
        >
          {results.map((item, i) => (
            <li
              key={item.id}
              onMouseDown={() => select(item)}
              className={`px-3 py-2 cursor-pointer flex justify-between gap-2 ${i === highlighted ? 'bg-blue-50 text-blue-800' : 'hover:bg-gray-50'}`}
            >
              <div className="min-w-0">
                <div className="font-medium truncate">{item.name}</div>
                <div className="text-xs text-gray-400 truncate">
                  {[item.item_code, item.barcode].filter(Boolean).join(' · ')}
                </div>
              </div>
              <div className="text-right shrink-0 text-xs text-gray-500">
                <div>MRP {item.mrp}</div>
                <div>{item.unit}</div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {open && query.length > 0 && !loading && results.length === 0 && (
        <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-sm text-gray-400">
          No products found
        </div>
      )}
    </div>
  )
}

interface modal_props {
  title: string
  open: boolean
  onClose: () => void
  children: React.ReactNode
  width?: string
}

export default function modal({ title, open, onClose, children, width = 'max-w-md' }: modal_props) {
  if (!open) return null
  const full = width === 'full'   // true full-screen window: fixed heading, scrolling body
  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center ${full ? 'bg-app-card' : 'bg-black/40'}`} role="dialog" aria-modal="true" aria-label={title}>
      <div className={`bg-app-card text-text-primary ${full ? 'w-screen h-screen' : `rounded-xl shadow-xl w-full ${width} mx-4 max-h-[90vh]`} flex flex-col`}>
        <div className={`flex items-center justify-between border-b border-border ${full ? 'px-6 py-3 bg-app-bg' : 'px-5 py-4'}`}>
          <h3 className={`m-0 ${full ? 'font-bold text-lg' : 'font-semibold'}`}>{title}</h3>
          <button onClick={onClose} aria-label="Close" className="w-8 h-8 rounded-md text-text-muted hover:bg-app-bg hover:text-text-primary text-xl leading-none">&times;</button>
        </div>
        <div className={`overflow-y-auto ${full ? 'flex-1 px-6 py-4' : 'px-5 py-4'}`}>{children}</div>
      </div>
    </div>
  )
}

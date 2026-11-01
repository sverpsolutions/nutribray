interface page_header_props {
  title: string
  subtitle?: string
  action?: React.ReactNode
  icon?: string
}

export default function PageHeader({ title, subtitle, action }: page_header_props) {
  return (
    <div className="page-header">
      <div>
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

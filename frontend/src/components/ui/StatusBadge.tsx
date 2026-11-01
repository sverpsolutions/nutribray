export default function StatusBadge({ active }: { active: boolean }) {
  return (
    <span className={`status-badge ${active ? 'status-badge-active' : 'status-badge-inactive'}`}>
      <span className={`dot ${active ? 'dot-active bg-status-active-dot' : 'bg-red-500'}`}></span>
      {active ? 'Active' : 'Inactive'}
    </span>
  )
}

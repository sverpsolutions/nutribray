import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  dashboardBuilderApi,
  type MyDashboardResponse,
  type WidgetModel
} from '../../api/dashboardBuilder'
import { useAuthStore } from '../../store/authStore'
import DynamicWidgetRenderer from './DynamicWidgetRenderer'

const REFRESH_MS = 60_000

export default function Dashboard() {
  const me = useAuthStore(s => s.user)
  const isAdmin = me?.role === 'admin' || me?.role === 'superadmin'

  const [dashData, setDashData] = useState<MyDashboardResponse | null>(null)
  const [widgets, setWidgets] = useState<WidgetModel[]>([])
  const [loading, setLoading] = useState(true)
  const [updated, setUpdated] = useState<Date | null>(null)

  // Filters
  const [days, setDays] = useState(7)
  const [selectedOutletId, setSelectedOutletId] = useState<number | null>(null)
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null)

  // User personal layout edit mode
  const [customizing, setCustomizing] = useState(false)
  const [savingPref, setSavingPref] = useState(false)

  const loadDashboard = async () => {
    try {
      const res = await dashboardBuilderApi.getMyDashboard()
      setDashData(res)
      setWidgets(res.widgets)
      setUpdated(new Date())
    } catch (err: any) {
      toast.error('Failed to load dashboard layout')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadDashboard()
    const timer = setInterval(loadDashboard, REFRESH_MS)
    return () => clearInterval(timer)
  }, [])

  // User personal layout: Move Up / Down
  const moveWidget = (index: number, direction: 'up' | 'down') => {
    const targetIdx = direction === 'up' ? index - 1 : index + 1
    if (targetIdx < 0 || targetIdx >= widgets.length) return
    const updated = [...widgets]
    const temp = updated[index]
    updated[index] = updated[targetIdx]
    updated[targetIdx] = temp
    updated.forEach((w, idx) => { w.position = idx })
    setWidgets(updated)
  }

  // Change column span
  const changeColSpan = (index: number, span: number) => {
    const updated = [...widgets]
    updated[index].col_span = span
    setWidgets(updated)
  }

  // Hide widget
  const hideWidget = (index: number) => {
    const updated = widgets.filter((_, idx) => idx !== index)
    setWidgets(updated)
  }

  // Save personalized layout preferences
  const handleSavePreferences = async () => {
    if (!dashData?.template) return
    try {
      setSavingPref(true)
      const overrides: Record<string, any> = { widgets: {} }
      widgets.forEach((w, idx) => {
        overrides.widgets[w.widget_key] = {
          position: idx,
          col_span: w.col_span,
          is_visible: true
        }
      })
      await dashboardBuilderApi.savePreferences(dashData.template.id, overrides)
      toast.success('Your dashboard view preferences have been saved!')
      setCustomizing(false)
      loadDashboard()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Failed to save preferences')
    } finally {
      setSavingPref(false)
    }
  }

  // Reset to company default layout
  const handleResetPreferences = async () => {
    if (!dashData?.template) return
    if (!confirm('Reset your dashboard to company default layout?')) return
    try {
      setSavingPref(true)
      await dashboardBuilderApi.resetPreferences(dashData.template.id)
      toast.success('Dashboard reset to template default')
      setCustomizing(false)
      loadDashboard()
    } catch (err: any) {
      toast.error('Failed to reset dashboard')
    } finally {
      setSavingPref(false)
    }
  }

  if (loading && !dashData) {
    return (
      <div className="p-12 text-center text-text-muted flex flex-col items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mb-3" />
        <span>Loading role-scoped dashboard…</span>
      </div>
    )
  }

  const scope = dashData?.scope
  const template = dashData?.template

  return (
    <div className="p-4 lg:p-8 flex flex-col gap-6 max-w-[1600px] mx-auto">
      {/* Top Header & Scope Banner */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-text-primary m-0">Dashboard</h1>
            {template && (
              <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-primary/10 text-primary border border-primary/20">
                {template.name}
              </span>
            )}
          </div>
          <p className="text-xs text-text-muted m-0 mt-1">
            {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            {updated && <> · updated {updated.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}, auto-refreshes every minute</>}
          </p>
        </div>

        {/* Global Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Layout Personalization Button */}
          {template?.allow_user_customization && (
            <button
              type="button"
              className={`btn text-xs ${customizing ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setCustomizing(!customizing)}
            >
              <i className={`fas ${customizing ? 'fa-check' : 'fa-th-large'} mr-1.5`} />
              {customizing ? 'Finish Editing' : 'Customize View'}
            </button>
          )}

          {/* Reset to Default */}
          {dashData?.has_custom_preferences && (
            <button
              type="button"
              className="btn btn-secondary text-xs hover:!text-red-500"
              onClick={handleResetPreferences}
              title="Reset to company template default"
            >
              <i className="fas fa-undo mr-1.5" /> Reset Layout
            </button>
          )}

          {/* Admin Dashboard Builder shortcut */}
          {isAdmin && (
            <Link to="/settings/dashboard-builder" className="btn btn-secondary text-xs">
              <i className="fas fa-cog mr-1.5" /> Dashboard Builder
            </Link>
          )}

          <Link to="/inventory/transfer/multi" className="btn btn-secondary text-xs hover:no-underline">
            Transfer Out
          </Link>
          <Link to="/billing/create" className="btn btn-primary text-xs hover:no-underline">
            <i className="fas fa-plus mr-1.5" /> New Invoice
          </Link>
        </div>
      </div>

      {/* Role & Data Scope Filter Bar */}
      <div className="bg-app-card border border-border rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Active Data Boundary Pill */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-app-bg border border-border text-xs">
            <i className={`fas ${scope?.is_unrestricted ? 'fa-globe text-emerald-500' : 'fa-shield-alt text-blue-500'}`} />
            <span className="font-semibold text-text-primary capitalize">
              {scope?.role?.replace(/_/g, ' ')} Scope:
            </span>
            <span className="text-text-secondary font-medium">
              {scope?.is_unrestricted
                ? 'All Outlets & Categories (Unrestricted)'
                : `${scope?.permitted_outlets.length ?? 0} Stores · ${scope?.permitted_categories.length ?? 0} Categories`}
            </span>
          </div>

          {/* Store Switcher (strictly within permitted scope) */}
          {scope && scope.permitted_outlets.length > 1 && (
            <select
              className="form-input text-xs !py-1 !px-2.5 !w-auto font-medium"
              value={selectedOutletId ?? ''}
              onChange={e => setSelectedOutletId(e.target.value ? Number(e.target.value) : null)}
              aria-label="Filter Store"
            >
              <option value="">All Permitted Stores ({scope.permitted_outlets.length})</option>
              {scope.permitted_outlets.map(o => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          )}

          {/* Category Switcher (strictly within permitted scope) */}
          {scope && scope.permitted_categories.length > 1 && (
            <select
              className="form-input text-xs !py-1 !px-2.5 !w-auto font-medium"
              value={selectedCategoryId ?? ''}
              onChange={e => setSelectedCategoryId(e.target.value ? Number(e.target.value) : null)}
              aria-label="Filter Category"
            >
              <option value="">All Permitted Categories ({scope.permitted_categories.length})</option>
              {scope.permitted_categories.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
        </div>

        {/* Date Range Selector */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-muted font-medium">Date Range:</span>
          <div className="flex border border-border rounded-lg overflow-hidden text-xs bg-app-bg">
            {[7, 14, 30].map(d => (
              <button
                key={d}
                type="button"
                className={`px-3 py-1 font-medium transition-all ${
                  days === d ? 'bg-primary text-white font-semibold' : 'text-text-secondary hover:text-text-primary'
                }`}
                onClick={() => setDays(d)}
              >
                {d} Days
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Customizing Banner */}
      {customizing && (
        <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3 text-xs text-amber-900 dark:text-amber-200">
          <span className="flex items-center gap-2">
            <i className="fas fa-edit text-amber-600" />
            <strong>Customization Mode:</strong> Adjust widget order using the arrows, resize column widths (1 to 4 cols), or hide widgets.
          </span>
          <div className="flex items-center gap-2">
            <button
              className="btn btn-primary text-xs !py-1"
              onClick={handleSavePreferences}
              disabled={savingPref}
            >
              <i className="fas fa-save mr-1" /> {savingPref ? 'Saving…' : 'Save My View'}
            </button>
            <button
              className="btn btn-secondary text-xs !py-1"
              onClick={() => { setCustomizing(false); loadDashboard() }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Dynamic Responsive 4-Column Widget Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {widgets.map((w, idx) => (
          <div key={w.widget_key || idx} className="relative group">
            {/* Customization Toolbar overlay when in edit mode */}
            {customizing && (
              <div className="mb-2 p-1.5 rounded-lg bg-app-bg border border-border flex items-center justify-between text-xs shadow-sm">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className="w-6 h-6 rounded bg-app-card hover:bg-border flex items-center justify-center text-text-primary disabled:opacity-30"
                    disabled={idx === 0}
                    onClick={() => moveWidget(idx, 'up')}
                    title="Move earlier"
                  >
                    <i className="fas fa-chevron-left" />
                  </button>
                  <button
                    type="button"
                    className="w-6 h-6 rounded bg-app-card hover:bg-border flex items-center justify-center text-text-primary disabled:opacity-30"
                    disabled={idx === widgets.length - 1}
                    onClick={() => moveWidget(idx, 'down')}
                    title="Move later"
                  >
                    <i className="fas fa-chevron-right" />
                  </button>
                  <span className="font-mono text-[11px] text-text-muted px-1">#{idx + 1}</span>
                </div>

                <div className="flex items-center gap-1">
                  {[1, 2, 3, 4].map(span => (
                    <button
                      key={span}
                      type="button"
                      className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        w.col_span === span ? 'bg-primary text-white' : 'bg-app-card text-text-secondary hover:text-text-primary'
                      }`}
                      onClick={() => changeColSpan(idx, span)}
                    >
                      {span}C
                    </button>
                  ))}
                  <button
                    type="button"
                    className="w-6 h-6 rounded bg-app-card hover:bg-red-50 hover:text-red-500 text-text-muted flex items-center justify-center ml-1"
                    onClick={() => hideWidget(idx)}
                    title="Hide widget"
                  >
                    <i className="fas fa-times" />
                  </button>
                </div>
              </div>
            )}

            <DynamicWidgetRenderer
              widget={w}
              days={days}
              outletId={selectedOutletId}
              categoryId={selectedCategoryId}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

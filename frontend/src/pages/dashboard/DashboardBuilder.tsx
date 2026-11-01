import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import PageHeader from '../../components/ui/PageHeader'
import Modal from '../../components/ui/Modal'
import {
  dashboardBuilderApi,
  type DashboardTemplate,
  type WidgetModel
} from '../../api/dashboardBuilder'
import { useAuthStore } from '../../store/authStore'
import DynamicWidgetRenderer from './DynamicWidgetRenderer'

export default function DashboardBuilder() {
  const me = useAuthStore(s => s.user)
  const isAdmin = me?.role === 'admin' || me?.role === 'superadmin'

  const [templates, setTemplates] = useState<DashboardTemplate[]>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null)
  const [currentTemplate, setCurrentTemplate] = useState<DashboardTemplate | null>(null)
  const [templateWidgets, setTemplateWidgets] = useState<WidgetModel[]>([])
  const [widgetLibrary, setWidgetLibrary] = useState<WidgetModel[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [activeTab, setActiveTab] = useState<'editor' | 'preview'>('editor')

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showAddWidgetModal, setShowAddWidgetModal] = useState(false)
  const [newTemplateForm, setNewTemplateForm] = useState({
    name: '',
    slug: '',
    description: '',
    role_id: '',
    is_default: false,
    allow_user_customization: true
  })

  // Load all templates & widget library
  const loadTemplates = async () => {
    try {
      setLoading(true)
      const [tList, lib] = await Promise.all([
        dashboardBuilderApi.getTemplates(),
        dashboardBuilderApi.getWidgetLibrary()
      ])
      setTemplates(tList)
      setWidgetLibrary(lib)
      if (tList.length > 0 && !selectedTemplateId) {
        setSelectedTemplateId(tList[0].id)
      }
    } catch (err: any) {
      toast.error('Failed to load dashboard templates')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadTemplates()
  }, [])

  // Load specific template details when selected
  useEffect(() => {
    if (!selectedTemplateId) return
    let active = true
    dashboardBuilderApi.getTemplate(selectedTemplateId)
      .then(res => {
        if (active) {
          setCurrentTemplate(res.template)
          setTemplateWidgets(res.widgets)
        }
      })
      .catch(() => active && toast.error('Failed to load template widgets'))
    return () => { active = false }
  }, [selectedTemplateId])

  // Move widget up
  const moveWidget = (index: number, direction: 'up' | 'down') => {
    const targetIdx = direction === 'up' ? index - 1 : index + 1
    if (targetIdx < 0 || targetIdx >= templateWidgets.length) return
    const updated = [...templateWidgets]
    const temp = updated[index]
    updated[index] = updated[targetIdx]
    updated[targetIdx] = temp
    // update positions
    updated.forEach((w, idx) => { w.position = idx })
    setTemplateWidgets(updated)
  }

  // Change col_span
  const changeColSpan = (index: number, span: number) => {
    const updated = [...templateWidgets]
    updated[index].col_span = span
    setTemplateWidgets(updated)
  }

  // Toggle visibility
  const toggleVisibility = (index: number) => {
    const updated = [...templateWidgets]
    updated[index].is_visible = !updated[index].is_visible
    setTemplateWidgets(updated)
  }

  // Remove widget from template
  const removeWidget = (index: number) => {
    const updated = templateWidgets.filter((_, idx) => idx !== index)
    updated.forEach((w, idx) => { w.position = idx })
    setTemplateWidgets(updated)
  }

  // Add widget from library
  const addWidgetToTemplate = (libWidget: WidgetModel) => {
    // Check if already in template
    if (templateWidgets.some(w => w.widget_key === libWidget.widget_key)) {
      toast.error(`"${libWidget.name}" is already in this template`)
      return
    }
    const newWidget: WidgetModel = {
      ...libWidget,
      widget_id: libWidget.id,
      position: templateWidgets.length,
      col_span: libWidget.default_width || 2,
      is_visible: true
    }
    setTemplateWidgets([...templateWidgets, newWidget])
    toast.success(`Added "${libWidget.name}"`)
  }

  // Save template configuration
  const handleSave = async () => {
    if (!selectedTemplateId || !currentTemplate) return
    try {
      setSaving(true)
      await dashboardBuilderApi.updateTemplate(selectedTemplateId, {
        name: currentTemplate.name,
        description: currentTemplate.description,
        is_default: currentTemplate.is_default,
        allow_user_customization: currentTemplate.allow_user_customization,
        widgets: templateWidgets.map((w, idx) => ({
          widget_id: w.widget_id || w.id!,
          widget_key: w.widget_key,
          position: idx,
          col_span: w.col_span,
          is_visible: w.is_visible
        }))
      })
      toast.success('Dashboard template saved successfully')
      loadTemplates()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Failed to save template')
    } finally {
      setSaving(false)
    }
  }

  // Create new template
  const handleCreateTemplate = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      setSaving(true)
      const res = await dashboardBuilderApi.createTemplate({
        name: newTemplateForm.name.trim(),
        slug: newTemplateForm.slug.trim().toLowerCase().replace(/\s+/g, '_'),
        description: newTemplateForm.description.trim(),
        role_id: newTemplateForm.role_id ? Number(newTemplateForm.role_id) : null,
        is_default: newTemplateForm.is_default,
        allow_user_customization: newTemplateForm.allow_user_customization,
        widgets: []
      })
      toast.success('Template created!')
      setShowCreateModal(false)
      setNewTemplateForm({ name: '', slug: '', description: '', role_id: '', is_default: false, allow_user_customization: true })
      await loadTemplates()
      setSelectedTemplateId(res.id)
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Failed to create template')
    } finally {
      setSaving(false)
    }
  }

  // Clone template
  const handleClone = async () => {
    if (!selectedTemplateId) return
    if (!confirm('Clone this template into a new custom variant?')) return
    try {
      setSaving(true)
      const res = await dashboardBuilderApi.cloneTemplate(selectedTemplateId)
      toast.success(`Template cloned as "${res.name}"`)
      await loadTemplates()
      setSelectedTemplateId(res.id)
    } catch (err: any) {
      toast.error('Failed to clone template')
    } finally {
      setSaving(false)
    }
  }

  // Delete template
  const handleDelete = async () => {
    if (!selectedTemplateId || !currentTemplate) return
    if (currentTemplate.is_default) {
      toast.error('Default company template cannot be deleted')
      return
    }
    if (!confirm(`Are you sure you want to delete template "${currentTemplate.name}"?`)) return
    try {
      setSaving(true)
      await dashboardBuilderApi.deleteTemplate(selectedTemplateId)
      toast.success('Template deleted')
      setSelectedTemplateId(null)
      loadTemplates()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Failed to delete template')
    } finally {
      setSaving(false)
    }
  }

  if (!isAdmin) {
    return (
      <div className="p-8 text-center text-text-muted">
        <i className="fas fa-lock text-3xl mb-3 text-amber-500" />
        <h2 className="text-xl font-semibold">Access Restricted</h2>
        <p>Only administrators can access the Dashboard Builder.</p>
        <Link to="/dashboard" className="btn btn-primary mt-4">Return to Dashboard</Link>
      </div>
    )
  }

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-[1600px] mx-auto">
      <PageHeader
        title="Custom Dashboard Builder"
        subtitle="Design and assign customized role-based dashboards with granular widgets, column sizing, and data scope"
        action={
          <div className="flex items-center gap-2">
            <Link to="/dashboard" className="btn btn-secondary">
              <i className="fas fa-arrow-left mr-1.5" /> Back to Live Dashboard
            </Link>
            <button
              className="btn btn-primary"
              onClick={() => setShowCreateModal(true)}
            >
              <i className="fas fa-plus mr-1.5" /> New Template
            </button>
          </div>
        }
      />

      {/* Template Switcher Bar */}
      <div className="bg-app-card border border-border rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-xs font-semibold uppercase tracking-wider text-text-muted">Active Template:</label>
          <select
            className="form-input !w-auto min-w-[280px] font-semibold text-text-primary"
            value={selectedTemplateId || ''}
            onChange={e => setSelectedTemplateId(Number(e.target.value))}
          >
            {templates.map(t => (
              <option key={t.id} value={t.id}>
                {t.name} {t.is_default ? '★ (Company Default)' : ''} {t.role_name ? `• ${t.role_name}` : ''}
              </option>
            ))}
          </select>

          {currentTemplate && (
            <div className="flex items-center gap-2">
              {currentTemplate.is_default && (
                <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                  Default Dashboard
                </span>
              )}
              {currentTemplate.role_name && (
                <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300">
                  Role: {currentTemplate.role_name}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Tab Switcher: Editor vs Live Preview */}
          <div className="flex bg-app-bg border border-border rounded-lg p-0.5">
            <button
              type="button"
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                activeTab === 'editor'
                  ? 'bg-app-card text-text-primary shadow-sm'
                  : 'text-text-muted hover:text-text-primary'
              }`}
              onClick={() => setActiveTab('editor')}
            >
              <i className="fas fa-sliders-h mr-1.5" /> Layout Editor
            </button>
            <button
              type="button"
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                activeTab === 'preview'
                  ? 'bg-app-card text-text-primary shadow-sm'
                  : 'text-text-muted hover:text-text-primary'
              }`}
              onClick={() => setActiveTab('preview')}
            >
              <i className="fas fa-eye mr-1.5" /> Live Preview
            </button>
          </div>

          <button
            type="button"
            className="btn btn-secondary text-xs"
            onClick={handleClone}
            title="Duplicate template"
          >
            <i className="fas fa-copy mr-1" /> Clone
          </button>

          {currentTemplate && !currentTemplate.is_default && (
            <button
              type="button"
              className="btn btn-secondary text-xs hover:!text-red-500"
              onClick={handleDelete}
              title="Delete template"
            >
              <i className="fas fa-trash-alt mr-1" /> Delete
            </button>
          )}

          <button
            type="button"
            className="btn btn-primary text-xs"
            onClick={handleSave}
            disabled={saving}
          >
            <i className="fas fa-save mr-1.5" /> {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>

      {activeTab === 'editor' ? (
        /* Layout Editor View */
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left 2 Cols: Ordered Widgets List */}
          <div className="lg:col-span-2 space-y-4">
            <div className="flex items-center justify-between bg-app-card border border-border rounded-xl p-4">
              <div>
                <h3 className="text-sm font-semibold text-text-primary m-0">
                  Configured Dashboard Widgets ({templateWidgets.length})
                </h3>
                <p className="text-xs text-text-muted m-0 mt-0.5">
                  Set column widths (1 to 4 cols), arrange positioning order, or toggle visibility.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-primary text-xs"
                onClick={() => setShowAddWidgetModal(true)}
              >
                <i className="fas fa-plus mr-1" /> Add Widgets
              </button>
            </div>

            {templateWidgets.length === 0 ? (
              <div className="p-12 text-center border-2 border-dashed border-border rounded-xl bg-app-card/50">
                <i className="fas fa-th-large text-3xl text-text-muted mb-2" />
                <p className="text-sm font-medium text-text-secondary">No widgets added to this template yet.</p>
                <button
                  className="btn btn-primary text-xs mt-3"
                  onClick={() => setShowAddWidgetModal(true)}
                >
                  Browse Widget Catalog
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {templateWidgets.map((w, idx) => (
                  <div
                    key={w.widget_key || idx}
                    className={`bg-app-card border rounded-xl p-3 flex flex-wrap items-center justify-between gap-3 transition-all ${
                      w.is_visible ? 'border-border' : 'border-border/40 opacity-60 bg-app-bg/50'
                    }`}
                  >
                    {/* Ordering handles & info */}
                    <div className="flex items-center gap-3 min-w-[240px]">
                      <div className="flex flex-col gap-0.5">
                        <button
                          type="button"
                          className="w-6 h-5 rounded hover:bg-app-bg flex items-center justify-center text-xs text-text-muted hover:text-text-primary disabled:opacity-20"
                          disabled={idx === 0}
                          onClick={() => moveWidget(idx, 'up')}
                          title="Move up"
                        >
                          <i className="fas fa-chevron-up" />
                        </button>
                        <button
                          type="button"
                          className="w-6 h-5 rounded hover:bg-app-bg flex items-center justify-center text-xs text-text-muted hover:text-text-primary disabled:opacity-20"
                          disabled={idx === templateWidgets.length - 1}
                          onClick={() => moveWidget(idx, 'down')}
                          title="Move down"
                        >
                          <i className="fas fa-chevron-down" />
                        </button>
                      </div>

                      <span className="font-mono text-xs text-text-muted font-bold w-5 text-center">
                        #{idx + 1}
                      </span>

                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm text-text-primary">{w.name}</span>
                          <span className="text-[10px] uppercase font-semibold tracking-wider px-2 py-0.5 rounded bg-app-bg text-text-secondary border border-border">
                            {w.category}
                          </span>
                        </div>
                        <p className="text-xs text-text-muted m-0 line-clamp-1">{w.description}</p>
                      </div>
                    </div>

                    {/* Width / Col Span controls */}
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-1 bg-app-bg border border-border rounded-lg p-0.5">
                        {[1, 2, 3, 4].map(cols => (
                          <button
                            key={cols}
                            type="button"
                            className={`px-2.5 py-1 text-xs font-semibold rounded ${
                              w.col_span === cols
                                ? 'bg-primary text-white shadow-sm'
                                : 'text-text-secondary hover:text-text-primary'
                            }`}
                            onClick={() => changeColSpan(idx, cols)}
                            title={`Width: ${cols} of 4 columns (${cols * 25}%)`}
                          >
                            {cols} Col
                          </button>
                        ))}
                      </div>

                      {/* Visibility Toggle */}
                      <button
                        type="button"
                        className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs transition-colors ${
                          w.is_visible
                            ? 'text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40'
                            : 'text-text-muted hover:bg-app-bg'
                        }`}
                        onClick={() => toggleVisibility(idx)}
                        title={w.is_visible ? 'Visible on dashboard' : 'Hidden'}
                      >
                        <i className={`fas ${w.is_visible ? 'fa-eye' : 'fa-eye-slash'}`} />
                      </button>

                      {/* Remove Button */}
                      <button
                        type="button"
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-xs text-text-muted hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
                        onClick={() => removeWidget(idx)}
                        title="Remove from template"
                      >
                        <i className="fas fa-times" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right Column: Template Settings */}
          {currentTemplate && (
            <div className="bg-app-card border border-border rounded-xl p-5 space-y-4 h-fit">
              <h3 className="text-sm font-semibold text-text-primary m-0 pb-2 border-b border-border">
                Template Configuration
              </h3>

              <div>
                <label className="form-label text-xs">Template Name</label>
                <input
                  className="form-input"
                  value={currentTemplate.name}
                  onChange={e => setCurrentTemplate({ ...currentTemplate, name: e.target.value })}
                />
              </div>

              <div>
                <label className="form-label text-xs">Description</label>
                <textarea
                  className="form-input text-xs"
                  rows={2}
                  value={currentTemplate.description || ''}
                  onChange={e => setCurrentTemplate({ ...currentTemplate, description: e.target.value })}
                />
              </div>

              <div className="pt-2 border-t border-border space-y-3">
                <label className="flex items-center gap-2 text-xs font-medium text-text-secondary cursor-pointer">
                  <input
                    type="checkbox"
                    checked={currentTemplate.is_default}
                    onChange={e => setCurrentTemplate({ ...currentTemplate, is_default: e.target.checked })}
                  />
                  <span>Set as Default Landing Dashboard</span>
                </label>

                <label className="flex items-center gap-2 text-xs font-medium text-text-secondary cursor-pointer">
                  <input
                    type="checkbox"
                    checked={currentTemplate.allow_user_customization}
                    onChange={e => setCurrentTemplate({ ...currentTemplate, allow_user_customization: e.target.checked })}
                  />
                  <span>Allow Users to Personalize Widget Arrangement</span>
                </label>
              </div>

              <div className="pt-3 border-t border-border">
                <button
                  type="button"
                  className="btn btn-primary w-full justify-center"
                  onClick={handleSave}
                  disabled={saving}
                >
                  <i className="fas fa-save mr-1.5" /> Save Configuration
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Live Preview View */
        <div className="space-y-4">
          <div className="bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/60 rounded-xl p-3 flex items-center justify-between text-xs text-blue-900 dark:text-blue-200">
            <span className="flex items-center gap-2">
              <i className="fas fa-info-circle text-blue-600" />
              <strong>Preview Mode:</strong> This renders the exact responsive 4-column layout and live widgets for this template.
            </span>
            <button
              className="btn btn-secondary text-xs !py-1"
              onClick={() => setActiveTab('editor')}
            >
              Return to Editor
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {templateWidgets.filter(w => w.is_visible).map((w, idx) => (
              <DynamicWidgetRenderer
                key={w.widget_key || idx}
                widget={w}
                previewMode={true}
              />
            ))}
          </div>
        </div>
      )}

      {/* Modal: Add Widgets from Catalog */}
      <Modal
        open={showAddWidgetModal}
        onClose={() => setShowAddWidgetModal(false)}
        title="Add Widgets from Reusable Library"
        width="max-w-2xl"
      >
        <div className="space-y-4">
          <p className="text-xs text-text-muted">
            Select widgets to add to the active dashboard template. All widgets automatically inherit backend data boundaries.
          </p>

          <div className="max-h-[440px] overflow-y-auto space-y-2 pr-1">
            {widgetLibrary.map(libW => {
              const alreadyAdded = templateWidgets.some(w => w.widget_key === libW.widget_key)
              return (
                <div
                  key={libW.id}
                  className="flex items-center justify-between p-3 rounded-lg border border-border bg-app-bg hover:bg-app-card transition-colors"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-text-primary">{libW.name}</span>
                      <span className="text-[10px] uppercase font-semibold tracking-wider px-2 py-0.5 rounded bg-app-card text-text-secondary border border-border">
                        {libW.category}
                      </span>
                    </div>
                    <p className="text-xs text-text-muted m-0 line-clamp-1">{libW.description}</p>
                  </div>
                  <button
                    type="button"
                    className={`btn text-xs ${alreadyAdded ? 'btn-secondary opacity-50 cursor-not-allowed' : 'btn-primary'}`}
                    disabled={alreadyAdded}
                    onClick={() => addWidgetToTemplate(libW)}
                  >
                    {alreadyAdded ? 'Added' : '+ Add Widget'}
                  </button>
                </div>
              )
            })}
          </div>

          <div className="flex justify-end pt-3 border-t border-border">
            <button className="btn btn-secondary text-xs" onClick={() => setShowAddWidgetModal(false)}>
              Done
            </button>
          </div>
        </div>
      </Modal>

      {/* Modal: Create New Template */}
      <Modal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Create New Dashboard Template"
        width="max-w-lg"
      >
        <form onSubmit={handleCreateTemplate} className="space-y-4">
          <div>
            <label className="form-label text-xs">Template Name <span className="text-red-500">*</span></label>
            <input
              className="form-input"
              required
              placeholder="e.g. Frozen Foods Category Dashboard"
              value={newTemplateForm.name}
              onChange={e => {
                const name = e.target.value
                const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
                setNewTemplateForm({ ...newTemplateForm, name, slug })
              }}
            />
          </div>

          <div>
            <label className="form-label text-xs">Template Key / Slug <span className="text-red-500">*</span></label>
            <input
              className="form-input font-mono text-xs"
              required
              placeholder="e.g. frozen_category_dash"
              value={newTemplateForm.slug}
              onChange={e => setNewTemplateForm({ ...newTemplateForm, slug: e.target.value.toLowerCase().replace(/\s+/g, '_') })}
            />
          </div>

          <div>
            <label className="form-label text-xs">Description</label>
            <textarea
              className="form-input text-xs"
              rows={2}
              placeholder="Purpose and target department for this dashboard..."
              value={newTemplateForm.description}
              onChange={e => setNewTemplateForm({ ...newTemplateForm, description: e.target.value })}
            />
          </div>

          <div className="space-y-2 pt-2 border-t border-border">
            <label className="flex items-center gap-2 text-xs font-medium text-text-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={newTemplateForm.is_default}
                onChange={e => setNewTemplateForm({ ...newTemplateForm, is_default: e.target.checked })}
              />
              <span>Set as Default Landing Dashboard</span>
            </label>

            <label className="flex items-center gap-2 text-xs font-medium text-text-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={newTemplateForm.allow_user_customization}
                onChange={e => setNewTemplateForm({ ...newTemplateForm, allow_user_customization: e.target.checked })}
              />
              <span>Allow Users to Personalize Layout</span>
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button type="button" className="btn btn-secondary text-xs" onClick={() => setShowCreateModal(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary text-xs" disabled={saving}>
              {saving ? 'Creating…' : 'Create Template'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

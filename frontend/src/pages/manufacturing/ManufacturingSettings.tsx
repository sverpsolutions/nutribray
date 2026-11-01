import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { getCompanySettings, updateCompanySettings, type CompanySettings } from '../../api/company';

export default function ManufacturingSettings() {
  const [settings, setSettings] = useState<Partial<CompanySettings> | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getCompanySettings()
      .then((data) => {
        setSettings(data);
      })
      .catch((err) => {
        console.error(err);
        toast.error('Failed to load manufacturing settings');
      })
      .finally(() => setLoading(false));
  }, []);

  const handleChange = (key: keyof CompanySettings, value: any) => {
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const updated = await updateCompanySettings(settings);
      setSettings(updated);
      toast.success('Manufacturing configuration saved successfully');
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Failed to update settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading || !settings) {
    return (
      <div className="flex items-center justify-center p-12 text-slate-500">
        <i className="fas fa-spinner fa-spin text-2xl mr-3 text-indigo-600" />
        <span>Loading Manufacturing Settings...</span>
      </div>
    );
  }

  return (
    <div className="w-full space-y-6 pb-12">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-slate-200">
        <div>
          <h1 className="text-xl font-black text-slate-800 flex items-center gap-2">
            <span className="p-2 bg-indigo-600 text-white rounded-lg">
              <i className="fas fa-industry text-sm" />
            </span>
            Manufacturing & Plant Configuration
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Configure Nutribray production settings, store mappings, numbering series, and approval gates.
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg shadow-sm flex items-center gap-2 transition"
        >
          {saving ? <i className="fas fa-spinner fa-spin" /> : <i className="fas fa-save" />}
          Save Changes
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Module Enablement & Identity */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <h2 className="font-bold text-slate-800 text-sm flex items-center gap-2">
              <i className="fas fa-toggle-on text-indigo-600" />
              Module Activation & Legal Entity
            </h2>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                className="sr-only peer"
                checked={!!settings.enable_manufacturing}
                onChange={(e) => handleChange('enable_manufacturing', e.target.checked)}
              />
              <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
            </label>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              Manufacturing Company Name / Entity
            </label>
            <input
              type="text"
              value={settings.mfg_company_name || ''}
              onChange={(e) => handleChange('mfg_company_name', e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="e.g., Nutribray Manufacturing Pvt Ltd"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              Plant / Factory Locations (Comma separated)
            </label>
            <input
              type="text"
              value={settings.mfg_plant_locations || ''}
              onChange={(e) => handleChange('mfg_plant_locations', e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="e.g., Plant 1 - Rai Industrial Area, Plant 2 - Kundli"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              Manufacturing Departments
            </label>
            <input
              type="text"
              value={settings.mfg_departments || ''}
              onChange={(e) => handleChange('mfg_departments', e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="e.g., Pre-Weighing, Baking & Roasting, Blending, Primary Packaging, Quality Assurance"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              Production Floor Stores
            </label>
            <input
              type="text"
              value={settings.production_stores || ''}
              onChange={(e) => handleChange('production_stores', e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="e.g., Line 1 Store, Line 2 Store, Pouch Pack Store"
            />
          </div>
        </div>

        {/* Numbering Series & Valuation */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <h2 className="font-bold text-slate-800 text-sm pb-3 border-b border-slate-100 flex items-center gap-2">
            <i className="fas fa-hashtag text-indigo-600" />
            Numbering Series & Cost Valuation
          </h2>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                BOM Prefix
              </label>
              <input
                type="text"
                value={settings.bom_prefix || ''}
                onChange={(e) => handleChange('bom_prefix', e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="BOM-NB-"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                MO Series Prefix
              </label>
              <input
                type="text"
                value={settings.mfg_order_prefix || ''}
                onChange={(e) => handleChange('mfg_order_prefix', e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="NB-MO-"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              Production Batch Series Prefix
            </label>
            <input
              type="text"
              value={settings.production_batch_prefix || ''}
              onChange={(e) => handleChange('production_batch_prefix', e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="NB-BAT-"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              Default Stock Valuation Method
            </label>
            <select
              value={settings.default_stock_valuation_method || 'FIFO'}
              onChange={(e) => handleChange('default_stock_valuation_method', e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="FIFO">FIFO (First In, First Out)</option>
              <option value="WEIGHTED_AVERAGE">Weighted Average Cost (Moving Average)</option>
              <option value="STANDARD">Standard Cost</option>
            </select>
          </div>
        </div>

        {/* Approvals & Quality Governance */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4 md:col-span-2">
          <h2 className="font-bold text-slate-800 text-sm pb-3 border-b border-slate-100 flex items-center gap-2">
            <i className="fas fa-shield-alt text-emerald-600" />
            Governance, Quality Release & Inventory Control Policies
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
              <input
                type="checkbox"
                id="req_bom_approval"
                checked={!!settings.require_bom_approval}
                onChange={(e) => handleChange('require_bom_approval', e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              <label htmlFor="req_bom_approval" className="cursor-pointer">
                <div className="text-xs font-bold text-slate-800">Enforce BOM Approval</div>
                <div className="text-[11px] text-slate-500">
                  Only approved BOM revisions can be selected when creating manufacturing orders.
                </div>
              </label>
            </div>

            <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
              <input
                type="checkbox"
                id="req_issue_approval"
                checked={!!settings.require_material_issue_approval}
                onChange={(e) => handleChange('require_material_issue_approval', e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              <label htmlFor="req_issue_approval" className="cursor-pointer">
                <div className="text-xs font-bold text-slate-800">Require Material Issue Sign-off</div>
                <div className="text-[11px] text-slate-500">
                  Warehouse manager must verify physical dispatch of raw materials before status moves to ISSUED.
                </div>
              </label>
            </div>

            <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
              <input
                type="checkbox"
                id="req_qc_release"
                checked={!!settings.require_qc_release_for_fg}
                onChange={(e) => handleChange('require_qc_release_for_fg', e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              <label htmlFor="req_qc_release" className="cursor-pointer">
                <div className="text-xs font-bold text-slate-800">QC Release Gate for Finished Goods</div>
                <div className="text-[11px] text-slate-500">
                  Finished products remain in Quarantine and cannot be billed or transferred until Quality release is signed off.
                </div>
              </label>
            </div>

            <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
              <input
                type="checkbox"
                id="strict_fefo"
                checked={!!settings.strict_fefo_enforcement}
                onChange={(e) => handleChange('strict_fefo_enforcement', e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              <label htmlFor="strict_fefo" className="cursor-pointer">
                <div className="text-xs font-bold text-slate-800">Strict FEFO Enforcement</div>
                <div className="text-[11px] text-slate-500">
                  Automatically allocate raw material and packaging lots with the earliest expiration date.
                </div>
              </label>
            </div>

            <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
              <input
                type="checkbox"
                id="allow_neg_stock"
                checked={!!settings.allow_negative_raw_material_stock}
                onChange={(e) => handleChange('allow_negative_raw_material_stock', e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              <label htmlFor="allow_neg_stock" className="cursor-pointer">
                <div className="text-xs font-bold text-slate-800">Allow Negative Raw Material Stock</div>
                <div className="text-[11px] text-slate-500 text-rose-600 font-medium">
                  When unchecked (default), material issues and consumption are strictly blocked if physical stock is deficient.
                </div>
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

import React, { useState } from 'react';
import { useThemeStore } from '../../store/themeStore';
import { useBrandingStore } from '../../store/brandingStore';

export default function ThemeSettings() {
  const { isDarkMode, toggleDarkMode, isMonochrome, toggleMonochrome } = useThemeStore();
  const { brand_name, setBrandName, primary_color, setPrimaryColor } = useBrandingStore();
  const [localBrandName, setLocalBrandName] = useState(brand_name);
  const [localColor, setLocalColor] = useState(primary_color || '#2563EB');
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      setBrandName(localBrandName);
      setPrimaryColor(localColor);
      
      // Also update document variable for immediate effect
      document.documentElement.style.setProperty('--clr-primary', localColor);
      
      import('react-hot-toast').then(({ toast }) => {
        toast.success('Theme settings updated successfully!', {
          style: { borderRadius: '15px', background: '#334155', color: '#fff' }
        });
      });
    } finally {
      setIsSaving(false);
    }
  };

  const presets = [
    { name: 'Enterprise Blue', color: '#2563EB' },
    { name: 'Modern Indigo', color: '#6366F1' },
    { name: 'Forest Green', color: '#059669' },
    { name: 'Ruby Red', color: '#DC2626' },
    { name: 'Luxury Slate', color: '#334155' },
    { name: 'Royal Purple', color: '#7C3AED' },
  ];

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 p-8 overflow-auto">
      <div className="max-w-4xl mx-auto w-full">
        <div className="mb-10">
          <h1 className="text-3xl font-black text-slate-800 dark:text-white mb-2 italic">
            Interface Customization
          </h1>
          <p className="text-slate-500 font-medium">Personalize your Nutribray workspace and branding.</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left Column: Branding */}
          <div className="lg:col-span-2 space-y-8">
            <section className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-10 border border-slate-200 dark:border-slate-800 shadow-xl">
              <h3 className="text-lg font-bold mb-8 flex items-center gap-2">
                <i className="fas fa-building text-blue-500"></i> Corporate Identity
              </h3>
              
              <div className="space-y-6">
                <div className="flex flex-col gap-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Brand Name</label>
                  <input 
                    type="text" 
                    value={localBrandName}
                    onChange={(e) => setLocalBrandName(e.target.value)}
                    className="w-full h-14 px-6 rounded-2xl bg-slate-50 dark:bg-slate-800 border-none outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold text-slate-700 dark:text-white"
                    placeholder="Enter Company Name"
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Primary Accent Color</label>
                  <div className="flex items-center gap-4">
                    <input 
                      type="color" 
                      value={localColor}
                      onChange={(e) => setLocalColor(e.target.value)}
                      className="w-14 h-14 rounded-xl cursor-pointer border-none bg-transparent"
                    />
                    <input 
                      type="text" 
                      value={localColor}
                      onChange={(e) => setLocalColor(e.target.value)}
                      className="flex-1 h-14 px-6 rounded-2xl bg-slate-50 dark:bg-slate-800 border-none outline-none focus:ring-2 focus:ring-blue-500 transition-all font-mono text-sm"
                    />
                  </div>
                </div>

                <div className="pt-6">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4 block">Color Presets</label>
                  <div className="flex flex-wrap gap-3">
                    {presets.map(p => (
                      <button 
                        key={p.color}
                        onClick={() => setLocalColor(p.color)}
                        className={`w-10 h-10 rounded-full transition-all hover:scale-110 ${localColor === p.color ? 'ring-4 ring-offset-2 ring-blue-500' : ''}`}
                        style={{ backgroundColor: p.color }}
                        title={p.name}
                      />
                    ))}
                  </div>
                </div>
              </div>

              <div className="mt-12 flex justify-end">
                <button 
                  onClick={handleSave}
                  disabled={isSaving}
                  className="px-10 py-4 bg-blue-600 text-white rounded-2xl font-bold shadow-lg shadow-blue-200 dark:shadow-none hover:bg-blue-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {isSaving ? (
                    <><i className="fas fa-spinner fa-spin"></i> Processing...</>
                  ) : (
                    'Apply Changes'
                  )}
                </button>
              </div>
            </section>
          </div>

          {/* Right Column: Theme Toggle */}
          <div className="space-y-8">
            <section className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-10 border border-slate-200 dark:border-slate-800 shadow-xl flex flex-col items-center text-center">
              <h3 className="text-lg font-bold mb-6">Display Mode</h3>
              
              <div 
                onClick={toggleDarkMode}
                className="relative w-24 h-48 bg-slate-100 dark:bg-slate-800 rounded-full cursor-pointer p-2 transition-all group"
              >
                <div className={`absolute left-2 right-2 h-20 rounded-full transition-all duration-500 flex items-center justify-center text-xl shadow-xl ${
                  isDarkMode 
                    ? 'bottom-2 bg-slate-900 text-indigo-400' 
                    : 'top-2 bg-white text-amber-400'
                }`}>
                  <i className={`fas ${isDarkMode ? 'fa-moon' : 'fa-sun'}`}></i>
                </div>
                <div className="h-full flex flex-col justify-between py-8 font-black text-[10px] text-slate-400 uppercase tracking-widest pointer-events-none">
                  <span>Light</span>
                  <span>Dark</span>
                </div>
              </div>

              <p className="mt-8 text-sm text-slate-500 leading-relaxed italic">
                Switch between light and dark modes to reduce eye strain and improve readability.
              </p>

              <div className="w-full h-px bg-slate-200 dark:bg-slate-800 my-8"></div>

              <h3 className="text-lg font-bold mb-6">Monochrome Theme</h3>
              <button
                onClick={toggleMonochrome}
                className={`w-full py-4 rounded-2xl font-bold transition-all flex items-center justify-center gap-3 ${
                  isMonochrome
                    ? 'bg-slate-800 text-white shadow-lg'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                <i className="fas fa-tint-slash"></i>
                {isMonochrome ? 'Monochrome Active' : 'Enable Monochrome'}
              </button>
              <p className="mt-4 text-xs text-slate-500 leading-relaxed italic">
                Removes all color from the interface for a clean, black-and-white look.
              </p>
            </section>

            <section className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-[2.5rem] p-8 text-white shadow-2xl">
              <h4 className="font-bold mb-4 flex items-center gap-2">
                <i className="fas fa-magic text-blue-400"></i> Smart Theming
              </h4>
              <p className="text-xs text-slate-400 leading-relaxed mb-6">
                Our design system automatically adjusts shadows, text contrast, and border colors based on your primary accent choice.
              </p>
              <div className="w-full h-1 bg-slate-700 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500" style={{ width: '65%' }}></div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

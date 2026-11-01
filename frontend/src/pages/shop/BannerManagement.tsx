import React, { useEffect, useState } from 'react';
import { 
  Image as ImageIcon, 
  Plus, 
  Trash2, 
  Save, 
  Zap, 
  AlertCircle, 
  CheckCircle2, 
  ExternalLink,
  Loader2,
  Settings,
  Layout
} from 'lucide-react';
import { shopService } from '../../services/shopService';
import { toast } from 'react-hot-toast';
import { useTheme } from '../../context/ThemeContext';

const BannerManagement: React.FC = () => {
  const { theme, setTheme } = useTheme();
  const [banners, setBanners] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [newBanner, setNewBanner] = useState({
    title: '',
    image: '',
    link: '',
    sort_order: 0
  });

  useEffect(() => {
    loadBanners();
  }, []);

  const loadBanners = async () => {
    try {
      const data = await shopService.getAdminBanners();
      setBanners(data);
    } catch (err) {
      toast.error("Failed to load banners");
    } finally {
      setLoading(false);
    }
  };

  const handleAddBanner = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBanner.image) return toast.error("Image URL is required");

    try {
      setIsProcessing(true);
      await shopService.createBanner(newBanner);
      toast.success("Banner added successfully");
      setShowForm(false);
      setNewBanner({ title: '', image: '', link: '', sort_order: 0 });
      loadBanners();
    } catch (err) {
      toast.error("Failed to add banner");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDeleteBanner = async (id: number) => {
    if (!confirm("Are you sure you want to delete this banner?")) return;
    try {
      await shopService.deleteBanner(id);
      toast.success("Banner deleted");
      loadBanners();
    } catch (err) {
      toast.error("Failed to delete banner");
    }
  };

  const handleAutoSetup = async () => {
    if (!confirm("This will automatically match product images based on Item Codes. Proceed?")) return;
    try {
      setIsProcessing(true);
      const res = await shopService.autoSetupProductImages();
      toast.success(res.message);
    } catch (err) {
      toast.error("Auto-setup failed");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="p-6 space-y-8 bg-slate-50 min-h-screen">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-slate-900 flex items-center gap-3">
            <Layout className="text-blue-600 w-8 h-8" />
            Shop Management
          </h1>
          <p className="text-slate-500 font-medium">Configure banners and automate product images</p>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-bold transition-all shadow-lg shadow-blue-200"
          >
            {showForm ? 'Cancel' : <><Plus className="w-5 h-5" /> Add Banner</>}
          </button>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-8">
        {/* Banner Management */}
        <div className="lg:col-span-2 space-y-6">
          {showForm && (
            <div className="bg-white p-8 rounded-3xl border-2 border-blue-100 shadow-xl space-y-6 animate-in fade-in slide-in-from-top-4 duration-300">
              <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                <Plus className="text-blue-500 w-5 h-5" />
                Add New Banner
              </h2>
              <form onSubmit={handleAddBanner} className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-xs font-black text-slate-400 uppercase tracking-wider">Banner Title</label>
                  <input 
                    type="text"
                    value={newBanner.title}
                    onChange={e => setNewBanner({...newBanner, title: e.target.value})}
                    placeholder="Summer Collection"
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all font-medium"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-black text-slate-400 uppercase tracking-wider">Image URL</label>
                  <input 
                    type="text"
                    value={newBanner.image}
                    onChange={e => setNewBanner({...newBanner, image: e.target.value})}
                    placeholder="/banners/promo1.jpg"
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all font-medium"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-black text-slate-400 uppercase tracking-wider">Target Link (Optional)</label>
                  <input 
                    type="text"
                    value={newBanner.link}
                    onChange={e => setNewBanner({...newBanner, link: e.target.value})}
                    placeholder="/shop/category/1"
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all font-medium"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-black text-slate-400 uppercase tracking-wider">Sort Order</label>
                  <input 
                    type="number"
                    value={newBanner.sort_order}
                    onChange={e => setNewBanner({...newBanner, sort_order: parseInt(e.target.value)})}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all font-medium"
                  />
                </div>
                <div className="md:col-span-2">
                  <button 
                    disabled={isProcessing}
                    className="w-full flex items-center justify-center gap-2 py-4 bg-slate-900 text-white rounded-2xl font-bold hover:bg-black transition-all disabled:opacity-50"
                  >
                    {isProcessing ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Save className="w-5 h-5" /> Save Banner</>}
                  </button>
                </div>
              </form>
            </div>
          )}

          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-6 border-b border-slate-100">
              <h2 className="text-xl font-bold text-slate-800">Active Banners</h2>
            </div>
            <div className="p-6">
              {loading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
                </div>
              ) : banners.length === 0 ? (
                <div className="text-center py-12 space-y-4">
                  <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto">
                    <ImageIcon className="text-slate-400 w-8 h-8" />
                  </div>
                  <p className="text-slate-400 font-medium">No banners configured yet</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {banners.map((banner) => (
                    <div key={banner.id} className="group relative bg-slate-50 rounded-2xl overflow-hidden border border-slate-200 hover:border-blue-200 transition-all">
                      <div className="aspect-[21/9] bg-slate-200">
                        <img src={banner.image} alt={banner.title} className="w-full h-full object-cover" />
                      </div>
                      <div className="p-4 flex items-center justify-between">
                        <div>
                          <h3 className="font-bold text-slate-800">{banner.title || 'Untitled Banner'}</h3>
                          <p className="text-xs text-slate-500 font-medium flex items-center gap-1">
                            <ExternalLink className="w-3 h-3" /> {banner.link || 'No link'}
                          </p>
                        </div>
                        <button 
                          onClick={() => handleDeleteBanner(banner.id)}
                          className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      </div>
                      <div className="absolute top-2 left-2 bg-black/50 backdrop-blur-md text-white text-[10px] px-2 py-1 rounded-lg font-bold">
                        Order: {banner.sort_order}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Magic Actions / Theme / Auto Setup */}
        <div className="space-y-6">
          <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm space-y-6">
            <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
              <Settings className="w-5 h-5 text-slate-400" />
              Theme Settings
            </h2>
            <div className="grid grid-cols-2 gap-3">
              <button 
                onClick={() => setTheme('yellow')}
                className={`flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all ${
                  theme === 'yellow' ? 'border-yellow-400 bg-yellow-50' : 'border-slate-100 hover:border-slate-200'
                }`}
              >
                <div className="w-8 h-8 bg-yellow-400 rounded-full shadow-inner" />
                <span className="text-xs font-black text-slate-700">Modern Yellow</span>
              </button>
              <button 
                onClick={() => setTheme('blue')}
                className={`flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all ${
                  theme === 'blue' ? 'border-blue-400 bg-blue-50' : 'border-slate-100 hover:border-slate-200'
                }`}
              >
                <div className="w-8 h-8 bg-blue-500 rounded-full shadow-inner" />
                <span className="text-xs font-black text-slate-700">Elite Blue</span>
              </button>
            </div>
          </div>

          <div className="bg-gradient-to-br from-indigo-600 to-violet-700 p-8 rounded-3xl text-white shadow-xl shadow-indigo-200 space-y-6">
            <div className="space-y-2">
              <div className="w-12 h-12 bg-white/20 backdrop-blur-md rounded-2xl flex items-center justify-center">
                <Zap className="w-6 h-6 fill-white" />
              </div>
              <h2 className="text-2xl font-black">Magic Auto-Setup</h2>
              <p className="text-indigo-100 text-sm font-medium leading-relaxed">
                Automatically match product images from your server's <code className="bg-white/10 px-1 rounded">/public/products/</code> folder using Item Codes.
              </p>
            </div>

            <div className="bg-white/10 backdrop-blur-md p-4 rounded-2xl space-y-3">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-indigo-200 shrink-0 mt-0.5" />
                <p className="text-[11px] font-bold text-indigo-100 uppercase tracking-wider leading-tight">
                  Convention: <span className="text-white">ITEMCODE.jpg</span>, <span className="text-white">ITEMCODE_1.jpg</span>
                </p>
              </div>
            </div>

            <button 
              disabled={isProcessing}
              onClick={handleAutoSetup}
              className="w-full py-4 bg-white text-indigo-600 rounded-2xl font-black text-lg hover:bg-indigo-50 transition-all shadow-lg flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {isProcessing ? <Loader2 className="w-6 h-6 animate-spin" /> : 'Run Auto-Setup Now'}
            </button>
            
            <p className="text-center text-[10px] font-bold text-indigo-300 uppercase tracking-widest">
              Last Run: Never
            </p>
          </div>

          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
            <h3 className="font-bold text-slate-800 flex items-center gap-2">
              <Settings className="w-4 h-4 text-slate-400" />
              Quick Tips
            </h3>
            <ul className="space-y-3">
              {[
                { icon: CheckCircle2, text: 'Use 1200x400px for banners' },
                { icon: CheckCircle2, text: 'Keep text centered for mobile' },
                { icon: CheckCircle2, text: 'Use .webp for better performance' },
              ].map((tip, i) => (
                <li key={i} className="flex items-center gap-3 text-sm text-slate-500 font-medium">
                  <tip.icon className="w-4 h-4 text-emerald-500" />
                  {tip.text}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BannerManagement;

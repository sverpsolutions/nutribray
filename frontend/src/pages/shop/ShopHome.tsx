import React, { useEffect, useState } from 'react';
import { ShoppingBag, ChevronRight, Zap, Star } from 'lucide-react';
import api from '../../api/axios';
import ProductCard from '../../components/shop/ProductCard';
import { shopService } from '../../services/shopService';


const ShopHome: React.FC = () => {
  const [categories, setCategories] = useState<any[]>([]);
  const [featured, setFeatured] = useState<any[]>([]);
  const [banners, setBanners] = useState<any[]>([]);
  const [currentBanner, setCurrentBanner] = useState(0);
  const [loading, setLoading] = useState(true);
  
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return { text: "Good Morning!", sub: "Get your fresh breakfast items in 15 mins" };
    if (hour < 17) return { text: "Good Afternoon!", sub: "Stock up on your midday essentials" };
    return { text: "Good Evening!", sub: "Dinner is served. Fast delivery to your door." };
  };
  
  const greeting = getGreeting();

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [catRes, featRes, bannerRes] = await Promise.all([
          api.get(`/shop/categories`),
          api.get(`/shop/featured`),
          shopService.getBanners()
        ]);
        setCategories(catRes.data.slice(0, 8));
        setFeatured(featRes.data);
        setBanners(bannerRes);
      } catch (err) {
        console.error('Error fetching shop data:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  useEffect(() => {
    if (banners.length > 1) {
      const interval = setInterval(() => {
        setCurrentBanner(prev => (prev + 1) % banners.length);
      }, 5000);
      return () => clearInterval(interval);
    }
  }, [banners]);

  return (
    <div className="space-y-8 pb-12">
      {/* Hero Section */}
      <section className="relative h-[300px] md:h-[500px] overflow-hidden bg-slate-100">
        {banners.length > 0 ? (
          banners.map((banner, index) => (
            <div 
              key={banner.id}
              className={`absolute inset-0 transition-opacity duration-1000 ${index === currentBanner ? 'opacity-100 z-10' : 'opacity-0 z-0'}`}
            >
              <img 
                src={banner.image} 
                alt={banner.title} 
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/30 to-transparent flex items-center">
                <div className="max-w-7xl mx-auto px-6 w-full">
                  <div className="max-w-xl space-y-6 animate-in slide-in-from-left-8 duration-700">
                    <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-green-500 text-white rounded-full text-xs font-black uppercase tracking-widest shadow-lg shadow-green-500/20">
                      <Zap className="w-3 h-3 fill-white" />
                      Limited Time Offer
                    </div>
                    <h1 className="text-4xl md:text-7xl font-black text-white leading-[1.1]">
                      {banner.title || 'Freshness Delivered.'}
                    </h1>
                    <p className="text-slate-100 text-lg md:text-2xl font-medium max-w-md drop-shadow-md">
                      Premium quality groceries delivered in under 30 minutes.
                    </p>
                    <div className="flex gap-4">
                      <button className="px-10 py-5 bg-green-600 hover:bg-green-700 text-white rounded-2xl font-black text-xl transition-all transform hover:scale-105 shadow-2xl shadow-green-900/40">
                        Shop Now
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))
        ) : (
          <>
            <img 
              src="/banners/hero.png" 
              alt="Fresh Groceries" 
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-black/60 to-transparent flex items-center">
              <div className="max-w-7xl mx-auto px-6 w-full">
                <div className="max-w-lg space-y-4">
                  <div className="inline-flex items-center gap-2 px-3 py-1 bg-green-500/20 backdrop-blur-md border border-green-500/30 rounded-full text-green-400 text-xs font-bold uppercase tracking-wider">
                    <Zap className="w-3 h-3" />
                    Fastest Delivery in Town
                  </div>
                  <h1 className="text-4xl md:text-6xl font-extrabold text-white leading-tight">
                    Freshness <br /> 
                    <span className="text-green-400">Delivered</span> to Your <br />
                    Doorstep.
                  </h1>
                  <p className="text-slate-200 text-lg md:text-xl font-medium max-w-sm">
                    Get premium quality groceries delivered in under 30 minutes.
                  </p>
                  <button className="px-8 py-4 bg-green-600 hover:bg-green-700 text-white rounded-xl font-bold text-lg transition-all transform hover:scale-105 shadow-xl shadow-green-900/20">
                    Shop Now
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
        
        {/* Banner Indicators */}
        {banners.length > 1 && (
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-20 flex gap-2">
            {banners.map((_, i) => (
              <button 
                key={i}
                onClick={() => setCurrentBanner(i)}
                className={`h-1.5 rounded-full transition-all ${i === currentBanner ? 'w-8 bg-green-500' : 'w-2 bg-white/50 hover:bg-white'}`}
              />
            ))}
          </div>
        )}
      </section>

      <div className="max-w-7xl mx-auto px-4 space-y-12">
        {/* Time-Aware Greeting */}
        <div className="bg-gradient-to-r from-yellow-400/10 to-transparent p-6 rounded-3xl border border-yellow-400/20">
          <h2 className="text-3xl font-black text-slate-800">{greeting.text}</h2>
          <p className="text-slate-500 font-bold">{greeting.sub}</p>
        </div>

        {/* Categories Section (Bento Grid Style) */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-black text-slate-800">Explore Categories</h2>
            <button className="text-yellow-600 font-black flex items-center gap-1 hover:underline">
              View All <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {loading ? (
              Array(6).fill(0).map((_, i) => (
                <div key={i} className="aspect-square bg-slate-200 rounded-3xl animate-pulse" />
              ))
            ) : (
              categories.map((cat, i) => (
                <button 
                  key={cat.id} 
                  className={`tactile-card group relative overflow-hidden rounded-3xl p-6 text-left flex flex-col justify-between h-48 ${
                    i % 4 === 0 ? 'md:col-span-2 bg-yellow-50 border-yellow-100' : 'bg-white'
                  }`}
                >
                  <div className="relative z-10">
                    <span className="text-lg font-black text-slate-800 group-hover:text-yellow-600 transition-colors">
                      {cat.name}
                    </span>
                  </div>
                  <div className="absolute bottom-4 right-4 w-24 h-24 transform group-hover:scale-110 transition-transform">
                    <img 
                      src={`https://ui-avatars.com/api/?name=${cat.name}&background=fde68a&color=92400e&bold=true`} 
                      alt={cat.name} 
                      className="w-full h-full object-contain drop-shadow-xl"
                    />
                  </div>
                </button>
              ))
            )}
          </div>
        </section>

        {/* Best Sellers */}
        <section className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                <Star className="text-yellow-400 fill-yellow-400 w-6 h-6" />
                Best Sellers
              </h2>
              <p className="text-slate-500 text-sm font-medium">Most loved items in your area</p>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-6">
            {loading ? (
              Array(5).fill(0).map((_, i) => (
                <div key={i} className="bg-white rounded-3xl p-4 space-y-4 animate-pulse">
                  <div className="aspect-square bg-slate-100 rounded-2xl" />
                  <div className="space-y-2">
                    <div className="h-4 bg-slate-100 rounded-full" />
                    <div className="h-4 bg-slate-100 rounded-full w-2/3" />
                  </div>
                </div>
              ))
            ) : (
              featured.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
};

export default ShopHome;

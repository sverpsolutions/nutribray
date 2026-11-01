import React, { useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { ShoppingCart, Home, Search, User, Menu, X } from 'lucide-react';
import { useCartStore } from '../store/useCartStore';
import { useTheme } from '../context/ThemeContext';
const ShopLayout: React.FC = () => {
  const { theme } = useTheme();
  const location = useLocation();
  const cartItems = useCartStore((state) => state.items);
  const totalItems = cartItems.reduce((acc, item) => acc + item.quantity, 0);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const isActive = (path: string) => location.pathname === path;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      {/* Top Header */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link to="/shop" className="flex items-center gap-3 group">
            <div className={`w-11 h-11 rounded-2xl flex items-center justify-center transition-all ${
              theme === 'yellow' ? 'bg-yellow-400 shadow-lg shadow-yellow-200' : 'bg-green-600 shadow-lg shadow-green-200'
            }`}>
              <ShoppingCart className={`${theme === 'yellow' ? 'text-slate-900' : 'text-white'} w-6 h-6 group-hover:scale-110 transition-transform`} />
            </div>
            <span className={`text-2xl font-black hidden sm:block ${
              theme === 'yellow' ? 'text-slate-900' : 'bg-gradient-to-r from-green-700 to-green-500 bg-clip-text text-transparent'
            }`}>
              Modern<span className={theme === 'yellow' ? 'text-yellow-500' : ''}>Bazaar</span>
            </span>
          </Link>

          {/* Desktop Search */}
          <div className="hidden md:flex flex-1 max-w-md mx-8">
            <div className="relative w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
              <input
                type="text"
                placeholder="Search for groceries..."
                className={`w-full pl-10 pr-4 py-2.5 bg-slate-100 border-none rounded-full focus:ring-2 transition-all outline-none ${
                  theme === 'yellow' ? 'focus:ring-yellow-400' : 'focus:ring-green-500'
                }`}
              />
            </div>
          </div>

          <div className="flex items-center gap-4">
            <Link to="/shop/cart" className="relative p-2 text-slate-600 hover:bg-slate-100 rounded-full transition-colors">
              <ShoppingCart className="w-6 h-6" />
              {totalItems > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center animate-bounce">
                  {totalItems}
                </span>
              )}
            </Link>
            <button className="p-2 text-slate-600 hover:bg-slate-100 rounded-full md:hidden" onClick={() => setIsMenuOpen(!isMenuOpen)}>
              {isMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
            <button className={`hidden md:flex items-center gap-2 px-6 py-2.5 rounded-full font-black text-sm transition-all shadow-lg tactile-btn ${
              theme === 'yellow' ? 'bg-yellow-400 text-slate-900 shadow-yellow-100' : 'bg-green-600 text-white shadow-green-100'
            }`}>
              <User className="w-4 h-4" />
              Sign In
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 pb-20 md:pb-0">
        <Outlet />
      </main>

      {/* Bottom Navigation (Mobile Only) */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white/90 backdrop-blur-xl border-t border-slate-100 px-6 h-18 flex items-center justify-between z-50 pb-safe">
        <Link to="/shop" className={`flex flex-col items-center gap-1 transition-colors ${
          isActive('/shop') ? (theme === 'yellow' ? 'text-yellow-600' : 'text-green-600') : 'text-slate-400'
        }`}>
          <Home className="w-6 h-6" />
          <span className="text-[10px] font-black uppercase tracking-widest">Home</span>
        </Link>
        <Link to="/shop/search" className={`flex flex-col items-center gap-1 transition-colors ${
          isActive('/shop/search') ? (theme === 'yellow' ? 'text-yellow-600' : 'text-green-600') : 'text-slate-400'
        }`}>
          <Search className="w-6 h-6" />
          <span className="text-[10px] font-black uppercase tracking-widest">Search</span>
        </Link>
        <Link to="/shop/cart" className={`flex flex-col items-center gap-1 transition-colors ${
          isActive('/shop/cart') ? (theme === 'yellow' ? 'text-yellow-600' : 'text-green-600') : 'text-slate-400'
        }`}>
          <div className="relative">
            <ShoppingCart className="w-6 h-6" />
            {totalItems > 0 && (
              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[8px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
                {totalItems}
              </span>
            )}
          </div>
          <span className="text-[10px] font-black uppercase tracking-widest">Cart</span>
        </Link>
        <Link to="/shop/profile" className={`flex flex-col items-center gap-1 transition-colors ${
          isActive('/shop/profile') ? (theme === 'yellow' ? 'text-yellow-600' : 'text-green-600') : 'text-slate-400'
        }`}>
          <User className="w-6 h-6" />
          <span className="text-[10px] font-black uppercase tracking-widest">Profile</span>
        </Link>
      </nav>
    </div>
  );
};

export default ShopLayout;

import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Command, ArrowRight, CornerDownLeft, Sparkles } from 'lucide-react';
import { APP_ROUTES, RouteConfig } from '../../routes/config';
import { useTabStore } from '../../store/tabStore';
import { audit_api } from '../../api/audit';
import { matchesSearch } from '../../utils/search';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function CommandPalette({ isOpen, onClose }: CommandPaletteProps) {
  const navigate = useNavigate();
  const addTab = useTabStore((s) => s.addTab);
  const [search, setSearch] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Filter routes based on search
  const filteredRoutes = APP_ROUTES.filter((route) => {
    if (!route.title || !route.path) return false;
    const titleMatch = matchesSearch(search, route.title);
    const pathMatch = matchesSearch(search, route.path);
    const idMatch = route.id.includes(search);
    return titleMatch || pathMatch || idMatch;
  }).slice(0, 8); // limit results for speed and design

  // Keyboard navigation inside the palette
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % Math.max(1, filteredRoutes.length));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + filteredRoutes.length) % Math.max(1, filteredRoutes.length));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filteredRoutes[selectedIndex]) {
          handleSelect(filteredRoutes[selectedIndex]);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, filteredRoutes, selectedIndex]);

  // Focus input on open
  useEffect(() => {
    if (isOpen) {
      setSearch('');
      setSelectedIndex(0);
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  const handleSelect = (route: RouteConfig) => {
    addTab({ id: route.path, title: route.title, path: route.path });
    audit_api.log({
      action: 'OPEN',
      module: route.title,
      details: `Opened via Command Palette (Shortcut)`
    });
    navigate(route.path);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[20000] flex items-start justify-center pt-[15vh] px-4 bg-slate-950/40 backdrop-blur-md animate-in fade-in duration-200">
      <div 
        ref={containerRef}
        className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden border border-slate-200/80 animate-in zoom-in-95 duration-200 flex flex-col max-h-[60vh] focus-within:ring-4 focus-within:ring-yellow-500/10 transition-all"
      >
        {/* Search input container */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100 bg-slate-50/50">
          <Search className="text-slate-400 shrink-0" size={20} />
          <input
            ref={inputRef}
            type="text"
            placeholder="Type a form name, route path, or shortcut code..."
            className="flex-1 bg-transparent border-0 outline-none text-slate-800 placeholder-slate-400 font-medium text-[15px]"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setSelectedIndex(0);
            }}
          />
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-white border border-slate-200 shadow-sm shrink-0">
            <kbd className="text-[10px] font-mono font-bold text-slate-400">ESC</kbd>
            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter">to close</span>
          </div>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto py-2">
          {filteredRoutes.length > 0 ? (
            <div className="space-y-0.5 px-2">
              <div className="px-3 py-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                <Sparkles size={12} className="text-yellow-500" />
                Forms & Transactions ({filteredRoutes.length})
              </div>
              {filteredRoutes.map((route, idx) => {
                const isSelected = idx === selectedIndex;
                return (
                  <div
                    key={route.id}
                    onClick={() => handleSelect(route)}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    className={`flex items-center justify-between px-3.5 py-3 rounded-2xl cursor-pointer transition-all duration-150 ${
                      isSelected 
                        ? 'bg-yellow-50 text-slate-900 border-l-4 border-yellow-500 pl-2.5 font-bold shadow-sm' 
                        : 'text-slate-600 hover:bg-slate-50/80 font-semibold'
                    }`}
                  >
                    <div className="flex items-center gap-3.5 min-w-0">
                      <div className={`w-8 h-8 rounded-xl flex items-center justify-center font-bold text-[10px] font-mono shrink-0 transition-colors ${
                        isSelected ? 'bg-yellow-200 text-yellow-800' : 'bg-slate-100 text-slate-500'
                      }`}>
                        {route.id}
                      </div>
                      <div className="min-w-0">
                        <p className="text-[13px] leading-tight truncate">{route.title}</p>
                        <p className="text-[9px] text-slate-400 font-mono tracking-tighter truncate mt-0.5">{route.path}</p>
                      </div>
                    </div>
                    {isSelected && (
                      <div className="flex items-center gap-1.5 text-[10px] text-yellow-700 bg-yellow-100/50 px-2 py-0.5 rounded-lg shrink-0 font-bold font-mono">
                        <span>Go</span>
                        <CornerDownLeft size={10} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="p-8 text-center text-slate-400">
              <Command size={32} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm font-semibold">No forms or routes found</p>
              <p className="text-[10px] mt-1 uppercase tracking-widest opacity-60">Try searching for "item", "bill", "salary" or "reports"</p>
            </div>
          )}
        </div>

        {/* Footer shortcuts helper */}
        <div className="bg-slate-50 border-t border-slate-100 px-5 py-3.5 flex items-center justify-between text-[10px] font-bold text-slate-400 uppercase tracking-wider shrink-0">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-white border border-slate-200 rounded shadow-sm font-mono text-[9px] text-slate-500">↑↓</kbd>
              Navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-white border border-slate-200 rounded shadow-sm font-mono text-[9px] text-slate-500">Enter</kbd>
              Select
            </span>
          </div>
          <span className="text-yellow-600 flex items-center gap-1 font-black">
            Nutribray Command Center
          </span>
        </div>
      </div>
    </div>
  );
}

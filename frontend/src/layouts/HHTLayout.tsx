import React, { ReactNode, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

interface HHTLayoutProps {
  children: ReactNode;
  title: string;
  onBack?: () => void;
}

const HHTLayout: React.FC<HHTLayoutProps> = ({ children, title, onBack }) => {
  const navigate = useNavigate();

  // Prevent double-tap zoom
  useEffect(() => {
    let lastTap = 0;
    const handler = (e: TouchEvent) => {
      const now = Date.now();
      if (now - lastTap < 300) e.preventDefault();
      lastTap = now;
    };
    document.addEventListener('touchend', handler, { passive: false });
    return () => document.removeEventListener('touchend', handler);
  }, []);

  return (
    <div
      className="flex flex-col bg-slate-100"
      style={{
        height: '100dvh',           // dynamic viewport height (handles iOS toolbar)
        overflow: 'hidden',
        touchAction: 'pan-y',       // allow scroll but block pinch-zoom
        WebkitUserSelect: 'none',
        userSelect: 'none',
      }}
    >
      {/* Top App Bar */}
      <div className="bg-blue-800 text-white flex items-center px-3 py-2 shrink-0 shadow-md"
        style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}>
        <button
          onClick={onBack ?? (() => navigate('/hht'))}
          className="p-2 rounded-full hover:bg-blue-700 active:bg-blue-600 transition-colors mr-2"
          style={{ WebkitTapHighlightColor: 'transparent' }}
        >
          <i className={`fas ${onBack ? 'fa-arrow-left' : 'fa-sign-out-alt'} text-base`} />
        </button>
        <p className="flex-1 font-black text-base tracking-wide truncate">{title}</p>
        <p className="text-[10px] opacity-70 font-bold uppercase tracking-widest flex-shrink-0">HHT-01</p>
      </div>

      {/* Scrollable content */}
      <div
        className="flex-1 overflow-y-auto p-3 flex flex-col"
        style={{
          overscrollBehavior: 'contain',
          WebkitOverflowScrolling: 'touch',
          paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))',
        }}
      >
        {children}
      </div>

      <div className="hidden">
        <audio id="beep-success" src="/assets/sounds/beep.mp3" />
        <audio id="beep-error" src="/assets/sounds/error.mp3" />
      </div>
    </div>
  );
};

export default HHTLayout;

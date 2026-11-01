import { useEffect, useState } from 'react';
import Sidebar from '../components/Layout/Sidebar';
import Header from '../components/Layout/Header';
import TabBar from '../components/Layout/TabBar'; // Import TabBar
import TabbedOutlet from '../components/Layout/TabbedOutlet';
import { Navigate, useLocation } from 'react-router-dom';
import { useKeyboardNavigation } from '../hooks/useKeyboardNavigation';
import { isAllowed, MFG_HOME } from '../config/mfgOnly';

const AppLayout = () => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isPinned, setIsPinned] = useState(true);
  useKeyboardNavigation(); // Enable Shift+Tab / Ctrl+Tab navigation
  const { pathname } = useLocation();

  // Remember state in localStorage
  useEffect(() => {
    const savedCollapsed = localStorage.getItem('sidebar_collapsed');
    const savedPinned = localStorage.getItem('sidebar_pinned');
    if (savedCollapsed === 'true') setSidebarCollapsed(true);
    if (savedPinned === 'false') setIsPinned(false);
  }, []);

  function handleToggle() {
    setSidebarCollapsed(prev => {
      const next = !prev;
      localStorage.setItem('sidebar_collapsed', String(next));
      return next;
    });
  }

  function handlePinToggle() {
    setIsPinned(prev => {
      const next = !prev;
      localStorage.setItem('sidebar_pinned', String(next));
      return next;
    });
  }

  // Listen to clicks on the document to collapse the sidebar if clicking outside
  useEffect(() => {
    function handleDocumentClick(e: MouseEvent) {
      const sidebarEl = document.getElementById('app-sidebar');
      const toggleBtn = document.getElementById('sidebar-toggle-btn');
      
      // If sidebar is visible (not collapsed)
      if (sidebarEl && !sidebarEl.classList.contains('w-0')) {
        // If click is outside the sidebar and also not on the toggle button
        if (!sidebarEl.contains(e.target as Node) && (!toggleBtn || !toggleBtn.contains(e.target as Node))) {
          setSidebarCollapsed(true);
          localStorage.setItem('sidebar_collapsed', 'true');
        }
      }
    }
    
    document.addEventListener('mousedown', handleDocumentClick);
    return () => {
      document.removeEventListener('mousedown', handleDocumentClick);
    };
  }, []);

  if (!isAllowed(pathname)) return <Navigate to={MFG_HOME} replace />;

  return (
    <div className="flex h-screen overflow-hidden bg-app-bg font-sans">
      {/* ── Left Sidebar ── */}
      <Sidebar 
        collapsed={sidebarCollapsed} 
        onToggle={handleToggle} 
        isPinned={isPinned}
        onPinToggle={handlePinToggle}
      />

      {/* ── Main Area ── */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Top Header */}
        <Header onSidebarToggle={handleToggle} />

        {/* Multi-Tab Bar ── Restored! */}
        <TabBar />

        {/* Page Content */}
        <main className="flex-1 overflow-auto relative">
          <TabbedOutlet />
        </main>
      </div>
    </div>
  );
};

export default AppLayout;

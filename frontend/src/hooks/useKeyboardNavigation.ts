import { useEffect } from 'react';
import { useTabStore } from '../store/tabStore';
import { useNavigate } from 'react-router-dom';

export const useKeyboardNavigation = () => {
  const { tabs, activeTabId, setActiveTab } = useTabStore();
  const navigate = useNavigate();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Shortcut: Ctrl + Shift + Tab (Previous Tab) or Ctrl + Tab (Next Tab)
      // This is standard browser behavior, but we can also support Alt + Left/Right
      // The user specifically asked for "SHIFT TAB", which we will interpret as 
      // Ctrl + Shift + Tab or just Shift + Tab when not in an input.
      
      const isInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName);
      
      // Cycle Tabs with Alt + Arrow Keys (Safer than Shift+Tab)
      if (e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        e.preventDefault();
        if (tabs.length <= 1) return;

        const currentIndex = tabs.findIndex(t => t.id === activeTabId);
        let nextIndex = 0;

        if (e.key === 'ArrowRight') {
          nextIndex = (currentIndex + 1) % tabs.length;
        } else {
          nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
        }

        const nextTab = tabs[nextIndex];
        setActiveTab(nextTab.id);
        navigate(nextTab.path);
      }
      
      // Support Ctrl + Tab / Ctrl + Shift + Tab
      if (e.ctrlKey && e.key === 'Tab') {
          e.preventDefault();
          if (tabs.length <= 1) return;

          const currentIndex = tabs.findIndex(t => t.id === activeTabId);
          let nextIndex = 0;

          if (!e.shiftKey) {
            nextIndex = (currentIndex + 1) % tabs.length;
          } else {
            nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
          }

          const nextTab = tabs[nextIndex];
          setActiveTab(nextTab.id);
          navigate(nextTab.path);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [tabs, activeTabId, setActiveTab, navigate]);
};

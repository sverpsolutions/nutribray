import React from 'react';
import { useTabStore } from '../../store/tabStore';
import { useNavigate } from 'react-router-dom';
import { audit_api } from '../../api/audit';

const TabBar = () => {
  const { tabs, activeTabId, setActiveTab, removeTab } = useTabStore();
  const navigate = useNavigate();

  const handleTabClick = (id: string, path: string) => {
    setActiveTab(id);
    navigate(path);
  };

  const handleClose = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const tabToClose = tabs.find(t => t.id === id);
    if (tabToClose) {
        audit_api.log({
            action: 'CLOSE',
            module: tabToClose.title,
            details: `Closed tab: ${tabToClose.title}`
        });
    }
    removeTab(id);
    
    // Logic to handle navigation after closing
    setTimeout(() => {
      const currentTabs = useTabStore.getState().tabs;
      const currentActiveId = useTabStore.getState().activeTabId;
      if (currentActiveId) {
          const activeTab = currentTabs.find(t => t.id === currentActiveId);
          if (activeTab) navigate(activeTab.path);
      } else {
          navigate('/dashboard');
      }
    }, 0);
  };

  if (tabs.length === 0) return null;

  return (
    <div className="flex items-end gap-1 bg-app-bg border-b border-border px-4 pt-1.5 overflow-x-auto no-scrollbar h-[42px] shrink-0">
      {tabs.map((tab) => {
        const isActive = activeTabId === tab.id;
        return (
          <div
            key={tab.id}
            onClick={() => handleTabClick(tab.id, tab.path)}
            className={`group flex items-center h-full gap-2 pl-3.5 pr-2 cursor-pointer transition-colors rounded-t-lg border border-b-0 min-w-[120px] max-w-[220px] relative ${
              isActive 
                ? 'bg-white text-text-primary border-border -mb-px h-[calc(100%+1px)]' 
                : 'text-text-secondary border-transparent hover:bg-white/70'
            }`}
          >
            <span className={`text-[13px] truncate flex-1 ${isActive ? 'font-semibold' : 'font-medium'}`}>
              {tab.title}
            </span>
            
            <button
              onClick={(e) => handleClose(e, tab.id)}
              aria-label={`Close ${tab.title}`}
              className={`w-6 h-6 rounded flex items-center justify-center transition-colors text-text-muted hover:bg-app-bg hover:text-text-primary ${
                isActive ? '' : 'opacity-0 group-hover:opacity-100'
              }`}
            >
              <i className="fas fa-times text-[10px]"></i>
            </button>
          </div>
        );
      })}
    </div>
  );
};

export default TabBar;

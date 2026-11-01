import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const MAX_TABS = 3;

export interface Tab {
  id: string;
  title: string;
  path: string;
  active: boolean;
}

interface TabState {
  tabs: Tab[];
  activeTabId: string | null;
  addTab: (tab: Omit<Tab, 'active'>) => void;
  removeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
}

export const useTabStore = create<TabState>()(
  persist(
    (set) => ({
      tabs: [],
      activeTabId: null,
      addTab: (tab) =>
        set((state) => {
          // keep only the last MAX_TABS screens: reopening one moves it to the end, opening a new one drops the oldest
          const exists = state.tabs.find((t) => t.path === tab.path);
          const rest = state.tabs.filter((t) => t.path !== tab.path);
          const current = exists ?? { ...tab, active: true };
          return {
            tabs: [...rest, current].slice(-MAX_TABS),
            activeTabId: current.id,
          };
        }),
      removeTab: (id) =>
        set((state) => {
          const newTabs = state.tabs.filter((t) => t.id !== id);
          let newActiveTabId = state.activeTabId;
          if (state.activeTabId === id) {
            newActiveTabId = newTabs.length > 0 ? newTabs[newTabs.length - 1].id : null;
          }
          return {
            tabs: newTabs,
            activeTabId: newActiveTabId,
          };
        }),
      setActiveTab: (id) => set({ activeTabId: id }),
    }),
    {
      name: 'nutribay-tabs',
      // tabs saved before the limit existed: keep the newest ones only
      merge: (saved, current) => {
        const p = (saved ?? {}) as Partial<TabState>;
        const tabs = (p.tabs ?? []).slice(-MAX_TABS);
        return { ...current, ...p, tabs, activeTabId: tabs.some((t) => t.id === p.activeTabId) ? p.activeTabId! : tabs[tabs.length - 1]?.id ?? null };
      },
    }
  )
);

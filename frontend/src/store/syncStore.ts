import { create } from 'zustand';

interface SyncState {
  runningOutlets: Record<number, boolean>;
  setRunning: (outletId: number, isRunning: boolean) => void;
  globalStatus: string | null;
  setGlobalStatus: (status: string | null) => void;
}

export const useSyncStore = create<SyncState>((set) => ({
  runningOutlets: {},
  setRunning: (outletId, isRunning) => 
    set((state) => ({
      runningOutlets: { ...state.runningOutlets, [outletId]: isRunning }
    })),
  globalStatus: null,
  setGlobalStatus: (status) => set({ globalStatus: status }),
}));

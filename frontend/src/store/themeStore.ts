import { create } from 'zustand';

interface ThemeState {
  isDarkMode: boolean;
  isMonochrome: boolean;
  toggleDarkMode: () => void;
  toggleMonochrome: () => void;
}

export const useThemeStore = create<ThemeState>((set) => ({
  isDarkMode: localStorage.getItem('sv_dark_mode') === '1',
  isMonochrome: localStorage.getItem('sv_monochrome') === '1',
  toggleDarkMode: () => set((state) => {
    const newVal = !state.isDarkMode;
    localStorage.setItem('sv_dark_mode', newVal ? '1' : '0');
    // on <html> so CSS variables and getComputedStyle(documentElement) both see it
    document.documentElement.classList.toggle('dark-mode', newVal);
    return { isDarkMode: newVal };
  }),
  toggleMonochrome: () => set((state) => {
    const newVal = !state.isMonochrome;
    localStorage.setItem('sv_monochrome', newVal ? '1' : '0');
    if (newVal) {
      document.body.classList.add('monochrome-mode');
    } else {
      document.body.classList.remove('monochrome-mode');
    }
    return { isMonochrome: newVal };
  }),
}));

// Initialize classes on load
if (typeof document !== 'undefined') {
  if (localStorage.getItem('sv_dark_mode') === '1') {
    document.documentElement.classList.add('dark-mode');
  }
  if (localStorage.getItem('sv_monochrome') === '1') {
    document.body.classList.add('monochrome-mode');
  }
}

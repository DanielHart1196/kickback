import { writable } from 'svelte/store';

/** @type {{ isStandalone: boolean; installStatus: 'idle'|'prompted'|'installing'|'installed'; deferredPrompt: any; installed: boolean; manualInstall: boolean }} */
const initial = {
  isStandalone: false,
  installStatus: 'idle',
  deferredPrompt: null,
  installed: false,
  manualInstall: false
};

const store = writable(initial);

let media = null;

function detectStandalone() {
  try {
    return (
      (typeof window !== 'undefined' &&
        window.matchMedia &&
        window.matchMedia('(display-mode: standalone)').matches) ||
      (
        typeof navigator !== 'undefined' &&
        // iOS Safari exposes non-standard navigator.standalone
        /** @type {any} */ (navigator) &&
        /** @type {any} */ (navigator).standalone === true
      )
    );
  } catch {
    return false;
  }
}

function detectIOS() {
  try {
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    return /iPhone|iPad|iPod/i.test(ua);
  } catch {
    return false;
  }
}

export function init() {
  if (typeof window === 'undefined') return;
  const standalone = detectStandalone();
  store.update((s) => ({
    ...s,
    isStandalone: standalone,
    installed: standalone,
    manualInstall: detectIOS()
  }));

  /** @param {Event & { prompt?: () => void }} e */
  const handleBeforeInstall = (e) => {
    e.preventDefault();
    store.update((s) => ({
      ...s,
      deferredPrompt: e,
      installStatus: 'prompted'
    }));
  };
  const handleInstalled = () => {
    store.update((s) => ({
      ...s,
      installStatus: 'installed',
      installed: true,
      deferredPrompt: null
    }));
  };
  window.addEventListener('beforeinstallprompt', handleBeforeInstall);
  window.addEventListener('appinstalled', handleInstalled);

  media = window.matchMedia('(display-mode: standalone)');
  const updateStandalone = () => {
    const standalone = detectStandalone();
    store.update((s) => ({
      ...s,
      isStandalone: standalone,
      installStatus: standalone ? 'installed' : s.installStatus,
      installed: standalone
    }));
    if (!standalone) {
      try {
        localStorage.removeItem('kickback:pwa_installed');
      } catch {}
    }
  };
  if (media && media.addEventListener) {
    media.addEventListener('change', updateStandalone);
  } else if (media && media.addListener) {
    media.addListener(updateStandalone);
  }
}

export async function promptInstall() {
  let dp = null;
  let status = 'idle';
  store.update((s) => {
    dp = s.deferredPrompt;
    status = s.installStatus;
    return s;
  });
  if (!dp) return;
  store.update((s) => ({ ...s, installStatus: 'installing' }));
  try {
    /** @type {any} */ (dp).prompt?.();
    const choice = await /** @type {any} */ (dp).userChoice;
    if (!choice || choice.outcome !== 'accepted') {
      store.update((s) => ({ ...s, installStatus: 'idle', deferredPrompt: null }));
    }
  } catch {
    store.update((s) => ({ ...s, installStatus: 'idle', deferredPrompt: null }));
  }
}

export const pwaStore = {
  subscribe: store.subscribe
};

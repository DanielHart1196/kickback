<script>
  import { onMount } from 'svelte';
  import { pwaStore, init, promptInstall } from '$lib/stores/pwaStore.js';
  import { supabase } from '$lib/supabase';

  let notificationsEnabled = false;
  let notificationMessage = '';
  let notificationError = false;
  let installing = false;
  let installMessage = '';

  async function ensurePushSubscription() {
    try {
      if (typeof window === 'undefined') return false;
      if (!('serviceWorker' in navigator)) return false;
      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token || '';
      if (!token) return false;
      let reg = await navigator.serviceWorker.getRegistration();
      if (!reg) {
        try {
          await navigator.serviceWorker.register('/service-worker.js');
          reg = await navigator.serviceWorker.getRegistration();
        } catch {
          return false;
        }
      }
      if (!reg) return false;
      const keyRes = await fetch('/api/notifications/vapid-key');
      const keyPayload = await keyRes.json().catch(() => null);
      const publicKey = keyPayload?.publicKey ?? '';
      if (!publicKey) return false;
      const existing = await reg.pushManager.getSubscription();
      const subscription =
        existing ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: Uint8Array.from(
            atob(publicKey.replace(/-/g, '+').replace(/_/g, '/')),
            (c) => c.charCodeAt(0)
          )
        }));
      const resp = await fetch('/api/notifications/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ subscription })
      });
      return resp.ok;
    } catch {
      return false;
    }
  }

  async function toggleNotifications() {
    if (typeof Notification === 'undefined') {
      notificationMessage = 'Notifications not supported';
      notificationError = true;
      return;
    }
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      notificationMessage = 'Requires HTTPS to enable';
      notificationError = true;
      return;
    }
    if (Notification.permission === 'granted') {
      notificationsEnabled = !notificationsEnabled;
      notificationMessage = '';
      notificationError = false;
      if (notificationsEnabled) {
        const ok = await ensurePushSubscription();
        if (!ok) {
          notificationMessage = 'Failed to register push';
          notificationError = true;
        }
      }
      return;
    }
    const result = await Notification.requestPermission();
    notificationsEnabled = result === 'granted';
    notificationMessage = notificationsEnabled ? '' : 'Notifications blocked';
    notificationError = !notificationsEnabled;
    if (notificationsEnabled) {
      const ok = await ensurePushSubscription();
      if (!ok) {
        notificationMessage = 'Failed to register push';
        notificationError = true;
      }
    }
  }

  async function onInstall() {
    installing = true;
    await promptInstall();
    installing = false;
    if (!$pwaStore.isStandalone && !$pwaStore.deferredPrompt) {
      installMessage = 'Use browser menu → Install app';
    } else {
      installMessage = '';
    }
  }

  onMount(() => {
    init();
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistration().then((reg) => {
        if (!reg) {
          navigator.serviceWorker
            .register('/service-worker.js')
            .catch(() => {});
        }
      });
    }
    notificationsEnabled = typeof Notification !== 'undefined' && Notification.permission === 'granted';
    if (notificationsEnabled) {
      void ensurePushSubscription();
    }
  });
</script>

{#if $pwaStore.isStandalone}
  <div class="mt-3 flex items-center justify-between">
    <span id="notifications-label" class="text-[11px] font-bold uppercase tracking-widest text-zinc-400">Enable Notifications</span>
    <button
      type="button"
      on:click={toggleNotifications}
      class={`relative w-12 h-6 rounded-full ${notificationsEnabled ? 'bg-green-500' : 'bg-zinc-700'} transition-colors`}
      aria-pressed={notificationsEnabled}
      aria-labelledby="notifications-label"
    >
      <span class={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${notificationsEnabled ? 'translate-x-6' : ''}`}></span>
    </button>
  </div>
  {#if notificationError}
    <p class="mt-2 text-[10px] font-bold uppercase tracking-widest text-zinc-400">{notificationMessage}</p>
  {/if}
{:else if !$pwaStore.isStandalone && !$pwaStore.installed}
  <button
    type="button"
    on:click={onInstall}
    class="mt-3 w-full rounded-xl bg-white px-4 py-3 text-xs font-black uppercase tracking-[0.2em] text-black hover:bg-zinc-200 transition-colors"
  >
    {installing ? 'Installing...' : 'Install Kickback'}
  </button>
  {#if installMessage}
    <p class="mt-2 text-[10px] font-bold uppercase tracking-widest text-zinc-400">{installMessage}</p>
  {/if}
{:else if !$pwaStore.isStandalone && $pwaStore.installed}
  <p class="mt-3 text-[11px] font-bold uppercase tracking-widest text-zinc-400">Manage notifications from the Kickback app</p>
{:else if $pwaStore.manualInstall}
  <p class="mt-3 text-[11px] font-bold uppercase tracking-widest text-zinc-400">Manual Install: Add to Home Screen from Safari</p>
{:else}
  <p class="mt-3 text-[11px] font-bold uppercase tracking-widest text-zinc-400">Install Kickback to enable notifications</p>
{/if}

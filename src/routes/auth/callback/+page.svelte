<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { supabase } from '$lib/supabase';
  import { buildReferralCodeFromEmail, generateReferralCode, isReferralCodeValid } from '$lib/referrals/code';

  let showSafariHandoff = false;
  let safariHandoffUrl = '';

  function isIosInAppBrowser(): boolean {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent || '';
    const iOS =
      /iPad|iPhone|iPod/.test(ua) ||
      (ua.includes('Macintosh') && typeof document !== 'undefined' && 'ontouchend' in document);
    if (!iOS) return false;
    const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA/.test(ua);
    return !isSafari;
  }

  function buildContinueHereUrl(): string {
    const url = new URL(window.location.href);
    url.searchParams.set('continue_here', '1');
    return url.toString();
  }

  function continueHere() {
    window.location.replace(buildContinueHereUrl());
  }

  async function isReferralCodeAvailable(code: string, userId: string): Promise<boolean> {
    const normalized = String(code ?? '').trim().toUpperCase();
    if (!normalized) return false;
    const { data, error } = await supabase
      .from('profiles')
      .select('id')
      .eq('referral_code', normalized)
      .maybeSingle();
    if (error) throw error;
    if (!data?.id) return true;
    return data.id === userId;
  }

  async function generateUniqueReferralCode(userId: string, email: string): Promise<string> {
    const baseCode = buildReferralCodeFromEmail(email);
    if (baseCode && isReferralCodeValid(baseCode)) {
      if (await isReferralCodeAvailable(baseCode, userId)) return baseCode;
      for (let i = 1; i <= 9; i += 1) {
        const numberedCode = `${baseCode}${i}`;
        if (await isReferralCodeAvailable(numberedCode, userId)) return numberedCode;
      }
    }
    for (let i = 0; i < 20; i += 1) {
      const code = generateReferralCode(4);
      if (await isReferralCodeAvailable(code, userId)) return code;
    }
    return generateReferralCode(4);
  }

  async function ensureProfileBootstrap(
    userId: string,
    userEmail: string,
    role: 'member' | 'owner' | 'admin',
    existingProfile: {
      role?: string | null;
      notify_payout_confirmation?: boolean | null;
      email?: string | null;
      referral_code?: string | null;
      referral_code_original?: string | null;
    } | null
  ) {
    const safeRole: 'member' | 'owner' | 'admin' =
      existingProfile?.role === 'admin' ? 'admin' : role;
    const profilePayload: Record<string, any> = {
      id: userId,
      role: safeRole,
      updated_at: new Date().toISOString()
    };
    if (userEmail) {
      profilePayload.email = userEmail;
    }
    if (!existingProfile) {
      profilePayload.notify_payout_confirmation = true;
    }
    await supabase.from('profiles').upsert(profilePayload);

    const existingReferralCode = existingProfile?.referral_code ?? null;
    const hasReferral = Boolean(existingReferralCode);
    if (hasReferral) {
      if (!existingProfile?.referral_code_original && existingReferralCode) {
        await supabase
          .from('profiles')
          .update({
            referral_code_original: existingReferralCode,
            updated_at: new Date().toISOString()
          })
          .eq('id', userId);
      }
      return;
    }

    const generated = await generateUniqueReferralCode(userId, userEmail || 'member');
    await supabase
      .from('profiles')
      .update({
        referral_code: generated,
        referral_code_original: generated,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId);
  }

  onMount(async () => {
    if (typeof window !== 'undefined') {
      const hash = window.location.hash || '';
      if (hash.includes('access_token') && hash.includes('refresh_token')) {
        const params = new URLSearchParams(hash.replace(/^#/, ''));
        const access_token = params.get('access_token') || '';
        const refresh_token = params.get('refresh_token') || '';
        if (access_token && refresh_token) {
          try {
            await supabase.auth.setSession({ access_token, refresh_token });
            // Clean up URL parameters after auth
            const redirectTo = $page.url.searchParams.get('redirect_to') || '/';
            history.replaceState(history.state, '', redirectTo);
          } catch {}
        }
      }
    }

    let session = null;
    try {
      const exchanged = await supabase.auth.exchangeCodeForSession(window.location.href);
      session = exchanged?.data?.session ?? null;
    } catch {}
    if (!session) {
      const { data: { session: current }, error } = await supabase.auth.getSession();
      if (error) {
        await goto('/login?error=auth_failed');
        return;
      }
      session = current ?? null;
    }

    if (session) {
      const redirectTo = $page.url.searchParams.get('redirect_to') || '/';
      const continueHereRequested = $page.url.searchParams.get('continue_here') === '1';
      const handoffDone = $page.url.searchParams.get('handoff_done') === '1';
      const adminCode = ($page.url.searchParams.get('admin_code') || '').trim();
      const hasValidAdminCode = adminCode === '3095';
      const userEmail = session.user.email || $page.url.searchParams.get('email') || '';
      const { data: existingProfile } = await supabase
        .from('profiles')
        .select('role, notify_payout_confirmation, email, referral_code, referral_code_original')
        .eq('id', session.user.id)
        .maybeSingle();
      const currentRole = existingProfile?.role ?? 'member';
      const isPrivilegedRole = currentRole === 'admin' || currentRole === 'owner';
      const isAbsolute = /^https?:\/\//.test(redirectTo);
      if (isAbsolute) {
        try {
          const target = new URL(redirectTo);
          const isAdmin = target.pathname.includes('/admin');
          if (isAdmin) {
            if (currentRole !== 'admin' && currentRole !== 'owner' && !hasValidAdminCode) {
              await goto('/admin/login?error=admin_code_required');
              return;
            }
            const nextRole: 'admin' | 'owner' =
              currentRole === 'admin' || currentRole === 'owner'
                ? (currentRole as 'admin' | 'owner')
                : 'owner';
            await ensureProfileBootstrap(session.user.id, userEmail, nextRole, existingProfile);
          } else {
            await ensureProfileBootstrap(
              session.user.id,
              userEmail,
              isPrivilegedRole ? (currentRole as 'admin' | 'owner') : 'member',
              existingProfile
            );
          }
          if (target.origin !== window.location.origin) {
            const access_token = session?.access_token ?? '';
            const refresh_token = session?.refresh_token ?? '';
            if (access_token && refresh_token) {
              const url = new URL('/auth/callback', target.origin);
              const path = target.pathname + (target.search || '');
              url.searchParams.set('redirect_to', path || '/');
              const hash = `access_token=${encodeURIComponent(access_token)}&refresh_token=${encodeURIComponent(refresh_token)}`;
              window.location.replace(url.toString() + '#' + hash);
              return;
            }
          }
          window.location.replace(redirectTo);
          return;
        } catch {
          await goto('/');
          return;
        }
      }

      if (!continueHereRequested && !handoffDone && isIosInAppBrowser()) {
        const access_token = session?.access_token ?? '';
        const refresh_token = session?.refresh_token ?? '';
        if (access_token && refresh_token) {
          const handoff = new URL('/auth/callback', window.location.origin);
          handoff.searchParams.set('redirect_to', redirectTo);
          handoff.searchParams.set('handoff_done', '1');
          if (adminCode) {
            handoff.searchParams.set('admin_code', adminCode);
          }
          const hash = `access_token=${encodeURIComponent(access_token)}&refresh_token=${encodeURIComponent(refresh_token)}`;
          safariHandoffUrl = handoff.toString() + '#' + hash;
          showSafariHandoff = true;
          return;
        }
      }

      const isAdmin = redirectTo.includes('/admin');
      if (isAdmin) {
        if (currentRole !== 'admin' && currentRole !== 'owner' && !hasValidAdminCode) {
          await goto('/admin/login?error=admin_code_required');
          return;
        }
        if (currentRole === 'admin' || currentRole === 'owner') {
          await ensureProfileBootstrap(session.user.id, userEmail, currentRole as 'admin' | 'owner', existingProfile);
        }
        if (currentRole !== 'admin' && currentRole !== 'owner' && hasValidAdminCode) {
          await ensureProfileBootstrap(session.user.id, userEmail, 'owner', existingProfile);
        }
        await goto('/admin');
      } else {
        // Create/update profile for regular users
        await ensureProfileBootstrap(
          session.user.id,
          userEmail,
          isPrivilegedRole ? (currentRole as 'admin' | 'owner') : 'member',
          existingProfile
        );
        await goto(redirectTo);
      }
    } else {
      // No session found
      await goto('/login?error=no_session');
    }
  });
</script>

<div class="min-h-screen bg-black text-white flex items-center justify-center">
  {#if showSafariHandoff}
    <div class="w-full max-w-sm px-6 py-8 rounded-3xl border border-zinc-800 bg-zinc-900 text-center space-y-4">
      <h1 class="text-xl font-black uppercase tracking-tight">Open In Safari</h1>
      <p class="text-sm text-zinc-300">
        iPhone in-app browsers do not share sign-in state with Safari. Open Safari to complete sign-in there.
      </p>
      <a
        href={safariHandoffUrl}
        target="_blank"
        rel="noopener noreferrer"
        class="w-full h-11 rounded-full bg-orange-500 text-black font-black text-sm inline-flex items-center justify-center active:scale-95 transition-all"
      >
        Open In Safari
      </a>
      <button
        type="button"
        on:click={continueHere}
        class="w-full h-11 rounded-full border border-zinc-700 text-zinc-100 font-black text-sm inline-flex items-center justify-center active:scale-95 transition-all"
      >
        Continue Here
      </button>
    </div>
  {:else}
    <p>Authenticating...</p>
  {/if}
</div>

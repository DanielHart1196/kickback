<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { supabase } from '$lib/supabase';

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
      const adminCode = ($page.url.searchParams.get('admin_code') || '').trim();
      const hasValidAdminCode = adminCode === '3095';
      const { data: existingProfile } = await supabase
        .from('profiles')
        .select('role, notify_payout_confirmation')
        .eq('id', session.user.id)
        .maybeSingle();
      const currentRole = existingProfile?.role ?? 'member';
      const isPrivilegedRole = currentRole === 'admin' || currentRole === 'owner';
      const isAbsolute = /^https?:\/\//.test(redirectTo);
      if (isAbsolute) {
        try {
          const target = new URL(redirectTo);
          const isSameOrigin = target.origin === window.location.origin;
          if (isPrivilegedRole && isSameOrigin && (target.pathname === '/' || target.pathname === '')) {
            window.location.replace('/admin');
            return;
          }
          const isAdmin = target.pathname.includes('/admin');
          if (isAdmin) {
            if (currentRole !== 'admin' && currentRole !== 'owner' && !hasValidAdminCode) {
              await goto('/admin/login?error=admin_code_required');
              return;
            }
            if (currentRole !== 'admin' && currentRole !== 'owner' && hasValidAdminCode) {
              await supabase.from('profiles').upsert({
                id: session.user.id,
                role: 'owner',
                updated_at: new Date().toISOString()
              });
            }
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
      const isAdmin = redirectTo.includes('/admin');
      if (isAdmin) {
        if (currentRole !== 'admin' && currentRole !== 'owner' && !hasValidAdminCode) {
          await goto('/admin/login?error=admin_code_required');
          return;
        }
        if (currentRole !== 'admin' && currentRole !== 'owner' && hasValidAdminCode) {
          await supabase.from('profiles').upsert({
            id: session.user.id,
            role: 'owner',
            updated_at: new Date().toISOString()
          });
        }
        await goto('/admin');
      } else {
        if (isPrivilegedRole && (redirectTo === '/' || redirectTo === '')) {
          await goto('/admin');
          return;
        }
        // Create/update profile for regular users
        const userEmail = session.user.email || $page.url.searchParams.get('email');
        if (userEmail) {
          const profilePayload: Record<string, any> = {
            id: session.user.id,
            email: userEmail,
            role: isPrivilegedRole ? currentRole : 'member',
            updated_at: new Date().toISOString()
          };
          if (!existingProfile) {
            profilePayload.notify_payout_confirmation = true;
          }
          await supabase.from('profiles').upsert(profilePayload);
        }
        await goto(redirectTo);
      }
    } else {
      // No session found
      await goto('/login?error=no_session');
    }
  });
</script>

<div class="min-h-screen bg-black text-white flex items-center justify-center">
  <p>Authenticating...</p>
</div>

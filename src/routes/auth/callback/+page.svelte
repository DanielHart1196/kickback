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
            history.replaceState(history.state, '', window.location.pathname + window.location.search);
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
      const isAbsolute = /^https?:\/\//.test(redirectTo);
      if (isAbsolute) {
        try {
          const target = new URL(redirectTo);
          const isAdmin = target.pathname.includes('/admin');
          if (isAdmin) {
            const { data: profile } = await supabase
              .from('profiles')
              .select('role')
              .eq('id', session.user.id)
              .maybeSingle();
            const currentRole = profile?.role ?? 'member';
            if (currentRole !== 'admin' && currentRole !== 'owner') {
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
        const { data: profile } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', session.user.id)
          .maybeSingle();
        const currentRole = profile?.role ?? 'member';
        if (currentRole !== 'admin' && currentRole !== 'owner') {
          await supabase.from('profiles').upsert({
            id: session.user.id,
            role: 'owner',
            updated_at: new Date().toISOString()
          });
        }
        await goto('/admin');
      } else {
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

<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { supabase } from '$lib/supabase';

  let checking = true;

  async function guardAdmin() {
    if ($page.route.id === '/admin/login') {
      checking = false;
      return;
    }

    const { data: sessionData } = await supabase.auth.getSession();
    const session = sessionData.session;
    if (!session?.user) {
      window.location.href = '/admin/login';
      return;
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', session.user.id)
      .maybeSingle();

    const role = profile?.role ?? 'member';
    if (role !== 'owner' && role !== 'admin') {
      window.location.href = '/';
      return;
    }

    checking = false;
  }

  onMount(guardAdmin);
</script>

{#if !checking}
  <slot />
{/if}

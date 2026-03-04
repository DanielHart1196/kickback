<script lang="ts">
  import { onMount } from 'svelte';
  import { supabase } from '$lib/supabase';

  const payoutSetupLinkKey = 'kickback:open_payout_setup_link';

  onMount(async () => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(payoutSetupLinkKey, '1');
    } catch {}

    const { data } = await supabase.auth.getSession();
    if (data.session?.user) {
      window.location.replace('/?payout=1');
      return;
    }
    window.location.replace('/login');
  });
</script>

<main class="min-h-screen bg-black text-white"></main>

<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { supabase } from '$lib/supabase';

  onMount(async () => {
    const { data: { session }, error } = await supabase.auth.getSession();
    
    if (error) {
      console.error('Error getting session:', error);
      await goto('/login?error=auth_failed');
      return;
    }

    if (session) {
      // Check if this is an admin login (redirected from /admin)
      const redirectTo = $page.url.searchParams.get('redirect_to') || '/';
      const isAdmin = redirectTo.includes('/admin');
      
      if (isAdmin) {
        // Set admin role in profiles table for new users
        const { error: profileError } = await supabase.from('profiles').upsert({
          id: session.user.id,
          role: 'owner',
          updated_at: new Date().toISOString()
        });
        
        if (profileError) {
          console.error('Error setting admin role:', profileError);
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

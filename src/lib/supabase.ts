import { createClient } from '@supabase/supabase-js';

// PASTE YOUR ACTUAL STRINGS HERE TEMPORARILY
const supabaseUrl = 'https://zrrdofyetfiybmtllxzh.supabase.co';
const supabaseAnonKey = 'sb_publishable_XfJGX54Iz2EdIVpt-WZPWg_RqRU_Y7J';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
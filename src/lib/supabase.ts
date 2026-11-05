import { createClient } from '@supabase/supabase-js'

// Browser client: anon key only. The service role key never reaches src/ or any VITE_* variable.
export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY)

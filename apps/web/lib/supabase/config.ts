/** Canonical public settings take precedence over legacy project-specific aliases. */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_FREMWORK_SUPABASE_URL || 'https://jwznteirgsnebvtswppu.supabase.co';
export const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_FREMWORK_SUPABASE_KEY || 'sb_publishable_jSU3BbnNVHojq0teQR8j-A_3Au5k5k6';

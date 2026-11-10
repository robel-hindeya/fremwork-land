/** Workspace that each landing site hands signed-in users to, when NEXT_PUBLIC_APP_URL is not set. */
const PAIRED_WORKSPACE: Record<string, string> = {
  'fremwork-land.onrender.com': 'https://fremwork-app.onrender.com',
};

/**
 * Fremwork AI workspace for the current site. NEXT_PUBLIC_APP_URL wins; otherwise the Render landing
 * site pairs with the Render workspace, and everything else uses app.fremwork.com.
 */
export function workspaceUrl(hostname?: string): string {
  const configured = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/+$/, '');
  if (configured) return configured;
  const host = hostname ?? (typeof window !== 'undefined' ? window.location.hostname : '');
  return PAIRED_WORKSPACE[host] || 'https://app.fremwork.com';
}

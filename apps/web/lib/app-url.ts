/** Fremwork AI, the product itself. */
export const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://fremai.vercel.app';

/**
 * Where "Log in" links point. After the handover only the app holds the session, so signed-in users
 * go straight to their chats and everyone else is sent back to this site's /login by the app.
 */
export const APP_LOGIN_URL = `${APP_URL}/chat`;

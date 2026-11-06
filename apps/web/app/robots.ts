import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  const baseUrl = (process.env.NEXT_PUBLIC_SITE_URL || 'https://www.fremwork.com').replace(/\/+$/, '');
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/events', '/signup', '/login'],
        disallow: ['/admin/', '/auth/', '/set-password'],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}

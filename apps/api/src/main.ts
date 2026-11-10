import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import express, { type Express } from 'express';
import { AppModule } from './app.module';

let cachedServer: Express | null = null;

export async function bootstrapServer(): Promise<Express> {
  if (cachedServer) {
    return cachedServer;
  }
  const expressApp = express();
  // Behind Vercel's proxy (one hop): use the client IP from X-Forwarded-For so the rate limit is per visitor,
  // not one shared bucket for everyone.
  if (process.env.VERCEL || process.env.TRUST_PROXY === 'true') expressApp.set('trust proxy', 1);
  expressApp.use(express.json({ limit: '1mb' }));
  expressApp.use(express.urlencoded({ extended: true, limit: '1mb' }));
  const app = await NestFactory.create(AppModule, new ExpressAdapter(expressApp), { bodyParser: false });

  // WEB_URL is a comma-separated list of sites allowed to call the API, e.g.
  // "https://fremwork.com,https://fremwork-web.vercel.app". Set ALLOW_VERCEL_PREVIEWS=true
  // to also allow Vercel preview deployments (*.vercel.app).
  const allowed = (process.env.WEB_URL ?? 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  // Off unless explicitly enabled: anyone can deploy a *.vercel.app site.
  const previews = process.env.ALLOW_VERCEL_PREVIEWS === 'true';
  app.enableCors({
    origin: (origin: string | undefined, cb: (err: Error | null, ok?: boolean) => void) => {
      if (!origin) return cb(null, true); // curl, server-to-server
      const ok = allowed.includes(origin) || (previews && /^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(origin));
      cb(null, ok);
    },
    credentials: false,
    exposedHeaders: ['Content-Disposition'],
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }));

  await app.init();
  cachedServer = expressApp;
  return expressApp;
}

// Standalone execution (when run directly: node dist/main.js)
if (typeof require !== 'undefined' && require.main === module) {
  bootstrapServer().then((server) => {
    const port = Number(process.env.PORT ?? 4000);
    server.listen(port, () => {
      const allowed = (process.env.WEB_URL ?? 'http://localhost:3000')
        .split(',')
        .map((o) => o.trim().replace(/\/+$/, ''))
        .filter(Boolean);
      console.log(`Fremwork API on port ${port}. Allowed sites: ${allowed.join(', ')}`);
    });
  }, (err) => {
    console.error('Fremwork API failed to start:', err);
    process.exit(1);
  });
}

// Vercel Serverless Function handler
export default async function handler(req: any, res: any) {
  const server = await bootstrapServer();
  return server(req, res);
}

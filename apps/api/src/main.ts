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
  const previews = process.env.ALLOW_VERCEL_PREVIEWS !== 'false';
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
  });
}

// Vercel Serverless Function handler
export default async function handler(req: any, res: any) {
  const server = await bootstrapServer();
  return server(req, res);
}

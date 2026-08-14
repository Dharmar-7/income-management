import 'dotenv/config';
import './instrument'; // Sentry — must load before Nest/Prisma
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import helmet from 'helmet';
import compression from 'compression';
import { json, urlencoded } from 'express';

// Crash immediately if any required environment variable is missing.
// Better to fail loudly at boot than to fail silently during a real request.
function validateEnv() {
  const required = [
    'DATABASE_URL',
    'CLERK_SECRET_KEY',
    'CLERK_PUBLISHABLE_KEY',
  ];
  const missing = required.filter(key => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n` +
      'Check your .env file.',
    );
  }
}

async function bootstrap() {
  validateEnv();

  // bodyParser disabled so we can raise the JSON limit: documents arrive as
  // base64 in JSON, and a 10 MB file is ~13.4 MB encoded — Express's default
  // 100 KB limit would reject them with 413.
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.use(json({ limit: '15mb' }));
  app.use(urlencoded({ extended: true, limit: '15mb' }));

  // Helmet — sets ~15 secure HTTP response headers automatically.
  // e.g. X-Content-Type-Options: nosniff, X-Frame-Options: DENY, etc.
  app.use(helmet());

  // gzip responses — big win for large JSON payloads (transaction lists,
  // reports, and especially notes whose images are inlined as base64 data URLs).
  app.use(compression());

  // CORS — CORS is browser-enforced, so it only gates the WEB app; the native
  // mobile app (no Origin header) is unaffected. In production set CORS_ORIGINS
  // to a comma-separated allowlist of your web origins to lock this down. When
  // it's unset (local dev), we reflect the request origin for convenience.
  const corsOrigins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean);
  app.enableCors({
    origin: corsOrigins.length > 0 ? corsOrigins : true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  // Global ValidationPipe — applies to every @Body() in every controller.
  //
  // whitelist: true            — silently strips properties not in the DTO
  // forbidNonWhitelisted: true — throws 400 if client sends unknown properties
  // transform: true            — auto-converts plain JSON to DTO class instances
  //                              (e.g. "5" → 5 when @IsNumber() is declared)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  await app.listen(process.env.PORT ?? 4000, '0.0.0.0');
  console.log(`API running on port ${process.env.PORT ?? 4000}`);
}
bootstrap();

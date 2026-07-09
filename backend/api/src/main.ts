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

  // bodyParser disabled so we can raise the JSON limit: documents and note
  // images arrive as base64 in JSON, and a 5 MB file is ~6.8 MB encoded —
  // Express's default 100 KB limit would reject them with 413.
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.use(json({ limit: '8mb' }));
  app.use(urlencoded({ extended: true, limit: '8mb' }));

  // Helmet — sets ~15 secure HTTP response headers automatically.
  // e.g. X-Content-Type-Options: nosniff, X-Frame-Options: DENY, etc.
  app.use(helmet());

  // gzip responses — big win for large JSON payloads (transaction lists,
  // reports, and especially notes whose images are inlined as base64 data URLs).
  app.use(compression());

  // CORS — only allow requests from our web and mobile apps
  app.enableCors({
    origin: true,  // Allow all origins in development
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

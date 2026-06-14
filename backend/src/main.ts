import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { assertSafeJwtSecrets } from './auth/jwt.config';

function securityHeaders(req: { path?: string }, res: { setHeader: (name: string, value: string) => void }, next: () => void) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (req.path?.startsWith('/api')) {
    res.setHeader('Cache-Control', 'no-store');
  }
  next();
}

function createRateLimiter(windowMs: number, max: number) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (req: { ip?: string; path?: string }, res: { setHeader: (name: string, value: string) => void; status: (code: number) => { json: (body: unknown) => void } }, next: () => void) => {
    const now = Date.now();
    const key = `${req.ip ?? 'unknown'}:${req.path ?? ''}`;
    const current = hits.get(key);
    if (!current || current.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }
    current.count += 1;
    if (current.count > max) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((current.resetAt - now) / 1000))));
      res.status(429).json({ message: 'Слишком много запросов. Попробуйте позже.' });
      return;
    }
    next();
  };
}

async function bootstrap() {
  assertSafeJwtSecrets();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  // QR-код заведения загружается как data URL → увеличиваем лимит тела запроса.
  app.useBodyParser('json', { limit: '6mb' });
  app.useBodyParser('urlencoded', { limit: '6mb', extended: true });
  app.set('trust proxy', 1);
  app.use(securityHeaders);
  app.use('/api/auth/login', createRateLimiter(60_000, 10));
  app.use('/api/auth/refresh', createRateLimiter(60_000, 20));

  const corsOrigin = (process.env.CORS_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim());

  app.enableCors({
    origin: corsOrigin,
    credentials: true,
  });

  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  Logger.log(`🚀 API запущен на http://localhost:${port}/api`, 'Bootstrap');
}
bootstrap();

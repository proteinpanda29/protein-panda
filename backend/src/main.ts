import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ValidationPipe } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import helmet from '@fastify/helmet';
import { AppModule } from './app.module';
import { PrismaExceptionFilter } from './common/prisma-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    // rawBody:true keeps the exact request bytes available as req.rawBody
    // alongside the normal parsed req.body — needed for the Razorpay
    // webhook, whose signature is computed over the raw JSON bytes, not
    // the re-serialized parsed object (those can differ in whitespace/key
    // order and would silently break verification).
    { rawBody: true },
  );

  // Explicitly use the socket.io adapter — it attaches to the underlying
  // Node HTTP server regardless of Fastify vs Express, but Nest needs this
  // set explicitly when the platform adapter isn't the default Express one.
  app.useWebSocketAdapter(new IoAdapter(app));

  // Real security headers, not just "we validated input" — CSP, HSTS,
  // X-Frame-Options, X-Content-Type-Options, etc. contentSecurityPolicy
  // is disabled here specifically because this API serves JSON to a
  // separately-hosted Next.js frontend, not HTML pages itself — a CSP
  // header on a pure JSON API provides no protection and can only ever
  // cause confusing false-positive blocks if ever misconfigured. The
  // frontend (a separate Next.js deployment) should set its own CSP
  // appropriate to the HTML/scripts it actually serves.
  await app.register(helmet, { contentSecurityPolicy: false });

  app.enableCors({
    origin: process.env.FRONTEND_URL ?? 'http://localhost:3000',
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.setGlobalPrefix('api');

  app.useGlobalFilters(new PrismaExceptionFilter());

  const port = process.env.PORT ? Number(process.env.PORT) : 4000;
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`API running on port ${port}`);
}

bootstrap();

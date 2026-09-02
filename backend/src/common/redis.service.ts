import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService extends Redis implements OnModuleDestroy {
  private logger = new Logger('RedisService');

  constructor() {
    super(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      // ioredis's own default already backs off (starts fast, ramps up
      // to a 2s cap) — but retries forever with no ceiling by default.
      // Capping it means a genuinely dead Redis (not just a blip)
      // eventually stops trying every 2 seconds forever and settles at
      // a calmer 10s interval, and any Redis command issued while
      // disconnected fails fast (below) instead of queueing up
      // indefinitely waiting for a reconnect that isn't coming.
      retryStrategy: (times) => Math.min(times * 100, 10_000),
      maxRetriesPerRequest: 3,
    });

    // Without this, a connection blip (Redis restarting, a network hiccup)
    // fires an unhandled 'error' event on this EventEmitter — ioredis
    // itself still retries the connection internally, but Node treats an
    // un-listened 'error' event as a serious condition and, depending on
    // the exact timing/version, that can escalate to an uncaught
    // exception that takes down the whole API process over what should
    // be a recoverable, temporary Redis outage. Found via a real
    // boot-and-request integration test, not a unit test — this class
    // was too trivial to have ever gotten one, and a mocked test
    // wouldn't exercise real EventEmitter behavior anyway.
    this.on('error', (err) => {
      this.logger.warn(`Redis connection error (will keep retrying): ${err.message}`);
    });
  }

  async onModuleDestroy() {
    this.disconnect();
  }
}

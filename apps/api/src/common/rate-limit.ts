import { HttpException, HttpStatus, Injectable, NestMiddleware, OnModuleInit } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { NextFunction, Request, Response } from 'express';
import type { Collection, Connection } from 'mongoose';
import { config } from '../config.js';

interface Bucket {
  _id: string;
  count: number;
  expiresAt: Date;
}

/**
 * Fixed-window request counters kept in MongoDB, so every API container shares the same counts.
 * A TTL index removes old windows.
 */
@Injectable()
export class RateLimiter implements OnModuleInit {
  private readonly buckets: Collection<Bucket>;

  constructor(@InjectConnection() connection: Connection) {
    this.buckets = connection.collection<Bucket>('ratelimits');
  }

  async onModuleInit() {
    await this.buckets.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  }

  /** Counts one hit on the key. Throws 429 once the key has had more than `limit` hits in the window. */
  async hit(key: string, limit: number, windowSeconds: number, message = 'Too many attempts. Please wait a few minutes and try again.') {
    if (!config.rateLimits) return;
    const window = Math.floor(Date.now() / (windowSeconds * 1000));
    const bucket = await this.buckets.findOneAndUpdate(
      { _id: `${key}:${windowSeconds}:${window}` },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((window + 1) * windowSeconds * 1000) } },
      { upsert: true, returnDocument: 'after' },
    );
    if ((bucket?.count ?? 0) > limit) throw new HttpException(message, HttpStatus.TOO_MANY_REQUESTS);
  }
}

interface Rule {
  method: string;
  path: string;
  limit: number;
  windowSeconds: number;
}

/**
 * Per-IP limits on the endpoints people can call without logging in (password guessing, code
 * guessing, email and SMS flooding, sign-up spam). Account lockout and OTP attempt limits still apply
 * per user on top of these.
 */
export const RATE_RULES: Rule[] = [
  { method: 'POST', path: '/api/auth/login', limit: 30, windowSeconds: 600 },
  { method: 'POST', path: '/api/auth/forgot-password', limit: 10, windowSeconds: 3600 },
  { method: 'POST', path: '/api/auth/reset-password', limit: 20, windowSeconds: 3600 },
  { method: 'POST', path: '/api/auth/otp/verify', limit: 20, windowSeconds: 600 },
  { method: 'POST', path: '/api/support/login', limit: 10, windowSeconds: 600 },
  { method: 'POST', path: '/api/support/otp/verify', limit: 10, windowSeconds: 600 },
  { method: 'POST', path: '/api/tenants/signup', limit: 5, windowSeconds: 3600 },
  { method: 'POST', path: '/api/tenants/resolve', limit: 60, windowSeconds: 600 },
  // The client's approve-by-email-link page (public, token in the body).
  { method: 'GET', path: '/api/support-approval', limit: 60, windowSeconds: 600 },
  { method: 'POST', path: '/api/support-approval', limit: 20, windowSeconds: 600 },
];

/** Every API call from one IP, to blunt scraping and floods. Generous: a hotel's staff often share one IP. */
const OVERALL = { limit: 3000, windowSeconds: 300 };

@Injectable()
export class RateLimitMiddleware implements NestMiddleware {
  constructor(private readonly limiter: RateLimiter) {}

  async use(req: Request, _res: Response, next: NextFunction) {
    try {
      const ip = req.ip ?? 'unknown';
      const path = req.originalUrl.split('?')[0].replace(/\/+$/, '');
      await this.limiter.hit(`ip:${ip}`, OVERALL.limit, OVERALL.windowSeconds, 'Too many requests. Please slow down.');
      const rule = RATE_RULES.find((r) => r.method === req.method && r.path === path);
      if (rule) await this.limiter.hit(`${rule.path}:${ip}`, rule.limit, rule.windowSeconds);
      next();
    } catch (err) {
      next(err);
    }
  }
}

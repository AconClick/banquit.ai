import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';

const startedAt = new Date();

/**
 * For the load balancer and monitoring. `/api/health` says the process is up (container
 * liveness); `/api/health/ready` also checks MongoDB, so a container that lost the database stops
 * getting traffic.
 */
@Controller('health')
export class HealthController {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  @Get()
  live() {
    return { status: 'ok', version: process.env.APP_VERSION ?? 'dev', startedAt };
  }

  @Get('ready')
  async ready() {
    const started = Date.now();
    try {
      await Promise.race([
        this.connection.db!.admin().ping(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
      ]);
    } catch {
      throw new ServiceUnavailableException({ status: 'unavailable', mongo: 'down' });
    }
    return { status: 'ok', mongo: 'up', mongoMs: Date.now() - started };
  }
}

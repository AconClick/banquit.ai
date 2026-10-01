import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { config } from './config.js';

const app = configureApp(await NestFactory.create<NestExpressApplication>(AppModule));
app.enableCors({ origin: true, credentials: true });
await app.listen(config.port);

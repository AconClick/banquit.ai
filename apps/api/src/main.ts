import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { config, productionConfigProblems } from './config.js';

if (config.production) {
  const problems = productionConfigProblems();
  if (problems.length) {
    console.error(`Refusing to start in production:\n- ${problems.join('\n- ')}`);
    process.exit(1);
  }
}

const app = configureApp(await NestFactory.create<NestExpressApplication>(AppModule));
app.enableShutdownHooks();
await app.listen(config.port);

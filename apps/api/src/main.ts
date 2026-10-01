import { ConsoleLogger, Logger } from '@nestjs/common';
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

// JSON log lines in production, one per event, for CloudWatch Logs Insights and metric filters.
const logger = config.production ? new ConsoleLogger({ json: true }) : undefined;
const app = configureApp(await NestFactory.create<NestExpressApplication>(AppModule, { logger }));
const crashLog = new Logger('Process');
process.on('unhandledRejection', (reason) => crashLog.error({ event: 'unhandledRejection', message: String(reason) }, (reason as Error)?.stack));
process.on('uncaughtException', (err) => {
  crashLog.error({ event: 'uncaughtException', message: err.message }, err.stack);
  process.exit(1);
});
app.enableShutdownHooks();
await app.listen(config.port);

import { Global, Module } from '@nestjs/common';
import { config } from '../config.js';
import { AwsNotifier, ConsoleNotifier, Notifier } from './notifier.js';

@Global()
@Module({
  providers: [{ provide: Notifier, useClass: config.notifyProvider === 'aws' ? AwsNotifier : ConsoleNotifier }],
  exports: [Notifier],
})
export class NotificationsModule {}

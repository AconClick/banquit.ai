import { Injectable, Logger } from '@nestjs/common';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { config } from '../config.js';

export interface OutgoingMessage {
  channel: 'email' | 'sms';
  to: string;
  subject?: string;
  body: string;
}

export abstract class Notifier {
  abstract send(message: OutgoingMessage): Promise<void>;
}

/** Development notifier: logs messages and keeps them in memory so tests can read them. */
@Injectable()
export class ConsoleNotifier extends Notifier {
  private readonly logger = new Logger('Notifier');
  readonly outbox: OutgoingMessage[] = [];

  async send(message: OutgoingMessage): Promise<void> {
    this.outbox.push(message);
    this.logger.log(`[${message.channel}] to ${message.to}: ${message.subject ?? ''} ${message.body}`);
  }
}

/** Production notifier: SMS through Amazon SNS, email through Amazon SES. */
@Injectable()
export class AwsNotifier extends Notifier {
  private readonly sns = new SNSClient({ region: config.awsRegion });
  private readonly ses = new SESClient({ region: config.awsRegion });

  async send(message: OutgoingMessage): Promise<void> {
    if (message.channel === 'sms') {
      await this.sns.send(
        new PublishCommand({
          PhoneNumber: message.to,
          Message: message.body,
          MessageAttributes: { 'AWS.SNS.SMS.SMSType': { DataType: 'String', StringValue: 'Transactional' } },
        }),
      );
      return;
    }
    await this.ses.send(
      new SendEmailCommand({
        Source: config.mailFrom,
        Destination: { ToAddresses: [message.to] },
        Message: { Subject: { Data: message.subject ?? 'Banquet.ai' }, Body: { Text: { Data: message.body } } },
      }),
    );
  }
}

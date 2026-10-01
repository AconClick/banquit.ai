import { ArgumentsHost, Catch, HttpException, HttpStatus, Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import type { AppRequest } from './request-context.js';

export interface ObservedRequest extends AppRequest {
  requestId?: string;
}

/** Paths that are not worth a log line (load balancer health checks every few seconds). */
const QUIET = /^\/api\/health(\/|$)/;

/**
 * One structured log line per request: id, method, path (never the query string, which can hold
 * codes), status, time taken, tenant and user. The id is also returned in `X-Request-Id`, so a
 * client's report can be matched to the log.
 */
@Injectable()
export class RequestLogMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: ObservedRequest, res: Response, next: NextFunction) {
    const given = req.header('x-request-id');
    req.requestId = given && /^[\w.-]{8,100}$/.test(given) ? given : randomUUID();
    res.setHeader('X-Request-Id', req.requestId);
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const path = req.originalUrl.split('?')[0];
      if (QUIET.test(path) && res.statusCode < 400) return;
      const entry = {
        requestId: req.requestId,
        method: req.method,
        path: path.slice(0, 300),
        status: res.statusCode,
        ms: Number((process.hrtime.bigint() - started) / 1_000_000n),
        tenant: req.tenant?.subdomain,
        user: req.auth?.support ? `support:${String(req.auth.support._id)}` : req.auth?.user?.userId,
        ip: req.ip,
      };
      if (res.statusCode >= 500) this.logger.error(entry);
      else if (res.statusCode >= 400 && res.statusCode !== 401 && res.statusCode !== 404) this.logger.warn(entry);
      else this.logger.log(entry);
    });
    next();
  }
}

/** Where unexpected errors are sent. The default writes them to the log; swap in Sentry or similar here. */
export abstract class ErrorReporter {
  abstract report(error: unknown, context: Record<string, unknown>): void;
}

@Injectable()
export class LogErrorReporter extends ErrorReporter {
  private readonly logger = new Logger('Error');

  report(error: unknown, context: Record<string, unknown>) {
    const err = error instanceof Error ? error : new Error(String(error));
    this.logger.error({ ...context, error: err.name, message: err.message }, err.stack);
  }
}

/**
 * Sends every unexpected error (anything that is not a deliberate HTTP answer below 500) to the
 * error reporter with the request id, then answers as Nest normally does. The client sees only a
 * generic message plus the request id, never the stack.
 */
@Catch()
export class ReportingExceptionFilter extends BaseExceptionFilter {
  constructor(private readonly reporter: ErrorReporter) {
    super();
  }

  override catch(exception: unknown, host: ArgumentsHost) {
    // A malformed id in the address (e.g. /bills/abc) is the caller's mistake, not a server error.
    if (exception instanceof Error && exception.name === 'CastError') {
      return super.catch(new HttpException('Invalid id.', HttpStatus.BAD_REQUEST), host);
    }
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    if (status >= 500) {
      const req = host.switchToHttp().getRequest<ObservedRequest>();
      this.reporter.report(exception, {
        requestId: req?.requestId, method: req?.method, path: req?.originalUrl?.split('?')[0], tenant: req?.tenant?.subdomain,
      });
      if (!(exception instanceof HttpException) && req?.requestId) {
        const res = host.switchToHttp().getResponse<Request['res'] & Response>();
        if (!res.headersSent) {
          res.status(status).json({ statusCode: status, message: 'Something went wrong. Please try again.', requestId: req.requestId });
          return;
        }
      }
    }
    super.catch(exception, host);
  }
}

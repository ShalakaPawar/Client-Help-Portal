import { Controller, Headers, HttpCode, HttpStatus, Logger, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ErrorCode } from '@chp/shared';
import { Public } from '../common/auth.decorators';
import { AppException } from '../common/app-exception';
import { LiveKitService } from './livekit.service';
import { WebhookService } from './webhook.service';

/**
 * LiveKit posts room/participant/track/egress events here.
 * The body is kept raw (express.raw in main.ts) because the signature covers the exact bytes.
 */
@Controller('livekit')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    private readonly livekit: LiveKitService,
    private readonly webhooks: WebhookService,
  ) {}

  @Public()
  @Post('webhook')
  @HttpCode(200)
  async receive(@Req() req: Request, @Headers('authorization') auth?: string) {
    const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : JSON.stringify(req.body ?? {});
    let event;
    try {
      event = await this.livekit.receiveWebhook(raw, auth);
    } catch (err) {
      this.logger.warn(`rejected webhook: ${(err as Error).message}`);
      throw new AppException(ErrorCode.INVALID_WEBHOOK_SIGNATURE, HttpStatus.UNAUTHORIZED, 'Invalid webhook signature');
    }
    await this.webhooks.handle(event);
    return { ok: true };
  }
}

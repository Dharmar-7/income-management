import {
  Controller,
  Get,
  Delete,
  Post,
  Query,
  Res,
  UseGuards,
  HttpCode,
  UnauthorizedException,
} from '@nestjs/common';
import * as express from 'express';
import { verifyToken } from '@clerk/backend';
import { GmailOAuthService } from './gmail-oauth.service';
import { GmailSyncService } from './gmail-sync.service';
import { ClerkAuthGuard } from '../auth/clerk.guard';
import { CurrentUser } from '../auth/current-user.decorator';

@Controller('gmail')
export class GmailController {
  constructor(
    private oauthService: GmailOAuthService,
    private syncService: GmailSyncService,
  ) {}

  // GET /gmail/connect?token=<clerk-jwt>
  // Browser redirect — can't send headers, so the Clerk token comes as a query param.
  @Get('connect')
  async connect(@Query('token') token: string, @Res() res: express.Response) {
    if (!token) throw new UnauthorizedException('Missing token');
    const payload = await verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY }).catch(() => {
      throw new UnauthorizedException('Invalid or expired token');
    });
    const url = this.oauthService.getAuthUrl(payload.sub);
    return res.redirect(url);
  }

  // GET /gmail/callback — Google redirects here after user approves.
  // NOT protected by ClerkAuthGuard (the request comes from Google), so trust is
  // established by verifying the signed `state` inside handleCallback.
  @Get('callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: express.Response,
  ) {
    try {
      await this.oauthService.handleCallback(code, state);
      return res.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/settings?gmail=connected`);
    } catch {
      // Forged/expired state or a failed token exchange — fail closed.
      return res.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/settings?gmail=error`);
    }
  }

  // GET /gmail/status — check if Gmail is connected
  @Get('status')
  @UseGuards(ClerkAuthGuard)
  async status(@CurrentUser() userId: string) {
    const connected = await this.oauthService.isConnected(userId);
    return { connected };
  }

  // POST /gmail/sync — manually trigger a sync
  @Post('sync')
  @UseGuards(ClerkAuthGuard)
  @HttpCode(200)
  async manualSync(@CurrentUser() userId: string) {
    const count = await this.syncService.syncUser(userId);
    return {
      message: `Sync complete. ${count} new transaction(s) imported.`,
      imported: count,
    };
  }

  // DELETE /gmail/disconnect — revoke access and delete tokens
  @Delete('disconnect')
  @UseGuards(ClerkAuthGuard)
  @HttpCode(200)
  async disconnect(@CurrentUser() userId: string) {
    await this.oauthService.disconnect(userId);
    return { message: 'Gmail disconnected successfully.' };
  }
}

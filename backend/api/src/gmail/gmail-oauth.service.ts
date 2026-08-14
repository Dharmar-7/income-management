import { Injectable } from '@nestjs/common';
import { google } from 'googleapis';
import { EncryptionService } from '../common/encryption.service';
import { PrismaService } from '../prisma/prisma.service';
import { signState, verifyState } from './oauth-state';

@Injectable()
export class GmailOAuthService {
  private oauth2Client;

  constructor(
    private encryption: EncryptionService,
    private prisma: PrismaService,
  ) {
    this.oauth2Client = new google.auth.OAuth2(
      process.env.GMAIL_CLIENT_ID,
      process.env.GMAIL_CLIENT_SECRET,
      process.env.GMAIL_REDIRECT_URI,
    );
  }

  // Secret used to sign the OAuth `state`. CLERK_SECRET_KEY is always present
  // (validated at boot) and is a high-entropy server-only secret.
  private stateSecret(): string {
    return process.env.GMAIL_STATE_SECRET || process.env.CLERK_SECRET_KEY || '';
  }

  // Step 1 — Generate the Google consent screen URL
  getAuthUrl(clerkUserId: string): string {
    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',   // gives us a refresh token
      prompt: 'consent',        // always show consent screen (ensures refresh token)
      scope: ['https://www.googleapis.com/auth/gmail.readonly'],
      // Signed { uid, iat } so the unauthenticated callback can't be forged to
      // link a Google account to someone else's user id.
      state: signState(clerkUserId, this.stateSecret(), Date.now()),
    });
  }

  // Step 2 — Exchange auth code for tokens and save to DB (encrypted). The state
  // is verified first — a bad signature / stale state is rejected before we
  // touch Google or the DB.
  async handleCallback(code: string, state: string): Promise<void> {
    const clerkUserId = verifyState(state, this.stateSecret(), Date.now());

    const { tokens } = await this.oauth2Client.getToken(code);

    if (!tokens.access_token || !tokens.refresh_token) {
      throw new Error('Google did not return the required tokens');
    }

    const encryptedAccess = this.encryption.encrypt(tokens.access_token);
    const encryptedRefresh = this.encryption.encrypt(tokens.refresh_token);
    const expiry = tokens.expiry_date
      ? new Date(tokens.expiry_date)
      : new Date(Date.now() + 3600 * 1000); // default 1 hour

    await this.prisma.user.update({
      where: { clerkId: clerkUserId },
      data: {
        gmailAccessToken: encryptedAccess,
        gmailRefreshToken: encryptedRefresh,
        gmailTokenExpiry: expiry,
      },
    });
  }

  // Decrypt tokens and return a ready-to-use OAuth2 client for Gmail API calls
  async getAuthenticatedClient(clerkUserId: string) {
    const user = await this.prisma.user.findUnique({
      where: { clerkId: clerkUserId },
      select: {
        gmailAccessToken: true,
        gmailRefreshToken: true,
        gmailTokenExpiry: true,
      },
    });

    if (!user?.gmailAccessToken || !user?.gmailRefreshToken) {
      throw new Error('Gmail not connected for this user');
    }

    const accessToken = this.encryption.decrypt(user.gmailAccessToken);
    const refreshToken = this.encryption.decrypt(user.gmailRefreshToken);

    const client = new google.auth.OAuth2(
      process.env.GMAIL_CLIENT_ID,
      process.env.GMAIL_CLIENT_SECRET,
      process.env.GMAIL_REDIRECT_URI,
    );

    client.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken,
      expiry_date: user.gmailTokenExpiry?.getTime(),
    });

    // Auto-save refreshed access token back to DB (encrypted)
    client.on('tokens', async (newTokens) => {
      if (newTokens.access_token) {
        await this.prisma.user.update({
          where: { clerkId: clerkUserId },
          data: {
            gmailAccessToken: this.encryption.encrypt(newTokens.access_token),
            gmailTokenExpiry: newTokens.expiry_date
              ? new Date(newTokens.expiry_date)
              : undefined,
          },
        });
      }
    });

    return client;
  }

  // Delete all Gmail tokens for the user (disconnect)
  async disconnect(clerkUserId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { clerkId: clerkUserId },
      select: { gmailAccessToken: true },
    });

    // Revoke the token with Google so they also invalidate it
    if (user?.gmailAccessToken) {
      try {
        const accessToken = this.encryption.decrypt(user.gmailAccessToken);
        await this.oauth2Client.revokeToken(accessToken);
      } catch {
        // Ignore revocation errors — still delete locally
      }
    }

    await this.prisma.user.update({
      where: { clerkId: clerkUserId },
      data: {
        gmailAccessToken: null,
        gmailRefreshToken: null,
        gmailTokenExpiry: null,
        gmailSyncedAt: null,
      },
    });
  }

  async isConnected(clerkUserId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { clerkId: clerkUserId },
      select: { gmailRefreshToken: true },
    });
    return !!user?.gmailRefreshToken;
  }
}

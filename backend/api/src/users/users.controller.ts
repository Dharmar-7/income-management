import { Body, Controller, Patch, Post, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { ClerkAuthGuard } from '../auth/clerk.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { createClerkClient } from '@clerk/backend';

const clerk = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY,
});

@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  // POST /users/me — called by the frontend right after login
  // Creates the user in our DB if they don't exist yet
  @Post('me')
  @UseGuards(ClerkAuthGuard)
  async syncUser(@CurrentUser() clerkUserId: string) {
    // Fast path: the row almost always exists (every app open calls this).
    // Skipping the Clerk profile fetch turns ~800ms of cross-continent API
    // latency into a ~10ms DB lookup. Clerk is only consulted on the very
    // first sign-in, when we genuinely need the email/name to create the row.
    const existing = await this.usersService.findByClerkId(clerkUserId);
    if (existing) return existing;

    const clerkUser = await clerk.users.getUser(clerkUserId);
    const email = clerkUser.emailAddresses[0]?.emailAddress ?? '';
    const name = [clerkUser.firstName, clerkUser.lastName]
      .filter(Boolean)
      .join(' ') || undefined;

    return this.usersService.findOrCreate(clerkUserId, email, name);
  }

  // PATCH /users/me — user-tunable settings: month start day (salary cycle).
  @Patch('me')
  @UseGuards(ClerkAuthGuard)
  updateSettings(
    @CurrentUser() clerkUserId: string,
    @Body() dto: UpdateSettingsDto,
  ) {
    return this.usersService.updateSettings(clerkUserId, dto);
  }
}

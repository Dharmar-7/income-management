import { Body, Controller, Delete, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { ClerkAuthGuard } from '../auth/clerk.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RegisterTokenDto } from './dto/register-token.dto';
import { UpdatePrefsDto } from './dto/update-prefs.dto';

@Controller('notifications')
@UseGuards(ClerkAuthGuard)
export class NotificationsController {
  constructor(private service: NotificationsService) {}

  // The app posts its Expo push token here on launch so the server can reach it.
  @Post('register')
  register(@CurrentUser() clerkId: string, @Body() dto: RegisterTokenDto) {
    return this.service.registerToken(clerkId, dto.token, dto.platform);
  }

  @Delete('register')
  remove(@Body() dto: RegisterTokenDto) {
    return this.service.removeToken(dto.token);
  }

  @Get('prefs')
  getPrefs(@CurrentUser() clerkId: string) {
    return this.service.getPrefs(clerkId);
  }

  @Patch('prefs')
  updatePrefs(@CurrentUser() clerkId: string, @Body() dto: UpdatePrefsDto) {
    return this.service.updatePrefs(clerkId, dto);
  }
}

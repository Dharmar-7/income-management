import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, Query, UseGuards,
  UseInterceptors, UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { NotesService } from './notes.service';
import { ClerkAuthGuard } from '../auth/clerk.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { CreateNoteDto } from './dto/create-note.dto';
import { UpdateNoteDto } from './dto/update-note.dto';

@Controller('notes')
@UseGuards(ClerkAuthGuard)
export class NotesController {
  constructor(private service: NotesService) {}

  // ─── Note list & archive ─────────────────────────────────────────────────
  @Get()
  findAll(
    @CurrentUser() clerkId: string,
    @Query('search') search?: string,
    @Query('tag') tag?: string,
  ) {
    return this.service.findAll(clerkId, search, tag);
  }

  @Get('archived')
  findArchived(@CurrentUser() clerkId: string) {
    return this.service.findArchived(clerkId);
  }

  // ─── Tags autocomplete ───────────────────────────────────────────────────
  @Get('tags')
  getAllTags(@CurrentUser() clerkId: string) {
    return this.service.getAllTags(clerkId);
  }

  // ─── Reminders (polled by web every 60s) ────────────────────────────────
  @Get('reminders/due')
  getDueReminders(@CurrentUser() clerkId: string) {
    return this.service.getDueReminders(clerkId);
  }

  // ─── CRUD ────────────────────────────────────────────────────────────────
  @Post()
  create(@CurrentUser() clerkId: string, @Body() dto: CreateNoteDto) {
    return this.service.create(clerkId, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() clerkId: string,
    @Param('id') id: string,
    @Body() dto: UpdateNoteDto,
  ) {
    return this.service.update(clerkId, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() clerkId: string, @Param('id') id: string) {
    return this.service.remove(clerkId, id);
  }

  // ─── Lock / Unlock ───────────────────────────────────────────────────────
  @Post(':id/lock')
  lockNote(
    @CurrentUser() clerkId: string,
    @Param('id') id: string,
    @Body('password') password: string,
  ) {
    return this.service.lockNote(clerkId, id, password);
  }

  @Post(':id/remove-lock')
  removeLock(
    @CurrentUser() clerkId: string,
    @Param('id') id: string,
    @Body('password') password: string,
  ) {
    return this.service.removeLock(clerkId, id, password);
  }

  @Post(':id/unlock')
  unlockNote(
    @CurrentUser() clerkId: string,
    @Param('id') id: string,
    @Body('password') password: string,
  ) {
    return this.service.unlockNote(clerkId, id, password);
  }

  // ─── Images ──────────────────────────────────────────────────────────────
  @Post(':id/images')
  @UseInterceptors(FileInterceptor('file', {
    storage: memoryStorage(),
    // Abort the stream as soon as the cap is crossed — without this, an
    // oversized upload is buffered in full before the service rejects it.
    limits: { fileSize: 10 * 1024 * 1024 },
  }))
  addImage(
    @CurrentUser() clerkId: string,
    @Param('id') noteId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.service.addImage(clerkId, noteId, file);
  }

  @Delete(':id/images/:imageId')
  removeImage(
    @CurrentUser() clerkId: string,
    @Param('id') noteId: string,
    @Param('imageId') imageId: string,
  ) {
    return this.service.removeImage(clerkId, noteId, imageId);
  }
}

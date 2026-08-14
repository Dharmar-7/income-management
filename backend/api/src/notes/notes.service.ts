import {
  Injectable, NotFoundException, BadRequestException, UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { CreateNoteDto } from './dto/create-note.dto';
import { UpdateNoteDto } from './dto/update-note.dto';

const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB

@Injectable()
export class NotesService {
  constructor(private prisma: PrismaService) {}

  private resolveUserId(clerkId: string): Promise<string> {
    return this.prisma.resolveUserId(clerkId);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  // Convert NoteImage Bytes to base64 data URL for frontend display
  private imageToDataUrl(img: { data: Buffer; mimeType: string }) {
    return `data:${img.mimeType};base64,${img.data.toString('base64')}`;
  }

  // Shape a note for API response — strip passwordHash, redact content when locked
  private formatNote(note: any, includeContent = true) {
    const { passwordHash, ...rest } = note;
    void passwordHash; // intentionally stripped
    return {
      ...rest,
      content: (rest.isLocked && !includeContent) ? '' : rest.content,
      images: (note.images ?? []).map((img: any) => ({
        id: img.id,
        name: img.name,
        size: img.size,
        mimeType: img.mimeType,
        dataUrl: this.imageToDataUrl(img),
      })),
    };
  }

  // ─── Notes CRUD ───────────────────────────────────────────────────────────

  async findAll(clerkId: string, search?: string, tag?: string) {
    const userId = await this.resolveUserId(clerkId);

    const notes = await this.prisma.note.findMany({
      where: {
        userId,
        isArchived: false,
        ...(search && {
          OR: [
            { title: { contains: search, mode: 'insensitive' } },
            { content: { contains: search, mode: 'insensitive' } },
          ],
        }),
        ...(tag && { tags: { has: tag } }),
      },
      include: { images: true },
      orderBy: [{ isPinned: 'desc' }, { updatedAt: 'desc' }],
    });

    return notes.map(n => this.formatNote(n, false));
  }

  async findArchived(clerkId: string) {
    const userId = await this.resolveUserId(clerkId);
    const notes = await this.prisma.note.findMany({
      where: { userId, isArchived: true },
      include: { images: true },
      orderBy: { updatedAt: 'desc' },
    });
    return notes.map(n => this.formatNote(n, false));
  }

  async create(clerkId: string, dto: CreateNoteDto) {
    const userId = await this.resolveUserId(clerkId);
    const note = await this.prisma.note.create({
      data: {
        userId,
        title: dto.title?.trim() || null,
        content: dto.content ?? '',
        color: dto.color ?? 'white',
        isPinned: dto.isPinned ?? false,
        isArchived: dto.isArchived ?? false,
        tags: dto.tags ?? [],
        reminderAt: dto.reminderAt ? new Date(dto.reminderAt) : null,
      },
      include: { images: true },
    });
    return this.formatNote(note);
  }

  async update(clerkId: string, id: string, dto: UpdateNoteDto) {
    const userId = await this.resolveUserId(clerkId);
    const existing = await this.prisma.note.findUnique({ where: { id, userId } });
    if (!existing) throw new NotFoundException('Note not found.');

    const note = await this.prisma.note.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title?.trim() || null }),
        ...(dto.content !== undefined && { content: dto.content }),
        ...(dto.color !== undefined && { color: dto.color }),
        ...(dto.isPinned !== undefined && { isPinned: dto.isPinned }),
        ...(dto.isArchived !== undefined && { isArchived: dto.isArchived }),
        ...(dto.tags !== undefined && { tags: dto.tags }),
        ...(dto.clearReminder && { reminderAt: null, reminderSent: false }),
        ...(dto.reminderAt && !dto.clearReminder && {
          reminderAt: new Date(dto.reminderAt),
          reminderSent: false,  // reset so it fires again if rescheduled
        }),
      },
      include: { images: true },
    });
    return this.formatNote(note);
  }

  async remove(clerkId: string, id: string) {
    const userId = await this.resolveUserId(clerkId);
    const note = await this.prisma.note.findUnique({ where: { id, userId } });
    if (!note) throw new NotFoundException('Note not found.');
    await this.prisma.note.delete({ where: { id } });
    return { message: 'Note deleted.' };
  }

  // ─── Image upload ─────────────────────────────────────────────────────────

  async addImage(clerkId: string, noteId: string, file: Express.Multer.File) {
    const userId = await this.resolveUserId(clerkId);
    const note = await this.prisma.note.findUnique({ where: { id: noteId, userId } });
    if (!note) throw new NotFoundException('Note not found.');

    if (file.size > MAX_IMAGE_SIZE) {
      throw new BadRequestException('Image must be under 10 MB.');
    }

    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowed.includes(file.mimetype)) {
      throw new BadRequestException('Only JPEG, PNG, GIF, and WebP images are allowed.');
    }

    const image = await this.prisma.noteImage.create({
      data: {
        noteId,
        data: Buffer.from(file.buffer),
        mimeType: file.mimetype,
        name: file.originalname,
        size: file.size,
      },
    });

    return {
      id: image.id,
      name: image.name,
      size: image.size,
      mimeType: image.mimeType,
      dataUrl: this.imageToDataUrl(image as any),
    };
  }

  async removeImage(clerkId: string, noteId: string, imageId: string) {
    const userId = await this.resolveUserId(clerkId);
    const note = await this.prisma.note.findUnique({ where: { id: noteId, userId } });
    if (!note) throw new NotFoundException('Note not found.');

    const image = await this.prisma.noteImage.findUnique({ where: { id: imageId, noteId } });
    if (!image) throw new NotFoundException('Image not found.');

    await this.prisma.noteImage.delete({ where: { id: imageId } });
    return { message: 'Image deleted.' };
  }

  // ─── Reminders ────────────────────────────────────────────────────────────

  // Called by web frontend every 60s to check for due reminders
  async getDueReminders(clerkId: string) {
    const userId = await this.resolveUserId(clerkId);
    const now = new Date();

    const notes = await this.prisma.note.findMany({
      where: {
        userId,
        reminderSent: false,
        reminderAt: { lte: now },
      },
      select: { id: true, title: true, content: true, reminderAt: true },
    });

    // Mark them as sent
    if (notes.length > 0) {
      await this.prisma.note.updateMany({
        where: { id: { in: notes.map(n => n.id) } },
        data: { reminderSent: true },
      });
    }

    return notes;
  }

  // (Reminders no longer need a server cron: the phone schedules the actual
  // notification locally, and the "⏰ pending" badge is derived on the client
  // from whether reminderAt is still in the future.)

  // ─── All tags for autocomplete ────────────────────────────────────────────

  async getAllTags(clerkId: string) {
    const userId = await this.resolveUserId(clerkId);
    // Distinct tags computed in the DB — avoids pulling every note row
    // (content included) over the wire just to flatten their tag arrays.
    const rows = await this.prisma.$queryRaw<{ tag: string }[]>`
      SELECT DISTINCT UNNEST(tags) AS tag FROM "Note" WHERE "userId" = ${userId} ORDER BY tag
    `;
    return rows.map(r => r.tag);
  }

  // ─── Lock / Unlock ────────────────────────────────────────────────────────

  async lockNote(clerkId: string, id: string, password: string) {
    const userId = await this.resolveUserId(clerkId);
    const note = await this.prisma.note.findUnique({ where: { id, userId } });
    if (!note) throw new NotFoundException('Note not found.');
    if (!password || password.length < 4)
      throw new BadRequestException('Password must be at least 4 characters.');

    const passwordHash = await bcrypt.hash(password, 10);
    const updated = await (this.prisma.note.update as any)({
      where: { id },
      data: { isLocked: true, passwordHash },
      include: { images: true },
    });
    return this.formatNote(updated, false);
  }

  async removeLock(clerkId: string, id: string, password: string) {
    const userId = await this.resolveUserId(clerkId);
    const note = await this.prisma.note.findUnique({ where: { id, userId } }) as any;
    if (!note) throw new NotFoundException('Note not found.');
    if (!note.passwordHash || !await bcrypt.compare(password, note.passwordHash))
      throw new UnauthorizedException('Incorrect password.');

    const updated = await (this.prisma.note.update as any)({
      where: { id },
      data: { isLocked: false, passwordHash: null },
      include: { images: true },
    });
    return this.formatNote(updated, true);
  }

  async unlockNote(clerkId: string, id: string, password: string) {
    const userId = await this.resolveUserId(clerkId);
    const note = await this.prisma.note.findUnique({
      where: { id, userId },
      include: { images: true },
    }) as any;
    if (!note) throw new NotFoundException('Note not found.');
    if (!note.isLocked) return this.formatNote(note, true);
    if (!note.passwordHash || !await bcrypt.compare(password, note.passwordHash))
      throw new UnauthorizedException('Incorrect password.');

    return this.formatNote(note, true);
  }
}

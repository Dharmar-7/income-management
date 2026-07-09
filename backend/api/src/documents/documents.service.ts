import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { UpdateDocumentDto } from './dto/update-document.dto';

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB per document

// Metadata columns only — never select the heavy `data` blob in list views.
const META_SELECT = {
  id: true, name: true, category: true, mimeType: true, size: true,
  note: true, expiresAt: true, createdAt: true,
} as const;

@Injectable()
export class DocumentsService {
  constructor(private prisma: PrismaService) {}

  private resolveUserId(clerkId: string): Promise<string> {
    return this.prisma.resolveUserId(clerkId);
  }

  async list(clerkId: string) {
    const userId = await this.resolveUserId(clerkId);
    return this.prisma.document.findMany({
      where: { userId },
      select: META_SELECT,
      orderBy: { createdAt: 'desc' },
    });
  }

  // Single document including the file, returned as a base64 data URI the app can render.
  async getOne(clerkId: string, id: string) {
    const userId = await this.resolveUserId(clerkId);
    const doc = await this.prisma.document.findUnique({ where: { id, userId } });
    if (!doc) throw new NotFoundException('Document not found.');
    const { data, ...meta } = doc;
    return {
      ...meta,
      dataBase64: Buffer.from(data).toString('base64'),
      dataUri: `data:${doc.mimeType};base64,${Buffer.from(data).toString('base64')}`,
    };
  }

  async create(clerkId: string, dto: CreateDocumentDto) {
    const userId = await this.resolveUserId(clerkId);
    const buffer = Buffer.from(dto.dataBase64, 'base64');
    if (buffer.length === 0) throw new BadRequestException('Empty file.');
    if (buffer.length > MAX_BYTES) {
      throw new BadRequestException(`File too large (max ${MAX_BYTES / 1024 / 1024} MB).`);
    }
    const doc = await this.prisma.document.create({
      data: {
        userId,
        name: dto.name.trim(),
        category: dto.category?.trim() || 'Other',
        data: buffer,
        mimeType: dto.mimeType,
        size: buffer.length,
        note: dto.note?.trim() || null,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      },
      select: META_SELECT,
    });
    return doc;
  }

  async update(clerkId: string, id: string, dto: UpdateDocumentDto) {
    const userId = await this.resolveUserId(clerkId);
    const doc = await this.prisma.document.findUnique({ where: { id, userId } });
    if (!doc) throw new NotFoundException('Document not found.');
    return this.prisma.document.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name.trim() }),
        ...(dto.category !== undefined && { category: dto.category?.trim() || 'Other' }),
        ...(dto.note !== undefined && { note: dto.note?.trim() || null }),
        ...(dto.expiresAt !== undefined && { expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null }),
      },
      select: META_SELECT,
    });
  }

  async remove(clerkId: string, id: string) {
    const userId = await this.resolveUserId(clerkId);
    const doc = await this.prisma.document.findUnique({ where: { id, userId } });
    if (!doc) throw new NotFoundException('Document not found.');
    await this.prisma.document.delete({ where: { id } });
    return { message: 'Document deleted.' };
  }
}

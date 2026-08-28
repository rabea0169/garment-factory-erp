import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { PaginatedResult } from '../../common/dto/paginated-result.dto';
import {
  computeRequestHash,
  isIdempotencyUniqueViolation,
  storeIdempotencyResponse,
  tryReplayIdempotencyKey,
} from '../../core/common/idempotency.util';
import {
  DocumentCodePrefix,
  generateDocumentCode,
} from '../../core/common/codes.util';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';

@Injectable()
export class SuppliersService {
  constructor(private readonly prisma: PrismaService) {}

  async getSuppliers(pagination: PaginationDto = new PaginationDto()) {
    const page = pagination.page ?? 1;
    const limit = pagination.limit ?? 20;
    const where = { isActive: true, deletedAt: null };

    const [data, total] = await Promise.all([
      this.prisma.supplier.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.supplier.count({ where }),
    ]);

    return new PaginatedResult(data, total, page, limit);
  }

  async createSupplier(input: CreateSupplierDto, idempotencyKey?: string) {
    // RES-F02: replay-safe retry via Idempotency-Key header.
    const requestHash = computeRequestHash({
      name: input.name,
      phone: input.phone ?? null,
      email: input.email ?? null,
      address: input.address ?? null,
      notes: input.notes ?? null,
    });
    const scope = 'supplier-create';
    try {
      return await this.prisma.$transaction(async (tx) => {
        const replay = await tryReplayIdempotencyKey(
          tx,
          idempotencyKey,
          scope,
          requestHash,
        );
        if (replay)
          return replay as Awaited<ReturnType<typeof tx.supplier.create>> & {
            replayed: true;
          };

        const created = await tx.supplier.create({
          data: {
            code: generateDocumentCode(DocumentCodePrefix.SUPPLIER),
            name: input.name.trim(),
            phone: input.phone?.trim() || undefined,
            email: input.email?.trim().toLowerCase() || undefined,
            address: input.address?.trim() || undefined,
            notes: input.notes?.trim() || undefined,
          },
        });
        await storeIdempotencyResponse(tx, idempotencyKey, created);
        return created;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        !isIdempotencyUniqueViolation(error)
      ) {
        throw new ConflictException('بيانات المورد مستخدمة بالفعل');
      }
      throw error;
    }
  }
}

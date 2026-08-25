import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AccountType, VoucherType } from '@prisma/client';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { PaginatedResult } from '../../common/dto/paginated-result.dto';
import { CHART_OF_ACCOUNTS } from '../../core/financial/chart-of-accounts';
import { FinancialPostingService } from '../../core/financial/financial-posting.service';

@Injectable()
export class AccountingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly financial: FinancialPostingService,
  ) {}

  async getChartOfAccounts(pagination: PaginationDto = new PaginationDto()) {
    const page = pagination.page ?? 1;
    const pageSize = pagination.limit ?? 20;
    const skip = (page - 1) * pageSize;
    const options = { orderBy: { code: 'asc' } as const, skip, take: pageSize };

    const [data, total] = await Promise.all([
      this.prisma.account.findMany(options),
      this.prisma.account.count(),
    ]);

    return new PaginatedResult(data, total, page, pageSize);
  }

  async createAccount(data: {
    code: string;
    name: string;
    type: AccountType;
    parentId?: string;
    isGroup?: boolean;
  }) {
    return this.prisma.account.create({
      data: {
        code: data.code,
        name: data.name,
        type: data.type,
        parentId: data.parentId,
        isGroup: data.isGroup || false,
      },
    });
  }

  async getVouchers(pagination: PaginationDto = new PaginationDto()) {
    const page = pagination.page ?? 1;
    const pageSize = pagination.limit ?? 20;
    const skip = (page - 1) * pageSize;
    const options = {
      include: {
        createdBy: { select: { name: true } },
        journalEntry: { select: { code: true, id: true } },
        treasury: { select: { id: true, name: true } },
      },
      orderBy: { date: 'desc' } as const,
      skip,
      take: pageSize,
    };

    const [data, total] = await Promise.all([
      this.prisma.voucher.findMany(options),
      this.prisma.voucher.count(),
    ]);

    return new PaginatedResult(data, total, page, pageSize);
  }

  /**
   * A3: إنشاء سند مالي مرتبط بقيد مزدوج ذري.
   *
   * النمط المحاسبي:
   *  - RECEIPT (سند قبض): الخزينة تستلم نقدًا من طرف مقابل (عميل عادة).
   *    مدين: CASH/BANK، دائن: ACCOUNTS_RECEIVABLE (لو من عميل آجل).
   *  - PAYMENT (سند صرف): الخزينة تدفع نقدًا لطرف مقابل (مورد عادة).
   *    مدين: ACCOUNTS_PAYABLE (لو لمورد آجل)، دائن: CASH/BANK.
   *
   * كل قيد يُنشئ JournalEntry + JournalLines + تحديث Treasury.balance ذريًّا.
   * Voucher.journalEntryId يربطه بالقيد — لا سند بلا أثر مالي حقيقي (A3).
   */
  async createVoucher(
    data: {
      type: VoucherType;
      amount: number;
      description: string;
      reference?: string;
      treasuryId: string;
      counterpartyType?: 'CUSTOMER' | 'SUPPLIER' | 'WORKER';
      counterpartyId?: string;
    },
    createdById: string,
  ) {
    // P0-04: createdById من الجلسة — يُتجاهل أي value من body.

    // بناء بنود القيد بناءً على نوع السند.
    const cashAccount =
      data.type === VoucherType.RECEIPT
        ? CHART_OF_ACCOUNTS.CASH
        : CHART_OF_ACCOUNTS.CASH;
    const counterpartyAccount =
      data.counterpartyType === 'SUPPLIER'
        ? CHART_OF_ACCOUNTS.ACCOUNTS_PAYABLE
        : CHART_OF_ACCOUNTS.ACCOUNTS_RECEIVABLE;

    // RECEIPT: مدين CASH (تزيد)، دائن AR (تنقص).
    // PAYMENT: مدين AP (تزيد)، دائن CASH (تنقص).
    const lines =
      data.type === VoucherType.RECEIPT
        ? [
            {
              debitAccountId: cashAccount,
              creditAccountId: counterpartyAccount,
              amount: data.amount,
              description: data.description,
            },
          ]
        : [
            {
              debitAccountId: counterpartyAccount,
              creditAccountId: cashAccount,
              amount: data.amount,
              description: data.description,
            },
          ];

    // تحديث Treasury.balance ذريًّا داخل نفس الـ tx.
    const treasuryDelta =
      data.type === VoucherType.RECEIPT ? data.amount : -data.amount;

    // A1/A2: قيد مزدوج ذري + تحديث Treasury.balance.
    const entry = await this.financial.postJournalEntry(
      {
        description: `سند ${
          data.type === VoucherType.RECEIPT ? 'قبض' : 'صرف'
        }: ${data.description}`,
        reference: data.reference,
        isAuto: true,
        lines,
        userId: createdById,
        treasuryUpdates: [
          { treasuryId: data.treasuryId, delta: treasuryDelta },
        ],
        ...(data.counterpartyType === 'CUSTOMER' && data.counterpartyId
          ? {
              customerUpdates: [
                {
                  customerId: data.counterpartyId,
                  delta:
                    data.type === VoucherType.RECEIPT
                      ? -data.amount
                      : data.amount,
                },
              ],
            }
          : {}),
        ...(data.counterpartyType === 'SUPPLIER' && data.counterpartyId
          ? {
              supplierUpdates: [
                {
                  supplierId: data.counterpartyId,
                  delta:
                    data.type === VoucherType.PAYMENT
                      ? -data.amount
                      : data.amount,
                },
              ],
            }
          : {}),
      },
      createdById,
    );

    // A3: السند مرتبط بـ journalEntryId — لا أثر مالي خفي.
    const voucherCode = `VCH-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${randomBytes(4).toString('hex').toUpperCase()}`;
    return this.prisma.voucher.create({
      data: {
        code: voucherCode,
        type: data.type,
        amount: data.amount,
        description: data.description,
        reference: data.reference,
        createdById,
        journalEntryId: entry.entryId,
        treasuryId: data.treasuryId,
        counterpartyType: data.counterpartyType ?? null,
        counterpartyId: data.counterpartyId ?? null,
      },
      include: {
        journalEntry: { select: { code: true, id: true } },
        treasury: { select: { id: true, name: true } },
      },
    });
  }
}

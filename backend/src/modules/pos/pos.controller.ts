import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.guard';
import { QuickSaleDto } from './dto/quick-sale.dto';
import { POS_ROLES, PosService } from './pos.service';

/**
 * SELIM-ERP W2 — كنترولر نقطة البيع (POS.tsx في Selim ERP).
 *
 * الأدوار: الكاشير (صاحب الصندوق) + الإدارة العامة + المسؤول الأعلى —
 * نفس طيف أدوار بيع/تحصيل المبيعات الحالية.
 */
@ApiTags('POS (نقطة البيع)')
@Controller('pos')
export class PosController {
  constructor(private readonly posService: PosService) {}

  @Get('barcode/:code')
  @Roles(...POS_ROLES)
  @ApiOperation({
    summary: 'حل الباركود إلى صنف سلة (توليفة أو أول توليفة لمنتج)',
  })
  async resolveBarcode(@Param('code') code: string) {
    return this.posService.resolveBarcode(code);
  }

  @Get('catalog')
  @Roles(...POS_ROLES)
  @ApiOperation({
    summary:
      'كتالوج سريع لنقطة البيع — منتجات نشطة بأسعارها (تُخزن محليًا للعمل offline)',
  })
  async catalog(
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    return this.posService.getCatalog(limit, search);
  }

  @Post('quick-sale')
  @Roles(...POS_ROLES)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description:
      'مفتاح ثابت لفاتورة نقطة البيع — الطابور offline يعيد إرسال نفس المفتاح (نفس الفاتورة لا تتكرر)',
  })
  @ApiOperation({
    summary:
      'بيع سريع نقدي ذري: أمر بيع مؤكد + صرف مخزون + قيد GL + سند قبض + إيصار',
  })
  async quickSale(
    @Body() dto: QuickSaleDto,
    @CurrentUser() user: { id: string },
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.posService.quickSale(dto, user.id, idempotencyKey);
  }
}

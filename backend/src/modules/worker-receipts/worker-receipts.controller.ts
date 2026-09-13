import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.guard';
import { CreateWorkerReceiptDto } from './dto/create-worker-receipt.dto';
import { QueryWorkerReceiptDto } from './dto/query-worker-receipt.dto';
import { WorkerReceiptsService } from './worker-receipts.service';

/**
 * SELIM-ERP W1 — كنترولر سندات قبض العمال (يقلد /api/worker-receipts في
 * Selim ERP).
 *
 * الأدوار: موارد بشرية (إدارة تسويات العمال) + محاسبة (الأثر المالي)
 * + إدارة عامة. السوبر أدمن يتجاوز دائمًا (سلوك RolesGuard العام).
 */
@ApiTags('Worker Receipts (سندات قبض العمال)')
@Controller('worker-receipts')
export class WorkerReceiptsController {
  constructor(private readonly workerReceiptsService: WorkerReceiptsService) {}

  @Post()
  @Roles(UserRole.HR_MANAGER, UserRole.ACCOUNTANT, UserRole.GENERAL_MANAGER)
  @ApiOperation({
    summary:
      'إنشاء سند قبض عامل — حرس رصيد الخزينة + قيد مدين نقدية/دائن سلف العمال في معاملة واحدة',
  })
  async create(
    @Body() dto: CreateWorkerReceiptDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.workerReceiptsService.create(dto, user.id);
  }

  @Get()
  @Roles(UserRole.HR_MANAGER, UserRole.ACCOUNTANT, UserRole.GENERAL_MANAGER)
  @ApiOperation({
    summary: 'قائمة السندات بمرشحات العامل/التاريخ + مجاميع لكل عامل',
  })
  async findAll(
    @Query() query: QueryWorkerReceiptDto = new QueryWorkerReceiptDto(),
  ) {
    return this.workerReceiptsService.findAll(query);
  }

  @Get(':id')
  @Roles(UserRole.HR_MANAGER, UserRole.ACCOUNTANT, UserRole.GENERAL_MANAGER)
  @ApiOperation({ summary: 'تفاصيل سند قبض' })
  async findOne(@Param('id') id: string) {
    return this.workerReceiptsService.findOne(id);
  }

  @Delete(':id')
  @Roles(UserRole.HR_MANAGER, UserRole.ACCOUNTANT, UserRole.GENERAL_MANAGER)
  @ApiOperation({
    summary: 'حذف سند — عكس القيد وإعادة رصيد الخزينة في معاملة واحدة',
  })
  async remove(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.workerReceiptsService.remove(id, user.id);
  }
}

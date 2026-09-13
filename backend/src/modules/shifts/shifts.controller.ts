import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.guard';
import { CloseShiftDto } from './dto/close-shift.dto';
import { OpenShiftDto } from './dto/open-shift.dto';
import { QueryShiftDto } from './dto/query-shift.dto';
import { ShiftsService } from './shifts.service';

/**
 * SELIM-ERP W1 — كنترولر الورديات (يقلد /api/shifts في Selim ERP).
 *
 * الأدوار: الكاشير (صاحب الدرج) + الإدارة العامة (إشراف وإغلاق ورديات
 * الآخرين). السوبر أدمن يتجاوز دائمًا (سلوك RolesGuard العام).
 */
@ApiTags('Shifts (الورديات)')
@Controller('shifts')
export class ShiftsController {
  constructor(private readonly shiftsService: ShiftsService) {}

  @Post('open')
  @Roles(UserRole.CASHIER, UserRole.GENERAL_MANAGER)
  @ApiOperation({
    summary: 'فتح وردية POS — يُرفض عند وجود وردية مفتوحة للمستخدم',
  })
  async open(@Body() dto: OpenShiftDto, @CurrentUser() user: { id: string }) {
    return this.shiftsService.open(dto, user.id);
  }

  @Post(':id/close')
  @Roles(UserRole.CASHIER, UserRole.GENERAL_MANAGER)
  @ApiOperation({
    summary:
      'إغلاق وردية — حساب المتوقع (افتتاحي + مبيعات نقدية) والفرق على الخادم',
  })
  async close(
    @Param('id') id: string,
    @Body() dto: CloseShiftDto,
    @CurrentUser() user: { id: string; role?: UserRole },
  ) {
    return this.shiftsService.close(id, dto, user);
  }

  @Get('current')
  @Roles(UserRole.CASHIER, UserRole.GENERAL_MANAGER)
  @ApiOperation({ summary: 'وردية المستخدم الحالية المفتوحة أو null' })
  async getCurrent(@CurrentUser() user: { id: string }) {
    return this.shiftsService.getCurrent(user.id);
  }

  @Get()
  @Roles(UserRole.CASHIER, UserRole.GENERAL_MANAGER)
  @ApiOperation({
    summary: 'قائمة الورديات بمرشحات الحالة/الفاتح/النطاق الزمني',
  })
  async findAll(@Query() query: QueryShiftDto = new QueryShiftDto()) {
    return this.shiftsService.findAll(query);
  }

  @Get(':id')
  @Roles(UserRole.CASHIER, UserRole.GENERAL_MANAGER)
  @ApiOperation({ summary: 'تفاصيل وردية' })
  async findOne(@Param('id') id: string) {
    return this.shiftsService.findOne(id);
  }
}

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.guard';
import {
  CreateExpenseCategoryDto,
  CreateExpenseDto,
  QueryExpenseDto,
  UpdateExpenseCategoryDto,
  UpdateExpenseDto,
} from './dto/expense.dto';
import { ExpensesService } from './expenses.service';

/**
 * SELIM-ERP W1 — كنترولر المصاريف وبنودها (يقلد /api/expenses و
 * /api/expense-categories في Selim ERP).
 *
 * الأدوار (اتباع التفويض المالي في المشروع الحالي):
 * - قراءة المصروفات: إدارة عامة + محاسبة + كاشير (الصندوق اليومي).
 * - إنشاء مصروف (سحب نقدي من خزينة): إدارة عامة + كاشير.
 * - بنود المصاريف (تعريفات محاسبية): إدارة عامة + محاسبة.
 * - تعديل/حذف المصروفات (أثر مالي عكسي): إدارة عامة فقط.
 */
@ApiTags('Expenses (المصاريف وبنودها)')
@Controller('expenses')
export class ExpensesController {
  constructor(private readonly expensesService: ExpensesService) {}

  // ===================== Categories (EXC) =====================

  @Get('categories')
  @Roles(
    UserRole.GENERAL_MANAGER,
    UserRole.ACCOUNTANT,
    UserRole.CASHIER,
    UserRole.SUPER_ADMIN,
  )
  @ApiOperation({
    summary: 'قائمة بنود المصاريف — تزرع بنود Selim الافتراضية عند أول استخدام',
  })
  async listCategories() {
    return this.expensesService.listCategories();
  }

  @Post('categories')
  @Roles(UserRole.GENERAL_MANAGER, UserRole.ACCOUNTANT, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'إنشاء بند مصروف — الاسم فريد' })
  async createCategory(@Body() dto: CreateExpenseCategoryDto) {
    return this.expensesService.createCategory(dto);
  }

  @Patch('categories/:id')
  @Roles(UserRole.GENERAL_MANAGER, UserRole.ACCOUNTANT, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'تعديل بند مصروف' })
  async updateCategory(
    @Param('id') id: string,
    @Body() dto: UpdateExpenseCategoryDto,
  ) {
    return this.expensesService.updateCategory(id, dto);
  }

  @Delete('categories/:id')
  @Roles(UserRole.GENERAL_MANAGER, UserRole.ACCOUNTANT, UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'حذف بند مصروف — ممنوع إن استُخدم في مصروفات (Restrict)',
  })
  async removeCategory(@Param('id') id: string) {
    return this.expensesService.removeCategory(id);
  }

  // ===================== Expenses (EXP) =====================

  @Get('summary')
  @Roles(UserRole.GENERAL_MANAGER, UserRole.ACCOUNTANT, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'ملخص المصروفات حسب البند (بنفس مرشحات القائمة)' })
  async getSummary(@Query() query: QueryExpenseDto = new QueryExpenseDto()) {
    return this.expensesService.getSummary(query);
  }

  @Get()
  @Roles(
    UserRole.GENERAL_MANAGER,
    UserRole.ACCOUNTANT,
    UserRole.CASHIER,
    UserRole.SUPER_ADMIN,
  )
  @ApiOperation({
    summary: 'قائمة المصروفات ببحث/بند/تاريخ + ترقيم + إجماليات النطاق',
  })
  async findAll(@Query() query: QueryExpenseDto = new QueryExpenseDto()) {
    return this.expensesService.findAll(query);
  }

  @Get(':id')
  @Roles(
    UserRole.GENERAL_MANAGER,
    UserRole.ACCOUNTANT,
    UserRole.CASHIER,
    UserRole.SUPER_ADMIN,
  )
  @ApiOperation({ summary: 'تفاصيل مصروف بقيدة ورصيد خزينته' })
  async findOne(@Param('id') id: string) {
    return this.expensesService.findOne(id);
  }

  @Post()
  @Roles(UserRole.GENERAL_MANAGER, UserRole.CASHIER, UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary:
      'إنشاء مصروف — مع خزينة: خصم رصيد + قيد Dr GENERAL_EXPENSE/Cr CASH داخل معاملة واحدة؛ بلا خزينة: سجل بلا قيد',
  })
  async create(
    @Body() dto: CreateExpenseDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.expensesService.create(dto, user.id);
  }

  @Patch(':id')
  @Roles(UserRole.GENERAL_MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'تعديل مصروف — مسموح فقط للمصروفات غير المقيدة ماليًا',
  })
  async update(@Param('id') id: string, @Body() dto: UpdateExpenseDto) {
    return this.expensesService.update(id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.GENERAL_MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'حذف مصروف — عكس القيد وإعادة رصيد الخزينة داخل معاملة واحدة',
  })
  async remove(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.expensesService.remove(id, user.id);
  }
}

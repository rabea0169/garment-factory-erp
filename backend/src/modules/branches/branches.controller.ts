import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { BranchesService } from './branches.service';
import { CreateBranchDto, UpdateBranchDto } from './dto/branch.dto';

/**
 * SELIM-ERP W4: فروع الشركة — نقل /api/company/branches من Selim ERP.
 * القراءة لكل المصادقين (منتقي الفروع في نماذج البيع/الشراء/الأصناف)،
 * والكتابة (إنشاء/تحديث/حذف) لـ SUPER_ADMIN + GENERAL_MANAGER —
 * نفس قيد owner/admin في المرجع (AdminApiRole).
 */
@ApiTags('Branches (فروع الشركة)')
@Controller('branches')
export class BranchesController {
  constructor(private readonly branchesService: BranchesService) {}

  @Get()
  @ApiOperation({
    summary: 'قائمة الفروع مرتبة (الرئيسي أولًا) مع عدادات المستندات',
  })
  async list() {
    return this.branchesService.list();
  }

  @Post()
  @Roles(UserRole.SUPER_ADMIN, UserRole.GENERAL_MANAGER)
  @ApiOperation({ summary: 'إنشاء فرع (رئيسي واحد فقط — يلغي غيره)' })
  async create(
    @Body() dto: CreateBranchDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.branchesService.create(dto, user.id);
  }

  @Patch(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.GENERAL_MANAGER)
  @ApiOperation({ summary: 'تحديث فرع (نقل الرئيسية يلغي رئيسية غيره)' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBranchDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.branchesService.update(id, dto, user.id);
  }

  @Delete(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.GENERAL_MANAGER)
  @ApiOperation({
    summary: 'حذف فرع — الرئيسي مرفوض؛ حذف غيره يُفك ربط مستنداته بلا فقد',
  })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.branchesService.remove(id, user.id);
  }
}

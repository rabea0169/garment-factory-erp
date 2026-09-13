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
import { CreatePackDto } from './dto/create-pack.dto';
import { BuildPackDto } from './dto/build-pack.dto';
import { QueryPackDto } from './dto/query-pack.dto';
import { PackingService } from './packing.service';

/**
 * SELIM-ERP W1 — كنترولر العبوات (يقلد /api/packing في Selim ERP):
 * تعريف العبوات (مجموعة توليفات) + البناء/التفكيك بحركات مخزون حقيقية.
 *
 * الأدوار: نفس أدوار القص (إنتاج + مخازن + إدارة عامة) — العبوات جزء
 * منظومة التعبئة في خط الإنتاج. السوبر أدمن يتجاوز (RolesGuard العام).
 */
@ApiTags('Packing (العبوات)')
@Controller('packing')
export class PackingController {
  constructor(private readonly packingService: PackingService) {}

  @Get('availability')
  @Roles(
    UserRole.PRODUCTION_MANAGER,
    UserRole.INVENTORY_MANAGER,
    UserRole.GENERAL_MANAGER,
  )
  @ApiOperation({
    summary: 'متاح كل عبوة (بناء − تفكيك) من سجل التدقيق',
  })
  async availability() {
    return this.packingService.availability();
  }

  @Post()
  @Roles(
    UserRole.PRODUCTION_MANAGER,
    UserRole.INVENTORY_MANAGER,
    UserRole.GENERAL_MANAGER,
  )
  @ApiOperation({
    summary: 'إنشاء عبوة — ترقيم نظامي PACK-0001 (كود العميل يُتجاهل)',
  })
  async create(
    @Body() dto: CreatePackDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.packingService.create(dto, user.id);
  }

  @Get()
  @Roles(
    UserRole.PRODUCTION_MANAGER,
    UserRole.INVENTORY_MANAGER,
    UserRole.GENERAL_MANAGER,
  )
  @ApiOperation({ summary: 'قائمة العبوات بمكوناتها + المتاح المحسوب' })
  async listPacks(@Query() query: QueryPackDto = new QueryPackDto()) {
    return this.packingService.listPacks(query);
  }

  @Get(':id')
  @Roles(
    UserRole.PRODUCTION_MANAGER,
    UserRole.INVENTORY_MANAGER,
    UserRole.GENERAL_MANAGER,
  )
  @ApiOperation({ summary: 'تفاصيل عبوة بمكوناتها' })
  async findOne(@Param('id') id: string) {
    return this.packingService.findOne(id);
  }

  @Post(':id/build')
  @Roles(
    UserRole.PRODUCTION_MANAGER,
    UserRole.INVENTORY_MANAGER,
    UserRole.GENERAL_MANAGER,
  )
  @ApiOperation({
    summary:
      'بناء عدد عبوات — خصم مكوناتها من المخزن داخل معاملة واحدة + توثيق تدقيق',
  })
  async build(
    @Param('id') id: string,
    @Body() dto: BuildPackDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.packingService.build(id, dto, user.id);
  }

  @Post(':id/unpack')
  @Roles(
    UserRole.PRODUCTION_MANAGER,
    UserRole.INVENTORY_MANAGER,
    UserRole.GENERAL_MANAGER,
  )
  @ApiOperation({
    summary:
      'تفكيك عدد عبوات — إعادة المكونات للمخزن بتكلفة البناء + توثيق تدقيق',
  })
  async unpack(
    @Param('id') id: string,
    @Body() dto: BuildPackDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.packingService.unpack(id, dto, user.id);
  }

  @Delete(':id')
  @Roles(
    UserRole.PRODUCTION_MANAGER,
    UserRole.INVENTORY_MANAGER,
    UserRole.GENERAL_MANAGER,
  )
  @ApiOperation({
    summary: 'حذف عبوة — يُرفض إن كان لها عمليات بناء موثقة',
  })
  async remove(@Param('id') id: string) {
    return this.packingService.remove(id);
  }
}

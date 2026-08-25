import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/roles.guard';
import { AddStockDto } from './dto/add-stock.dto';

@ApiTags('Inventory (المخزون)')
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get('raw-materials')
  @ApiOperation({ summary: 'الحصول على جميع المواد الخام' })
  async getRawMaterials() {
    return this.inventoryService.getAllRawMaterials();
  }

  @Get('raw-materials/low-stock')
  @ApiOperation({ summary: 'المواد الخام التي قاربت على الانتهاء' })
  async getLowStockMaterials() {
    return this.inventoryService.getLowStockMaterials();
  }

  @Post('raw-materials/:id/add-stock')
  @Roles(UserRole.INVENTORY_MANAGER)
  @ApiOperation({ summary: 'إضافة رصيد لمادة خام' })
  async addStock(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AddStockDto,
  ) {
    return this.inventoryService.addRawMaterialStock(
      id,
      body.quantity,
      body.costPerUnit,
    );
  }

  @Get('finished-goods')
  @ApiOperation({ summary: 'الحصول على المنتجات التامة الصنع' })
  async getFinishedGoods() {
    return this.inventoryService.getAllFinishedGoods();
  }

  @Get('summary')
  @ApiOperation({ summary: 'إحصائيات المخزون للوحة التحكم' })
  async getSummary() {
    return this.inventoryService.getDashboardSummary();
  }
}

import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

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
  @ApiOperation({ summary: 'إضافة رصيد لمادة خام' })
  async addStock(
    @Param('id') id: string,
    @Body() body: { quantity: number; costPerUnit: number },
  ) {
    return this.inventoryService.addRawMaterialStock(id, body.quantity, body.costPerUnit);
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

import { Controller, Get, Post, Body } from '@nestjs/common';
import { SalesService } from './sales.service';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

@ApiTags('Sales (المبيعات والعملاء)')
@Controller('sales')
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  @Get('customers')
  @ApiOperation({ summary: 'قائمة العملاء' })
  async getCustomers() {
    return this.salesService.getCustomers();
  }

  @Post('customers')
  @ApiOperation({ summary: 'إضافة عميل جديد' })
  async createCustomer(@Body() body: { name: string; phone?: string; address?: string }) {
    return this.salesService.createCustomer(body);
  }

  @Get('orders')
  @ApiOperation({ summary: 'قائمة أوامر البيع (الفواتير)' })
  async getSalesOrders() {
    return this.salesService.getSalesOrders();
  }

  @Post('orders')
  @ApiOperation({ summary: 'إنشاء أمر بيع جديد' })
  async createOrder(@Body() body: any) {
    return this.salesService.createSalesOrder(body);
  }
}

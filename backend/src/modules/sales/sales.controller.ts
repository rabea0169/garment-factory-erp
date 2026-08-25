import { Controller, Get, Post, Body } from '@nestjs/common';
import { SalesService } from './sales.service';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PaymentType, UserRole } from '@prisma/client';
import { Roles } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';

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
  @Roles(UserRole.CASHIER, UserRole.GENERAL_MANAGER)
  @ApiOperation({ summary: 'إضافة عميل جديد' })
  async createCustomer(
    @Body() body: { name: string; phone?: string; address?: string },
  ) {
    return this.salesService.createCustomer(body);
  }

  @Get('orders')
  @ApiOperation({ summary: 'قائمة أوامر البيع (الفواتير)' })
  async getSalesOrders() {
    return this.salesService.getSalesOrders();
  }

  @Post('orders')
  @Roles(UserRole.CASHIER, UserRole.GENERAL_MANAGER)
  @ApiOperation({ summary: 'إنشاء أمر بيع جديد' })
  async createOrder(
    @CurrentUser('id') userId: string,
    @Body()
    body: {
      customerId: string;
      paymentType: PaymentType;
      discount: number;
      items: {
        productVariantId: string;
        quantity: number;
        unitPrice: number;
      }[];
    },
  ) {
    // P0-04: userId من الجلسة فقط — أي userId وارد في body يُتجاهل
    return this.salesService.createSalesOrder(body, userId);
  }
}

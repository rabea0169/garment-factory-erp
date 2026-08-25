import { Controller, Get, Post, Body } from '@nestjs/common';
import { SalesService } from './sales.service';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { CreateSalesOrderDto } from './dto/create-sales-order.dto';

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
  async createCustomer(@Body() body: CreateCustomerDto) {
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
    @Body() body: CreateSalesOrderDto,
  ) {
    // P0-04: userId من الجلسة فقط — إرساله في body يُرفض بـ 400 (forbidNonWhitelisted)
    return this.salesService.createSalesOrder(body, userId);
  }
}

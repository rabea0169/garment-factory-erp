import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { SalesService } from './sales.service';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { CreateSalesOrderDto } from './dto/create-sales-order.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';

@ApiTags('Sales (المبيعات والعملاء)')
@Controller('sales')
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  @Get('customers')
  @ApiOperation({ summary: 'قائمة العملاء' })
  async getCustomers(@Query() pagination: PaginationDto) {
    return this.salesService.getCustomers(pagination);
  }

  @Post('customers')
  @Roles(UserRole.CASHIER, UserRole.GENERAL_MANAGER)
  @ApiOperation({ summary: 'إضافة عميل جديد' })
  async createCustomer(@Body() body: CreateCustomerDto) {
    return this.salesService.createCustomer(body);
  }

  @Get('orders')
  @ApiOperation({ summary: 'قائمة أوامر البيع (الفواتير)' })
  async getSalesOrders(@Query() pagination: PaginationDto) {
    return this.salesService.getSalesOrders(pagination);
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

  @Post('orders/:id/confirm')
  @Roles(UserRole.CASHIER, UserRole.GENERAL_MANAGER)
  @ApiOperation({ summary: 'تأكيد أمر البيع وصرف المخزون' })
  async confirmOrder(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.salesService.confirmOrder(id, userId);
  }
}

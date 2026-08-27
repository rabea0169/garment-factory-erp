import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Headers,
} from '@nestjs/common';
import { SalesService } from './sales.service';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { CreateSalesOrderDto } from './dto/create-sales-order.dto';
import { ConfirmSalesOrderDto } from './dto/confirm-sales-order.dto';
import { CreateCustomerPaymentDto } from './dto/create-customer-payment.dto';
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
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<unknown> {
    // P0-04: userId من الجلسة فقط — إرساله في body يُرفض بـ 400 (forbidNonWhitelisted)
    // A8: Idempotency-Key اختياري — نفس المفتاح + نفس المحتوى = نفس الاستجابة بلا أثر جديد.
    return await this.salesService.createSalesOrder(
      body,
      userId,
      idempotencyKey,
    );
  }

  @Post('orders/:id/confirm')
  @Roles(UserRole.CASHIER, UserRole.GENERAL_MANAGER)
  @ApiOperation({ summary: 'تأكيد أمر البيع وصرف المخزون' })
  async confirmOrder(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() body: ConfirmSalesOrderDto = {},
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<unknown> {
    // A8: Idempotency-Key على التأكيد — يمنع صرفًا مزدوجًا عند إعادة المحاولة.
    return await this.salesService.confirmOrder(
      id,
      userId,
      idempotencyKey,
      body?.treasuryId,
    );
  }

  @Post('orders/:id/payments')
  @Roles(UserRole.CASHIER, UserRole.GENERAL_MANAGER)
  @ApiOperation({ summary: 'تحصيل دفعة من عميل على أمر بيع' })
  async recordCustomerPayment(
    @Param('id') id: string,
    @Body() body: CreateCustomerPaymentDto,
    @CurrentUser('id') actorId: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<unknown> {
    return this.salesService.recordCustomerPayment(
      id,
      body,
      actorId,
      idempotencyKey,
    );
  }
}

import {
  Controller,
  Get,
  Post,
  Body,
  Headers,
  Param,
  Put,
  UseGuards,
  Query,
} from '@nestjs/common';
import { PurchasingService } from './purchasing.service';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { CreatePurchaseReceiptDto } from './dto/create-purchase-receipt.dto';
import { ReturnToSupplierDto } from './dto/return-to-supplier.dto';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { UserRole } from '@prisma/client';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiHeader,
} from '@nestjs/swagger';
import { PaginationDto } from '../../common/dto/pagination.dto';

@ApiTags('Purchasing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('purchasing')
export class PurchasingController {
  constructor(private readonly purchasingService: PurchasingService) {}

  @Get('orders')
  @ApiOperation({ summary: 'Get all purchase orders with pagination' })
  async getPurchaseOrders(@Query() pagination: PaginationDto) {
    return this.purchasingService.getPurchaseOrders(pagination);
  }

  @Post()
  @Roles(UserRole.INVENTORY_MANAGER, UserRole.GENERAL_MANAGER)
  @ApiOperation({ summary: 'Create a new purchase order' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description:
      'PUR-3: مفتاح ثابت لإعادة إرسال نفس أمر الشراء بأمان — نفس المفتاح + نفس المحتوى = نفس الاستجابة، ومحتوى مختلف = 409',
  })
  async create(
    @Body() dto: CreatePurchaseOrderDto,
    @CurrentUser('id') userId: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.purchasingService.createPurchaseOrder(
      dto,
      userId,
      idempotencyKey,
    );
  }

  @Post(':id/receipts')
  @Roles(UserRole.INVENTORY_MANAGER, UserRole.GENERAL_MANAGER)
  @ApiOperation({ summary: 'Create a partial or complete goods receipt' })
  async createReceipt(
    @Param('id') id: string,
    @Body() dto: CreatePurchaseReceiptDto,
    @CurrentUser('id') userId: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.purchasingService.createReceipt(
      id,
      dto,
      userId,
      idempotencyKey,
    );
  }

  @Put(':id/receive')
  @Roles(UserRole.INVENTORY_MANAGER, UserRole.GENERAL_MANAGER)
  @ApiOperation({ summary: 'Receive purchase order into inventory' })
  async receive(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.purchasingService.receiveOrder(id, userId);
  }

  @Post(':id/approve')
  @Roles(UserRole.INVENTORY_MANAGER, UserRole.GENERAL_MANAGER)
  @ApiOperation({
    summary: 'PUR-5 (أ): اعتماد أمر شراء DRAFT (فصل واجبات — المنشئ لا يعتمد)',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: 'PUR-5 (أ): مفتاح ثابت لإعادة إرسال طلب الاعتماد بأمان',
  })
  async approveOrder(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.purchasingService.approvePurchaseOrder(
      id,
      userId,
      idempotencyKey,
    );
  }

  @Post(':id/cancel')
  @Roles(UserRole.INVENTORY_MANAGER, UserRole.GENERAL_MANAGER)
  @ApiOperation({ summary: 'PUR-5: إلغاء أمر شراء مسودة (DRAFT فقط)' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: 'PUR-5: مفتاح ثابت لإعادة إرسال طلب الإلغاء بأمان',
  })
  async cancelOrder(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.purchasingService.cancelPurchaseOrder(
      id,
      userId,
      idempotencyKey,
    );
  }

  @Post(':id/return')
  @Roles(UserRole.INVENTORY_MANAGER, UserRole.GENERAL_MANAGER)
  @ApiOperation({ summary: 'Return purchase order item to supplier' })
  async returnItem(
    @Param('id') id: string,
    @Body() dto: ReturnToSupplierDto,
    @CurrentUser('id') userId: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.purchasingService.returnToSupplier(
      id,
      dto,
      userId,
      idempotencyKey,
    );
  }
}

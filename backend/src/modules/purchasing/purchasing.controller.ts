import { Controller, Post, Body, Param, Put, UseGuards } from '@nestjs/common';
import { PurchasingService } from './purchasing.service';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { UserRole } from '@prisma/client';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';

@ApiTags('Purchasing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('purchasing')
export class PurchasingController {
  constructor(private readonly purchasingService: PurchasingService) {}

  @Post()
  @Roles(UserRole.INVENTORY_MANAGER, UserRole.GENERAL_MANAGER)
  @ApiOperation({ summary: 'Create a new purchase order' })
  async create(
    @Body() dto: CreatePurchaseOrderDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.purchasingService.createPurchaseOrder(dto, userId);
  }

  @Put(':id/receive')
  @Roles(UserRole.INVENTORY_MANAGER, UserRole.GENERAL_MANAGER)
  @ApiOperation({ summary: 'Receive purchase order into inventory' })
  async receive(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.purchasingService.receiveOrder(id, userId);
  }

  @Post(':id/return')
  @Roles(UserRole.INVENTORY_MANAGER, UserRole.GENERAL_MANAGER)
  @ApiOperation({ summary: 'Return purchase order item to supplier' })
  async returnItem(
    @Param('id') id: string,
    @Body() body: { itemId: string; quantity: number },
    @CurrentUser('id') userId: string,
  ) {
    return this.purchasingService.returnToSupplier(
      id,
      body.itemId,
      body.quantity,
      userId,
    );
  }
}

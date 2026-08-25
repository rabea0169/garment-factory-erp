import { Controller, Get, Post, Body } from '@nestjs/common';
import { ShippingService } from './shipping.service';
import { ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/roles.guard';

@ApiTags('Shipping (الشحن)')
@Controller('shipping')
export class ShippingController {
  constructor(private readonly shippingService: ShippingService) {}

  @Get()
  async getShipments() {
    return this.shippingService.getShipments();
  }

  @Post()
  @Roles(UserRole.CASHIER, UserRole.GENERAL_MANAGER)
  async createShipment(
    @Body()
    body: {
      salesOrderId: string;
      shippingCompanyId?: string;
      shippingCost?: number;
      trackingNumber?: string;
      notes?: string;
    },
  ) {
    return this.shippingService.createShipment(body);
  }
}

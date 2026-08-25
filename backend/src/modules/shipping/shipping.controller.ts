import { Controller, Get, Post, Body } from '@nestjs/common';
import { ShippingService } from './shipping.service';
import { ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/roles.guard';
import { CreateShipmentDto } from './dto/create-shipment.dto';

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
  async createShipment(@Body() body: CreateShipmentDto) {
    return this.shippingService.createShipment(body);
  }
}

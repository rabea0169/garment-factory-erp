import { Controller, Get, Post, Body } from '@nestjs/common';
import { ShippingService } from './shipping.service';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('Shipping (الشحن)')
@Controller('shipping')
export class ShippingController {
  constructor(private readonly shippingService: ShippingService) {}

  @Get()
  async getShipments() {
    return this.shippingService.getShipments();
  }

  @Post()
  async createShipment(@Body() body: any) {
    return this.shippingService.createShipment(body);
  }
}

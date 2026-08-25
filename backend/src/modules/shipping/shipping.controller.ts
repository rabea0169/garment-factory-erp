import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { ShippingService } from './shipping.service';
import { ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/roles.guard';
import { CreateShipmentDto } from './dto/create-shipment.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';

@ApiTags('Shipping (الشحن)')
@Controller('shipping')
export class ShippingController {
  constructor(private readonly shippingService: ShippingService) {}

  @Get()
  async getShipments(@Query() pagination: PaginationDto = new PaginationDto()) {
    return this.shippingService.getShipments(pagination);
  }

  @Post()
  @Roles(UserRole.CASHIER, UserRole.GENERAL_MANAGER)
  async createShipment(@Body() body: CreateShipmentDto) {
    return this.shippingService.createShipment(body);
  }
}

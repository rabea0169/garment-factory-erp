import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  Query,
  Headers,
} from '@nestjs/common';
import { ShippingService } from './shipping.service';
import { ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.guard';
import { CreateShipmentDto } from './dto/create-shipment.dto';
import { UpdateShipmentStatusDto } from './dto/update-shipment-status.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';

@ApiTags('Shipping (الشحن)')
@Controller('shipping')
export class ShippingController {
  constructor(private readonly shippingService: ShippingService) {}

  @Get()
  async getShipments(@Query() pagination: PaginationDto = new PaginationDto()) {
    return this.shippingService.getShipments(pagination);
  }

  @Patch(':id/status')
  @Roles(UserRole.CASHIER, UserRole.GENERAL_MANAGER)
  async updateStatus(
    @Param('id') id: string,
    @Body() body: UpdateShipmentStatusDto,
    @CurrentUser('id') actorId: string,
  ) {
    return this.shippingService.updateShipmentStatus(
      id,
      body.status,
      actorId,
      body.proofOfDelivery,
    );
  }

  @Post()
  @Roles(UserRole.CASHIER, UserRole.GENERAL_MANAGER)
  async createShipment(
    @Body() body: CreateShipmentDto,
    @CurrentUser('id') actorId: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.shippingService.createShipment(body, actorId, idempotencyKey);
  }
}

import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  Headers,
} from '@nestjs/common';
import { ShippingService } from './shipping.service';
import { ApiTags, ApiOperation, ApiHeader } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.guard';
import { CreateShipmentDto } from './dto/create-shipment.dto';
import { UpdateShipmentStatusDto } from './dto/update-shipment-status.dto';
import { ShipmentQueryDto } from './dto/shipment-query.dto';

@ApiTags('Shipping (الشحن)')
@Controller('shipping')
export class ShippingController {
  constructor(private readonly shippingService: ShippingService) {}

  @Get()
  @ApiOperation({
    summary: 'SHP-5: قائمة الشحنات بإسقاط انتقائي ومرشحات (CC-6)',
  })
  async getShipments(
    @Query() query: ShipmentQueryDto = new ShipmentQueryDto(),
  ) {
    return this.shippingService.getShipments(query);
  }

  @Patch(':id/status')
  @Roles(UserRole.CASHIER, UserRole.GENERAL_MANAGER)
  @ApiOperation({
    summary: 'SHP-6: تحديث حالة الشحنة (idempotent عبر Idempotency-Key)',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description:
      'SHP-6: مفتاح ثابت لإعادة إرسال نفس تحديث الحالة بأمان — نفس المفتاح + نفس المحتوى = نفس الاستجابة، ومحتوى مختلف = 409',
  })
  async updateStatus(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateShipmentStatusDto,
    @CurrentUser('id') actorId: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.shippingService.updateShipmentStatus(
      id,
      body.status,
      actorId,
      body.proofOfDelivery,
      idempotencyKey,
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

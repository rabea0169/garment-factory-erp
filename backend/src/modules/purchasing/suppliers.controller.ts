import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { Roles } from '../auth/roles.guard';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { SuppliersService } from './suppliers.service';

@ApiTags('Suppliers (الموردون)')
@ApiBearerAuth()
@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly suppliersService: SuppliersService) {}

  @Get()
  @ApiOperation({ summary: 'قائمة الموردين النشطين مع pagination' })
  async getSuppliers(@Query() pagination: PaginationDto = new PaginationDto()) {
    return this.suppliersService.getSuppliers(pagination);
  }

  @Post()
  @Roles(UserRole.INVENTORY_MANAGER, UserRole.GENERAL_MANAGER)
  @ApiOperation({ summary: 'إنشاء مورد جديد' })
  async createSupplier(@Body() body: CreateSupplierDto) {
    return this.suppliersService.createSupplier(body);
  }
}

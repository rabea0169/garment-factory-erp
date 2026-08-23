import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    // استخدم process.env['DATABASE_URL'] أو قيمة افتراضية للاحتياط
    const pool = new Pool({ connectionString: process.env['DATABASE_URL'] || 'postgresql://postgres:erp_password_2024@localhost:5432/garment_erp?schema=public' });
    const adapter = new PrismaPg(pool);
    super({ adapter });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

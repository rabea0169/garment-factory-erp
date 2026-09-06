import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';
import type { SignOptions } from 'jsonwebtoken';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: {
          // GF-0003: إزالة `as any` — cast مباشر إلى نوع خيارات التوقيع
          // AUTH-1 (W1-D): الافتراضي 30m بدل 7d القديم الخطِر — عمر قصير
          // لتوكن الوصول يضمن أن إبطال jwtVersion (logout/SEC-F04) يسري فعليًا.
          // استمرارية الجلسة مسؤولية دورة التحديث SEC-F04 (refresh rotation)
          // وليست عمر access token الطويل.
          expiresIn: configService.get<string>(
            'JWT_EXPIRES_IN',
            '30m',
          ) as SignOptions['expiresIn'],
        },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
})
export class AuthModule {}

import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AdminController } from './admin.controller';
import { AdminAuthGuard } from './admin.guard';
import { WmsAuthGuard } from './wms-auth.guard';
import { PrismaService } from '../../prisma.service';

@Module({
  controllers: [AuthController, AdminController],
  providers: [PrismaService, AdminAuthGuard, WmsAuthGuard],
  exports: [AdminAuthGuard, WmsAuthGuard],
})
export class AuthModule {}

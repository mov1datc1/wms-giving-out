import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AdminController } from './admin.controller';
import { AdminAuthGuard } from './admin.guard';
import { PrismaService } from '../../prisma.service';

@Module({
  controllers: [AuthController, AdminController],
  providers: [PrismaService, AdminAuthGuard],
  exports: [AdminAuthGuard],
})
export class AuthModule {}

import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AdminController } from './admin.controller';
import { PrismaService } from '../../prisma.service';

@Module({
  controllers: [AuthController, AdminController],
  providers: [PrismaService],
})
export class AuthModule {}

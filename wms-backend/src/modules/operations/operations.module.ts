import { Module } from '@nestjs/common';
import { OperationsController } from './operations.controller';
import { PrismaService } from '../../prisma.service';

@Module({
  controllers: [OperationsController],
  providers: [PrismaService],
})
export class OperationsModule {}

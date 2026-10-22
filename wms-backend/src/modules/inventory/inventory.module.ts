import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { PrismaService } from '../../prisma.service';
import { OperationsModule } from '../operations/operations.module';

@Module({
  imports: [OperationsModule],
  controllers: [InventoryController],
  providers: [PrismaService],
})
export class InventoryModule {}

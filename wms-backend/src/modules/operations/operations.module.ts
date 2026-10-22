import { Module } from '@nestjs/common';
import { OperationsController } from './operations.controller';
import { PrismaService } from '../../prisma.service';
import { PutawayEngineService } from './putaway-engine.service';

@Module({
  controllers: [OperationsController],
  providers: [PrismaService, PutawayEngineService],
  exports: [PutawayEngineService],
})
export class OperationsModule {}

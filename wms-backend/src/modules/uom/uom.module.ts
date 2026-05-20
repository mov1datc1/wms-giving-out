import { Module } from '@nestjs/common';
import { UomController } from './uom.controller';
import { PrismaService } from '../../prisma.service';

@Module({
  controllers: [UomController],
  providers: [PrismaService],
})
export class UomModule {}

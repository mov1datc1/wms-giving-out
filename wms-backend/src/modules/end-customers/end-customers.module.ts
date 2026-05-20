import { Module } from '@nestjs/common';
import { EndCustomersController } from './end-customers.controller';
import { PrismaService } from '../../prisma.service';

@Module({
  controllers: [EndCustomersController],
  providers: [PrismaService],
})
export class EndCustomersModule {}

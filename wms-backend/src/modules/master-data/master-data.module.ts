import { Module } from '@nestjs/common';
import { MasterDataController } from './master-data.controller';
import { PrismaService } from '../../prisma.service';
import { EmailService } from '../../email.service';

@Module({
  controllers: [MasterDataController],
  providers: [PrismaService, EmailService],
})
export class MasterDataModule {}

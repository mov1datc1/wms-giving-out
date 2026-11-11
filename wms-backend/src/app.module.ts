import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaService } from './prisma.service';
import { AuthModule } from './modules/auth/auth.module';
import { WmsAuthGuard } from './modules/auth/wms-auth.guard';
import { UsersModule } from './modules/users/users.module';
import { ClientsModule } from './modules/clients/clients.module';
import { EndCustomersModule } from './modules/end-customers/end-customers.module';
import { UomModule } from './modules/uom/uom.module';
import { MasterDataModule } from './modules/master-data/master-data.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { OperationsModule } from './modules/operations/operations.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    AuthModule,
    UsersModule,
    ClientsModule,
    EndCustomersModule,
    UomModule,
    MasterDataModule,
    InventoryModule,
    OperationsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    PrismaService,
    {
      provide: APP_GUARD,
      useClass: WmsAuthGuard,
    },
  ],
})
export class AppModule {}

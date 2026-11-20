import { Global, Module } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { SettingsController } from './settings.controller';
import { TaxesController } from './taxes.controller';
import { TaxesService } from './taxes.service';

@Global()
@Module({
  controllers: [SettingsController, TaxesController],
  providers: [SettingsService, TaxesService],
  exports: [SettingsService],
})
export class SettingsModule {}

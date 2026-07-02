import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { EventsGateway } from './events.gateway';
import { PttGateway } from './ptt.gateway';

@Global()
@Module({
  imports: [JwtModule.register({})],
  providers: [EventsGateway, PttGateway],
  exports: [EventsGateway],
})
export class RealtimeModule {}

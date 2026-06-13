import { Controller, Get, Header } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { HealthService } from './health.service';

@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  current() {
    return this.health.current();
  }

  @Get('migrations')
  migrations() {
    return this.health.currentMigrations();
  }

  @Get('project')
  project() {
    return this.health.project();
  }

  @Get('status')
  @Header('Content-Type', 'text/html; charset=utf-8')
  statusPage() {
    return this.health.statusPage();
  }
}

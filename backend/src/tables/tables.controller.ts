import { Controller, Get } from '@nestjs/common';
import { TablesService } from './tables.service';

@Controller('tables')
export class TablesController {
  constructor(private readonly tables: TablesService) {}

  @Get()
  findAll() {
    return this.tables.findAll();
  }
}

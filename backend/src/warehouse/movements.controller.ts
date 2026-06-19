import { Controller, Get, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { MovementsService } from './movements.service';
import { Roles } from '../common/decorators/roles.decorator';
import { MovementsQueryDto } from './dto';

@Controller('admin/warehouse/movements')
@Roles(Role.ADMIN, Role.OWNER)
export class MovementsController {
  constructor(private readonly movements: MovementsService) {}

  @Get('summary')
  summary(@Query() query: MovementsQueryDto) {
    return this.movements.summary(query);
  }

  @Get()
  findAll(@Query() query: MovementsQueryDto) {
    return this.movements.findAll(query);
  }
}

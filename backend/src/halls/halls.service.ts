import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class HallsService {
  constructor(private prisma: PrismaService) {}

  /** Активные залы со столами — для экрана выбора стола официантом. */
  findAllWithTables() {
    return this.prisma.hall.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      include: {
        tables: {
          where: { isActive: true },
          orderBy: { sortOrder: 'asc' },
          select: { id: true, number: true, seats: true, status: true },
        },
      },
    });
  }
}

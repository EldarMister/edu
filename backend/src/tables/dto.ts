import { IsNotEmpty, IsString } from 'class-validator';

export class MoveTableDto {
  @IsString()
  @IsNotEmpty({ message: 'Укажите целевой стол' })
  targetTableId: string;
}

export class TransferTableDto {
  @IsString()
  @IsNotEmpty({ message: 'Укажите официанта' })
  waiterId: string;
}

import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsString, ValidateNested } from 'class-validator';

export class StopListItemDto {
  @IsString()
  dishId: string;

  @IsBoolean()
  isAvailable: boolean;
}

export class UpdateStopListDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => StopListItemDto)
  items: StopListItemDto[];
}

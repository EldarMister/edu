import { IsNumber, IsOptional, Max, Min } from 'class-validator';

export class StartShiftDto {
  @IsOptional() @IsNumber() @Min(-90) @Max(90)
  latitude?: number;

  @IsOptional() @IsNumber() @Min(-180) @Max(180)
  longitude?: number;

  @IsOptional() @IsNumber() @Min(0)
  accuracy?: number;
}

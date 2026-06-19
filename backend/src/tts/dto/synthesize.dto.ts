import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class SynthesizeDto {
  @IsString()
  @IsNotEmpty({ message: 'Текст обязателен' })
  @MaxLength(2000)
  text: string;

  @IsOptional()
  @IsString()
  @IsIn(['baya', 'kseniya', 'ksenia', 'xenia', 'eugene', 'aidar'])
  speaker?: string;

  @IsOptional()
  @IsString()
  @IsIn(['v5_2_ru'])
  preferredModel?: string;

  @IsOptional()
  @IsString()
  @IsIn(['v4_ru'])
  fallbackModel?: string;
}

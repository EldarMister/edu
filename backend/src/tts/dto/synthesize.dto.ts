import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class SynthesizeDto {
  @IsString()
  @IsNotEmpty({ message: 'Текст обязателен' })
  @MaxLength(2000)
  text: string;
}

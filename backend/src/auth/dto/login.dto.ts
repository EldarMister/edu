import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsString()
  @IsNotEmpty({ message: 'Укажите номер телефона' })
  phone: string;

  @IsString()
  @MinLength(4, { message: 'Пароль слишком короткий' })
  password: string;
}

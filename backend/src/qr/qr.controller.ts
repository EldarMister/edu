import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { QrService } from './qr.service';
import { AddItemDto, JoinDto, SubmitDto, UpdateItemDto } from './dto';

/**
 * Публичные эндпоинты QR-меню стола. Без JWT — доступны гостю по ссылке из QR.
 * Все мутации идентифицируют гостя по guestKey (localStorage).
 */
@Public()
@Controller('public')
export class QrController {
  constructor(private readonly qr: QrService) {}

  /** Меню стола: заведение, стол, категории, блюда. */
  @Get('menu/:tableToken')
  menu(@Param('tableToken') tableToken: string) {
    return this.qr.getMenu(tableToken);
  }

  /** Текущая (draft) сессия общего заказа стола. */
  @Get('qr-session/:tableToken')
  session(@Param('tableToken') tableToken: string) {
    return this.qr.getSession(tableToken);
  }

  /** Уже отправленный QR-заказ с живыми статусами позиций. */
  @Get('qr-session/:tableToken/orders/:orderId')
  submittedOrder(
    @Param('tableToken') tableToken: string,
    @Param('orderId') orderId: string,
  ) {
    return this.qr.getSubmittedOrder(tableToken, orderId);
  }

  /** Вход гостя — создаёт/возвращает guestId и guestLabel. */
  @Post('qr-session/:tableToken/join')
  join(@Param('tableToken') tableToken: string, @Body() dto: JoinDto) {
    return this.qr.join(tableToken, dto.guestKey);
  }

  /** Добавить позицию в общий заказ. */
  @Post('qr-session/:tableToken/items')
  addItem(@Param('tableToken') tableToken: string, @Body() dto: AddItemDto) {
    return this.qr.addItem(tableToken, dto);
  }

  /** Изменить количество своей позиции. */
  @Patch('qr-session/:tableToken/items/:itemId')
  updateItem(
    @Param('tableToken') tableToken: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateItemDto,
  ) {
    return this.qr.updateItem(tableToken, itemId, dto);
  }

  /** Удалить свою позицию (guestKey — в query). */
  @Delete('qr-session/:tableToken/items/:itemId')
  removeItem(
    @Param('tableToken') tableToken: string,
    @Param('itemId') itemId: string,
    @Query('guestKey') guestKey: string,
  ) {
    return this.qr.removeItem(tableToken, itemId, guestKey);
  }

  /** Отправить общий заказ в POS. */
  @Post('qr-session/:tableToken/submit')
  submit(@Param('tableToken') tableToken: string, @Body() dto: SubmitDto) {
    return this.qr.submit(tableToken, dto.guestKey);
  }
}

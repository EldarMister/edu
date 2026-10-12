import { SetMetadata } from '@nestjs/common';

export const PERMISSION_KEY = 'required_permission';

/**
 * Требует у сотрудника право доступа (строка вида "sections.warehouse").
 * Владелец проходит всегда; остальные — по сохранённым/дефолтным правам.
 */
export const RequirePermission = (permission: string) => SetMetadata(PERMISSION_KEY, permission);

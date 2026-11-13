import { SetMetadata } from '@nestjs/common';

export const PERMISSION_KEY = 'required_permission';

/**
 * Требует у сотрудника право доступа (строка вида "sections.warehouse").
 * Владелец проходит всегда; остальные — по сохранённым/дефолтным правам.
 */
export const RequirePermission = (...permissions: string[]) => SetMetadata(PERMISSION_KEY, permissions);

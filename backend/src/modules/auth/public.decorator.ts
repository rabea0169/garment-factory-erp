import { SetMetadata } from '@nestjs/common';

/**
 * يعلّم المسار كعام — يتجاوز JwtAuthGuard.
 * مقصور حاليًا على: POST /auth/login و GET /
 * (GF-0002 — قاعدة fail-closed: كل ما ليس عامًا محمي افتراضيًا)
 */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

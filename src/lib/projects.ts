import { z } from 'zod';
import { zUuid } from './api';

export const projectInput = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().max(5000).optional(),
  orgUnitId: zUuid,
  brandId: z.enum(['dagym', 'hilink', 'bodylab']).nullable().optional(),
  ownerId: zUuid.nullable().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  archived: z.boolean().optional(),
});

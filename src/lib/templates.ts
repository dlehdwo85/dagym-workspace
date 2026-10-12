import { z } from 'zod';
export const templatePayload = z.object({
  title: z.string().max(200),
  description: z.string().max(20000).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  approvalRequired: z.boolean().optional(),
  dueInDays: z.number().int().min(0).max(365).optional(),
  tags: z.array(z.string()).optional(),
  checklist: z.array(z.string()).optional(),
  subtasks: z.array(z.string()).optional(),
  recurrence: z.string().optional(),
});
export type TemplatePayload = z.infer<typeof templatePayload>;

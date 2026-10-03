import { z } from 'zod';

const email = z.string().trim().toLowerCase().email().max(254);
const password = z.string().min(15, 'Use at least 15 characters.').max(128);
export const registerSchema = z
  .object({ name: z.string().trim().min(2).max(80), email, password })
  .strict();
export const loginSchema = z.object({ email, password: z.string().min(1).max(128) }).strict();

export const statusSchema = z.enum(['TODO', 'IN_PROGRESS', 'DONE']);
export const prioritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH']);
const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a valid date.')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return (
      !Number.isNaN(date.getTime()) &&
      date.toISOString().slice(0, 10) === value &&
      value >= '1000-01-01'
    );
  }, 'Choose a valid calendar date.')
  .nullable();
const taskFieldsSchema = z
  .object({
    title: z.string().trim().min(1, 'A title is required.').max(200),
    description: z.string().trim().max(5000),
    status: statusSchema,
    priority: prioritySchema,
    dueDate: calendarDate,
  })
  .strict();
export const taskSchema = taskFieldsSchema.extend({
  description: taskFieldsSchema.shape.description.default(''),
  status: statusSchema.default('TODO'),
  priority: prioritySchema.default('MEDIUM'),
  dueDate: calendarDate.default(null),
});
export const updateTaskSchema = taskFieldsSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field.');
export const listSchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(10),
    search: z.string().trim().max(200).default(''),
    status: statusSchema.optional(),
    priority: prioritySchema.optional(),
    sortBy: z
      .enum(['updatedAt', 'createdAt', 'title', 'dueDate', 'priority', 'status'])
      .default('updatedAt'),
    order: z.enum(['asc', 'desc']).default('desc'),
  })
  .strict();
export const taskIdSchema = z.uuid();

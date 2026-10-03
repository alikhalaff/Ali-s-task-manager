import { Router } from 'express';
import { db } from './db.js';
import { csrfProtection, requireAuth } from './auth.js';
import { AppError } from './errors.js';
import { listSchema, taskIdSchema, taskSchema, updateTaskSchema } from './validation.js';
import type { Prisma, Task } from './generated/client.js';

function serialize(task: Task) {
  return { ...task, dueDate: task.dueDate?.toISOString().slice(0, 10) ?? null };
}
export const taskRoutes = Router();
// Return 401 for expired sessions before checking the now-expired CSRF token.
taskRoutes.use(requireAuth, csrfProtection);
taskRoutes.get('/summary', async (req, res) => {
  const userId = req.user!.id;
  const today = new Date(new Date().toISOString().slice(0, 10));
  const [todo, inProgress, done, overdue] = await db.$transaction([
    db.task.count({ where: { userId, status: 'TODO' } }),
    db.task.count({ where: { userId, status: 'IN_PROGRESS' } }),
    db.task.count({ where: { userId, status: 'DONE' } }),
    db.task.count({ where: { userId, status: { not: 'DONE' }, dueDate: { lt: today } } }),
  ]);
  res.json({ total: todo + inProgress + done, todo, inProgress, done, overdue });
});
taskRoutes.get('/', async (req, res) => {
  const query = listSchema.parse(req.query);
  const where: Prisma.TaskWhereInput = {
    userId: req.user!.id,
    ...(query.status && { status: query.status }),
    ...(query.priority && { priority: query.priority }),
    ...(query.search && {
      OR: [{ title: { contains: query.search } }, { description: { contains: query.search } }],
    }),
  };
  const [items, total] = await db.$transaction([
    db.task.findMany({
      where,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      orderBy: [{ [query.sortBy]: query.order }, { id: 'asc' }],
    }),
    db.task.count({ where }),
  ]);
  res.json({ items: items.map(serialize), total, page: query.page, pageSize: query.pageSize });
});
taskRoutes.get('/:id', async (req, res) => {
  const id = taskIdSchema.parse(req.params.id);
  const task = await db.task.findFirst({ where: { id, userId: req.user!.id } });
  if (!task) throw new AppError(404, 'TASK_NOT_FOUND', 'This task could not be found.');
  res.json(serialize(task));
});
taskRoutes.post('/', async (req, res) => {
  const input = taskSchema.parse(req.body);
  const task = await db.task.create({
    data: {
      ...input,
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
      userId: req.user!.id,
    },
  });
  res.status(201).json(serialize(task));
});
taskRoutes.patch('/:id', async (req, res) => {
  const id = taskIdSchema.parse(req.params.id);
  const input = updateTaskSchema.parse(req.body);
  const data = {
    ...input,
    ...(input.dueDate !== undefined && { dueDate: input.dueDate ? new Date(input.dueDate) : null }),
  };
  const task = await db.$transaction(async (tx) => {
    const result = await tx.task.updateMany({ where: { id, userId: req.user!.id }, data });
    if (!result.count) throw new AppError(404, 'TASK_NOT_FOUND', 'This task could not be found.');
    return tx.task.findFirstOrThrow({ where: { id, userId: req.user!.id } });
  });
  res.json(serialize(task));
});
taskRoutes.delete('/:id', async (req, res) => {
  const id = taskIdSchema.parse(req.params.id);
  const result = await db.task.deleteMany({ where: { id, userId: req.user!.id } });
  if (!result.count) throw new AppError(404, 'TASK_NOT_FOUND', 'This task could not be found.');
  res.status(204).end();
});

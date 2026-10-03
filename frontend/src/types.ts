export type User = { id: string; name: string; email: string };
export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'DONE';
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH';
export type Task = {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
};
export type TaskInput = Pick<Task, 'title' | 'description' | 'status' | 'priority' | 'dueDate'>;
export type Summary = {
  total: number;
  todo: number;
  inProgress: number;
  done: number;
  overdue: number;
};
export type FieldErrors = Record<string, string[]>;
export const statusOptions = [
  { label: 'To do', value: 'TODO', color: 'grey-7', class: 'todo' },
  { label: 'In progress', value: 'IN_PROGRESS', color: 'primary', class: 'progress' },
  { label: 'Done', value: 'DONE', color: 'positive', class: 'done' },
] as const;
export const priorityOptions = [
  { label: 'Low', value: 'LOW' },
  { label: 'Medium', value: 'MEDIUM' },
  { label: 'High', value: 'HIGH' },
] as const;
export function statusLabel(status: TaskStatus) {
  return statusOptions.find((option) => option.value === status)!.label;
}
export function dateLabel(date: string | null) {
  return date
    ? new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(
        new Date(`${date}T12:00:00`),
      )
    : 'No due date';
}

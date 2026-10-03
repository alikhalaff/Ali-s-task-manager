<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useQuasar, type QTableColumn } from 'quasar';
import { useAuthStore } from '../stores/auth';
import { api, errorInfo } from '../api';
import {
  dateLabel,
  statusLabel,
  statusOptions,
  priorityOptions,
  type Task,
  type TaskStatus,
  type Summary,
} from '../types';
import BrandMark from '../components/BrandMark.vue';
import TaskFormDialog from '../components/TaskFormDialog.vue';

const q = useQuasar();
const router = useRouter();
const auth = useAuthStore();
const drawer = ref(q.screen.gt.sm);
const rows = ref<Task[]>([]);
const summary = ref<Summary>({ total: 0, todo: 0, inProgress: 0, done: 0, overdue: 0 });
const loading = ref(true);
const loadedOnce = ref(false);
const listError = ref('');
const summaryError = ref(false);
const search = ref('');
const status = ref('');
const priority = ref('');
const pagination = ref({
  sortBy: 'updatedAt',
  descending: true,
  page: 1,
  rowsPerPage: 10,
  rowsNumber: 0,
});
const formOpen = ref(false);
const editing = ref<Task | null>(null);
const deleteOpen = ref(false);
const deleting = ref<Task | null>(null);
const deletingBusy = ref(false);
const deleteError = ref('');
const changing = ref<Set<string>>(new Set());
const logoutBusy = ref(false);
const helpOpen = ref(false);
let requestSequence = 0;
const today = new Date().toISOString().slice(0, 10);
const dateHeading = new Intl.DateTimeFormat('en', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
}).format(new Date());
const firstName = computed(() => auth.user?.name.split(' ')[0] ?? 'there');
const initials = computed(
  () =>
    auth.user?.name
      .split(' ')
      .slice(0, 2)
      .map((name) => name[0])
      .join('')
      .toUpperCase() ?? 'U',
);
const hasFilters = computed(() => Boolean(search.value || status.value || priority.value));
const completion = computed(() =>
  summary.value.total ? Math.round((summary.value.done / summary.value.total) * 100) : 0,
);
const statusFilters = [{ label: 'All statuses', value: '' }, ...statusOptions];
const priorityFilters = [{ label: 'All priorities', value: '' }, ...priorityOptions];
const columns: QTableColumn[] = [
  { name: 'title', label: 'Task', field: 'title', align: 'left', sortable: true },
  { name: 'status', label: 'Status', field: 'status', align: 'left', sortable: true },
  { name: 'priority', label: 'Priority', field: 'priority', align: 'left', sortable: true },
  { name: 'dueDate', label: 'Due date', field: 'dueDate', align: 'left', sortable: true },
  { name: 'actions', label: 'Actions', field: 'id', align: 'right' },
];
const cards = computed(() => [
  { label: 'Total tasks', count: summary.value.total, icon: 'layers', style: 'purple', filter: '' },
  {
    label: 'To do',
    count: summary.value.todo,
    icon: 'radio_button_unchecked',
    style: 'neutral',
    filter: 'TODO',
  },
  {
    label: 'In progress',
    count: summary.value.inProgress,
    icon: 'timelapse',
    style: 'amber',
    filter: 'IN_PROGRESS',
  },
  {
    label: 'Completed',
    count: summary.value.done,
    icon: 'task_alt',
    style: 'green',
    filter: 'DONE',
  },
]);
async function loadTasks() {
  const sequence = ++requestSequence;
  loading.value = true;
  listError.value = '';
  const params = {
    page: pagination.value.page,
    pageSize: pagination.value.rowsPerPage,
    sortBy: pagination.value.sortBy || 'updatedAt',
    order: pagination.value.descending ? 'desc' : 'asc',
    ...(search.value && { search: search.value }),
    ...(status.value && { status: status.value }),
    ...(priority.value && { priority: priority.value }),
  };
  try {
    const { data } = await api.get<{ items: Task[]; total: number }>('/tasks', { params });
    if (sequence !== requestSequence) return;
    rows.value = data.items;
    pagination.value.rowsNumber = data.total;
    loadedOnce.value = true;
    if (!data.items.length && data.total > 0 && pagination.value.page > 1) {
      pagination.value.page = Math.max(1, Math.ceil(data.total / pagination.value.rowsPerPage));
      void loadTasks();
    }
  } catch (caught) {
    if (sequence === requestSequence) listError.value = errorInfo(caught).message;
  } finally {
    if (sequence === requestSequence) loading.value = false;
  }
}
async function loadSummary() {
  try {
    const { data } = await api.get<Summary>('/tasks/summary');
    summary.value = data;
    summaryError.value = false;
  } catch {
    summaryError.value = true;
  }
}
function refresh() {
  return Promise.all([loadTasks(), loadSummary()]);
}
function requestPage({
  pagination: next,
}: {
  pagination: { page: number; rowsPerPage: number; sortBy: string | null; descending: boolean };
}) {
  pagination.value = { ...pagination.value, ...next, sortBy: next.sortBy || 'updatedAt' };
  void loadTasks();
}
watch([search, status, priority], () => {
  pagination.value.page = 1;
  void loadTasks();
});
function clearFilters() {
  search.value = '';
  status.value = '';
  priority.value = '';
}
function setStatus(value: string) {
  status.value = value;
  if (q.screen.lt.md) drawer.value = false;
}
function openForm(task: Task | null = null) {
  editing.value = task;
  formOpen.value = true;
}
function saved() {
  q.notify({
    type: 'positive',
    message: editing.value ? 'Task updated. Looking good!' : 'Task created. One step closer.',
  });
  void refresh();
}
function confirmDelete(task: Task) {
  deleting.value = task;
  deleteError.value = '';
  deleteOpen.value = true;
}
async function deleteTask() {
  if (!deleting.value || deletingBusy.value) return;
  deletingBusy.value = true;
  deleteError.value = '';
  try {
    await api.delete(`/tasks/${deleting.value.id}`);
    deleteOpen.value = false;
    q.notify({ type: 'positive', message: 'Task deleted.' });
    await refresh();
  } catch (caught) {
    deleteError.value = errorInfo(caught).message;
  } finally {
    deletingBusy.value = false;
  }
}
async function toggleComplete(task: Task) {
  if (changing.value.has(task.id)) return;
  changing.value.add(task.id);
  try {
    const next: TaskStatus = task.status === 'DONE' ? 'TODO' : 'DONE';
    await api.patch(`/tasks/${task.id}`, { status: next });
    q.notify({
      type: 'positive',
      message: next === 'DONE' ? 'Another one done. Nice work!' : 'Task moved back to your list.',
    });
    await refresh();
  } catch (caught) {
    q.notify({ type: 'negative', message: errorInfo(caught).message });
  } finally {
    changing.value.delete(task.id);
  }
}
async function logout() {
  logoutBusy.value = true;
  try {
    await auth.logout();
    await router.replace('/login');
  } catch (caught) {
    q.notify({ type: 'negative', message: errorInfo(caught).message });
  } finally {
    logoutBusy.value = false;
  }
}
onMounted(() => {
  void refresh();
});
</script>

<template>
  <q-layout view="lHh Lpr lFf" class="workspace-layout">
    <q-header class="workspace-header">
      <q-toolbar class="workspace-toolbar">
        <q-btn
          v-if="$q.screen.lt.md"
          flat
          round
          icon="menu"
          aria-label="Open navigation"
          @click="drawer = !drawer"
        />
        <div class="breadcrumb">
          <span>Workspace</span><q-icon name="chevron_right" size="18px" /><strong>My tasks</strong>
        </div>
        <q-space />
        <span class="header-date desktop-only">{{ dateHeading }}</span>
        <q-btn
          flat
          round
          icon="help_outline"
          aria-label="Workspace help"
          class="help-button"
          @click="helpOpen = true"
          ><q-tooltip>Getting started</q-tooltip></q-btn
        >
        <q-btn flat no-caps class="account-button" aria-label="Account menu">
          <q-avatar size="34px" class="user-avatar">{{ initials }}</q-avatar
          ><q-icon name="expand_more" size="19px" />
          <q-menu class="account-menu"
            ><div class="q-pa-md">
              <strong>{{ auth.user?.name }}</strong>
              <div class="muted text-caption">{{ auth.user?.email }}</div>
            </div>
            <q-separator /><q-list
              ><q-item clickable :disable="logoutBusy" @click="logout"
                ><q-item-section avatar><q-icon name="logout" /></q-item-section
                ><q-item-section>Sign out</q-item-section></q-item
              ></q-list
            ></q-menu
          >
        </q-btn>
      </q-toolbar>
    </q-header>
    <q-drawer v-model="drawer" show-if-above :width="244" bordered class="workspace-sidebar">
      <div class="sidebar-content">
        <router-link to="/tasks" class="brand-link"><BrandMark /></router-link>
        <div class="workspace-label">
          <span class="workspace-mini-icon"><q-icon name="workspaces" size="18px" /></span>
          <div><strong>Personal workspace</strong><span>A space of your own</span></div>
        </div>
        <span class="nav-section-label">WORKSPACE</span>
        <q-list class="sidebar-nav">
          <q-item clickable :active="status === ''" active-class="nav-active" @click="setStatus('')"
            ><q-item-section avatar><q-icon name="space_dashboard" /></q-item-section
            ><q-item-section>All tasks</q-item-section
            ><q-item-section side
              ><span class="nav-count">{{ summary.total }}</span></q-item-section
            ></q-item
          >
          <q-item
            clickable
            :active="status === 'IN_PROGRESS'"
            active-class="nav-active"
            @click="setStatus('IN_PROGRESS')"
            ><q-item-section avatar><q-icon name="timelapse" /></q-item-section
            ><q-item-section>In progress</q-item-section
            ><q-item-section side
              ><span class="nav-count">{{ summary.inProgress }}</span></q-item-section
            ></q-item
          >
          <q-item
            clickable
            :active="status === 'DONE'"
            active-class="nav-active"
            @click="setStatus('DONE')"
            ><q-item-section avatar><q-icon name="task_alt" /></q-item-section
            ><q-item-section>Completed</q-item-section
            ><q-item-section side
              ><span class="nav-count">{{ summary.done }}</span></q-item-section
            ></q-item
          >
        </q-list>
        <div class="sidebar-note">
          <span class="note-spark"><q-icon name="auto_awesome" size="25px" /></span
          ><strong>Small steps.<br />Meaningful progress.</strong>
          <p>Make room for the things<br />that move you forward.</p>
          <q-btn
            flat
            no-caps
            label="Add a task"
            icon-right="arrow_forward"
            color="primary"
            @click="openForm()"
          />
        </div>
        <div class="sidebar-footer">
          <span class="online-dot"></span> Your personal task space<span class="sidebar-version"
            >TASKFLOW</span
          >
        </div>
      </div>
    </q-drawer>
    <q-page-container>
      <q-page class="tasks-page">
        <div class="page-heading">
          <div>
            <span class="eyebrow">LET’S MAKE TODAY COUNT</span>
            <h1>Your tasks, in focus<span class="brand-dot">.</span></h1>
            <p>Hey {{ firstName }}, a little structure goes a long way.</p>
          </div>
          <q-btn
            class="new-task-button"
            color="primary"
            unelevated
            no-caps
            icon="add"
            label="New task"
            @click="openForm()"
          />
        </div>
        <div class="summary-grid">
          <button
            v-for="card in cards"
            :key="card.label"
            class="summary-card"
            :class="{ 'summary-selected': status === card.filter }"
            :aria-label="`Show ${card.label.toLowerCase()}`"
            @click="setStatus(card.filter)"
          >
            <div class="summary-card-top">
              <span>{{ card.label }}</span
              ><span class="stat-icon" :class="card.style"
                ><q-icon :name="card.icon" size="21px"
              /></span>
            </div>
            <q-skeleton v-if="!loadedOnce && loading" type="text" width="55px" height="48px" />
            <strong v-else>{{ summaryError ? '—' : card.count }}</strong>
            <span class="stat-caption">{{
              card.filter === 'DONE'
                ? `${completion}% of your tasks`
                : card.filter === 'IN_PROGRESS'
                  ? 'Moving things forward'
                  : card.filter === 'TODO'
                    ? 'Ready when you are'
                    : 'Everything in one place'
            }}</span>
          </button>
        </div>
        <div class="task-section-heading">
          <div>
            <h2>
              My tasks <span class="section-count">{{ pagination.rowsNumber }}</span>
            </h2>
            <p>
              {{
                hasFilters
                  ? 'A closer look at what matters right now.'
                  : 'Your next steps, all in one place.'
              }}
            </p>
          </div>
          <span v-if="summary.overdue" class="overdue-note"
            ><q-icon name="schedule" />{{ summary.overdue }} overdue</span
          >
        </div>
        <q-banner v-if="summaryError" class="error-banner q-mb-md" rounded role="alert"
          >We couldn’t refresh your task counts.<template #action
            ><q-btn flat no-caps label="Retry" @click="loadSummary" /></template
        ></q-banner>
        <q-banner v-if="listError" class="error-banner q-mb-md" rounded role="alert"
          >{{ listError
          }}<template #action><q-btn flat no-caps label="Try again" @click="loadTasks" /></template
        ></q-banner>
        <section class="task-panel" aria-label="Task list">
          <div class="task-toolbar">
            <q-input
              v-model="search"
              :debounce="350"
              outlined
              dense
              placeholder="Search your tasks…"
              aria-label="Search tasks"
              clearable
              @clear="search = ''"
              ><template #prepend><q-icon name="search" color="grey-6" size="21px" /></template
            ></q-input>
            <div class="task-filters">
              <q-select
                v-model="status"
                :options="statusFilters"
                emit-value
                map-options
                outlined
                dense
                aria-label="Filter by status"
              /><q-select
                v-model="priority"
                :options="priorityFilters"
                emit-value
                map-options
                outlined
                dense
                aria-label="Filter by priority"
              /><q-btn
                flat
                round
                icon="refresh"
                aria-label="Refresh tasks"
                :disable="loading"
                @click="refresh"
                ><q-tooltip>Refresh tasks</q-tooltip></q-btn
              >
            </div>
          </div>
          <q-table
            v-model:pagination="pagination"
            :rows="rows"
            :columns="columns"
            row-key="id"
            :loading="loading"
            :rows-per-page-options="[5, 10, 20, 50]"
            flat
            class="task-table"
            binary-state-sort
            :grid="$q.screen.lt.sm"
            @request="requestPage"
          >
            <template #body-cell-title="props"
              ><q-td :props="props"
                ><div class="task-title-cell">
                  <q-btn
                    flat
                    round
                    dense
                    class="complete-button"
                    :class="{ 'is-complete': props.row.status === 'DONE' }"
                    :icon="props.row.status === 'DONE' ? 'check_circle' : 'radio_button_unchecked'"
                    :aria-label="`${props.row.status === 'DONE' ? 'Reopen' : 'Complete'} ${props.row.title}`"
                    :loading="changing.has(props.row.id)"
                    @click="toggleComplete(props.row)"
                  />
                  <div class="task-title-copy">
                    <button
                      class="task-title"
                      :class="{ 'completed-title': props.row.status === 'DONE' }"
                      @click="openForm(props.row)"
                    >
                      {{ props.row.title }}</button
                    ><span v-if="props.row.description">{{ props.row.description }}</span>
                  </div>
                </div></q-td
              ></template
            >
            <template #body-cell-status="props"
              ><q-td :props="props"
                ><span class="status-badge" :class="props.row.status.toLowerCase()"
                  ><span></span>{{ statusLabel(props.row.status) }}</span
                ></q-td
              ></template
            >
            <template #body-cell-priority="props"
              ><q-td :props="props"
                ><span class="priority-label" :class="props.row.priority.toLowerCase()"
                  ><q-icon name="flag" size="16px" />{{
                    props.row.priority.charAt(0) + props.row.priority.slice(1).toLowerCase()
                  }}</span
                ></q-td
              ></template
            >
            <template #body-cell-dueDate="props"
              ><q-td :props="props"
                ><span
                  class="due-date"
                  :class="{
                    overdue:
                      props.row.dueDate && props.row.dueDate < today && props.row.status !== 'DONE',
                  }"
                  ><q-icon v-if="props.row.dueDate" name="calendar_today" size="14px" />{{
                    dateLabel(props.row.dueDate)
                  }}</span
                ></q-td
              ></template
            >
            <template #body-cell-actions="props"
              ><q-td :props="props"
                ><q-btn
                  flat
                  round
                  dense
                  icon="edit_outlined"
                  :aria-label="`Edit ${props.row.title}`"
                  @click="openForm(props.row)"
                  ><q-tooltip>Edit task</q-tooltip></q-btn
                ><q-btn
                  flat
                  round
                  dense
                  icon="delete_outline"
                  class="delete-button"
                  :aria-label="`Delete ${props.row.title}`"
                  @click="confirmDelete(props.row)"
                  ><q-tooltip>Delete task</q-tooltip></q-btn
                ></q-td
              ></template
            >
            <template #item="props"
              ><div class="mobile-task-wrap">
                <q-card flat bordered class="mobile-task-card"
                  ><div class="mobile-task-top">
                    <q-btn
                      flat
                      round
                      dense
                      :icon="
                        props.row.status === 'DONE' ? 'check_circle' : 'radio_button_unchecked'
                      "
                      :color="props.row.status === 'DONE' ? 'positive' : 'grey-6'"
                      :aria-label="`${props.row.status === 'DONE' ? 'Reopen' : 'Complete'} ${props.row.title}`"
                      :loading="changing.has(props.row.id)"
                      @click="toggleComplete(props.row)"
                    /><button class="task-title" @click="openForm(props.row)">
                      {{ props.row.title }}
                    </button>
                  </div>
                  <p>{{ props.row.description }}</p>
                  <div class="mobile-task-badges">
                    <span class="status-badge" :class="props.row.status.toLowerCase()"
                      ><span></span>{{ statusLabel(props.row.status) }}</span
                    ><span class="priority-label" :class="props.row.priority.toLowerCase()"
                      ><q-icon name="flag" />{{ props.row.priority }}</span
                    >
                  </div>
                  <div class="mobile-task-bottom">
                    <span class="due-date">{{ dateLabel(props.row.dueDate) }}</span
                    ><q-space /><q-btn
                      flat
                      round
                      dense
                      icon="edit_outlined"
                      :aria-label="`Edit ${props.row.title}`"
                      @click="openForm(props.row)"
                    /><q-btn
                      flat
                      round
                      dense
                      icon="delete_outline"
                      :aria-label="`Delete ${props.row.title}`"
                      @click="confirmDelete(props.row)"
                    /></div
                ></q-card></div
            ></template>
            <template #no-data
              ><div v-if="!loading" class="empty-state">
                <span class="empty-icon"
                  ><q-icon
                    :name="
                      listError ? 'cloud_off' : hasFilters ? 'search_off' : 'playlist_add_check'
                    "
                    size="36px"
                /></span>
                <h3>
                  {{
                    listError
                      ? 'Your tasks will be right here.'
                      : hasFilters
                        ? 'No tasks match just yet.'
                        : 'A little space for your next big thing.'
                  }}
                </h3>
                <p>
                  {{
                    listError
                      ? 'Try reconnecting to load your workspace.'
                      : hasFilters
                        ? 'Try another search or clear your filters.'
                        : 'Add your first task and take it one step at a time.'
                  }}
                </p>
                <q-btn
                  v-if="!listError"
                  color="primary"
                  :outline="hasFilters"
                  unelevated
                  no-caps
                  :label="hasFilters ? 'Clear filters' : 'Create your first task'"
                  @click="hasFilters ? clearFilters() : openForm()"
                /></div
            ></template>
          </q-table>
        </section>
        <p class="page-footnote">
          <q-icon name="auto_awesome" /> Progress starts with one small step.
        </p>
      </q-page>
    </q-page-container>
    <TaskFormDialog v-model="formOpen" :task="editing" @saved="saved" />
    <q-dialog v-model="deleteOpen" :persistent="deletingBusy"
      ><q-card class="delete-dialog"
        ><span class="delete-dialog-icon"><q-icon name="delete_outline" size="30px" /></span>
        <h2>Delete this task?</h2>
        <p>“{{ deleting?.title }}” will be permanently removed.</p>
        <q-banner v-if="deleteError" class="error-banner" rounded role="alert">{{
          deleteError
        }}</q-banner>
        <div class="dialog-actions">
          <q-btn
            flat
            no-caps
            label="Keep task"
            :disable="deletingBusy"
            @click="deleteOpen = false"
          /><q-btn
            color="negative"
            unelevated
            no-caps
            label="Delete task"
            :loading="deletingBusy"
            @click="deleteTask"
          /></div></q-card
    ></q-dialog>
    <q-dialog v-model="helpOpen"
      ><q-card class="help-dialog"
        ><div class="dialog-header">
          <h2>A little help getting started</h2>
          <q-btn v-close-popup flat round icon="close" aria-label="Close help" />
        </div>
        <p>Add a task with a clear title, then give it a priority and an optional due date.</p>
        <p>
          Use the circle beside a task to mark it done. Click its title or pencil to edit, and the
          bin to delete.
        </p>
        <p>
          Search and filters help you find your next step. Your tasks are visible only in your
          account.
        </p></q-card
      ></q-dialog
    >
  </q-layout>
</template>

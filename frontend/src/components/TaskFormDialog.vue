<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import { api, errorInfo } from '../api';
import {
  statusOptions,
  priorityOptions,
  type Task,
  type TaskInput,
  type FieldErrors,
} from '../types';

const open = defineModel<boolean>({ required: true });
const props = defineProps<{ task: Task | null }>();
const emit = defineEmits<{ saved: [] }>();
const form = reactive<TaskInput>({
  title: '',
  description: '',
  status: 'TODO',
  priority: 'MEDIUM',
  dueDate: null,
});
const saving = ref(false);
const error = ref('');
const fields = ref<FieldErrors>({});
watch(open, (value) => {
  if (!value) return;
  Object.assign(
    form,
    props.task
      ? {
          title: props.task.title,
          description: props.task.description,
          status: props.task.status,
          priority: props.task.priority,
          dueDate: props.task.dueDate,
        }
      : { title: '', description: '', status: 'TODO', priority: 'MEDIUM', dueDate: null },
  );
  error.value = '';
  fields.value = {};
});
async function save() {
  if (saving.value) return;
  saving.value = true;
  error.value = '';
  fields.value = {};
  try {
    const payload = { ...form, dueDate: form.dueDate || null };
    if (props.task) await api.patch(`/tasks/${props.task.id}`, payload);
    else await api.post('/tasks', payload);
    open.value = false;
    emit('saved');
  } catch (caught) {
    const info = errorInfo(caught);
    error.value = info.message;
    fields.value = info.details;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <q-dialog v-model="open" :persistent="saving">
    <q-card class="task-dialog">
      <div class="dialog-header">
        <div>
          <span class="eyebrow">MAKE IT HAPPEN</span>
          <h2>{{ task ? 'Edit task' : 'A new task, a fresh start.' }}</h2>
        </div>
        <q-btn
          flat
          round
          icon="close"
          aria-label="Close task form"
          :disable="saving"
          @click="open = false"
        />
      </div>
      <q-form class="dialog-form" @submit="save">
        <q-banner v-if="error" class="error-banner q-mb-md" rounded role="alert">{{
          error
        }}</q-banner>
        <q-input
          v-model="form.title"
          outlined
          label="Task title"
          autofocus
          maxlength="200"
          counter
          :disable="saving"
          :error="!!fields.title"
          :error-message="fields.title?.[0]"
          :rules="[(value) => !!value.trim() || 'Give your task a title.']"
          lazy-rules
        />
        <q-input
          v-model="form.description"
          outlined
          label="Description (optional)"
          type="textarea"
          :rows="3"
          maxlength="5000"
          :disable="saving"
          :error="!!fields.description"
          :error-message="fields.description?.[0]"
        />
        <div class="form-two-columns">
          <q-select
            v-model="form.status"
            outlined
            label="Status"
            :options="statusOptions"
            emit-value
            map-options
            :disable="saving"
            :error="!!fields.status"
            :error-message="fields.status?.[0]"
          /><q-select
            v-model="form.priority"
            outlined
            label="Priority"
            :options="priorityOptions"
            emit-value
            map-options
            :disable="saving"
            :error="!!fields.priority"
            :error-message="fields.priority?.[0]"
          />
        </div>
        <q-input
          v-model="form.dueDate"
          outlined
          label="Due date (optional)"
          type="date"
          min="1000-01-01"
          max="9999-12-31"
          clearable
          stack-label
          :disable="saving"
          :error="!!fields.dueDate"
          :error-message="fields.dueDate?.[0]"
        />
        <div class="dialog-actions">
          <q-btn flat no-caps label="Cancel" :disable="saving" @click="open = false" /><q-btn
            type="submit"
            color="primary"
            unelevated
            no-caps
            :label="task ? 'Save changes' : 'Create task'"
            :loading="saving"
          />
        </div>
      </q-form>
    </q-card>
  </q-dialog>
</template>

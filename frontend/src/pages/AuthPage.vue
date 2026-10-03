<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { errorInfo } from '../api';
import type { FieldErrors } from '../types';
import BrandMark from '../components/BrandMark.vue';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const registering = computed(() => route.path === '/register');
const form = reactive({ name: '', email: '', password: '' });
const loading = ref(false);
const showPassword = ref(false);
const error = ref('');
const fields = ref<FieldErrors>({});
watch(registering, () => {
  error.value = '';
  fields.value = {};
  form.password = '';
});
async function submit() {
  if (loading.value) return;
  loading.value = true;
  error.value = '';
  fields.value = {};
  try {
    await auth.authenticate(registering.value ? 'register' : 'login', {
      email: form.email,
      password: form.password,
      ...(registering.value && { name: form.name }),
    });
    await router.replace('/tasks');
  } catch (caught) {
    const info = errorInfo(caught);
    error.value = info.message;
    fields.value = info.details;
  } finally {
    loading.value = false;
  }
}
function demo() {
  form.email = 'demo@taskflow.local';
  form.password = 'TaskflowDemo!2026';
  void submit();
}
</script>

<template>
  <main class="auth-page">
    <section class="auth-story">
      <BrandMark />
      <div class="auth-story-copy">
        <span class="eyebrow">LESS CLUTTER. MORE CLARITY.</span>
        <h1>Good work starts<br />with a little <span>focus.</span></h1>
        <p>
          A calmer place for your tasks, your plans,<br class="desktop-only" />
          and everything you’re moving forward.
        </p>
        <div class="auth-illustration" aria-hidden="true">
          <div class="orbit orbit-one"></div>
          <div class="orbit orbit-two"></div>
          <div class="sample-task sample-task-back">
            <span class="sample-check done"><q-icon name="check" /></span>
            <div><strong>A fresh start</strong><span>Make space for what matters</span></div>
          </div>
          <div class="sample-task sample-task-front">
            <span class="sample-check"><q-icon name="check" /></span>
            <div><strong>One thing at a time</strong><span>Small steps. Real progress.</span></div>
            <span class="sample-pill">In progress</span>
          </div>
          <div class="sample-progress">
            <q-icon name="auto_awesome" color="primary" /><span>You’ve got this.</span>
          </div>
        </div>
      </div>
      <p class="auth-footer">A little structure. A lot of possibility.</p>
    </section>
    <section class="auth-form-panel">
      <div class="auth-mobile-brand"><BrandMark /></div>
      <div class="auth-form-wrap">
        <span class="eyebrow">YOUR PERSONAL WORKSPACE</span>
        <h2>{{ registering ? 'Start your next chapter.' : 'Welcome back.' }}</h2>
        <p class="muted">
          {{
            registering
              ? 'Create an account and make room for your best work.'
              : 'Sign in and pick up where you left off.'
          }}
        </p>
        <q-banner v-if="auth.connectionError" class="error-banner" rounded role="alert">
          {{ auth.connectionError }}
          <template #action
            ><q-btn flat no-caps label="Retry connection" @click="auth.restore()"
          /></template>
        </q-banner>
        <q-banner v-if="error" class="error-banner q-mt-md" rounded role="alert">{{
          error
        }}</q-banner>
        <q-form class="auth-form" @submit="submit">
          <q-input
            v-if="registering"
            v-model="form.name"
            outlined
            label="Your name"
            autocomplete="name"
            :disable="loading"
            :error="!!fields.name"
            :error-message="fields.name?.[0]"
            :rules="[(value) => value.trim().length >= 2 || 'Enter at least 2 characters.']"
            maxlength="80"
            lazy-rules
          />
          <q-input
            v-model="form.email"
            outlined
            label="Email address"
            type="email"
            autocomplete="email"
            :disable="loading"
            :error="!!fields.email"
            :error-message="fields.email?.[0]"
            :rules="[
              (value) =>
                /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) || 'Enter a valid email address.',
            ]"
            maxlength="254"
            lazy-rules
          />
          <q-input
            v-model="form.password"
            outlined
            label="Password"
            :type="showPassword ? 'text' : 'password'"
            :autocomplete="registering ? 'new-password' : 'current-password'"
            :disable="loading"
            :error="!!fields.password"
            :error-message="fields.password?.[0]"
            :rules="[
              (value) =>
                value.length >= (registering ? 15 : 1) ||
                (registering ? 'Use at least 15 characters.' : 'Enter your password.'),
            ]"
            maxlength="128"
            lazy-rules
          >
            <template #append
              ><q-btn
                flat
                round
                dense
                :icon="showPassword ? 'visibility_off' : 'visibility'"
                :aria-label="showPassword ? 'Hide password' : 'Show password'"
                @click="showPassword = !showPassword"
            /></template>
          </q-input>
          <q-btn
            class="auth-submit"
            type="submit"
            color="primary"
            no-caps
            unelevated
            :label="registering ? 'Create account' : 'Sign in'"
            icon-right="arrow_forward"
            :loading="loading"
          />
        </q-form>
        <p class="auth-switch">
          {{ registering ? 'Already have an account?' : 'New to Taskflow?' }}
          <router-link :to="registering ? '/login' : '/register'">{{
            registering ? 'Sign in' : 'Create an account'
          }}</router-link>
        </p>
        <div v-if="!registering" class="demo-section">
          <span>Just taking a look?</span
          ><q-btn
            outline
            color="primary"
            no-caps
            label="Try the demo account"
            :disable="loading"
            @click="demo"
          />
        </div>
        <p class="auth-security">
          <q-icon name="lock_outline" /> Your workspace is private to your account.
        </p>
      </div>
    </section>
  </main>
</template>

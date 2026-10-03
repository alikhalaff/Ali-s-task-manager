import http from 'k6/http';
import { check, fail, sleep } from 'k6';
import exec from 'k6/execution';
import { Counter, Rate, Trend } from 'k6/metrics';

const base = __ENV.BASE_URL || 'http://web';
if (base !== 'http://web')
  throw new Error('This test only targets the isolated Compose web service');
const mode = __ENV.LOAD_MODE || 'stress';
const profiles = {
  smoke: [
    { duration: '5s', target: 5 },
    { duration: '10s', target: 5 },
    { duration: '5s', target: 0 },
  ],
  load: [
    { duration: '10s', target: 10 },
    { duration: '15s', target: 25 },
    { duration: '30s', target: 25 },
    { duration: '10s', target: 0 },
  ],
  stress: [
    { duration: '10s', target: 10 },
    { duration: '20s', target: 50 },
    { duration: '20s', target: 100 },
    { duration: '20s', target: 200 },
    { duration: '20s', target: 200 },
    { duration: '15s', target: 20 },
    { duration: '10s', target: 0 },
  ],
};
if (!profiles[mode]) throw new Error('Choose smoke, load or stress');
const peak = mode === 'smoke' ? 5 : mode === 'load' ? 25 : 200;
const requests = new Counter('workload_requests');
const latency = new Trend('workload_latency', true);
const failures = new Rate('workload_failed');
const serverErrors = new Counter('server_errors');
const throttled = new Counter('throttled_requests');
const journeys = new Counter('completed_journeys');
const integrityFailures = new Counter('integrity_failures');

export const options = {
  scenarios: {
    tasks: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: profiles[mode],
      gracefulRampDown: '30s',
      gracefulStop: '30s',
    },
  },
  thresholds: {
    workload_failed: ['rate<0.01'],
    workload_latency: ['p(95)<1000'],
    ...(mode === 'stress'
      ? {
          'workload_latency{stage:50-users}': ['p(95)<1000'],
          'workload_latency{stage:100-users}': ['p(95)<1000'],
          'workload_latency{stage:200-users}': ['p(95)<1000'],
          'workload_latency{stage:recovery}': ['p(95)<1000'],
        }
      : {}),
    integrity_failures: ['count==0'],
    server_errors: ['count==0'],
    throttled_requests: ['count==0'],
    completed_journeys: ['count>0'],
    checks: ['rate==1'],
  },
  setupTimeout: '120s',
  teardownTimeout: '120s',
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  systemTags: ['status', 'method', 'name', 'scenario', 'group', 'expected_response'],
};

function stageName() {
  if (mode !== 'stress') return mode;
  const seconds = (Date.now() - exec.scenario.startTime) / 1000;
  return seconds < 10
    ? 'warmup'
    : seconds < 30
      ? '50-users'
      : seconds < 50
        ? '100-users'
        : seconds < 90
          ? '200-users'
          : 'recovery';
}
function params(name, account, expected = 200, phase = 'workload') {
  return {
    timeout: '10s',
    tags: { name, phase, stage: phase === 'workload' ? stageName() : phase },
    headers: {
      'Content-Type': 'application/json',
      ...(account && { 'X-CSRF-Token': account.csrfToken }),
    },
    responseCallback: http.expectedStatuses(expected),
  };
}
function send(method, path, body, account, expected = 200) {
  const tags = {
    operation:
      path === '/api/tasks' || path.startsWith('/api/tasks?')
        ? `${method} tasks`
        : `${method} ${path.includes('summary') ? 'summary' : 'task'}`,
    stage: stageName(),
  };
  const response = http.request(
    method,
    `${base}${path}`,
    body ? JSON.stringify(body) : null,
    params(tags.operation, account, expected),
  );
  if (response.status !== expected && __ITER === 0)
    console.warn(
      `VU ${__VU}: ${tags.operation} expected ${expected}, received ${response.status}: ${response.body}`,
    );
  requests.add(1, tags);
  latency.add(response.timings.duration, tags);
  failures.add(response.status !== expected, tags);
  serverErrors.add(response.status >= 500 ? 1 : 0);
  throttled.add(response.status === 429 ? 1 : 0);
  check(response, { [`${tags.operation}: expected status`]: (value) => value.status === expected });
  return response;
}
function verify(condition, description) {
  integrityFailures.add(condition ? 0 : 1);
  check(condition, { [description]: (value) => value });
  return condition;
}

export function setup() {
  const users = [];
  for (let index = 1; index <= peak; index++) {
    // Each login needs its own jar: session regeneration must not revoke a previous account.
    const jar = new http.CookieJar();
    const session = http.get(`${base}/api/auth/session`, {
      ...params('bootstrap', null, 200, 'setup'),
      jar,
    });
    if (session.status !== 200) fail('Could not initialize isolated session');
    const login = http.post(
      `${base}/api/auth/login`,
      JSON.stringify({
        email: `load-${index}@stress.taskflow.local`,
        password: 'LoadtestOnly!2026',
      }),
      { ...params('login', { csrfToken: session.json('csrfToken') }, 200, 'setup'), jar },
    );
    if (login.status !== 200) fail(`Could not authenticate load user ${index}`);
    const account = {
      userId: login.json('user.id'),
      csrfToken: login.json('csrfToken'),
      cookie: jar.cookiesForURL(`${base}/api/tasks`)['taskmanager.sid'][0],
    };
    const list = http.get(`${base}/api/tasks`, {
      ...params('fixture list', account, 200, 'setup'),
      jar,
    });
    if (list.status !== 200 || list.json('total') !== 20)
      fail('Stress fixtures must contain 20 baseline tasks per user');
    account.fixtureTaskId = list.json('items.0.id');
    users.push(account);
  }
  return { users };
}

export default function (data) {
  const account = data.users[(__VU - 1) % data.users.length];
  http.cookieJar().set(base, 'taskmanager.sid', account.cookie, { path: '/api' });
  const title = `Load journey ${__VU}-${__ITER}`;
  const list = send('GET', '/api/tasks?pageSize=10&sortBy=title&order=asc', null, account);
  if (list.status === 200)
    verify(
      list.json('items').every((task) => task.userId === account.userId),
      'list never exposes another owner',
    );
  const summary = send('GET', '/api/tasks/summary', null, account);
  let completed = list.status === 200 && summary.status === 200;
  const created = send(
    'POST',
    '/api/tasks',
    { title, priority: 'HIGH', dueDate: '2026-12-15' },
    account,
    201,
  );
  if (created.status !== 201) {
    sleep(0.1);
    return;
  }
  const id = created.json('id');
  try {
    const updated = send('PATCH', `/api/tasks/${id}`, { status: 'DONE' }, account);
    completed = completed && updated.status === 200;
    if (updated.status === 200)
      verify(
        updated.json('title') === title &&
          updated.json('priority') === 'HIGH' &&
          updated.json('dueDate') === '2026-12-15',
        'partial updates retain omitted fields',
      );
    const fetched = send('GET', `/api/tasks/${id}`, null, account);
    completed = completed && fetched.status === 200;
    if (fetched.status === 200)
      verify(
        fetched.json('userId') === account.userId &&
          fetched.json('title') === title &&
          fetched.json('status') === 'DONE',
        'created task persists under the correct owner',
      );
    if (__ITER % 10 === 0 && data.users.length > 1) {
      const victim = data.users[__VU % data.users.length];
      send('GET', `/api/tasks/${victim.fixtureTaskId}`, null, account, 404);
    }
  } finally {
    const deleted = send('DELETE', `/api/tasks/${id}`, null, account, 204);
    if (deleted.status === 204 && completed) journeys.add(1);
  }
  sleep(0.1);
}

export function teardown(data) {
  for (const account of data.users) {
    http.cookieJar().set(base, 'taskmanager.sid', account.cookie, { path: '/api' });
    const response = http.post(
      `${base}/api/auth/logout`,
      null,
      params('logout', account, 204, 'teardown'),
    );
    check(response, { 'load session logout succeeds': (value) => value.status === 204 });
  }
  check(http.get(`${base}/api/health`, params('health', null, 200, 'teardown')), {
    'API recovers after peak load': (value) => value.status === 200,
  });
}

export function handleSummary(data) {
  const result = {
    mode,
    peakVirtualUsers: peak,
    timestamp: new Date().toISOString(),
    metrics: data.metrics,
    state: data.state,
  };
  const metric = (name) => data.metrics[name]?.values || {};
  const text = JSON.stringify(
    {
      mode,
      peakVirtualUsers: peak,
      requests: metric('workload_requests').count,
      completedJourneys: metric('completed_journeys').count,
      failedRequestRate: metric('workload_failed').rate,
      p95Milliseconds: metric('workload_latency')['p(95)'],
      p99Milliseconds: metric('workload_latency')['p(99)'],
      serverErrors: metric('server_errors').count,
      throttled: metric('throttled_requests').count,
      integrityFailures: metric('integrity_failures').count,
    },
    null,
    2,
  );
  return {
    [`/results/${__ENV.REPORT_NAME || mode}.json`]: JSON.stringify(result, null, 2),
    stdout: `\n${text}\n`,
  };
}

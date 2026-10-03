import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const mode = process.argv[2] || 'stress';
if (!['smoke', 'load', 'stress', 'prepare', 'down'].includes(mode)) throw new Error('Unknown mode');
const env = { ...process.env, STRESS_API_RATE_LIMIT: '1000000', STRESS_AUTH_RATE_LIMIT: '1000' };
const compose = [
  'compose',
  '--project-name',
  'taskflow-stress',
  '-f',
  'docker-compose.yml',
  '-f',
  'docker-compose.stress.yml',
];
const report = { mode, startedAt: new Date().toISOString(), resourceSamples: [] };
const reportName = `${mode}-${report.startedAt.replace(/[:.]/g, '-')}`;
await mkdir(new URL('../artifacts/stress/', import.meta.url), { recursive: true });

function command(args, { quiet = false, childEnv = env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { cwd: root, env: childEnv, windowsHide: true });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (!quiet) process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      if (!quiet) process.stderr.write(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, output }));
  });
}
async function required(args, options) {
  const result = await command([...compose, ...args], options);
  if (result.code !== 0)
    throw new Error(`Docker command failed (${result.code}): ${args.join(' ')}`);
  return result.output;
}
async function healthy() {
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const response = await fetch('http://localhost:8082/api/health', {
        signal: AbortSignal.timeout(2000),
      });
      if (response.status === 200) return true;
    } catch {
      /* Service is still starting. */
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('Isolated API did not become healthy');
}
async function probeLimits() {
  const limitedEnv = { ...env, STRESS_API_RATE_LIMIT: '20', STRESS_AUTH_RATE_LIMIT: '5' };
  await required(['up', '-d', '--force-recreate', '--no-deps', 'api'], { childEnv: limitedEnv });
  await required(['restart', 'web']);
  await healthy();
  const session = await fetch('http://localhost:8082/api/auth/session');
  let cookie = session.headers.get('set-cookie')?.split(';')[0];
  let { csrfToken } = await session.json();
  const authStatuses = [];
  let authRetryAfter;
  for (let index = 0; index < 6; index++) {
    const response = await fetch('http://localhost:8082/api/auth/login', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({
        email: 'load-1@stress.taskflow.local',
        password: index === 0 ? 'LoadtestOnly!2026' : 'IncorrectPassword!123',
      }),
    });
    authStatuses.push(response.status);
    authRetryAfter = response.headers.get('retry-after');
    if (index === 0 && response.status === 200) {
      cookie = response.headers.get('set-cookie')?.split(';')[0];
      csrfToken = (await response.json()).csrfToken;
    } else await response.text();
  }
  const logout = await fetch('http://localhost:8082/api/auth/logout', {
    method: 'POST',
    headers: { Cookie: cookie, 'X-CSRF-Token': csrfToken },
  });
  const logoutAfterAuthThrottle = logout.status;
  await logout.text();
  const apiStatuses = [];
  for (let index = 0; index < 13; index++) {
    const response = await fetch('http://localhost:8082/api/auth/session', {
      headers: { 'X-Forwarded-For': `192.0.2.${index + 1}` },
    });
    apiStatuses.push(response.status);
    if (index === 12) report.apiRetryAfter = response.headers.get('retry-after');
    await response.text();
  }
  const passed =
    authStatuses[0] === 200 &&
    authStatuses.slice(1, 5).every((status) => status === 401) &&
    authStatuses[5] === 429 &&
    logoutAfterAuthThrottle === 204 &&
    apiStatuses.slice(0, 12).every((status) => status === 200) &&
    apiStatuses[12] === 429 &&
    Number(authRetryAfter) > 0 &&
    Number(report.apiRetryAfter) > 0;
  return {
    passed,
    authLimit: 5,
    apiLimit: 20,
    authStatuses,
    logoutAfterAuthThrottle,
    apiStatuses,
    authRetryAfter,
    healthAfterThrottle: await healthy(),
  };
}

if (mode === 'down') {
  await required(['down', '--remove-orphans']);
  process.exit(0);
}
let sampling;
try {
  report.machine = (
    await command(
      [
        'info',
        '--format',
        '{{json .NCPU}} CPUs; {{json .MemTotal}} bytes; Docker {{.ServerVersion}}',
      ],
      { quiet: true },
    )
  ).output.trim();
  await required(['up', '--build', '-d', '--wait', 'db', 'migrate', 'api', 'web']);
  await required(['--profile', 'stress', 'run', '--build', '--no-deps', '--rm', 'stress-seed']);
  await healthy();
  if (mode === 'prepare') {
    console.log(
      'Isolated fixtures ready at http://localhost:8082. Clean up with npm run stress:down.',
    );
  } else {
    const ids = (await required(['ps', '-q', 'api', 'db', 'web'], { quiet: true }))
      .trim()
      .split(/\s+/);
    async function sample() {
      const result = await command(['stats', '--no-stream', '--format', '{{json .}}', ...ids], {
        quiet: true,
      });
      report.resourceSamples.push({
        at: new Date().toISOString(),
        containers: result.output
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line)),
      });
    }
    await sample();
    let samplingBusy = false;
    sampling = setInterval(async () => {
      if (samplingBusy) return;
      samplingBusy = true;
      try {
        await sample();
      } catch (error) {
        report.samplingError = error.message;
      } finally {
        samplingBusy = false;
      }
    }, 10000);
    const load = await command([
      ...compose,
      '--profile',
      'stress',
      'run',
      '--no-deps',
      '--rm',
      '-e',
      `LOAD_MODE=${mode}`,
      '-e',
      `REPORT_NAME=${reportName}`,
      'k6',
    ]);
    clearInterval(sampling);
    report.k6ExitCode = load.code;
    report.integrity = await command([
      ...compose,
      '--profile',
      'stress',
      'run',
      '--no-deps',
      '--rm',
      'stress-seed',
      'npm',
      'run',
      'stress:verify',
    ]);
    report.healthAfterLoad = await healthy();
    report.rateLimits = await probeLimits();
    report.passed = load.code === 0 && report.integrity.code === 0 && report.rateLimits.passed;
    if (!report.passed) process.exitCode = 1;
  }
} catch (error) {
  report.error = error.message;
  report.passed = false;
  process.exitCode = 1;
  console.error(error);
} finally {
  clearInterval(sampling);
  if (mode !== 'prepare' || report.error) {
    report.cleanup = await command([...compose, 'down', '--remove-orphans']);
    if (report.cleanup.code !== 0) process.exitCode = 1;
  }
  report.finishedAt = new Date().toISOString();
  await writeFile(
    new URL(`../artifacts/stress/${reportName}-runner.json`, import.meta.url),
    JSON.stringify(report, null, 2),
  );
  console.log(`Report: artifacts/stress/${reportName}-runner.json`);
}

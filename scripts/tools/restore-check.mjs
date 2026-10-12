import { startServer, Client } from '../../tests/helpers.mjs';
const s = await startServer({ DATABASE_URL: 'postgres://workos:workos@localhost:5432/workos_restore' });
const c = new Client('owner');
const r = await c.post('/api/auth/login', { email: 'ceo@dagym.test', password: 'owner-pass-1234' });
const t = await c.get('/api/tasks?view=all&includeDone=1');
console.log('login', r.status, 'tasks', t.body.tasks.map((x) => x.title));
s.proc.kill();

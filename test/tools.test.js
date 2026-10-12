import test from 'node:test';
import assert from 'node:assert/strict';
import { registerTools, TOOL_NAMES } from '../src/mcp/tools.js';

function fakeServer() {
  const tools = new Map();
  return { tools, registerTool(name, config, handler) { tools.set(name, { config, handler }); } };
}

test('every tool is registered; only local writers lack readOnlyHint', () => {
  const server = fakeServer();
  registerTools(server, {});
  assert.deepEqual([...server.tools.keys()].sort(), [...TOOL_NAMES].sort());
  assert.equal(server.tools.size, 18);
  for (const [name, { config }] of server.tools) {
    const local = ['icorsi_new_content', 'icorsi_download', 'icorsi_login'].includes(name);
    assert.equal(config.annotations.readOnlyHint, !local, name);
    assert.ok(config.description.length > 20, name);
  }
});

test('handlers return JSON and turn errors into isError results', async () => {
  const server = fakeServer();
  registerTools(server, {
    getGrades: async ({ courseId }) => ({ course: courseId, items: [] }),
    getActivity: async () => { throw new Error('Not an activity'); },
  });
  const ok = await server.tools.get('icorsi_grades').handler({ course_id: 9 });
  assert.deepEqual(JSON.parse(ok.content[0].text), { course: 9, items: [] });
  const bad = await server.tools.get('icorsi_get_activity').handler({ url: 'https://www.icorsi.ch/my/' });
  assert.equal(bad.isError, true);
  assert.equal(bad.content[0].text, 'Not an activity');
});

test('icorsi_get_activity needs a url or a cmid; icorsi_calendar picks the view', async () => {
  const server = fakeServer();
  registerTools(server, {
    getActivity: async (ref) => ref,
    getUpcoming: async (o) => ({ view: 'upcoming', ...o }),
    getCalendarDay: async (o) => ({ view: 'day', ...o }),
    getCalendarMonth: async (o) => ({ view: 'month', ...o }),
  });
  const call = async (name, args) => JSON.parse((await server.tools.get(name).handler(args)).content[0].text);
  assert.equal((await server.tools.get('icorsi_get_activity').handler({})).isError, true);
  assert.deepEqual(await call('icorsi_get_activity', { cmid: 5 }), { cmid: 5 });
  assert.deepEqual(await call('icorsi_calendar', { view: 'upcoming' }), { view: 'upcoming', courseId: 1 });
  assert.deepEqual(await call('icorsi_calendar', { view: 'day', year: 2026, month: 10, day: 6 }), { view: 'day', year: 2026, month: 10, day: 6, courseId: 1 });
  assert.deepEqual(await call('icorsi_calendar', { course_id: 9 }), { view: 'month', courseId: 9 });
});

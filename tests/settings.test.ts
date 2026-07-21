import { test, expect } from 'vitest';
import { describeSettings, fuzzyFilter, parseSettingValue } from '../src/settings.js';

test('describeSettings marks config vs default and lists known keys', () => {
  const rows = describeSettings({ port: 9333, browserPaths: ['/a', '/b'] });
  const byKey = Object.fromEntries(rows.map(r => [r.key, r]));
  expect(byKey.port).toMatchObject({ value: '9333', source: 'config' });
  expect(byKey.throttle).toMatchObject({ source: 'default' });
  expect(byKey.browserPaths.value).toBe('/a, /b');
  expect(byKey.layout).toMatchObject({ value: 'tabs', source: 'default' });
  expect(byKey.cacheDisabled).toMatchObject({ value: 'off', source: 'default' });
  expect(byKey.clearOnNav).toMatchObject({ value: 'off', source: 'default' });
  expect(rows.map(r => r.key)).toEqual(['port', 'ports', 'browserPaths', 'layout', 'lang', 'throttle', 'cacheDisabled', 'clearOnNav', 'networkColumns', 'bodyCapBytes', 'networkCap', 'harSanitize', 'copyRedact', 'editor', 'sessionCap', 'hints', 'persistSanitize', 'agentCmd']);
});

test('describeSettings orders rows by section and annotates each row', () => {
  const rows = describeSettings({});
  expect(rows.map(r => r.section)).toEqual(['연결', '연결', '연결', '표시', '표시', '표시', '표시', '표시', '표시', '캡처', '캡처', '캡처', '캡처', '에디터', '캡처', '표시', '캡처', '에이전트']);
  const byKey = Object.fromEntries(rows.map(r => [r.key, r]));
  expect(byKey.port).toMatchObject({ kind: 'number', section: '연결', description: '기본 CDP 포트' });
  expect(byKey.ports).toMatchObject({ kind: 'text', section: '연결', description: '시작 시 스캔할 디버그 포트 (쉼표 구분)' });
  expect(byKey.browserPaths).toMatchObject({ kind: 'text', section: '연결', description: '피커에 추가할 브라우저 실행 파일' });
  expect(byKey.layout).toMatchObject({ kind: 'enum', options: ['tabs', 'split'], section: '표시', description: 'Network/Console 동시 표시' });
  expect(byKey.throttle).toMatchObject({ kind: 'enum', options: ['off', 'fast3g', 'slow3g', 'offline'], section: '표시', description: '네트워크 스로틀 (Network 탭에서 T)' });
  expect(byKey.cacheDisabled).toMatchObject({ kind: 'enum', options: ['off', 'on'], section: '표시', description: '캐시 비활성화 (Network 탭에서 u)' });
  expect(byKey.clearOnNav).toMatchObject({ kind: 'enum', options: ['off', 'on'], section: '표시', description: '페이지 이동 시 네트워크 로그 지움' });
  expect(byKey.bodyCapBytes).toMatchObject({ kind: 'number', section: '캡처', description: '응답 바디 저장 한도 (bytes)' });
  expect(byKey.networkCap).toMatchObject({ kind: 'number', section: '캡처', description: '네트워크 로그 최대 보관 개수 (100–5000)' });
  expect(byKey.harSanitize).toMatchObject({ kind: 'enum', options: ['off', 'on'], section: '캡처', description: 'HAR 내보내기 시 민감한 헤더·쿠키 값 마스킹' });
  expect(byKey.copyRedact).toMatchObject({ kind: 'enum', options: ['off', 'on'], section: '캡처', description: 'cURL/fetch 복사(Y/F) 시 민감한 헤더 값 마스킹' });
  expect(byKey.port.options).toBeUndefined();
});

test('describeSettings reports persistSanitize and agentCmd, and parseSettingValue round-trips them', () => {
  const bare = Object.fromEntries(describeSettings({}).map(r => [r.key, r]));
  expect(bare.persistSanitize).toMatchObject({ value: 'off', source: 'default', kind: 'enum', options: ['off', 'on'] });
  expect(bare.agentCmd).toMatchObject({ value: '', source: 'default', kind: 'text', section: '에이전트' });
  const cfg = Object.fromEntries(describeSettings({ persistSanitize: true, agentCmd: 'claude --print' }).map(r => [r.key, r]));
  expect(cfg.persistSanitize).toMatchObject({ value: 'on', source: 'config' });
  expect(cfg.agentCmd).toMatchObject({ value: 'claude --print', source: 'config' });
  expect(parseSettingValue('persistSanitize', 'on')).toEqual({ patch: { persistSanitize: true } });
  expect(parseSettingValue('persistSanitize', 'nope')).toHaveProperty('error');
  expect(parseSettingValue('agentCmd', ' claude --print ')).toEqual({ patch: { agentCmd: 'claude --print' } });
  expect(parseSettingValue('agentCmd', '  ')).toEqual({ patch: { agentCmd: undefined } });
});

test('describeSettings reports harSanitize and copyRedact with their defaults', () => {
  const bare = Object.fromEntries(describeSettings({}).map(r => [r.key, r]));
  expect(bare.harSanitize).toMatchObject({ value: 'on', source: 'default' });
  expect(bare.copyRedact).toMatchObject({ value: 'off', source: 'default' });
  const cfg = Object.fromEntries(describeSettings({ harSanitize: false, copyRedact: true }).map(r => [r.key, r]));
  expect(cfg.harSanitize).toMatchObject({ value: 'off', source: 'config' });
  expect(cfg.copyRedact).toMatchObject({ value: 'on', source: 'config' });
});

test('parseSettingValue validates harSanitize and copyRedact', () => {
  expect(parseSettingValue('harSanitize', 'off')).toEqual({ patch: { harSanitize: false } });
  expect(parseSettingValue('harSanitize', 'on')).toEqual({ patch: { harSanitize: true } });
  expect(parseSettingValue('harSanitize', 'nope')).toMatchObject({ error: expect.any(String) });
  expect(parseSettingValue('copyRedact', 'on')).toEqual({ patch: { copyRedact: true } });
  expect(parseSettingValue('copyRedact', 'off')).toEqual({ patch: { copyRedact: false } });
  expect(parseSettingValue('copyRedact', 'nope')).toMatchObject({ error: expect.any(String) });
});

test('describeSettings reports configured networkCap and defaults otherwise', () => {
  const rows = describeSettings({ networkCap: 2500 });
  expect(rows.find(r => r.key === 'networkCap')).toMatchObject({ value: '2500', source: 'config' });
  const bare = describeSettings({});
  expect(bare.find(r => r.key === 'networkCap')).toMatchObject({ value: '1000', source: 'default' });
});

test('parseSettingValue validates networkCap within 100-5000', () => {
  expect(parseSettingValue('networkCap', '1000')).toEqual({ patch: { networkCap: 1000 } });
  expect(parseSettingValue('networkCap', '100')).toEqual({ patch: { networkCap: 100 } });
  expect(parseSettingValue('networkCap', '5000')).toEqual({ patch: { networkCap: 5000 } });
  expect(parseSettingValue('networkCap', '99')).toMatchObject({ error: expect.any(String) });
  expect(parseSettingValue('networkCap', '5001')).toMatchObject({ error: expect.any(String) });
  expect(parseSettingValue('networkCap', 'abc')).toMatchObject({ error: expect.any(String) });
  expect(parseSettingValue('networkCap', '1e3')).toMatchObject({ error: expect.any(String) });
});

test('describeSettings comma-joins configured ports and defaults otherwise', () => {
  const byKey = Object.fromEntries(describeSettings({ ports: [9222, 9333] }).map(r => [r.key, r]));
  expect(byKey.ports).toMatchObject({ value: '9222, 9333', source: 'config' });
  const bare = Object.fromEntries(describeSettings({}).map(r => [r.key, r]));
  expect(bare.ports).toMatchObject({ value: '9222', source: 'default' });
});

test('describeSettings marks a ports runtime override', () => {
  const byKey = Object.fromEntries(describeSettings({ ports: [9222] }, { ports: '9222, 9444' }).map(r => [r.key, r]));
  expect(byKey.ports).toMatchObject({ value: '9222, 9444', source: 'runtime' });
});

test('describeSettings reports configured layout', () => {
  const rows = describeSettings({ layout: 'split' });
  expect(rows.find(r => r.key === 'layout')).toMatchObject({ value: 'split', source: 'config' });
});

test('describeSettings reports configured cacheDisabled as on/off', () => {
  const on = describeSettings({ cacheDisabled: true });
  expect(on.find(r => r.key === 'cacheDisabled')).toMatchObject({ value: 'on', source: 'config' });
  const off = describeSettings({ cacheDisabled: false });
  expect(off.find(r => r.key === 'cacheDisabled')).toMatchObject({ value: 'off', source: 'config' });
});

test('describeSettings reports configured clearOnNav as on/off', () => {
  const on = describeSettings({ clearOnNav: true });
  expect(on.find(r => r.key === 'clearOnNav')).toMatchObject({ value: 'on', source: 'config' });
  const off = describeSettings({ clearOnNav: false });
  expect(off.find(r => r.key === 'clearOnNav')).toMatchObject({ value: 'off', source: 'config' });
});

test('describeSettings marks runtime overrides', () => {
  const rows = describeSettings({ port: 9333 }, { port: '9500', throttle: 'fast3g' });
  const byKey = Object.fromEntries(rows.map(r => [r.key, r]));
  expect(byKey.port).toMatchObject({ value: '9500', source: 'runtime' });
  expect(byKey.throttle).toMatchObject({ value: 'fast3g', source: 'runtime' });
});

test('describeSettings without effective arg is unchanged', () => {
  const rows = describeSettings({ port: 9333 });
  expect(rows.find(r => r.key === 'port')).toMatchObject({ value: '9333', source: 'config' });
});

test('describeSettings reports configured networkColumns and defaults otherwise', () => {
  const rows = describeSettings({ networkColumns: ['status', 'method', 'name'] });
  expect(rows.find(r => r.key === 'networkColumns')).toMatchObject({ value: 'status, method, name', source: 'config', kind: 'text', section: '표시' });
  const bare = describeSettings({});
  expect(bare.find(r => r.key === 'networkColumns')).toMatchObject({ value: 'status, type, time, size, waterfall, name', source: 'default' });
});

test('parseSettingValue validates and normalizes networkColumns', () => {
  expect(parseSettingValue('networkColumns', 'method, status')).toEqual({ patch: { networkColumns: ['status', 'method', 'name'] } });
  expect(parseSettingValue('networkColumns', 'status, url')).toEqual({ patch: { networkColumns: ['status', 'url'] } });
  expect(parseSettingValue('networkColumns', 'status, bogus')).toMatchObject({ error: expect.any(String) });
});

test('fuzzyFilter subsequence-matches keys case-insensitively', () => {
  const rows = describeSettings({});
  expect(fuzzyFilter(rows, 'zzz').map(r => r.key)).toEqual([]);
  expect(fuzzyFilter(rows, '').length).toBe(rows.length);
  expect(fuzzyFilter(rows, 'bcb').map(r => r.key)).toEqual(['bodyCapBytes']);
  expect(fuzzyFilter(rows, 'THR').map(r => r.key)).toEqual(['throttle']);
});

test('parseSettingValue validates and converts', () => {
  expect(parseSettingValue('port', '9500')).toEqual({ patch: { port: 9500 } });
  expect(parseSettingValue('port', 'abc')).toMatchObject({ error: expect.any(String) });
  expect(parseSettingValue('port', '70000')).toMatchObject({ error: expect.any(String) });
  expect(parseSettingValue('throttle', 'fast3g')).toEqual({ patch: { throttle: 'fast3g' } });
  expect(parseSettingValue('throttle', 'offline')).toEqual({ patch: { throttle: 'offline' } });
  expect(parseSettingValue('throttle', 'nope')).toMatchObject({ error: expect.any(String) });
  expect(parseSettingValue('cacheDisabled', 'on')).toEqual({ patch: { cacheDisabled: true } });
  expect(parseSettingValue('cacheDisabled', 'off')).toEqual({ patch: { cacheDisabled: false } });
  expect(parseSettingValue('cacheDisabled', 'nope')).toMatchObject({ error: expect.any(String) });
  expect(parseSettingValue('clearOnNav', 'on')).toEqual({ patch: { clearOnNav: true } });
  expect(parseSettingValue('clearOnNav', 'off')).toEqual({ patch: { clearOnNav: false } });
  expect(parseSettingValue('clearOnNav', 'nope')).toMatchObject({ error: expect.any(String) });
  expect(parseSettingValue('bodyCapBytes', '1024')).toEqual({ patch: { bodyCapBytes: 1024 } });
  expect(parseSettingValue('bodyCapBytes', '')).toMatchObject({ error: expect.any(String) });
  expect(parseSettingValue('port', '1e3')).toMatchObject({ error: expect.any(String) });
  expect(parseSettingValue('browserPaths', '/a, /b')).toEqual({ patch: { browserPaths: ['/a', '/b'] } });
  expect(parseSettingValue('layout', 'split')).toEqual({ patch: { layout: 'split' } });
  expect(parseSettingValue('layout', 'grid')).toMatchObject({ error: expect.any(String) });
  expect(parseSettingValue('nope', 'x')).toMatchObject({ error: expect.any(String) });
});

test('describeSettings shows (env) for an unset editor and the configured command otherwise', () => {
  const bare = Object.fromEntries(describeSettings({}).map(r => [r.key, r]));
  expect(bare.editor).toMatchObject({ value: '(env)', source: 'default', kind: 'text', section: '에디터' });
  const cfg = Object.fromEntries(describeSettings({ editor: 'code --wait' }).map(r => [r.key, r]));
  expect(cfg.editor).toMatchObject({ value: 'code --wait', source: 'config' });
});

test('parseSettingValue stores an editor command and clears it on empty or (env)', () => {
  expect(parseSettingValue('editor', 'nvim')).toEqual({ patch: { editor: 'nvim' } });
  expect(parseSettingValue('editor', '  emacsclient -t  ')).toEqual({ patch: { editor: 'emacsclient -t' } });
  const cleared = parseSettingValue('editor', '');
  expect('patch' in cleared && 'editor' in cleared.patch && cleared.patch.editor === undefined).toBe(true);
  const roundTrip = parseSettingValue('editor', '(env)');
  expect('patch' in roundTrip && 'editor' in roundTrip.patch && roundTrip.patch.editor === undefined).toBe(true);
});

test('describeSettings appends the hints row and parseSettingValue validates it', () => {
  const bare = Object.fromEntries(describeSettings({}).map(r => [r.key, r]));
  expect(bare.hints).toMatchObject({ value: '2', source: 'default', kind: 'enum', options: ['2', '1', 'off'], section: '표시' });
  const cfg = Object.fromEntries(describeSettings({ hints: 'off' }).map(r => [r.key, r]));
  expect(cfg.hints).toMatchObject({ value: 'off', source: 'config' });
  expect(parseSettingValue('hints', '1')).toEqual({ patch: { hints: '1' } });
  expect(parseSettingValue('hints', 'off')).toEqual({ patch: { hints: 'off' } });
  expect(parseSettingValue('hints', '3')).toMatchObject({ error: expect.any(String) });
});

test('parseSettingValue parses and validates ports lists', () => {
  expect(parseSettingValue('ports', '9222, 9333')).toEqual({ patch: { ports: [9222, 9333] } });
  expect(parseSettingValue('ports', '9222')).toEqual({ patch: { ports: [9222] } });
  expect(parseSettingValue('ports', '')).toMatchObject({ error: expect.any(String) });
  expect(parseSettingValue('ports', '9222, abc')).toMatchObject({ error: expect.any(String) });
  expect(parseSettingValue('ports', '70000')).toMatchObject({ error: expect.any(String) });
});

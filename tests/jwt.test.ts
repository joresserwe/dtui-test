import { test, expect } from 'vitest';
import { decodeJwt, requestJwts, setCookieJwts } from '../src/tui/lib/jwt.js';

const b64url = (obj: unknown): string => Buffer.from(JSON.stringify(obj)).toString('base64url');

const makeJwt = (header: unknown, payload: unknown, sig = 'sig-part'): string =>
  `${b64url(header)}.${b64url(payload)}.${sig}`;

const HEADER = { alg: 'HS256', typ: 'JWT' };
const PAYLOAD = { sub: 'user-1', exp: 1700003600, roles: ['admin', 'dev'] };

test('decodeJwt decodes header and payload without verifying the signature', () => {
  const decoded = decodeJwt(makeJwt(HEADER, PAYLOAD, 'not-a-real-signature'));
  expect(decoded).toEqual({ header: HEADER, payload: PAYLOAD });
});

test('decodeJwt accepts an empty signature segment', () => {
  expect(decodeJwt(makeJwt({ alg: 'none' }, { sub: 'x' }, ''))).toEqual({ header: { alg: 'none' }, payload: { sub: 'x' } });
});

test('decodeJwt round-trips unicode payload values through base64url', () => {
  const payload = { name: '홍길동', emoji: '🎫' };
  expect(decodeJwt(makeJwt(HEADER, payload))!.payload).toEqual(payload);
});

test('decodeJwt rejects malformed tokens silently', () => {
  expect(decodeJwt('')).toBeNull();
  expect(decodeJwt('abc.def.ghi')).toBeNull();
  expect(decodeJwt('eyJhbGciOiJIUzI1NiJ9')).toBeNull();
  expect(decodeJwt(`${b64url(HEADER)}.${b64url(PAYLOAD)}`)).toBeNull();
  expect(decodeJwt(`${b64url(HEADER)}.not+base64url!.sig`)).toBeNull();
  expect(decodeJwt(`eyJub3QganNvbg.${b64url(PAYLOAD)}.sig`)).toBeNull();
  expect(decodeJwt(`${b64url([1, 2])}.${b64url(PAYLOAD)}.sig`)).toBeNull();
  expect(decodeJwt(`${b64url(HEADER)}.${b64url('just a string')}.sig`)).toBeNull();
});

test('requestJwts finds a bearer token in the Authorization header', () => {
  const jwt = makeJwt(HEADER, PAYLOAD);
  const [tok] = requestJwts({ Authorization: `Bearer ${jwt}` });
  expect(tok).toEqual({ source: 'Authorization', header: HEADER, payload: PAYLOAD });
  expect(requestJwts({ authorization: `bearer ${jwt}` })).toHaveLength(1);
  expect(requestJwts({ Authorization: `Basic ${jwt}` })).toEqual([]);
  expect(requestJwts({ Authorization: 'Bearer opaque-token' })).toEqual([]);
  expect(requestJwts({})).toEqual([]);
});

test('requestJwts finds tokens in cookie values and keeps the cookie name as source', () => {
  const jwt = makeJwt(HEADER, PAYLOAD);
  const toks = requestJwts({ cookie: `theme=dark; session=${jwt}; other` });
  expect(toks).toHaveLength(1);
  expect(toks[0].source).toBe('session');
  expect(toks[0].payload).toEqual(PAYLOAD);
});

test('requestJwts reports both Authorization and cookie tokens', () => {
  const jwt = makeJwt(HEADER, PAYLOAD);
  const toks = requestJwts({ authorization: `Bearer ${jwt}`, cookie: `sid=${jwt}` });
  expect(toks.map(t => t.source)).toEqual(['Authorization', 'sid']);
});

test('setCookieJwts decodes set-cookie values and ignores attributes and non-JWT cookies', () => {
  const jwt = makeJwt(HEADER, PAYLOAD);
  const toks = setCookieJwts([`auth=${jwt}; Path=/; HttpOnly`, 'plain=1; Path=/']);
  expect(toks).toHaveLength(1);
  expect(toks[0].source).toBe('auth');
  expect(toks[0].header).toEqual(HEADER);
  expect(setCookieJwts([])).toEqual([]);
});

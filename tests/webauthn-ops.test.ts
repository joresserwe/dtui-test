import { test, expect, beforeAll, afterAll } from 'vitest';
import { MockCdp } from './helpers/mock-cdp.js';
import { CdpConnection } from '../src/cdp/connection.js';
import {
  enableWebAuthn,
  disableWebAuthn,
  addVirtualAuthenticator,
  removeVirtualAuthenticator,
} from '../src/cdp/webauthn.js';

let mock: MockCdp;
let conn: CdpConnection;
beforeAll(async () => { mock = await MockCdp.start(); conn = await CdpConnection.open(mock.pageWsUrl('page1')); });
afterAll(async () => { conn.close(); await mock.close(); });

test('enableWebAuthn opens the virtual environment without the browser UI', async () => {
  let seen: any;
  mock.respond('WebAuthn.enable', p => { seen = p; return {}; });
  await enableWebAuthn(conn);
  expect(seen).toEqual({ enableUI: false });
});

test('addVirtualAuthenticator builds a ctap2/internal authenticator and returns its id', async () => {
  let seen: any;
  mock.respond('WebAuthn.addVirtualAuthenticator', p => { seen = p; return { authenticatorId: 'auth-1' }; });
  const id = await addVirtualAuthenticator(conn, {
    protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true,
  });
  expect(id).toBe('auth-1');
  expect(seen).toEqual({
    options: {
      protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true,
      isUserVerified: true, automaticPresenceSimulation: true,
    },
  });
});

test('removeVirtualAuthenticator forwards the authenticator id', async () => {
  let seen: any;
  mock.respond('WebAuthn.removeVirtualAuthenticator', p => { seen = p; return {}; });
  await removeVirtualAuthenticator(conn, 'auth-1');
  expect(seen).toEqual({ authenticatorId: 'auth-1' });
});

test('disableWebAuthn tears down the virtual environment', async () => {
  let called = false;
  mock.respond('WebAuthn.disable', () => { called = true; return {}; });
  await disableWebAuthn(conn);
  expect(called).toBe(true);
});

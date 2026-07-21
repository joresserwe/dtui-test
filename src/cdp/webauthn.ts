import type { CdpConnection } from './connection.js';

export async function enableWebAuthn(conn: CdpConnection): Promise<void> {
  await conn.send('WebAuthn.enable', { enableUI: false });
}

export async function disableWebAuthn(conn: CdpConnection): Promise<void> {
  await conn.send('WebAuthn.disable');
}

export interface VirtualAuthenticatorOptions {
  protocol: 'ctap2';
  transport: 'internal';
  hasResidentKey: boolean;
  hasUserVerification: boolean;
  isUserVerified: boolean;
}

export async function addVirtualAuthenticator(conn: CdpConnection, o: VirtualAuthenticatorOptions): Promise<string> {
  const { authenticatorId } = await conn.send<{ authenticatorId: string }>('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: o.protocol,
      transport: o.transport,
      hasResidentKey: o.hasResidentKey,
      hasUserVerification: o.hasUserVerification,
      isUserVerified: o.isUserVerified,
      automaticPresenceSimulation: true,
    },
  });
  return authenticatorId;
}

export async function removeVirtualAuthenticator(conn: CdpConnection, authenticatorId: string): Promise<void> {
  await conn.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
}

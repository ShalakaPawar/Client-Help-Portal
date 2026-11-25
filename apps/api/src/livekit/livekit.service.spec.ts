import { createHash } from 'node:crypto';
import { AccessToken, TokenVerifier } from 'livekit-server-sdk';
import { LiveKitService } from './livekit.service';
import { loadConfig } from '../config/env';

/** Uses the real LiveKit SDK (no network): token contents and webhook signature checks. */
describe('LiveKitService', () => {
  const config = loadConfig();
  const service = new LiveKitService(config);
  const verifier = new TokenVerifier(config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET);

  describe('access tokens', () => {
    it('a client may join only this room and publish only screen share + microphone', async () => {
      const jwt = await service.createToken({ identity: 'user-1', name: 'Alice', room: 'call-abc', role: 'CLIENT' });
      const claims = await verifier.verify(jwt);
      expect(claims.sub).toBe('user-1');
      expect(claims.video).toMatchObject({ roomJoin: true, room: 'call-abc', canSubscribe: true, canPublishData: false });
      expect(claims.video?.canPublishSources).toEqual(expect.arrayContaining(['screen_share', 'microphone']));
      expect(claims.video?.canPublishSources).not.toContain('camera');
    });

    it('a consultant may publish only their microphone', async () => {
      const jwt = await service.createToken({ identity: 'user-2', name: 'Sam', room: 'call-abc', role: 'CONSULTANT' });
      const claims = await verifier.verify(jwt);
      expect(claims.video?.canPublishSources).toEqual(['microphone']);
    });

    it('tokens expire after 10 minutes (only needed to connect)', async () => {
      const jwt = await service.createToken({ identity: 'u', name: 'n', room: 'r', role: 'CLIENT' });
      const claims = (await verifier.verify(jwt)) as { exp?: number; nbf?: number };
      expect((claims.exp ?? 0) - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(600);
    });
  });

  describe('webhook signature', () => {
    const body = JSON.stringify({ event: 'room_finished', id: 'EV_1', room: { name: 'call-abc' } });

    async function signed(payload: string, secret = config.LIVEKIT_API_SECRET) {
      const at = new AccessToken(config.LIVEKIT_API_KEY, secret);
      at.sha256 = createHash('sha256').update(payload).digest('base64');
      return at.toJwt();
    }

    it('accepts a correctly signed event and normalises it', async () => {
      const event = await service.receiveWebhook(body, await signed(body));
      expect(event).toMatchObject({ id: 'EV_1', event: 'room_finished', roomName: 'call-abc' });
    });

    it('rejects a body that was changed after signing', async () => {
      const tampered = body.replace('call-abc', 'call-xyz');
      await expect(service.receiveWebhook(tampered, await signed(body))).rejects.toThrow();
    });

    it('rejects a signature made with another secret', async () => {
      await expect(service.receiveWebhook(body, await signed(body, 'not-the-secret-not-the-secret'))).rejects.toThrow();
    });
  });
});

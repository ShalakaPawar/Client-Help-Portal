/**
 * Client self-signup, the default consultant, and the admin role.
 * The admin manages consultants and client assignments only: no requests, calls or history.
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { auth, createTestApp, loginAs, resetDatabase } from './helpers';

describe('Accounts: signup, default consultant, admin', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ids: Record<string, string>;
  const http = () => request(app.getHttpServer());
  const signup = (email: string, extra: Record<string, unknown> = {}) =>
    http().post('/api/auth/signup').send({ name: 'New Client', email, password: 'longenough1', ...extra });

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  beforeEach(async () => {
    ids = await resetDatabase(prisma);
  });
  afterAll(async () => {
    await app.close();
  });

  describe('client signup', () => {
    it('creates a CLIENT, logs them in, and assigns the default consultant', async () => {
      const res = await signup('new@client.test').expect(201);
      expect(res.body.accessToken).toBeTruthy();
      expect(res.body.user).toMatchObject({ role: 'CLIENT', email: 'new@client.test', consultant: { name: 'Sam Consultant' } });

      // They can raise a request right away, and their consultant sees it.
      const req = await http().post('/api/requests').set(auth(res.body.accessToken)).send({ title: 'Help please', description: 'x' }).expect(201);
      const samList = await http().get('/api/requests').set(auth(await loginAs(app, 'consultant@demo.com'))).expect(200);
      expect(samList.body.map((r: { id: string }) => r.id)).toContain(req.body.id);
    });

    it('cannot be used to create a consultant or admin', async () => {
      await signup('sneaky@client.test', { role: 'CONSULTANT' }).expect(400);
      await signup('sneaky@client.test', { role: 'ADMIN' }).expect(400);
    });

    it('rejects an email that is already used, and weak input', async () => {
      const dup = await signup('client1@demo.com').expect(409);
      expect(dup.body.code).toBe('EMAIL_IN_USE');
      await http().post('/api/auth/signup').send({ name: 'X', email: 'not-an-email', password: 'short' }).expect(400);
    });

    it('without a default consultant the client waits and cannot raise requests yet', async () => {
      await prisma.user.updateMany({ data: { isDefaultConsultant: false } });
      const res = await signup('waiting@client.test').expect(201);
      expect(res.body.user.consultant).toBeNull();
      const blocked = await http().post('/api/requests').set(auth(res.body.accessToken)).send({ title: 'Help please', description: 'x' }).expect(409);
      expect(blocked.body.message).toMatch(/no consultant/i);
    });
  });

  describe('admin', () => {
    let admin: string;
    beforeEach(async () => {
      admin = await loginAs(app, 'admin@demo.com');
    });

    it('only the admin can use the admin endpoints', async () => {
      await http().get('/api/admin/consultants').expect(401);
      await http().get('/api/admin/consultants').set(auth(await loginAs(app, 'client1@demo.com'))).expect(403);
      await http().get('/api/admin/clients').set(auth(await loginAs(app, 'consultant@demo.com'))).expect(403);
      const list = await http().get('/api/admin/consultants').set(auth(admin)).expect(200);
      expect(list.body.find((c: { email: string }) => c.email === 'consultant@demo.com')).toMatchObject({ isDefault: true, clientCount: 3 });
    });

    it('adds a consultant who can log in, and changes the default for new signups', async () => {
      const created = await http()
        .post('/api/admin/consultants')
        .set(auth(admin))
        .send({ name: 'Nina Consultant', email: 'nina@demo.com', password: 'longenough1' })
        .expect(201);
      await http().post('/api/auth/login').send({ email: 'nina@demo.com', password: 'longenough1' }).expect(200);

      await http().post(`/api/admin/consultants/${created.body.id}/default`).set(auth(admin)).expect(200);
      const res = await signup('after@client.test').expect(201);
      expect(res.body.user.consultant).toMatchObject({ name: 'Nina Consultant' });
      expect(await prisma.user.count({ where: { isDefaultConsultant: true } })).toBe(1);
    });

    it("reassigns a client: their open requests move to the new consultant", async () => {
      const alice = await loginAs(app, 'client1@demo.com');
      const req = await http().post('/api/requests').set(auth(alice)).send({ title: 'Open one', description: 'x' }).expect(201);
      await http()
        .post(`/api/admin/clients/${ids['client1@demo.com']}/consultant`)
        .set(auth(admin))
        .send({ consultantId: ids['consultant2@demo.com'] })
        .expect(200);
      const moved = await prisma.helpRequest.findUniqueOrThrow({ where: { id: req.body.id } });
      expect(moved.consultantId).toBe(ids['consultant2@demo.com']);
      const me = await http().get('/api/auth/me').set(auth(alice)).expect(200);
      expect(me.body.consultant).toMatchObject({ name: 'Riya Consultant' });
    });

    it('has no access to requests, calls or history', async () => {
      const alice = await loginAs(app, 'client1@demo.com');
      const req = await http().post('/api/requests').set(auth(alice)).send({ title: 'Private', description: 'x' }).expect(201);
      expect((await http().get('/api/requests').set(auth(admin)).expect(200)).body).toEqual([]);
      await http().get(`/api/requests/${req.body.id}`).set(auth(admin)).expect(404);
      expect((await http().get('/api/history').set(auth(admin)).expect(200)).body.items).toEqual([]);
      await http().get('/api/calls/active').set(auth(admin)).expect(200, { call: null });
      await http().post(`/api/requests/${req.body.id}/calls`).set(auth(admin)).expect(403);
    });
  });
});

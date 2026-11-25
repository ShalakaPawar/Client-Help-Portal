import { createPinia, setActivePinia } from 'pinia';
import { router } from './router';

/** Regression: opening "/" used to redirect to itself forever (Maximum call stack size exceeded). */
describe('router entry points', () => {
  beforeEach(() => {
    sessionStorage.clear();
    setActivePinia(createPinia());
  });

  it('opening "/" while logged out goes to the login page', async () => {
    await router.push('/');
    expect(router.currentRoute.value.path).toBe('/login');
  });

  it('an unknown address while logged out goes to the login page', async () => {
    await router.push('/no/such/page');
    expect(router.currentRoute.value.path).toBe('/login');
  });

  it('opening "/" while logged in as a consultant goes to the consultant dashboard', async () => {
    sessionStorage.setItem('chp.token', 'token');
    sessionStorage.setItem('chp.user', JSON.stringify({ id: 'u1', email: 'c@demo.com', name: 'Sam', role: 'CONSULTANT' }));
    setActivePinia(createPinia());
    await router.push('/');
    expect(router.currentRoute.value.path).toBe('/consultant');
  });
});

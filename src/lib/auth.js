const KEY = 'daemu_admin_auth';

export const Auth = {
  isLoggedIn() { return localStorage.getItem(KEY) === '1'; },
  login() { localStorage.setItem(KEY, '1'); },
  logout() { localStorage.removeItem(KEY); }
};

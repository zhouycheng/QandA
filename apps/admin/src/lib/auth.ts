const AUTH_KEY = 'qanda-admin-auth'

export function isAuthenticated() {
  return window.localStorage.getItem(AUTH_KEY) === 'authenticated'
}

export function login(username: string, password: string) {
  const valid = username === 'admin' && password === 'mock'
  if (valid) window.localStorage.setItem(AUTH_KEY, 'authenticated')
  return valid
}

export function logout() {
  window.localStorage.removeItem(AUTH_KEY)
}

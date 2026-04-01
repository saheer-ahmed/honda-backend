// src/lib/api.js
const BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

const getTokens = () => ({
  access:  localStorage.getItem('honda_access_token'),
  refresh: localStorage.getItem('honda_refresh_token'),
});

const saveTokens = ({ accessToken, refreshToken }) => {
  if (accessToken)  localStorage.setItem('honda_access_token',  accessToken);
  if (refreshToken) localStorage.setItem('honda_refresh_token', refreshToken);
};

const clearTokens = () => {
  localStorage.removeItem('honda_access_token');
  localStorage.removeItem('honda_refresh_token');
  localStorage.removeItem('honda_user');
};

let isRefreshing   = false;
let refreshQueue   = [];

const processQueue = (error, token) => {
  refreshQueue.forEach(({ resolve, reject }) => error ? reject(error) : resolve(token));
  refreshQueue = [];
};

const request = async (path, options = {}, retry = true) => {
  const { access } = getTokens();
  const headers = {
    'Content-Type': 'application/json',
    ...(access ? { Authorization: `Bearer ${access}` } : {}),
    ...options.headers,
  };

  const res = await fetch(`${BASE}${path}`, { ...options, headers });

  // Auto-refresh on 401
  if (res.status === 401 && retry) {
    const { refresh } = getTokens();
    if (!refresh) { clearTokens(); window.location.href = '/login'; return; }

    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        refreshQueue.push({ resolve, reject });
      }).then((token) => {
        return request(path, {
          ...options,
          headers: { ...options.headers, Authorization: `Bearer ${token}` },
        }, false);
      });
    }

    isRefreshing = true;
    try {
      const r = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: refresh }),
      });
      if (!r.ok) throw new Error('Refresh failed');
      const data = await r.json();
      saveTokens(data);
      processQueue(null, data.accessToken);
      return request(path, options, false);
    } catch (err) {
      processQueue(err, null);
      clearTokens();
      window.location.href = '/login';
    } finally {
      isRefreshing = false;
    }
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw Object.assign(new Error(err.error || 'Request failed'), { status: res.status, data: err });
  }

  return res.status === 204 ? null : res.json();
};

// Convenience methods
const get    = (path, params) => request(path + (params ? '?' + new URLSearchParams(params) : ''));
const post   = (path, body)   => request(path, { method: 'POST',  body: JSON.stringify(body) });
const put    = (path, body)   => request(path, { method: 'PUT',   body: JSON.stringify(body) });
const patch  = (path, body)   => request(path, { method: 'PATCH', body: JSON.stringify(body) });
const del    = (path)         => request(path, { method: 'DELETE' });

// Upload files (multipart)
const upload = (path, formData) => {
  const { access } = getTokens();
  return fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: access ? { Authorization: `Bearer ${access}` } : {},
    body: formData,
  }).then(r => r.json());
};

export const api = { get, post, put, patch, del, upload, saveTokens, clearTokens, getTokens };

// ─── Auth ─────────────────────────────────────────────────────────────────────
export const authApi = {
  login:        (body)  => post('/auth/login',     body),
  register:     (body)  => post('/auth/register',  body),
  logout:       (body)  => post('/auth/logout',    body),
  me:           ()      => get('/auth/me'),
  updateFcm:    (token) => put('/auth/fcm-token',  { fcmToken: token }),
};

// ─── Jobs ─────────────────────────────────────────────────────────────────────
export const jobsApi = {
  list:         (p)     => get('/jobs',             p),
  get:          (id)    => get(`/jobs/${id}`),
  create:       (body)  => post('/jobs',            body),
  updateStatus: (id, b) => patch(`/jobs/${id}/status`, b),
  assignDriver: (id, b) => patch(`/jobs/${id}/assign-driver`, b),
  stats:        ()      => get('/jobs/stats'),
  rate:         (id, b) => post(`/jobs/${id}/rating`, b),
};

// ─── Inspections ──────────────────────────────────────────────────────────────
export const inspApi = {
  upsert:  (body)          => post('/inspections',              body),
  photos:  (jobId, fd)     => upload(`/inspections/${jobId}/photos`, fd),
  sign:    (jobId)         => post(`/inspections/${jobId}/sign`, {}),
  get:     (jobId)         => get(`/inspections/${jobId}`),
};

// ─── Quotations ───────────────────────────────────────────────────────────────
export const quotApi = {
  create:  (body)    => post('/quotations',          body),
  respond: (id, act) => post(`/quotations/${id}/respond`, { action: act }),
  getByJob: (jobId)  => get(`/quotations/job/${jobId}`),
};

// ─── Vehicles ─────────────────────────────────────────────────────────────────
export const vehiclesApi = {
  list:    (p) => get('/vehicles', p),
  create:  (b) => post('/vehicles', b),
};

// ─── Drivers ──────────────────────────────────────────────────────────────────
export const driversApi = {
  list:    ()   => get('/drivers'),
  tasks:   (id) => get(`/drivers/${id}/tasks`),
};

// ─── Notifications ────────────────────────────────────────────────────────────
export const notiApi = {
  list:    ()    => get('/notifications'),
  readAll: ()    => patch('/notifications/read'),
  broadcast: (b) => post('/notifications/broadcast', b),
};

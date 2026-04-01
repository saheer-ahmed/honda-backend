// src/lib/socket.js
import { io }        from 'socket.io-client';
import { api }       from './api';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:4000';

let socket = null;

export const getSocket = () => socket;

export const connectSocket = () => {
  const { access } = api.getTokens();
  if (!access) return null;
  if (socket?.connected) return socket;

  socket = io(SOCKET_URL, {
    auth:       { token: access },
    transports: ['websocket', 'polling'],
    reconnectionAttempts: 5,
    reconnectionDelay:    2000,
  });

  socket.on('connect',         () => console.log('[Socket] Connected:', socket.id));
  socket.on('disconnect',      (r) => console.log('[Socket] Disconnected:', r));
  socket.on('connect_error',   (e) => console.warn('[Socket] Error:', e.message));

  return socket;
};

export const disconnectSocket = () => {
  socket?.disconnect();
  socket = null;
};

export const subscribeJob = (jobId) => socket?.emit('job:subscribe',   { jobId });
export const unsubscribeJob = (jobId) => socket?.emit('job:unsubscribe', { jobId });

export const sendDriverLocation = (jobId, lat, lng) =>
  socket?.emit('driver:location', { jobId, lat, lng });

export const setDriverStatus = (status) =>
  socket?.emit('driver:status', { status });

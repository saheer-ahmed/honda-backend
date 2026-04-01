// src/hooks/useSocket.js
import { useEffect, useRef } from 'react';
import { getSocket, subscribeJob, unsubscribeJob } from '../lib/socket';

/**
 * Subscribe to socket events. Auto-cleans on unmount.
 * @param {Record<string, Function>} events  - { eventName: handler }
 * @param {string[]}                 jobIds  - optional job rooms to join
 */
export const useSocket = (events = {}, jobIds = []) => {
  const eventsRef = useRef(events);
  eventsRef.current = events;

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    // Subscribe to job rooms
    jobIds.forEach(id => subscribeJob(id));

    // Attach event listeners
    const attached = Object.entries(eventsRef.current).map(([ev, handler]) => {
      socket.on(ev, handler);
      return [ev, handler];
    });

    return () => {
      attached.forEach(([ev, handler]) => socket.off(ev, handler));
      jobIds.forEach(id => unsubscribeJob(id));
    };
  }, [jobIds.join(',')]);
};

/**
 * useJobUpdates – convenience hook for a single job
 */
export const useJobUpdates = (jobId, { onStatusUpdate, onQuotation, onDriverLocation } = {}) => {
  useSocket(
    {
      'job:status_update': (data) => data.jobId === jobId && onStatusUpdate?.(data),
      'quotation:new':     (data) => data.jobId === jobId && onQuotation?.(data),
      'quotation:response':(data) => data.jobId === jobId && onQuotation?.(data),
      'driver:location':   (data) => onDriverLocation?.(data),
    },
    [jobId].filter(Boolean)
  );
};

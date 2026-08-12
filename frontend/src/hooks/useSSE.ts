import { useEffect, useRef, useCallback } from 'react';
import { API_BASE } from '../api';

export type SSEEventType =
  | 'CONNECTED'
  | 'HEARTBEAT'
  | 'CALL_STARTED'
  | 'CALL_ENDED'
  | 'CALL_ANALYZED'
  | 'APPOINTMENT_BOOKED'
  | 'CALLBACK_SCHEDULED'
  | 'CAMPAIGN_UPDATE'
  | 'CONTACT_UPDATED'
  | 'COUNSELOR_ASSIGNED';

export interface SSEMessage {
  event: SSEEventType;
  data: any;
  timestamp: string;
}

export type SSECallback = (message: SSEMessage) => void;

/**
 * useSSE — Custom hook to connect to FastAPI Server-Sent Events stream.
 * Automatically reconnects with exponential backoff on disconnect.
 * Dispatches real-time events to registered callbacks.
 */
export function useSSE(onMessage?: SSECallback, eventTypes?: SSEEventType[]) {
  const onMessageRef = useRef<SSECallback | undefined>(onMessage);
  const eventTypesRef = useRef<SSEEventType[] | undefined>(eventTypes);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<any>(null);
  const retryCountRef = useRef(0);

  useEffect(() => {
    onMessageRef.current = onMessage;
    eventTypesRef.current = eventTypes;
  }, [onMessage, eventTypes]);

  const connect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    const token = localStorage.getItem('token') || '';
    const userStr = localStorage.getItem('user') || 'null';
    let schoolId = '';
    try {
      const user = JSON.parse(userStr);
      if (user?.school_id) {
        schoolId = user.school_id;
      }
    } catch {
      // ignore
    }

    // Build the stream URL
    let streamUrlStr = `${API_BASE}/events/stream`;
    const params = new URLSearchParams();
    if (token) params.set('token', token);
    if (schoolId) params.set('school_id', schoolId);
    const queryString = params.toString();
    if (queryString) {
      streamUrlStr += `?${queryString}`;
    }

    try {
      const es = new EventSource(streamUrlStr);
      eventSourceRef.current = es;

      es.onopen = () => {
        retryCountRef.current = 0;
      };

      es.onmessage = (e) => {
        try {
          const payload: SSEMessage = JSON.parse(e.data);
          if (payload.event === 'HEARTBEAT') return;

          if (
            !eventTypesRef.current ||
            eventTypesRef.current.length === 0 ||
            eventTypesRef.current.includes(payload.event)
          ) {
            if (onMessageRef.current) {
              onMessageRef.current(payload);
            }
          }
        } catch (err) {
          console.warn('[SSE] Error parsing event payload:', err);
        }
      };

      es.onerror = () => {
        if (eventSourceRef.current) {
          eventSourceRef.current.close();
          eventSourceRef.current = null;
        }
        // Exponential backoff reconnect: 2s, 4s, 8s, up to max 30s
        const delay = Math.min(30000, 2000 * Math.pow(1.5, retryCountRef.current));
        retryCountRef.current += 1;
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, delay);
      };
    } catch (err) {
      console.warn('[SSE] Connection error:', err);
    }
  }, []);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [connect]);

  return {
    reconnect: connect,
  };
}

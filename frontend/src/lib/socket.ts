import { io, Socket } from 'socket.io-client';

const SOCKET_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api').replace(/\/api$/, '');

let socket: Socket | null = null;

/**
 * Lazily creates a single shared socket connection, authenticated with
 * whatever JWT is currently in localStorage. Returns null if there's no
 * token yet (user isn't logged in) — callers should treat that as "no
 * live updates available" rather than an error.
 */
export function getSocket(): Socket | null {
  if (typeof window === 'undefined') return null;

  const token = localStorage.getItem('pp_token');
  if (!token) return null;

  if (!socket || socket.disconnected) {
    socket = io(SOCKET_URL, {
      auth: { token },
      transports: ['websocket'],
    });
  }

  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}

export interface OrderUpdateEvent {
  orderId: string;
  orderNumber: string;
  status: string;
  at: string;
}

import { useEffect } from 'react';
import { getSocket, OrderUpdateEvent } from './socket';

/**
 * Subscribes to live order status events for as long as the component
 * is mounted. Silently does nothing if the user isn't logged in (no
 * socket available) — the page still works from its initial REST fetch,
 * it just won't get live pushes.
 */
export function useOrderUpdates(onUpdate: (event: OrderUpdateEvent) => void) {
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    socket.on('order:update', onUpdate);
    return () => {
      socket.off('order:update', onUpdate);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

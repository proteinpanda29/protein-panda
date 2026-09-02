import { useEffect } from 'react';
import { getSocket } from './socket';

export interface DeliveryLocationEvent {
  orderId: string;
  lat: number;
  lng: number;
  at: string;
}

export function useDeliveryLocationUpdates(onUpdate: (event: DeliveryLocationEvent) => void) {
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    socket.on('delivery:location', onUpdate);
    return () => {
      socket.off('delivery:location', onUpdate);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

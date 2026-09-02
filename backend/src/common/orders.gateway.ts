import { Injectable, Logger } from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from './prisma.service';

interface SocketUser {
  userId: string;
  role: 'CUSTOMER' | 'ADMIN' | 'DELIVERY';
  customerId?: string;
  deliveryPersonId?: string;
}

// Human-readable order-update notifications — persisted alongside the
// live socket push so there's an in-app inbox history, not just an
// ephemeral toast the customer might have missed. Only statuses with a
// message here get a notification; intermediate/internal ones (e.g.
// ASSIGNED, which the customer sees as "Ready" already) don't need a
// separate entry.
const ORDER_STATUS_MESSAGES: Record<string, string> = {
  ACCEPTED: 'Your order has been accepted and is being prepared.',
  READY: 'Your order is ready!',
  OUT_FOR_DELIVERY: 'Your order is out for delivery.',
  ARRIVED: 'Your rider has arrived.',
  DELIVERED: 'Your order has been delivered. Enjoy! 🐼',
  FAILED: 'We were unable to complete your delivery — please contact us.',
  CANCELLED: 'Your order has been cancelled.',
};

/**
 * Rooms:
 *  - customer:<customerId>   → that customer's own order updates
 *  - admin                   → every order update (kitchen/ops view)
 *  - delivery:<deliveryPersonId> → only that rider's assigned-order updates
 *
 * A socket only ever joins the room(s) matching its own authenticated
 * identity — the same server-side-derived-role rule as the REST API.
 */
@Injectable()
@WebSocketGateway({
  cors: { origin: process.env.FRONTEND_URL ?? 'http://localhost:3000', credentials: true },
})
export class OrdersGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private logger = new Logger('OrdersGateway');

  constructor(
    private jwt: JwtService,
    private prisma: PrismaService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token =
        (client.handshake.auth?.token as string) ||
        (client.handshake.query?.token as string);

      if (!token) throw new Error('No token provided');

      const payload = this.jwt.verify(token, { secret: process.env.JWT_SECRET ?? 'dev-secret-change-me' });

      // Same enforcement as JwtStrategy on the REST API: a deactivated
      // account must not be able to open a live connection either, even
      // with a still-validly-signed, unexpired token. Without this check,
      // deactivating a staff/rider/customer account would only cut off
      // their REST access — they could still connect via WebSocket and
      // keep receiving live order/location updates indefinitely.
      const dbUser = await this.prisma.user.findUnique({ where: { id: payload.sub }, select: { isActive: true } });
      if (!dbUser || !dbUser.isActive) {
        throw new Error('This account has been deactivated');
      }

      const user: SocketUser = { userId: payload.sub, role: payload.role };

      if (user.role === 'CUSTOMER') {
        const customer = await this.prisma.customer.findUnique({ where: { userId: user.userId } });
        if (customer) {
          user.customerId = customer.id;
          client.join(`customer:${customer.id}`);
        }
      } else if (user.role === 'ADMIN') {
        client.join('admin');
      } else if (user.role === 'DELIVERY') {
        const rider = await this.prisma.deliveryPerson.findUnique({ where: { userId: user.userId } });
        if (rider) {
          user.deliveryPersonId = rider.id;
          client.join(`delivery:${rider.id}`);
        }
      }

      client.data.user = user;
    } catch (err) {
      this.logger.warn(`Rejected socket connection: ${(err as Error).message}`);
      client.disconnect(true);
    }
  }

  handleDisconnect() {
    // no-op — socket.io cleans up room membership automatically
  }

  /**
   * Broadcasts an order status change to the customer who placed it,
   * the admin/ops room, and the assigned delivery rider (if any).
   */
  emitOrderStatusUpdate(params: {
    orderId: string;
    orderNumber: string;
    status: string;
    customerId: string;
    deliveryPersonId?: string;
  }) {
    const payload = {
      orderId: params.orderId,
      orderNumber: params.orderNumber,
      status: params.status,
      at: new Date().toISOString(),
    };

    this.server.to(`customer:${params.customerId}`).emit('order:update', payload);
    this.server.to('admin').emit('order:update', payload);
    if (params.deliveryPersonId) {
      this.server.to(`delivery:${params.deliveryPersonId}`).emit('order:update', payload);
    }

    // Persisted in-app notification, alongside the live push above.
    // Every existing call site that already emits an order status
    // update gets this for free — no changes needed anywhere else.
    // Fire-and-forget: a logging failure here must never break the
    // actual status update this method exists to broadcast.
    const message = ORDER_STATUS_MESSAGES[params.status];
    if (message) {
      this.prisma.notification
        .create({
          data: {
            customerId: params.customerId,
            type: 'ORDER_UPDATE',
            title: `Order #${params.orderNumber}`,
            body: message,
            orderId: params.orderId,
          },
        })
        .catch((err: unknown) => this.logger.warn(`Failed to persist order notification: ${(err as Error).message}`));
    }
  }

  /**
   * Live rider position for one specific order — only reaches the
   * customer who placed that order (plus admin, for the ops map view).
   * Never broadcast to other customers or other riders.
   */
  emitDeliveryLocationUpdate(params: { orderId: string; customerId: string; lat: number; lng: number }) {
    const payload = { orderId: params.orderId, lat: params.lat, lng: params.lng, at: new Date().toISOString() };
    this.server.to(`customer:${params.customerId}`).emit('delivery:location', payload);
    this.server.to('admin').emit('delivery:location', payload);
  }
}

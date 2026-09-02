import { OrdersGateway } from './orders.gateway';

function makeSocket(token: string | null) {
  return {
    handshake: { auth: { token }, query: {} },
    join: jest.fn(),
    disconnect: jest.fn(),
    data: {} as any,
  } as any;
}

function makeHarness() {
  const jwt = { verify: jest.fn() } as any;
  const prisma = {
    user: { findUnique: jest.fn() },
    customer: { findUnique: jest.fn() },
    deliveryPerson: { findUnique: jest.fn() },
    notification: { create: jest.fn().mockResolvedValue({}) },
  } as any;
  const gateway = new OrdersGateway(jwt, prisma);
  gateway.server = { to: jest.fn().mockReturnValue({ emit: jest.fn() }) } as any;
  return { gateway, jwt, prisma };
}

describe('OrdersGateway.handleConnection', () => {
  it('disconnects a socket with no token at all', async () => {
    const { gateway } = makeHarness();
    const socket = makeSocket(null);

    await gateway.handleConnection(socket);

    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  it('disconnects a socket whose account has been deactivated, even with a validly-signed token', async () => {
    const { gateway, jwt, prisma } = makeHarness();
    jwt.verify.mockReturnValue({ sub: 'user-1', role: 'ADMIN' });
    prisma.user.findUnique.mockResolvedValue({ isActive: false });
    const socket = makeSocket('valid-jwt');

    await gateway.handleConnection(socket);

    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect(socket.join).not.toHaveBeenCalled();
  });

  it('disconnects a socket whose user no longer exists', async () => {
    const { gateway, jwt, prisma } = makeHarness();
    jwt.verify.mockReturnValue({ sub: 'deleted-user', role: 'CUSTOMER' });
    prisma.user.findUnique.mockResolvedValue(null);
    const socket = makeSocket('valid-jwt');

    await gateway.handleConnection(socket);

    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  it('joins an active CUSTOMER only to their own customer room', async () => {
    const { gateway, jwt, prisma } = makeHarness();
    jwt.verify.mockReturnValue({ sub: 'user-1', role: 'CUSTOMER' });
    prisma.user.findUnique.mockResolvedValue({ isActive: true });
    prisma.customer.findUnique.mockResolvedValue({ id: 'cust-1' });
    const socket = makeSocket('valid-jwt');

    await gateway.handleConnection(socket);

    expect(socket.join).toHaveBeenCalledWith('customer:cust-1');
    expect(socket.disconnect).not.toHaveBeenCalled();
  });

  it('joins an active ADMIN to the shared admin room', async () => {
    const { gateway, jwt, prisma } = makeHarness();
    jwt.verify.mockReturnValue({ sub: 'user-1', role: 'ADMIN' });
    prisma.user.findUnique.mockResolvedValue({ isActive: true });
    const socket = makeSocket('valid-jwt');

    await gateway.handleConnection(socket);

    expect(socket.join).toHaveBeenCalledWith('admin');
  });

  it('joins an active DELIVERY rider only to their own delivery room', async () => {
    const { gateway, jwt, prisma } = makeHarness();
    jwt.verify.mockReturnValue({ sub: 'user-1', role: 'DELIVERY' });
    prisma.user.findUnique.mockResolvedValue({ isActive: true });
    prisma.deliveryPerson.findUnique.mockResolvedValue({ id: 'rider-1' });
    const socket = makeSocket('valid-jwt');

    await gateway.handleConnection(socket);

    expect(socket.join).toHaveBeenCalledWith('delivery:rider-1');
  });

  it('disconnects on an invalid/expired JWT rather than throwing unhandled', async () => {
    const { gateway, jwt } = makeHarness();
    jwt.verify.mockImplementation(() => {
      throw new Error('jwt expired');
    });
    const socket = makeSocket('expired-jwt');

    await expect(gateway.handleConnection(socket)).resolves.toBeUndefined();
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });
});

describe('OrdersGateway.emitOrderStatusUpdate', () => {
  it('broadcasts to the customer room and the admin room, and the rider room only when assigned', () => {
    const { gateway } = makeHarness();

    gateway.emitOrderStatusUpdate({ orderId: 'o1', orderNumber: 'PP1', status: 'READY', customerId: 'cust-1' });

    expect(gateway.server.to).toHaveBeenCalledWith('customer:cust-1');
    expect(gateway.server.to).toHaveBeenCalledWith('admin');
    expect(gateway.server.to).not.toHaveBeenCalledWith(expect.stringContaining('delivery:'));
  });

  it('also broadcasts to the rider room when a delivery person is assigned', () => {
    const { gateway } = makeHarness();

    gateway.emitOrderStatusUpdate({
      orderId: 'o1',
      orderNumber: 'PP1',
      status: 'OUT_FOR_DELIVERY',
      customerId: 'cust-1',
      deliveryPersonId: 'rider-1',
    });

    expect(gateway.server.to).toHaveBeenCalledWith('delivery:rider-1');
  });

  it('persists a notification for a status that has a message defined (READY)', async () => {
    const { gateway, prisma } = makeHarness();

    gateway.emitOrderStatusUpdate({ orderId: 'o1', orderNumber: 'PP1234', status: 'READY', customerId: 'cust-1' });
    await Promise.resolve(); // let the fire-and-forget promise settle

    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        customerId: 'cust-1',
        type: 'ORDER_UPDATE',
        title: 'Order #PP1234',
        orderId: 'o1',
      }),
    });
  });

  it('does not persist a notification for a status with no message defined (e.g. ASSIGNED, which the customer already sees as Ready)', async () => {
    const { gateway, prisma } = makeHarness();

    gateway.emitOrderStatusUpdate({ orderId: 'o1', orderNumber: 'PP1234', status: 'ASSIGNED', customerId: 'cust-1' });
    await Promise.resolve();

    expect(prisma.notification.create).not.toHaveBeenCalled();
  });

  it('never throws even if persisting the notification fails — the broadcast itself must not be affected', async () => {
    const { gateway, prisma } = makeHarness();
    prisma.notification.create.mockRejectedValue(new Error('db down'));

    expect(() =>
      gateway.emitOrderStatusUpdate({ orderId: 'o1', orderNumber: 'PP1234', status: 'DELIVERED', customerId: 'cust-1' }),
    ).not.toThrow();
  });
});

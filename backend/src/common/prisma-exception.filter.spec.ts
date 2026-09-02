import { Prisma } from '@prisma/client';
import { PrismaExceptionFilter } from './prisma-exception.filter';

function makeHost() {
  const reply = {
    status: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  };
  const host: any = {
    switchToHttp: () => ({ getResponse: () => reply }),
  };
  return { host, reply };
}

describe('PrismaExceptionFilter', () => {
  it('converts a P2025 "record not found" error into a clean 404', () => {
    const filter = new PrismaExceptionFilter();
    const { host, reply } = makeHost();
    const exception = new Prisma.PrismaClientKnownRequestError('No record found', {
      code: 'P2025',
      clientVersion: '5.22.0',
    } as any);

    filter.catch(exception, host);

    expect(reply.status).toHaveBeenCalledWith(404);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 404, error: 'Not Found' }),
    );
  });

  it('never leaks the raw Prisma error message to the client — a generic, safe message only', () => {
    const filter = new PrismaExceptionFilter();
    const { host, reply } = makeHost();
    const exception = new Prisma.PrismaClientKnownRequestError('Some internal Prisma detail', {
      code: 'P2025',
      clientVersion: '5.22.0',
    } as any);

    filter.catch(exception, host);

    const sentBody = reply.send.mock.calls[0][0];
    expect(sentBody.message).not.toContain('Some internal Prisma detail');
  });

  it('falls back to a generic 500 for a different Prisma error code — not every Prisma error is a "not found"', () => {
    const filter = new PrismaExceptionFilter();
    const { host, reply } = makeHost();
    const exception = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: '5.22.0',
    } as any);

    filter.catch(exception, host);

    expect(reply.status).toHaveBeenCalledWith(500);
  });
});

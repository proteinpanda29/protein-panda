import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { FastifyReply } from 'fastify';

/**
 * `findUniqueOrThrow`/`findFirstOrThrow` are used ~40 times across this
 * codebase specifically because the caller usually already knows the
 * record should exist (e.g. an id that was just looked up moments
 * earlier, or supplied by an authenticated user who owns it) — using
 * the OrThrow variant is a deliberate, correct choice in almost all of
 * those places, not a bug.
 *
 * But when a record genuinely doesn't exist (a stale id, a typo, a
 * record deleted between requests, or someone probing a URL with a
 * made-up id), the resulting Prisma error is not an HttpException, so
 * without this filter every one of those call sites would surface as a
 * raw, unhelpful `500 Internal Server Error` instead of a clean `404`.
 * This was found via a real HTTP integration test hitting a delivery
 * route with a nonexistent id — a mocked-Prisma unit test structurally
 * cannot catch this, since a mock never throws Prisma's actual error
 * class the way a real database driver does.
 *
 * Rather than adding a try/catch to all ~40 call sites individually
 * (easy to miss one, and any future *OrThrow call would repeat the same
 * mistake), this converts the error class itself, globally, once.
 */
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const reply = host.switchToHttp().getResponse<FastifyReply>();

    if (exception.code === 'P2025') {
      reply.status(404).send({
        statusCode: 404,
        message: 'The requested record was not found',
        error: 'Not Found',
      });
      return;
    }

    // Any other Prisma error (a unique-constraint violation slipping
    // through uncaught, etc.) isn't a "missing record" case — a generic
    // 500 is still the right, honest response for those.
    reply.status(500).send({ statusCode: 500, message: 'Internal server error' });
  }
}

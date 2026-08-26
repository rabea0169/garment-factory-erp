import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from './health.controller';
import { PrismaService } from '../prisma/prisma.service';
import { getMethodMetadata } from '../../test/helpers/method-metadata';

describe('HealthController', () => {
  let controller: HealthController;
  let queryRaw: jest.Mock;
  let prisma: PrismaService;

  beforeEach(() => {
    jest.clearAllMocks();
    queryRaw = jest.fn();
    prisma = { $queryRaw: queryRaw } as unknown as PrismaService;
    controller = new HealthController(prisma);
  });

  it('returns liveness without querying the database', () => {
    const callHealth = () => controller.health();
    expect(callHealth()).toMatchObject({ status: 'ok' });
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('returns readiness when PostgreSQL responds', async () => {
    queryRaw.mockResolvedValue([{ '?column?': 1 }]);

    const callReadiness = () => controller.readiness();
    await expect(callReadiness()).resolves.toMatchObject({
      status: 'ok',
      database: 'ok',
    });
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it('returns 503 when PostgreSQL is unavailable', async () => {
    queryRaw.mockRejectedValue(new Error('database down'));

    const callReadiness = () => controller.readiness();
    await expect(callReadiness()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('skips the default throttler for liveness and readiness probes', () => {
    expect(
      getMethodMetadata<boolean>(
        'THROTTLER:SKIPdefault',
        HealthController.prototype,
        'health',
      ),
    ).toBe(true);
    expect(
      getMethodMetadata<boolean>(
        'THROTTLER:SKIPdefault',
        HealthController.prototype,
        'readiness',
      ),
    ).toBe(true);
  });
});

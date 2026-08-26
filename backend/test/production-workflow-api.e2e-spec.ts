import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ProductionStage, UserRole } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ProductionWorkflowService as WorkflowService } from '../src/modules/production/production-workflow.service';

const E2E_TEST_SECRET = 'gf0013-api-test-secret-value-with-32-chars!!';
process.env.JWT_SECRET = process.env.JWT_SECRET ?? E2E_TEST_SECRET;
process.env.NODE_ENV = 'test';

const UUID = '123e4567-e89b-12d3-a456-426614174000';
const STAGE_RUN_UUID = '123e4567-e89b-12d3-a456-426614174001';
const RAW_MATERIAL_UUID = '123e4567-e89b-12d3-a456-426614174002';
const WAREHOUSE_UUID = '123e4567-e89b-12d3-a456-426614174003';

interface TestUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  password: string;
}

const users: TestUser[] = [
  {
    id: 'gf0013-production-manager',
    name: 'Production Manager',
    email: 'production-manager@test.local',
    role: UserRole.PRODUCTION_MANAGER,
    isActive: true,
    password: 'not-used',
  },
  {
    id: 'gf0013-inventory-manager',
    name: 'Inventory Manager',
    email: 'inventory-manager@test.local',
    role: UserRole.INVENTORY_MANAGER,
    isActive: true,
    password: 'not-used',
  },
  {
    id: 'gf0013-viewer',
    name: 'Viewer',
    email: 'viewer@test.local',
    role: UserRole.VIEWER,
    isActive: true,
    password: 'not-used',
  },
];

describe('GF-0013 production workflow HTTP API (e2e)', () => {
  let app: INestApplication<App>;
  let jwtService: JwtService;
  let workflowMock: {
    transitionStage: jest.Mock;
    recordStageOutput: jest.Mock;
    consumeMaterial: jest.Mock;
    finalizeCost: jest.Mock;
  };

  beforeAll(async () => {
    const prismaMock = {
      user: {
        findUnique: jest.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve(users.find((user) => user.id === where.id) ?? null),
        ),
      },
    };
    workflowMock = {
      transitionStage: jest.fn().mockResolvedValue({
        replayed: false,
        transitionId: UUID,
        workOrderId: UUID,
        fromStage: null,
        toStage: ProductionStage.CUTTING,
        stageRunId: STAGE_RUN_UUID,
        stageVersion: 1,
      }),
      recordStageOutput: jest.fn().mockResolvedValue(undefined),
      consumeMaterial: jest.fn().mockResolvedValue({
        replayed: false,
        consumptionId: UUID,
        workOrderId: UUID,
        stageRunId: STAGE_RUN_UUID,
        stockLedgerEntryId: RAW_MATERIAL_UUID,
        actualQuantity: 4,
        wasteQuantity: 1,
        unitCost: 5,
        totalCost: 20,
        wasteCost: 5,
      }),
      finalizeCost: jest.fn().mockResolvedValue({
        id: UUID,
        workOrderId: UUID,
        materialCost: 20,
      }),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .overrideProvider(WorkflowService)
      .useValue(workflowMock)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
    jwtService = app.get(JwtService, { strict: false });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  const tokenFor = (user: TestUser): string =>
    jwtService.sign({ sub: user.id, email: user.email, role: user.role });
  const productionToken = () => tokenFor(users[0]);
  const inventoryToken = () => tokenFor(users[1]);
  const viewerToken = () => tokenFor(users[2]);

  const transitionBody = () => ({
    toStage: ProductionStage.CUTTING,
    reason: 'بدء مرحلة القص',
  });

  const consumptionBody = () => ({
    stageRunId: STAGE_RUN_UUID,
    rawMaterialId: RAW_MATERIAL_UUID,
    warehouseId: WAREHOUSE_UUID,
    plannedQuantity: 3,
    actualQuantity: 4,
    wasteQuantity: 1,
    unit: 'METER',
  });

  it('يرفض الانتقال بلا JWT بـ 401', () =>
    request(app.getHttpServer())
      .post(`/production/work-orders/${UUID}/stage-transitions`)
      .send(transitionBody())
      .expect(401));

  it('يرفض الانتقال لدور VIEWER بـ 403', () =>
    request(app.getHttpServer())
      .post(`/production/work-orders/${UUID}/stage-transitions`)
      .set('Authorization', `Bearer ${viewerToken()}`)
      .send(transitionBody())
      .expect(403));

  it('يسمح للـ production manager ويمرر actor وIdempotency-Key', async () => {
    await request(app.getHttpServer())
      .post(`/production/work-orders/${UUID}/stage-transitions`)
      .set('Authorization', `Bearer ${productionToken()}`)
      .set('Idempotency-Key', 'http-transition-key-1')
      .send(transitionBody())
      .expect(201);

    expect(workflowMock.transitionStage).toHaveBeenCalledWith(
      {
        workOrderId: UUID,
        ...transitionBody(),
        idempotencyKey: 'http-transition-key-1',
      },
      users[0].id,
    );
  });

  it('يفرض UUID وDTO whitelist في مسار الانتقال بـ 400', async () => {
    await request(app.getHttpServer())
      .post('/production/work-orders/not-a-uuid/stage-transitions')
      .set('Authorization', `Bearer ${productionToken()}`)
      .send(transitionBody())
      .expect(400);

    await request(app.getHttpServer())
      .post(`/production/work-orders/${UUID}/stage-transitions`)
      .set('Authorization', `Bearer ${productionToken()}`)
      .send({ ...transitionBody(), actorId: 'forged-actor' })
      .expect(400);

    expect(workflowMock.transitionStage).not.toHaveBeenCalled();
  });

  it('يسمح للمخزون باستهلاك الخامة ويرفضه للـ VIEWER', async () => {
    await request(app.getHttpServer())
      .post(`/production/work-orders/${UUID}/material-consumptions`)
      .set('Authorization', `Bearer ${viewerToken()}`)
      .set('Idempotency-Key', 'http-consume-forbidden')
      .send(consumptionBody())
      .expect(403);

    await request(app.getHttpServer())
      .post(`/production/work-orders/${UUID}/material-consumptions`)
      .set('Authorization', `Bearer ${inventoryToken()}`)
      .set('Idempotency-Key', 'http-consume-key-1')
      .send(consumptionBody())
      .expect(201);

    expect(workflowMock.consumeMaterial).toHaveBeenCalledWith(
      {
        workOrderId: UUID,
        ...consumptionBody(),
        idempotencyKey: 'http-consume-key-1',
      },
      users[1].id,
    );
  });

  it('يطبق validation للكميات وenum قبل استدعاء الخدمة بـ 400', async () => {
    await request(app.getHttpServer())
      .post(`/production/work-orders/${UUID}/stage-output`)
      .set('Authorization', `Bearer ${productionToken()}`)
      .send({
        stage: 'INVALID_STAGE',
        inputQty: 0,
        acceptedQty: -1,
        rejectedQty: 0,
        wasteQty: 0,
      })
      .expect(400);

    await request(app.getHttpServer())
      .post(`/production/work-orders/${UUID}/material-consumptions`)
      .set('Authorization', `Bearer ${inventoryToken()}`)
      .send({ ...consumptionBody(), actualQuantity: -1 })
      .expect(400);

    expect(workflowMock.recordStageOutput).not.toHaveBeenCalled();
    expect(workflowMock.consumeMaterial).not.toHaveBeenCalled();
  });

  it('يسجل output ويثبت التكلفة للأدوار المصرح لها', async () => {
    await request(app.getHttpServer())
      .post(`/production/work-orders/${UUID}/stage-output`)
      .set('Authorization', `Bearer ${productionToken()}`)
      .send({
        stage: ProductionStage.CUTTING,
        inputQty: 10,
        acceptedQty: 8,
        rejectedQty: 1,
        wasteQty: 1,
      })
      .expect(201)
      .expect({
        workOrderId: UUID,
        stage: ProductionStage.CUTTING,
        status: 'COMPLETED',
      });

    await request(app.getHttpServer())
      .post(`/production/work-orders/${UUID}/cost/finalize`)
      .set('Authorization', `Bearer ${productionToken()}`)
      .expect(201);

    expect(workflowMock.recordStageOutput).toHaveBeenCalledWith(
      {
        workOrderId: UUID,
        stage: ProductionStage.CUTTING,
        inputQty: 10,
        acceptedQty: 8,
        rejectedQty: 1,
        wasteQty: 1,
      },
      users[0].id,
    );
    expect(workflowMock.finalizeCost).toHaveBeenCalledWith(UUID, users[0].id);
  });
});

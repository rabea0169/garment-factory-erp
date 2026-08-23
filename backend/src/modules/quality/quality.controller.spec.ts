import { Test, TestingModule } from '@nestjs/testing';
import { QualityController } from './quality.controller';

describe('QualityController', () => {
  let controller: QualityController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [QualityController],
    }).compile();

    controller = module.get<QualityController>(QualityController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});

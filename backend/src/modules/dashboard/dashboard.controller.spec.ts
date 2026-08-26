import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

describe('DashboardController (GF-REMAINING-004)', () => {
  it('يمرر مرشح الفترة إلى DashboardService', async () => {
    const dashboardService = {
      getStats: jest.fn().mockResolvedValue({ inventory: {} }),
    };
    const controller = new DashboardController(
      dashboardService as unknown as DashboardService,
    );
    const query = {
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-08-26T23:59:59.999Z',
    };

    await controller.getStats(query);

    expect(dashboardService.getStats).toHaveBeenCalledWith(query);
  });
});

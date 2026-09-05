import { BadRequestException } from '@nestjs/common';
import { CampaignsService } from './campaigns.service';

function makeHarness() {
  const prisma: any = { campaign: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn().mockResolvedValue({}) } };
  const segments = { getSegment: jest.fn().mockResolvedValue([]) } as any;
  const notifications = { notifyCustomer: jest.fn().mockResolvedValue(undefined) } as any;
  const service = new CampaignsService(prisma, segments, notifications);
  return { service, prisma, segments, notifications };
}

describe('CampaignsService.sendCampaign', () => {
  it('rejects a campaign with no title', async () => {
    const { service } = makeHarness();
    await expect(
      service.sendCampaign('user-1', { name: 'Win-back', segmentType: 'LAPSED_30_DAYS', title: '', body: 'Come back!' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a campaign with no body', async () => {
    const { service } = makeHarness();
    await expect(
      service.sendCampaign('user-1', { name: 'Win-back', segmentType: 'LAPSED_30_DAYS', title: 'We miss you', body: '' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('recomputes the segment fresh and sends a real notification to every customer currently in it', async () => {
    const { service, segments, notifications } = makeHarness();
    segments.getSegment.mockResolvedValue([{ id: 'cust-1', name: 'Ravi' }, { id: 'cust-2', name: 'Priya' }]);

    await service.sendCampaign('user-1', { name: 'Win-back', segmentType: 'LAPSED_30_DAYS', title: 'We miss you', body: 'Come back for 20% off' });

    expect(notifications.notifyCustomer).toHaveBeenCalledTimes(2);
    expect(notifications.notifyCustomer).toHaveBeenCalledWith('cust-1', 'ANNOUNCEMENT', 'We miss you', 'Come back for 20% off');
    expect(notifications.notifyCustomer).toHaveBeenCalledWith('cust-2', 'ANNOUNCEMENT', 'We miss you', 'Come back for 20% off');
  });

  it('records the real recipient count and who sent it', async () => {
    const { service, prisma, segments } = makeHarness();
    segments.getSegment.mockResolvedValue([{ id: 'cust-1', name: 'Ravi' }, { id: 'cust-2', name: 'Priya' }, { id: 'cust-3', name: 'Amit' }]);

    await service.sendCampaign('user-1', { name: 'Win-back', segmentType: 'LAPSED_30_DAYS', title: 'We miss you', body: 'Come back!' });

    expect(prisma.campaign.create).toHaveBeenCalledWith({
      data: {
        name: 'Win-back',
        segmentType: 'LAPSED_30_DAYS',
        title: 'We miss you',
        body: 'Come back!',
        recipientCount: 3,
        sentByUserId: 'user-1',
      },
    });
  });

  it('still records the campaign with recipientCount 0 when the segment is currently empty — a real, honest outcome, not an error', async () => {
    const { service, prisma, segments, notifications } = makeHarness();
    segments.getSegment.mockResolvedValue([]);

    await service.sendCampaign('user-1', { name: 'Win-back', segmentType: 'LAPSED_30_DAYS', title: 'We miss you', body: 'Come back!' });

    expect(notifications.notifyCustomer).not.toHaveBeenCalled();
    expect(prisma.campaign.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ recipientCount: 0 }) }));
  });
});

describe('CampaignsService.listCampaigns', () => {
  it('returns the most recent campaigns first', async () => {
    const { service, prisma } = makeHarness();

    await service.listCampaigns();

    expect(prisma.campaign.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { sentAt: 'desc' } }));
  });
});

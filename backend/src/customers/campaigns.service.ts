import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { SegmentsService, SegmentType } from '../customers/segments.service';
import { NotificationCenterService } from '../notification-center/notification-center.service';

@Injectable()
export class CampaignsService {
  constructor(
    private prisma: PrismaService,
    private segments: SegmentsService,
    private notifications: NotificationCenterService,
  ) {}

  async listCampaigns() {
    return this.prisma.campaign.findMany({
      orderBy: { sentAt: 'desc' },
      include: { sentByUser: { select: { staff: { select: { name: true } } } } },
    });
  }

  /**
   * Recomputes the segment fresh right now (never a stale cached
   * list — same guarantee SegmentsService itself gives), sends a real
   * notification to every customer currently in it, and records what
   * was actually sent and to how many people. A segment with zero
   * current members is a real, valid outcome (nobody to send to right
   * now), not an error — the campaign still gets recorded with
   * recipientCount: 0 so there's an honest record of the attempt.
   */
  async sendCampaign(userId: string, input: { name: string; segmentType: SegmentType; title: string; body: string }) {
    if (!input.title?.trim() || !input.body?.trim()) {
      throw new BadRequestException('A campaign needs both a title and a body');
    }

    const recipients = await this.segments.getSegment(input.segmentType);

    await Promise.all(
      recipients.map((customer: { id: string }) =>
        this.notifications.notifyCustomer(customer.id, 'ANNOUNCEMENT', input.title, input.body),
      ),
    );

    return this.prisma.campaign.create({
      data: {
        name: input.name,
        segmentType: input.segmentType,
        title: input.title,
        body: input.body,
        recipientCount: recipients.length,
        sentByUserId: userId,
      },
    });
  }
}

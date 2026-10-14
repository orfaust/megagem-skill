// Worker events are delivered as user-role follow-ups immediately in every mode.
// No banner or terminal-key interception: completion still needs coordinator verification.
type NoticeJob = { id: string; state?: string; [key: string]: unknown };

export function createImmediateDelivery({ publish }: { publish: (job: NoticeJob) => void }) {
  return {
    deliver(job: NoticeJob): void {
      // No async lookup, pending jobs or input hook can hold feedback hostage.
      publish(job);
    },
  };
}

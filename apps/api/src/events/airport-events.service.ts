import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Subject } from 'rxjs';
import type { DeskTopic } from '@alx/contracts';

/** At ~10 feed messages/s, browsers get each changed topic at most this often. */
const FLUSH_MS = 500;

/** Which desk topics changed, coalesced so a burst of changes is one push per topic. */
@Injectable()
export class AirportEventsService implements OnModuleDestroy {
  private readonly subject = new Subject<DeskTopic>();
  private readonly pending = new Set<DeskTopic>();
  private readonly timer = setInterval(() => this.flush(), FLUSH_MS);
  readonly changes$ = this.subject.asObservable();

  /** Mark desk topics as changed; each is pushed at the next flush. */
  changed(...topics: DeskTopic[]): void {
    for (const topic of topics) this.pending.add(topic);
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  private flush(): void {
    for (const topic of this.pending) this.subject.next(topic);
    this.pending.clear();
  }
}

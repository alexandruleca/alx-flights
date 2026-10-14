import { Injectable } from '@nestjs/common';
import { AnomalyLog } from '../domain/anomalies';
import { AirportState } from '../domain/state';

/** The process's airport state: the truth ingest builds, or the API's mirror of it. */
@Injectable()
export class AirportStateService {
  readonly state = new AirportState();
  /** API only: recent normalizer rejects, for the desk's anomaly tape. */
  readonly anomalies = new AnomalyLog();
}

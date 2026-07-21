import type { CdpConnection } from './connection.js';

export interface ReportingReport {
  id: string;
  type: string;
  url: string;
  status: string;
  timestamp: number;
  body: string;
}

export interface ReportingEndpoint {
  url: string;
  groupName: string;
}

export class ReportingStore {
  private reports = new Map<string, ReportingReport>();
  private endpoints: ReportingEndpoint[] = [];

  handleEvent(method: string, params: any): boolean {
    if (method === 'Network.reportingApiReportAdded' || method === 'Network.reportingApiReportUpdated') {
      const r = params?.report;
      if (r?.id) {
        this.reports.set(r.id, {
          id: r.id,
          type: r.type ?? '',
          url: r.url ?? '',
          status: r.status ?? '',
          timestamp: typeof r.timestamp === 'number' ? r.timestamp : 0,
          body: r.body !== undefined ? JSON.stringify(r.body, null, 2) : '',
        });
      }
      return true;
    }
    if (method === 'Network.reportingApiEndpointsChangedForOrigin') {
      this.endpoints = (params?.endpoints ?? []).map((e: any) => ({
        url: e.url ?? '',
        groupName: e.groupName ?? '',
      }));
      return true;
    }
    return false;
  }

  reportList(): ReportingReport[] {
    return [...this.reports.values()];
  }

  endpointList(): ReportingEndpoint[] {
    return [...this.endpoints];
  }

  clear(): void {
    this.reports.clear();
    this.endpoints = [];
  }
}

export async function enableReportingApi(conn: CdpConnection, enable: boolean): Promise<void> {
  await conn.send('Network.enableReportingApi', { enable });
}

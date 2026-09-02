// work-data API 저장소 — 기존 ApiClient(core/api/client) 와 세션의 authorized 실행기를
// 재사용해 인증 요청을 만든다. 백엔드 계약: backend/app/api/v1/{workplaces,
// work_schedules,attendance_records}.py (Bearer 인증, 201/200 멱등, 204 삭제).
//
// 보안: 토큰/바디를 로그로 남기지 않는다(client.ts 가 이미 redaction). Base URL 은
// core/api/config 가 결정 — 기본값은 Preview, 운영 빌드는 EXPO_PUBLIC_API_BASE_URL.
import type { ApiClient } from '../../core/api/client';
import type { WorkDataRemote } from './engine';
import type { WireAttendance, WireSchedule, WireWorkplace } from './mappers';

/** 인증 요청 실행기 — session.runAuthorized 를 그대로 주입받는다(single-flight refresh 재사용). */
export type AuthorizedRunner = <T>(run: (accessToken: string) => Promise<T>) => Promise<T>;

// 목록 페이지네이션: limit 상한(200)까지 채워지면 다음 페이지를 이어 받는다.
const PAGE_LIMIT = 200;
const MAX_PAGES = 100; // 안전장치(최대 20,000건)

async function listAll<T>(
  authorized: AuthorizedRunner,
  client: ApiClient,
  basePath: string
): Promise<T[]> {
  const out: T[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const offset = page * PAGE_LIMIT;
    const path = `${basePath}?limit=${PAGE_LIMIT}&offset=${offset}`;
    const batch = await authorized((token) =>
      client.request<T[]>(path, { accessToken: token })
    );
    out.push(...batch);
    if (batch.length < PAGE_LIMIT) break;
  }
  return out;
}

export function createWorkDataRemote(
  client: ApiClient,
  authorized: AuthorizedRunner
): WorkDataRemote {
  const create = <W>(basePath: string, body: Record<string, unknown>): Promise<W> =>
    authorized((token) =>
      client.request<W>(basePath, { method: 'POST', body, accessToken: token })
    );
  const update = <W>(basePath: string, serverId: string, body: Record<string, unknown>): Promise<W> =>
    authorized((token) =>
      client.request<W>(`${basePath}/${serverId}`, {
        method: 'PATCH',
        body,
        accessToken: token,
      })
    );
  const remove = (basePath: string, serverId: string): Promise<void> =>
    authorized((token) =>
      client.request<void>(`${basePath}/${serverId}`, {
        method: 'DELETE',
        accessToken: token,
        expectNoContent: true,
      })
    );

  const WP = '/workplaces';
  const SCH = '/work-schedules';
  const ATT = '/attendance-records';

  return {
    createWorkplace: (b) => create<WireWorkplace>(WP, b),
    updateWorkplace: (id, b) => update<WireWorkplace>(WP, id, b),
    deleteWorkplace: (id) => remove(WP, id),
    listWorkplaces: () => listAll<WireWorkplace>(authorized, client, WP),
    createSchedule: (b) => create<WireSchedule>(SCH, b),
    updateSchedule: (id, b) => update<WireSchedule>(SCH, id, b),
    deleteSchedule: (id) => remove(SCH, id),
    listSchedules: () => listAll<WireSchedule>(authorized, client, SCH),
    createAttendance: (b) => create<WireAttendance>(ATT, b),
    updateAttendance: (id, b) => update<WireAttendance>(ATT, id, b),
    deleteAttendance: (id) => remove(ATT, id),
    listAttendance: () => listAll<WireAttendance>(authorized, client, ATT),
  };
}

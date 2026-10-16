import { apiFetch } from './api';

export interface JarvisPriority {
  id: number;
  date: string;
  rank: number;
  title: string;
  category: string;
  starter_step: string;
  completed: boolean;
}

export interface JarvisScheduleBlock {
  id: number;
  date: string;
  day_of_week: string;
  start_time: string;
  end_time: string;
  category: string;
  title: string;
  notes: string;
  completed: boolean;
}

export interface JarvisCheckinEntry {
  id: number;
  date: string;
  timestamp: number;
  status: string;
  summary: string;
  jarvis_pushback: string;
}

export interface JarvisAccountabilityStats {
  date: string;
  streak_days: number;
  completion_rate: number;
  today_completion_rate: number;
  completed_today: number;
  total_today: number;
  completed_all_time: number;
  total_all_time: number;
  nudge: string;
  recent_checkins: JarvisCheckinEntry[];
}

export interface JarvisSettings {
  codeact_enabled: boolean;
  cloud_fallback_enabled: boolean;
  voice_enabled: boolean;
  soul_prompt: string;
  soul_path: string;
}

export interface JarvisOverview {
  date: string;
  priorities: JarvisPriority[];
  schedule_today: JarvisScheduleBlock[];
  accountability: JarvisAccountabilityStats;
  briefing_text: string;
  settings: JarvisSettings;
  runtime: {
    model: string;
    engine: string;
    is_local: boolean;
    leaves_device_warning: string;
  };
}

export interface JarvisMemoryItem {
  id: string;
  content: string;
  source: string;
  score?: number;
  created_at?: number;
}

async function parseJsonOrThrow<T>(res: Response, fallbackMsg: string): Promise<T> {
  if (!res.ok) {
    let detail = fallbackMsg;
    try {
      const body = await res.json();
      if (body?.detail) detail = String(body.detail);
    } catch {
      // ignore json parse error
    }
    throw new Error(`${detail} (HTTP ${res.status})`);
  }
  return res.json() as Promise<T>;
}

export async function fetchJarvisOverview(dateStr?: string): Promise<JarvisOverview> {
  const qs = dateStr ? `?date=${encodeURIComponent(dateStr)}` : '';
  const res = await apiFetch(`/api/jarvis/overview${qs}`);
  return parseJsonOrThrow<JarvisOverview>(
    res,
    'Could not load today’s priorities and schedule from the local Jarvis server',
  );
}

export async function saveJarvisPriorities(
  priorities: Array<{ title: string; category?: string; starter_step?: string; completed?: boolean }>,
  dateStr?: string,
): Promise<{ priorities: JarvisPriority[] }> {
  const res = await apiFetch('/api/jarvis/priorities', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date: dateStr, priorities }),
  });
  return parseJsonOrThrow(res, 'Could not save today’s priorities');
}

export async function toggleJarvisPriority(
  priorityId: number,
  completed?: boolean,
): Promise<{ priority: JarvisPriority; accountability: JarvisAccountabilityStats }> {
  const res = await apiFetch(`/api/jarvis/priorities/${priorityId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ completed }),
  });
  return parseJsonOrThrow(res, 'Could not update priority status');
}

export async function fetchJarvisSchedule(params?: {
  date?: string;
  month?: string;
}): Promise<{ blocks: JarvisScheduleBlock[] }> {
  const search = new URLSearchParams();
  if (params?.date) search.set('date', params.date);
  if (params?.month) search.set('month', params.month);
  const qs = search.toString() ? `?${search.toString()}` : '';
  const res = await apiFetch(`/api/jarvis/schedule${qs}`);
  return parseJsonOrThrow(res, 'Could not load your schedule');
}

export async function importJarvisScheduleText(
  text: string,
  defaultDate?: string,
): Promise<{ added: number; blocks: JarvisScheduleBlock[] }> {
  const res = await apiFetch('/api/jarvis/schedule/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, date: defaultDate }),
  });
  return parseJsonOrThrow(res, 'Could not import schedule text');
}

export async function toggleJarvisScheduleBlock(
  blockId: number,
  completed?: boolean,
): Promise<{ block: JarvisScheduleBlock; accountability: JarvisAccountabilityStats }> {
  const res = await apiFetch(`/api/jarvis/schedule/${blockId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ completed }),
  });
  return parseJsonOrThrow(res, 'Could not update schedule block');
}

export async function deleteJarvisScheduleBlock(blockId: number): Promise<{ deleted: boolean }> {
  const res = await apiFetch(`/api/jarvis/schedule/${blockId}`, {
    method: 'DELETE',
  });
  return parseJsonOrThrow(res, 'Could not delete schedule block');
}

export async function fetchJarvisBriefing(dateStr?: string): Promise<{
  date: string;
  day_label: string;
  text: string;
  priorities: JarvisPriority[];
  schedule: JarvisScheduleBlock[];
  accountability: JarvisAccountabilityStats;
}> {
  const qs = dateStr ? `?date=${encodeURIComponent(dateStr)}` : '';
  const res = await apiFetch(`/api/jarvis/briefing${qs}`);
  return parseJsonOrThrow(res, 'Could not generate daily briefing');
}

export async function submitJarvisCheckin(payload: {
  status: string;
  summary: string;
  date?: string;
}): Promise<{
  id: number;
  date: string;
  status: string;
  summary: string;
  jarvis_pushback: string;
  stats: JarvisAccountabilityStats;
}> {
  const res = await apiFetch('/api/jarvis/checkin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow(res, 'Could not record accountability check-in');
}

export async function fetchJarvisMemory(query = ''): Promise<{ items: JarvisMemoryItem[]; count: number }> {
  const qs = query ? `?query=${encodeURIComponent(query)}` : '';
  const res = await apiFetch(`/api/jarvis/memory${qs}`);
  return parseJsonOrThrow(res, 'Could not read long-term memory');
}

export async function storeJarvisMemory(content: string, source = 'user_note'): Promise<JarvisMemoryItem> {
  const res = await apiFetch('/api/jarvis/memory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, source }),
  });
  return parseJsonOrThrow(res, 'Could not store memory note');
}

export async function deleteJarvisMemory(docId: string): Promise<{ deleted: boolean }> {
  const res = await apiFetch(`/api/jarvis/memory/${encodeURIComponent(docId)}`, {
    method: 'DELETE',
  });
  return parseJsonOrThrow(res, 'Could not delete memory item');
}

export async function updateJarvisSettings(
  payload: Partial<{
    codeact_enabled: boolean;
    cloud_fallback_enabled: boolean;
    voice_enabled: boolean;
    soul_prompt: string;
  }>,
): Promise<JarvisSettings> {
  const res = await apiFetch('/api/jarvis/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow(res, 'Could not save Jarvis settings');
}

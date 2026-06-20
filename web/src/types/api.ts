import type { JobQuality } from '../lib/analysisQuality';

export type JobSummary = {
  id: string;
  title: string;
  status: string;
  progress: number;
  processed_links: number;
  total_links: number;
  created_at: string;
  updated_at: string;
  duration?: number | null;
};

export type JobDetail = {
  id: string;
  title: string;
  status: string;
  progress: number;
  processed_links: number;
  total_links: number;
  prompt?: string | null;
  created_at: string;
  updated_at: string;
  duration?: number | null;
  error_message?: string | null;
  matter_id?: string | null;
  quality?: JobQuality | null;
};

export type LinkInfo = {
  url: string;
  status: string;
  decision_date?: string | null;
  evidence_snippet?: string | null;
};

export type ChatMessage = {
  role: 'user' | 'ai';
  content: string;
};

export type StatusResponse = JobDetail & {
  links?: LinkInfo[];
};

export type ChatResponse = ChatMessage[];

export type Matter = {
  id: string;
  title: string;
  description?: string | null;
  client_name?: string | null;
  tags?: string[] | null;
  created_at?: string | null;
};

export type MatterJob = {
  id: string;
  title: string;
  status: string;
  created_at: string;
  updated_at: string;
};

export type MattersListResponse = {
  success: boolean;
  matters: { id: string; title: string }[];
};

export type MatterResponse = {
  success: boolean;
  matter: Matter;
  jobs: MatterJob[];
};

export type ShareLink = {
  id: string;
  job_id: string;
  title?: string | null;
  share_url?: string | null;
  created_at: string;
  expires_at?: string | null;
  revoked_at?: string | null;
  created_by?: string | null;
};

export type ShareLinksResponse = {
  success: boolean;
  links: ShareLink[];
};

export type ShareStatus = 'active' | 'expired' | 'revoked';

export type OverviewRecent = {
  id: string;
  status: string;
  progress: number;
  total_links: number;
  processed_links: number;
  created_at: string;
  updated_at: string;
  title: string;
  matter_id?: string | null;
};

export type Overview = {
  total: number;
  statusCounts: Record<string, number>;
  thisWeek: number;
  today: number;
  byMatter: { matter_id: string; count: number }[];
  recent: OverviewRecent[];
};

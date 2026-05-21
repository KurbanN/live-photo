export type EventStatus = 'draft' | 'active' | 'ended' | 'archived';
export type EventPlan = 'lite' | 'party' | 'premium';
export type PhotoStatus = 'pending' | 'approved' | 'rejected';

export type EventSettings = {
  welcomeTitle?: string;
  welcomeSubtitle?: string;
  loginBgUrl?: string;
  headerSubtitle?: string;
};

export type EventRow = {
  id: string;
  slug: string;
  organizer_id: string | null;
  title: string;
  pin_hash: string | null;
  pin_enabled: boolean;
  status: EventStatus;
  plan: EventPlan;
  photo_limit: number;
  moderation_enabled: boolean;
  starts_at: string | null;
  ends_at: string | null;
  settings: EventSettings;
  created_at: string;
  updated_at: string;
};

export type PhotoRow = {
  id: string;
  event_id: string | null;
  storage_path: string;
  created_at: string;
  author: string | null;
  status: PhotoStatus;
};

export type PhotoEntry = {
  id: string;
  url: string;
  createdAt: string;
  author?: string;
  status?: PhotoStatus;
};

export const PLAN_LIMITS: Record<EventPlan, { photoLimit: number; moderation: boolean }> = {
  lite: { photoLimit: 300, moderation: false },
  party: { photoLimit: 2000, moderation: true },
  premium: { photoLimit: 5000, moderation: true },
};

export interface YouTubeVideo {
  id: string;
  title: string;
  channelId: string;
  channelName: string;
  channelAvatarUrl: string;
  thumbnailUrl: string;
  durationSeconds: number;
  ageText: string;
}

export interface YouTubeHomeRow {
  id: 'trending' | 'gaming' | 'music';
  title: string;
  videos: YouTubeVideo[];
}

export interface YouTubeHomePayload {
  fetchedAt: number;
  source: string;
  rows: YouTubeHomeRow[];
}

export interface YouTubeSubscription {
  channelId: string;
  name: string;
  avatarUrl: string;
}

export interface YouTubeSubscriptionFeedPayload {
  channelIds: string[];
  fetchedAt: number;
  source: string;
  videos: YouTubeVideo[];
}

export interface DirectStream {
  videoUrl: string;
  videoMimeType?: string;
  audioUrl?: string;
  audioMimeType?: string;
  width?: number;
  height?: number;
  source: string;
}

export type SponsorBlockCategory =
  | 'sponsor'
  | 'selfpromo'
  | 'interaction'
  | 'intro'
  | 'outro'
  | 'music_offtopic';

export type SponsorBlockSettings = Record<SponsorBlockCategory, boolean>;

export interface SponsorBlockSegment {
  category: SponsorBlockCategory;
  start: number;
  end: number;
}

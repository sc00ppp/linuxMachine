export interface YouTubeVideo {
  id: string;
  title: string;
  channelName: string;
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

export interface DirectStream {
  url: string;
  mimeType?: string;
}

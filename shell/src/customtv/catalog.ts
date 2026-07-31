export interface CustomTvCategory {
  id: string;
  display_name: string;
  video_count: number;
}

export interface CustomTvVideo {
  id: string;
  category: string;
  title: string;
  filename: string;
  url: string;
  size_bytes: number;
  extension: string;
  duration_seconds: number | null;
  downloaded_at: string | null;
}

export interface CustomTvCatalog {
  generated_at: string | null;
  categories: CustomTvCategory[];
  videos: CustomTvVideo[];
  mismatches: {
    completed_rows_missing_files: number;
    disk_videos_without_completed_row: number;
  };
}

/* Keep a fresh clone buildable before its owner runs the personal importer. */
const generatedModules = import.meta.glob<unknown>(
  '/src/core/customtv.generated.json',
  { eager: true, import: 'default' },
);
const generated = Object.values(generatedModules)[0];

function isCatalog(value: unknown): value is CustomTvCatalog {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<CustomTvCatalog>;
  return Array.isArray(candidate.categories) && Array.isArray(candidate.videos);
}

const emptyCatalog: CustomTvCatalog = {
  generated_at: null,
  categories: [],
  videos: [],
  mismatches: {
    completed_rows_missing_files: 0,
    disk_videos_without_completed_row: 0,
  },
};

export const customTvCatalog: Readonly<CustomTvCatalog> = isCatalog(generated)
  ? generated
  : emptyCatalog;

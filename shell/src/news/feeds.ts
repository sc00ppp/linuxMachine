/**
 * The channel lineup lives in one small file on purpose. Keep the identifiers
 * stable (they are used for localStorage cache keys), but labels, sources, and
 * RSS URLs can be changed without touching the channel UI or parser.
 */
export interface NewsFeedDefinition {
  id: string;
  label: string;
  source: string;
  url: string;
}

export const NEWS_FEEDS = [
  {
    id: 'world',
    label: 'World',
    source: 'BBC News',
    url: 'https://feeds.bbci.co.uk/news/world/rss.xml',
  },
  {
    id: 'technology',
    label: 'Technology',
    source: 'The Verge',
    url: 'https://www.theverge.com/rss/index.xml',
  },
  {
    id: 'science',
    label: 'Science',
    source: 'NASA Science',
    url: 'https://science.nasa.gov/feed/',
  },
  {
    id: 'gaming',
    label: 'Gaming',
    source: 'Polygon',
    url: 'https://www.polygon.com/rss/index.xml',
  },
] as const satisfies readonly NewsFeedDefinition[];

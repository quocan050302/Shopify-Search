/**
 * SWAI V11 — MetaAdsCollector MCP Protocol Types & Schemas
 */

export interface MetaCollectorCapabilities {
  extension_version: string;
  collector_version: string;
  transport: string;
  persistent_worker_alive: boolean;
  operations: string[];
  supported: {
    ad_types: string[];
    statuses: string[];
    search_types: string[];
    sort_modes: (string | null)[];
    export_formats: string[];
    fields: string[];
    events: string[];
  };
  limits: {
    default_batch: number;
    maximum_batch: number;
    maximum_meta_page: number;
    max_concurrency: number;
    maximum_response_bytes: number;
    maximum_ad_batch: number;
  };
}

export interface MetaCollectorCreativeRaw {
  body?: string | null;
  caption?: string | null;
  description?: string | null;
  title?: string | null;
  link_url?: string | null;
  image_url?: string | null;
  video_url?: string | null;
  video_hd_url?: string | null;
  video_sd_url?: string | null;
  thumbnail_url?: string | null;
  cta_text?: string | null;
  cta_type?: string | null;
  original_image_url?: string | null;
  resized_image_url?: string | null;
  watermarked_image_url?: string | null;
  watermarked_video_hd_url?: string | null;
  watermarked_video_sd_url?: string | null;
}

export interface MetaCollectorPageRaw {
  id: string;
  name: string;
  profile_picture_url?: string | null;
  page_url?: string | null;
  likes?: number | null;
  verified?: boolean;
  category?: string | null;
}

export interface MetaCollectorRawAd {
  id: string; // Meta Library ID
  source_url?: string;
  collected_at?: string;
  page?: MetaCollectorPageRaw | null;
  creatives?: MetaCollectorCreativeRaw[];
  creative_count?: number;
  start_date?: string | null;
  end_date?: string | null;
  is_active?: boolean;
  publisher_platforms?: string[];
  currency?: string | null;
  spend?: {
    lower_bound?: number | null;
    upper_bound?: number | null;
    currency?: string | null;
  } | null;
  impressions?: {
    lower_bound?: number | null;
    upper_bound?: number | null;
  } | null;
  targeting?: {
    age_min?: number | null;
    age_max?: number | null;
    genders?: string[];
    locations?: string[];
  } | null;
  ad_type?: string | null;
  categories?: string[];
  delivery_start_time?: string | null;
  delivery_stop_time?: string | null;
}

export interface MetaCollectorJobState {
  id: string;
  state: "QUEUED" | "RUNNING" | "PAUSED" | "COMPLETED" | "FAILED" | "CANCELLED" | string;
  count: number;
  stats?: Record<string, unknown>;
  error?: {
    code: string;
    message: string;
    retryable?: boolean;
  } | null;
  created?: string;
  updated?: string;
}

export interface MetaCollectorSearchResponse {
  result_set_id: string;
  job: MetaCollectorJobState;
  ads: MetaCollectorRawAd[];
  next_offset?: number | null;
  continuation?: string | null;
  retrieval_pending: boolean;
  data_status: "partial" | "query_exhausted" | string;
  untrusted_ad_content: boolean;
}

export interface MetaCollectorStoredResults {
  result_set_id: string;
  job: MetaCollectorJobState;
  ads: MetaCollectorRawAd[];
  next_offset?: number | null;
  continuation?: string | null;
  retrieval_pending: boolean;
  data_status: string;
}

export interface MetaCollectorInspectedAd {
  id: string;
  ad: MetaCollectorRawAd;
  media_downloaded?: boolean;
  media_paths?: string[];
}

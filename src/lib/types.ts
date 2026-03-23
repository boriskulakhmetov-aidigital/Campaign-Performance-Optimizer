/* ── CPO Domain Types ─────────────────────────────────────────────── */

// ── Enums / Unions ──────────────────────────────────────────────────

export type Platform =
  | 'google_search'
  | 'google_display'
  | 'google_pmax'
  | 'meta'
  | 'tiktok'
  | 'linkedin'
  | 'dv360'
  | 'other';

export type CampaignStatus = 'planned' | 'active' | 'analyzed' | 'optimized';

export type AdFormat = 'rsa' | 'eta' | 'image' | 'video' | 'carousel' | 'other';

export type VariationStatus = 'pending' | 'approved' | 'rejected' | 'testing' | 'graduated';

export type ChangeType = 'headline' | 'description' | 'both' | 'cta';

export type Technique =
  | 'added_numbers'
  | 'benefit_first'
  | 'urgency'
  | 'social_proof'
  | 'question_hook'
  | 'specificity'
  | 'shorter'
  | 'longer'
  | 'emotional'
  | 'keyword_loaded'
  | 'power_words'
  | 'negative_framing'
  | 'comparison';

// ── Core Entities ───────────────────────────────────────────────────

export interface CpoCampaign {
  id: string;
  session_id: string;
  user_id: string;
  name: string;
  platform: Platform;
  objective: string | null;
  vertical: string | null;
  audience_type: string | null;
  status: CampaignStatus;
  budget_total: number | null;
  budget_daily: number | null;
  currency: string;
  date_start: string | null;
  date_end: string | null;
  meta: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CpoAd {
  id: string;
  campaign_id: string;
  user_id: string;
  ad_group: string | null;
  ad_format: AdFormat;
  headline: string | null;
  description: string | null;
  display_url: string | null;
  final_url: string | null;
  // metrics
  impressions: number;
  clicks: number;
  conversions: number;
  spend: number;
  revenue: number;
  // computed (GENERATED ALWAYS)
  ctr: number;
  cpc: number;
  cvr: number;
  roas: number;
  // scoring
  score: number | null;
  score_reasons: ScoreReason[] | null;
  is_underperformer: boolean;
  created_at: string;
  updated_at: string;
}

export interface ScoreReason {
  metric: string;
  value: number;
  benchmark: number;
  verdict: 'below' | 'at' | 'above';
}

export interface CpoVariation {
  id: string;
  ad_id: string;
  campaign_id: string;
  user_id: string;
  change_type: ChangeType;
  headline: string | null;
  description: string | null;
  techniques: Technique[];
  rationale: string | null;
  status: VariationStatus;
  // post-testing metrics
  impressions: number;
  clicks: number;
  conversions: number;
  spend: number;
  revenue: number;
  ctr: number;
  cpc: number;
  cvr: number;
  roas: number;
  created_at: string;
  updated_at: string;
}

export interface CpoLearning {
  id: string;
  variation_id: string | null;
  user_id: string;
  platform: Platform;
  vertical: string | null;
  objective: string | null;
  audience_type: string | null;
  ad_format: AdFormat | null;
  change_type: ChangeType;
  techniques: Technique[];
  // baseline
  baseline_impressions: number;
  baseline_clicks: number;
  baseline_conversions: number;
  baseline_spend: number;
  baseline_ctr: number;
  baseline_cpc: number;
  baseline_cvr: number;
  baseline_roas: number;
  // variation
  variation_impressions: number;
  variation_clicks: number;
  variation_conversions: number;
  variation_spend: number;
  variation_ctr: number;
  variation_cpc: number;
  variation_cvr: number;
  variation_roas: number;
  // computed deltas
  delta_ctr: number;
  delta_cpc: number;
  delta_cvr: number;
  delta_roas: number;
  sample_size: number;
  confidence: number;
  days_measured: number;
  created_at: string;
}

// ── Session ─────────────────────────────────────────────────────────

export interface CpoSession {
  id: string;
  user_id: string;
  user_email: string | null;
  title: string;
  messages: ChatMsg[];
  status: string;
  report: string | null;
  report_data: CpoReportData | null;
  share_token: string | null;
  is_public: boolean;
  deleted_by_user: boolean;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
}

// ── CSV Parsing ─────────────────────────────────────────────────────

export interface ParsedCsvRow {
  campaign: string;
  campaignId?: string;
  adGroup: string;
  adGroupId?: string;
  headlines: string[];       // up to 15
  descriptions: string[];    // up to 4
  finalUrl: string;
  displayUrl?: string;
  status?: string;
  impressions: number;
  clicks: number;
  conversions: number;
  cost: number;              // "Cost" column (spend)
  revenue?: number;
}

export interface ParsedCsvResult {
  rows: ParsedCsvRow[];
  campaigns: string[];       // unique campaign names
  totalAds: number;
  totalSpend: number;
  errors: string[];
}

// ── Report Data ─────────────────────────────────────────────────────

export interface CpoReportData {
  campaign: CpoCampaign;
  ads: CpoAd[];
  variations: CpoVariation[];
  summary: CampaignSummary;
}

export interface CampaignSummary {
  totalAds: number;
  totalImpressions: number;
  totalClicks: number;
  totalConversions: number;
  totalSpend: number;
  totalRevenue: number;
  avgCtr: number;
  avgCpc: number;
  avgCvr: number;
  avgRoas: number;
  underperformerCount: number;
  variationsGenerated: number;
}

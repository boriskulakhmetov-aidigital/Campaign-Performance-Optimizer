/**
 * Google Ads CSV Parser
 *
 * Handles the standard Google Ads Editor / UI CSV export format.
 * Maps columns like "Campaign", "Ad Group", "Headline 1"–"Headline 15",
 * "Description 1"–"Description 4", "Impressions", "Clicks", "Cost", etc.
 */

import type { ParsedCsvRow, ParsedCsvResult } from './types';

/* ── Column name aliases (lowercase) ──────────────────────────────── */

const CAMPAIGN_COLS = ['campaign', 'campaign name'];
const CAMPAIGN_ID_COLS = ['campaign id'];
const AD_GROUP_COLS = ['ad group', 'ad group name'];
const AD_GROUP_ID_COLS = ['ad group id'];
const FINAL_URL_COLS = ['final url', 'landing page'];
const DISPLAY_URL_COLS = ['display url'];
const STATUS_COLS = ['status', 'ad status'];
const IMPRESSION_COLS = ['impressions', 'impr.', 'impr'];
const CLICK_COLS = ['clicks'];
const CONVERSION_COLS = ['conversions', 'conv.', 'conv', 'all conv.'];
const COST_COLS = ['cost', 'spend', 'amount spent'];
const REVENUE_COLS = ['conversion value', 'conv. value', 'revenue', 'total conversion value'];

function find(headers: string[], aliases: string[]): number {
  return headers.findIndex(h => aliases.includes(h.toLowerCase().trim()));
}

function findAll(headers: string[], prefix: string, max: number): number[] {
  const indices: number[] = [];
  for (let i = 1; i <= max; i++) {
    const target = `${prefix} ${i}`.toLowerCase();
    const idx = headers.findIndex(h => h.toLowerCase().trim() === target);
    if (idx >= 0) indices.push(idx);
  }
  return indices;
}

function parseNumber(val: string | undefined): number {
  if (!val) return 0;
  // Remove currency symbols, commas, percent signs
  const cleaned = val.replace(/[$€£¥,\s%]/g, '');
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

/* ── CSV text → rows ──────────────────────────────────────────────── */

function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

/* ── Main parser ──────────────────────────────────────────────────── */

export function parseGoogleAdsCsv(csvText: string): ParsedCsvResult {
  const lines = csvText.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) {
    return { rows: [], campaigns: [], totalAds: 0, totalSpend: 0, errors: ['CSV has no data rows'] };
  }

  const headers = splitCsvLine(lines[0]);
  const errors: string[] = [];

  // Map columns
  const campaignIdx = find(headers, CAMPAIGN_COLS);
  const campaignIdIdx = find(headers, CAMPAIGN_ID_COLS);
  const adGroupIdx = find(headers, AD_GROUP_COLS);
  const adGroupIdIdx = find(headers, AD_GROUP_ID_COLS);
  const finalUrlIdx = find(headers, FINAL_URL_COLS);
  const displayUrlIdx = find(headers, DISPLAY_URL_COLS);
  const statusIdx = find(headers, STATUS_COLS);
  const impressionIdx = find(headers, IMPRESSION_COLS);
  const clickIdx = find(headers, CLICK_COLS);
  const conversionIdx = find(headers, CONVERSION_COLS);
  const costIdx = find(headers, COST_COLS);
  const revenueIdx = find(headers, REVENUE_COLS);
  const headlineIndices = findAll(headers, 'Headline', 15);
  const descriptionIndices = findAll(headers, 'Description', 5);

  // Validate required columns
  if (campaignIdx < 0) errors.push('Missing "Campaign" column');
  if (adGroupIdx < 0) errors.push('Missing "Ad Group" column');
  if (impressionIdx < 0 && clickIdx < 0 && costIdx < 0) {
    errors.push('Missing performance metric columns (Impressions, Clicks, or Cost)');
  }
  if (headlineIndices.length === 0) {
    errors.push('Missing headline columns (e.g. "Headline 1")');
  }

  if (errors.length > 0 && campaignIdx < 0) {
    return { rows: [], campaigns: [], totalAds: 0, totalSpend: 0, errors };
  }

  const rows: ParsedCsvRow[] = [];
  const campaignSet = new Set<string>();
  let totalSpend = 0;

  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    if (cols.length < 3) continue; // skip empty/malformed rows

    const campaign = cols[campaignIdx] || 'Unknown Campaign';
    const adGroup = cols[adGroupIdx] || 'Unknown Ad Group';

    // Skip summary/total rows
    if (campaign.toLowerCase() === 'total' || adGroup.toLowerCase() === 'total') continue;

    const headlines = headlineIndices.map(idx => cols[idx] || '').filter(Boolean);
    const descriptions = descriptionIndices.map(idx => cols[idx] || '').filter(Boolean);

    // Skip rows with no creative (likely group summary rows)
    if (headlines.length === 0 && descriptions.length === 0) continue;

    const cost = costIdx >= 0 ? parseNumber(cols[costIdx]) : 0;
    totalSpend += cost;
    campaignSet.add(campaign);

    rows.push({
      campaign,
      campaignId: campaignIdIdx >= 0 ? cols[campaignIdIdx] : undefined,
      adGroup,
      adGroupId: adGroupIdIdx >= 0 ? cols[adGroupIdIdx] : undefined,
      headlines,
      descriptions,
      finalUrl: finalUrlIdx >= 0 ? cols[finalUrlIdx] || '' : '',
      displayUrl: displayUrlIdx >= 0 ? cols[displayUrlIdx] : undefined,
      status: statusIdx >= 0 ? cols[statusIdx] : undefined,
      impressions: impressionIdx >= 0 ? parseNumber(cols[impressionIdx]) : 0,
      clicks: clickIdx >= 0 ? parseNumber(cols[clickIdx]) : 0,
      conversions: conversionIdx >= 0 ? parseNumber(cols[conversionIdx]) : 0,
      cost,
      revenue: revenueIdx >= 0 ? parseNumber(cols[revenueIdx]) : undefined,
    });
  }

  return {
    rows,
    campaigns: [...campaignSet],
    totalAds: rows.length,
    totalSpend,
    errors,
  };
}

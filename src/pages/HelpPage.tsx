import { useEffect } from 'react';
import { HelpPage, applyTheme, resolveTheme } from '@boriskulakhmetov-aidigital/design-system';
import '@boriskulakhmetov-aidigital/design-system/style.css';

const GUIDE = `# Campaign Performance Optimizer — User Guide

**Tool:** [Campaign Performance Optimizer](https://campaign-optimizer.apps.aidigitallabs.com)

Analyze and optimize your marketing campaign performance with AI-powered insights. Get actionable recommendations to improve ROI, engagement, and conversion rates.

---

## Getting Started

### 1. Sign In

Open the app and sign in with your AIDigital Labs account.

### 2. Describe Your Campaign

Provide details about your campaign — platform, objectives, target audience, budget, and current performance metrics.

### 3. AI Analysis

The AI analyzes your campaign data against industry benchmarks and best practices, identifying optimization opportunities.

### 4. Review Recommendations

Review the detailed optimization report with prioritized recommendations for improving performance.

### 5. Download or Share

Export the report as Markdown, PDF, or share it via link.

---

## What to Expect

| Step | Time |
|------|------|
| Enter campaign details | 2-3 minutes |
| AI analysis | 3-5 minutes |
| **Total** | **5-8 minutes** |

---

## Tips

- **Use dark mode** for a more comfortable viewing experience. Toggle it in the top-right corner.
- Previous campaigns are saved automatically in the sidebar.
- Provide as much data as possible for more accurate recommendations.
`;

export default function AppHelpPage() {
  useEffect(() => { applyTheme(resolveTheme()); }, []);
  return <HelpPage markdown={GUIDE} />;
}

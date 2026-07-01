# 🐦 Agent Skill: X (Twitter) Automation & Manual Outreach System (Option B)

## Purpose
This skill defines the guidelines for generating, managing, and executing the daily trend analysis drafts and manual outreach on X to drive high-conversion organic traffic to SocialIntent AI. It covers local radar chart rendering, markdown draft output, character limit validation, and high-touch manual engagement.

---

## 📋 Execution Checklist

### Phase 1: Local Trend Analysis & Visual Generation
1. **Keyword Selection**:
   - Query Gemini for trending business, AI, tech, or side-hustle keywords relevant to creators.
   - Maintain a fallback database of keywords.
2. **Platform Needs Score Calculation**:
   - Score the relevance of the keyword across 5 platforms: YouTube, Instagram, TikTok, X, and Google SEO.
3. **Radar Chart Rendering**:
   - Use `matplotlib` with a premium dark theme (`#05060b` background, `#ec4899` radar path, `#8b5cf6` fill alpha).
   - Copy the chart to the user's Obsidian vault folder `C:\COO\メモ\X投稿ドラフト\` for immediate inline rendering.

### Phase 2: Copy-Paste Draft Formatting
1. **Character Counts**:
   - Ensure every tweet is strictly under 140 Japanese characters (or 280 English characters) to accommodate standard accounts.
   - Print the character count and safety status (`✅ Safe` or `⚠️ Alert`) next to each tweet block.
2. **Draft Layout**:
   - Title, date, and keyword.
   - Step-by-step checklist for posting.
   - Obsidian image block (`![[daily_trend_{keyword}.png]]`).
   - Copy-paste templates for DMs and replies.

### Phase 3: High-Touch Manual Engagement
1. **Bio Link / Pinned Post Placement**:
   - Maintain the landing page link in X bio or pinned tweet to avoid outbound link suppression in threads.
2. **CTA Mechanics**:
   - End the thread by asking users to comment "分析" (analysis) to receive the report link.
3. **Manual DMs (Speed & Personalization)**:
   - When a user comments "分析", reply to the comment and send a direct message containing the pre-encoded report URL: `https://socialintent-trends.onrender.com/?keyword={encoded_keyword}`.
   - Add a brief personalized tip to the DM template to boost click-to-purchase CVR.

---

## 🛠️ Standalone CLI Usage
The user can run the draft generator on-demand:
```bash
python generate_draft.py --keyword "AI副業"
```

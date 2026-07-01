# 🛠️ Agent Skill: Systematic Web QA, Feedback Generation & Autodebug Execution Loop

## Purpose
This skill equips the Agent with an end-to-end, professional product lifecycle workflow: discovering local web applications, running systematic QA checks, compiling high-value feedback, autonomously executing targeted code fixes (debugging, CSS alignment, localization, script recovery), and performing regression browser tests to prove the applications are 100% stable and high quality.

---

## 📋 Execution Checklist

### Phase 1: Workspace Discovery & Analysis
1. **Locate Target Applications**:
   - Walk the workspace to find `index.html` files (either in the root or within subfolders).
   - Identify potential application groups, startup config files (`deploy.py`, `package.json`, or local servers).
2. **Determine Dev Server Strategy**:
   - Check if the apps run statically (via local `file:///` scheme) or require local servers (e.g. Node, Python).
   - Scan active listening ports (`netstat`) to see if any local dev servers are running.

### Phase 2: Systematic QA Audit (Browser Verification)
For each discovered web application, execute a browser subagent session using these exact criteria:
1. **Functional Smoke Tests**:
   - Verify primary interactive flows (buttons, tabs, inputs, dropdown menus, theme toggles).
   - Test data creation/modification flows (e.g., search queries, form submissions).
   - Verify critical integrations (such as mock logins, third-party libraries, map renders).
2. **Visual & Usability Audit (UI/UX)**:
   - Identify spacing gaps, structural overlaps, misaligned text, or broken icons/images.
   - Ensure premium aesthetic standards (modern typography, gradients, glow micro-animations) are preserved and not cheapened by standard browser default dialogs (like `alert()`).
3. **Responsive Viewport Checks**:
   - Resize the viewport to standard mobile width (375px) to detect overlapping layouts or unreadable text.
4. **Developer Console & Asset Audit**:
   - Open developer tools or monitor the console output for any JavaScript exceptions (e.g., `TypeError`, `ERR_FILE_NOT_FOUND`, `Failed to fetch`).
   - Track down missing scripts or media assets.

### Phase 3: Feedback Synthesis
1. **Verification**:
   - **CRITICAL**: Never rely strictly on subagent output claims. View the captured click-feedback screenshots to manually verify the layout, bugs, and completeness before generating reports.
2. **Synthesis**:
   - Group findings by application.
   - Use clear severity indicators (e.g., `🔴 Critical Blocker`, `⚠️ UI Bug`, `💡 Suggestion`).
   - Deliver findings inside a structured markdown file (`feedback_report.md`).

### Phase 4: Feedback Implementation Loop (Feedback-driven Development)
Once the audit report is ready, autonomously proceed to resolve the findings:
1. **Prioritize Bug Fixes**:
   - **High Priority**: Blocker exceptions, script resource failures, missing javascript files (e.g., `ERR_FILE_NOT_FOUND`), and broken rendering logical blocks.
   - **Medium Priority**: Responsive layout overlaps, missing localization (i18n) key translations, and unfinished feature links.
   - **Low Priority**: Minor visual tweaks or standard alert box replacements.
2. **Execute Targeted Code Changes**:
   - Use precise file editing tools (`replace_file_content`, `multi_replace_file_content`) to address target areas.
   - **Restoring Missing Files**: If a script is reported missing (`ERR_FILE_NOT_FOUND`), analyze the HTML container, figure out the intended functionalities (e.g. employee grids, slider events), and programmatically reconstruct the script from scratch.
   - **Fixing CSS Overlaps**: Adjust Flexbox, Grid, margins, and media queries (`@media`) to achieve perfect mobile layouts.
   - **Fixing i18n Leaks**: Update translation definition files (`i18n.js`) or HTML content to ensure raw keys (e.g., `SYSTEM_HEALTH_AND_SECURITY`) are translated correctly.

### Phase 5: AI Accuracy & Prompt Engineering Optimization
Directly analyze and refine the machine learning models and LLM prompts under the hood:
1. **Model Parameter Tuning**:
   - Upgrade local ML model capacities (e.g. scale Whisper from `base` to `small` or `medium` size) to dramatically reduce word error rates (WER) for non-English transcription tasks.
2. **Prompt Engineering Refinement**:
   - Harden system prompts and LLM translation context to demand "video-dubbing-aware" length restrictions, consistent honorific/casual grammatical levels (e.g., desu/masu in Japanese), and structural JSON-like parsing integrity to prevent runtime split crashes.

### Phase 6: Regression Testing & Validation
1. **Re-Test via Browser Subagent**:
   - Re-open the modified applications in the browser subagent.
   - Explicitly test the previously broken flows (e.g., verify the recovered script runs, check that the mobile layout is aligned, ensure the blank cards are rendering).
2. **Console Error Sanity Check**:
   - Ensure the console is clean and free of JS errors or failed asset requests.
3. **Loop Until All Green**:
   - Repeat Phase 4, Phase 5, and Phase 6 until every critical and medium bug is resolved.
4. **Document Results**:
   - Generate or update `walkthrough.md` to prove all fixes are successfully deployed with screenshots.

---

## 📝 Deliverable Format (`feedback_report.md`)
The audit result should be structured as follows:

```markdown
# 🔍 QA Audit & Feedback Report

## 1. [App Name]
* **Visual Impression**: ⭐⭐⭐⭐⭐ / ⭐☆☆☆☆
* **Usability & Flow**: ⭐⭐⭐⭐⭐ / ⭐☆☆☆☆

### 🔴 Discovered Issues & Bugs
- **[Issue Name]**: Description of the exception or malfunction, including console trace.
- **[UI Defect]**: Details of responsive overlap or styling misalignment.

### 💡 Suggested Improvements
- Concrete recommendations for layout polish, missing user flows, or better UX paradigms.
```

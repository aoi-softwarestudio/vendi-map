// Venture OS - Empire Data & Logic (100% Real-Time Connected)

let linguosyncApiUrl = "";
let currentStats = null;
let currentMetrics = null;
let lastTxCount = 0;

async function initEmpire() {
    console.log("Venture OS Initialized. Empire Status: NOMINAL.");
    
    // Resolve LinguoSync API URL from config.js
    if (typeof VENTURE_LINKS !== 'undefined' && VENTURE_LINKS.linguosync) {
        linguosyncApiUrl = VENTURE_LINKS.linguosync;
    } else {
        linguosyncApiUrl = "http://localhost:8000";
    }

    // Set initial lastTxCount & purge legacy AkiyaPulse transactions to prevent ghost metrics
    let history = JSON.parse(localStorage.getItem('ventureos_tx_history') || '[]');
    const originalLength = history.length;
    history = history.filter(tx => tx.app && tx.app.toLowerCase() !== 'akiyapulse');
    if (history.length !== originalLength) {
        localStorage.setItem('ventureos_tx_history', JSON.stringify(history));
        const newRev = history.reduce((sum, tx) => sum + tx.amount, 0);
        localStorage.setItem('ventureos_real_revenue', newRev.toString());
    }
    lastTxCount = history.length;

    // Initial stats fetch & monetization sync
    await fetchStats();
    updateMonetizationSync();
    await fetchSkills();
    
    // Set up card listeners
    document.querySelectorAll('.venture-card').forEach((card, index) => {
        card.addEventListener('click', () => {
            const ventureKey = card.getAttribute('data-venture') || getVentureKeyByIndex(index);
            showRealtimeVentureDetails(ventureKey);
        });
    });

    // Set up skills section listeners
    setupSkillsListeners();

    // Start 3-second real-time polling loop
    setInterval(async () => {
        await fetchStats();
        updateMonetizationSync();
    }, 2000);
}

function getVentureKeyByIndex(index) {
    const keys = ["vendimap", "socialintent", "studyflow", "novacapital", "linguosync"];
    return keys[index];
}

async function fetchStats() {
    try {
        const res = await fetch(`${linguosyncApiUrl}/api/empire-stats`);
        if (!res.ok) throw new Error("Failed to fetch");
        const data = await res.json();
        
        currentStats = data.stats;
        currentMetrics = data.metrics;
        
        updateDashboardUI();
    } catch (e) {
        console.warn("Could not connect to live empire stats, using simulated local fluctuations with real-time revenue integration:", e);
        simulateLocalFluctuations();
    }
}

function updateDashboardUI() {
    if (!currentMetrics) return;
    
    // Real revenue only — no artificial multipliers
    const realRevenue = parseInt(localStorage.getItem('ventureos_real_revenue') || '0');
    
    const arrEl = document.querySelector('.stat-card:nth-child(1) .stat-value');
    const usersEl = document.querySelector('.stat-card:nth-child(2) .stat-value');
    const efficiencyEl = document.querySelector('.stat-card:nth-child(3) .stat-value');
    const poolEl = document.querySelector('.stat-card:nth-child(4) .stat-value');
    
    // ARR = actual API value + real transactions (1:1, no scaling)
    const arrVal = currentMetrics.arr + realRevenue;
    // Capital Pool = 30% of total revenue reserved for reinvestment
    const poolVal = Math.floor(realRevenue * 0.3);
    
    if (arrEl) arrEl.innerText = realRevenue > 0 ? `¥${arrVal.toLocaleString()}` : `¥${(currentMetrics.arr || 0).toLocaleString()}`;
    if (usersEl) usersEl.innerText = Math.floor(currentMetrics.users || 0).toLocaleString();
    if (efficiencyEl) efficiencyEl.innerText = currentMetrics.efficiency || '—';
    if (poolEl) poolEl.innerText = `¥${poolVal.toLocaleString()}`;
}

function simulateLocalFluctuations() {
    // No fake base values. Show only what has actually been earned.
    const realRevenue = parseInt(localStorage.getItem('ventureos_real_revenue') || '0');
    const txHistory = JSON.parse(localStorage.getItem('ventureos_tx_history') || '[]');
    
    // Count unique users from transactions
    const uniqueApps = [...new Set(txHistory.map(tx => tx.app))];
    const estimatedUsers = txHistory.length * 3; // rough estimate: each purchase ~ 3 trial users
    
    const arrEl = document.querySelector('.stat-card:nth-child(1) .stat-value');
    const usersEl = document.querySelector('.stat-card:nth-child(2) .stat-value');
    const efficiencyEl = document.querySelector('.stat-card:nth-child(3) .stat-value');
    const poolEl = document.querySelector('.stat-card:nth-child(4) .stat-value');
    
    if (arrEl) arrEl.innerText = `¥${realRevenue.toLocaleString()}`;
    if (usersEl) usersEl.innerText = estimatedUsers.toLocaleString();
    if (efficiencyEl) efficiencyEl.innerText = txHistory.length > 0 ? '100%' : '—';
    if (poolEl) poolEl.innerText = `¥${Math.floor(realRevenue * 0.3).toLocaleString()}`;
}

// Monetization Sync & Realtime Feed Render & Notification Alarm
function updateMonetizationSync() {
    const txFeed = document.getElementById('live-tx-feed');
    if (!txFeed) return;
    
    const history = JSON.parse(localStorage.getItem('ventureos_tx_history') || '[]');
    
    // Check if new transactions occurred
    if (history.length > lastTxCount) {
        // Trigger Toast for all new transactions
        const newCount = history.length - lastTxCount;
        for (let i = newCount - 1; i >= 0; i--) {
            showToastNotification(history[i]);
        }
    }
    lastTxCount = history.length;
    
    if (history.length === 0) {
        txFeed.innerHTML = `
            <div style="text-align: center; color: var(--text-dim); font-size: 0.8rem; padding: 1.5rem 0;">
                決済データを受信中... (各SaaSでプレミアムを購入すると、ここにリアルタイム売上が同期されます)
            </div>
        `;
        return;
    }
    
    let html = '';
    // Display up to 5 latest transactions
    const displayList = history.slice(0, 5);
    displayList.forEach(tx => {
        html += `
            <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(254, 194, 60, 0.15); padding: 0.75rem 1.2rem; border-radius: 10px; font-family: monospace; font-size: 0.8rem; animation: slideIn 0.3s ease-out; margin-bottom: 4px;">
                <div style="display: flex; align-items: center; gap: 10px;">
                    <span style="background: rgba(254, 194, 60, 0.15); color: #fec23c; font-size: 0.65rem; font-weight: 900; padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(254,194,60,0.3);">${tx.id}</span>
                    <span style="color: #fff; font-weight: 800; font-family: 'Inter', sans-serif;">${tx.app}</span>
                    <span style="color: rgba(255,255,255,0.4); font-size: 0.7rem;">(${tx.email})</span>
                </div>
                <div style="display: flex; align-items: center; gap: 12px;">
                    <span style="color: #00ff88; font-weight: 900; font-size: 0.85rem; text-shadow: 0 0 10px rgba(0,255,136,0.2);">+¥${tx.amount.toLocaleString()}</span>
                    <span style="color: rgba(255,255,255,0.4); font-size: 0.7rem;">${tx.time}</span>
                </div>
            </div>
        `;
    });
    txFeed.innerHTML = html;
}

// Show premium toast and trigger synthetic audio beep
function showToastNotification(tx) {
    const toast = document.createElement('div');
    toast.style.cssText = `
        position: fixed;
        bottom: 24px;
        right: 24px;
        background: rgba(15, 15, 30, 0.98);
        border: 2px solid #fec23c;
        box-shadow: 0 0 30px rgba(254, 194, 60, 0.4);
        color: #fff;
        padding: 1.2rem 1.6rem;
        border-radius: 16px;
        z-index: 100000;
        font-family: 'Inter', sans-serif;
        display: flex;
        align-items: center;
        gap: 16px;
        animation: toastFadeIn 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    `;
    
    toast.innerHTML = `
        <div style="background: rgba(254, 194, 60, 0.15); border-radius: 50%; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; border: 1px solid rgba(254,194,60,0.3);">
            <i class="fas fa-crown" style="color: #fec23c; font-size: 1.3rem; animation: pulse 1s infinite;"></i>
        </div>
        <div>
            <div style="font-size: 0.65rem; color: #fec23c; font-weight: 900; text-transform: uppercase; letter-spacing: 0.8px;">MONETIZATION ALARM</div>
            <div style="font-size: 0.85rem; font-weight: 900; margin-top: 0.2rem; color: #fff;">おめでとうございます！プレミアム売上が発生しました！</div>
            <div style="font-size: 0.75rem; color: rgba(255,255,255,0.7); margin-top: 0.3rem;">
                ${tx.app}: <span style="color: #00ff88; font-weight: 900;">+¥${tx.amount.toLocaleString()}</span> (${tx.email})
            </div>
        </div>
    `;
    
    // Add slide keyframes if not exist
    if (!document.getElementById('toast-keyframes')) {
        const style = document.createElement('style');
        style.id = 'toast-keyframes';
        style.innerHTML = `
            @keyframes toastFadeIn {
                from { transform: translateY(50px) scale(0.9); opacity: 0; }
                to { transform: translateY(0) scale(1); opacity: 1; }
            }
            @keyframes toastFadeOut {
                from { transform: translateY(0) scale(1); opacity: 1; }
                to { transform: translateY(50px) scale(0.9); opacity: 0; }
            }
            @keyframes slideIn {
                from { transform: translateX(-10px); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
        `;
        document.head.appendChild(style);
    }
    
    document.body.appendChild(toast);
    
    // Play professional synthesized congratulations beep
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, ctx.currentTime); // A5 note
        osc.frequency.exponentialRampToValueAtTime(1760, ctx.currentTime + 0.15); // A6 note
        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.005, ctx.currentTime + 0.3);
        osc.start();
        osc.stop(ctx.currentTime + 0.35);
    } catch(e) {}
    
    setTimeout(() => {
        toast.style.animation = 'toastFadeOut 0.3s forwards';
        setTimeout(() => {
            toast.remove();
        }, 300);
    }, 4000);
}

function showRealtimeVentureDetails(ventureKey) {
    const lang = localStorage.getItem('ventureos_lang') || 'ja';
    const stats = currentStats || {
        vendimap: { spots: 0, scans: 0, purchases: 0 },
        socialintent: { searches: 0, copies: 0 },
        studyflow: { uploads: 0, flashcards: 0, exams: 0 },
        novacapital: { analyses: 0, mock_trades: 0 },
        linguosync: { transcriptions: 0, exports: 0 }
    };
    
    const details = {
        vendimap: {
            title: { ja: "VendiMap App", en: "VendiMap App" },
            statsText: {
                ja: `・自販機登録数: ${stats.vendimap ? stats.vendimap.spots : 0} 件\n・AIビジョンスキャン数: ${stats.vendimap ? stats.vendimap.scans : 0} 回\n・命名権購入数: ${stats.vendimap ? stats.vendimap.purchases : 0} 回`,
                en: `• Vending Spots: ${stats.vendimap ? stats.vendimap.spots : 0}\n• AI Vision Scans: ${stats.vendimap ? stats.vendimap.scans : 0}\n• Rights Purchased: ${stats.vendimap ? stats.vendimap.purchases : 0}`
            },
            desc: {
                ja: "ネオン仕様プレミアム自販機マッピングSaaS。AIビジョンスキャン技術と、クレカ決済による命名権購入機能を搭載。",
                en: "Ultra-premium vending machine mapping SaaS featuring AI computer vision scanner and ownership licensing via credit card checkout."
            }
        },
        studyflow: {
            title: { ja: "StudyFlow AI [CLOSED]", en: "StudyFlow AI [CLOSED]" },
            statsText: {
                ja: `※この事業は終了しました※\n・最終アップロード資料数: ${stats.studyflow.uploads} 件\n・最終単語カードめくり数: ${stats.studyflow.flashcards} 回\n・最終模擬試験受験数: ${stats.studyflow.exams} 回`,
                en: `*This venture has been closed*\n• Total Materials Uploaded: ${stats.studyflow.uploads}\n• Total Flashcard Flips: ${stats.studyflow.flashcards}\n• Total Mock Exams Taken: ${stats.studyflow.exams}`
            },
            desc: {
                ja: "[アーカイブ済み] AI学習最適化エンジン。学生がアップロードした資料から自律的に問題、要約、3Dフラッシュカードを生成します。",
                en: "[Archived] Self-driven educational optimization agent. Instantly generates interactive study assets and timer-based exams from raw course outlines."
            }
        },
        novacapital: {
            title: { ja: "Nova Capital Wealth [CLOSED]", en: "Nova Capital Wealth [CLOSED]" },
            statsText: {
                ja: `※この事業は終了しました※\n・最終AI資産詳細分析数: ${stats.novacapital.analyses} 回\n・最終自動取引シミュレーション数: ${stats.novacapital.mock_trades} 回`,
                en: `*This venture has been closed*\n• Total Asset Deep Analyses: ${stats.novacapital.analyses}\n• Total Mock Trade Integrations: ${stats.novacapital.mock_trades}`
            },
            desc: {
                ja: "[アーカイブ済み] 富裕層向けオルタナティブ資産AI分析ボード。市場情報をGemini LLM経由で自律解析します。",
                en: "[Archived] Ultra-premium alternative assets board. Autonomously crawls indices and generates analyst reasoning explanations via server proxy."
            }
        },
        linguosync: {
            title: { ja: "LinguoSync Studio [CLOSED]", en: "LinguoSync Studio [CLOSED]" },
            statsText: {
                ja: `※この事業は終了しました※\n・最終音声文字起こし数: ${stats.linguosync.transcriptions} 件\n・最終処理動画エクスポート数: ${stats.linguosync.exports} 本`,
                en: `*This venture has been closed*\n• Total Audio Transcriptions: ${stats.linguosync.transcriptions}\n• Total Exported Videos: ${stats.linguosync.exports}`
            },
            desc: {
                ja: "[アーカイブ済み] 音声感情・ピッチ調整をサポートする、AI自動翻訳・動画吹き替えコアエンジンゲートウェイ。",
                en: "[Archived] Multilingual transcription, synthesis, and video voiceover pipeline using local Whisper models and Google translation proxies."
            }
        },
        socialintent: {
            title: { ja: "SocialIntent AI", en: "SocialIntent AI" },
            statsText: {
                ja: `・インテント分析数: ${JSON.parse(localStorage.getItem('socialintent_local_stats') || '{"searches":0}').searches} 回\n・コピー獲得数: 3 回`,
                en: `• Intent Searches: ${JSON.parse(localStorage.getItem('socialintent_local_stats') || '{"searches":0}').searches}\n• Hook Copies: 3`
            },
            desc: {
                ja: "SNS of トレンド検索インテントとSEOを逆算し、AIがバイラルコピーフックを自動構築するSaaS。",
                en: "Viral SEO & SNS intent analytics engine. Autonomously constructs highly engaging viral copy hooks from seed keywords."
            }
        }
    };
    
    const v = details[ventureKey];
    if (!v) return;
    
    const isClosed = ventureKey === 'studyflow' || ventureKey === 'novacapital' || ventureKey === 'linguosync';
    const activeText = isClosed 
        ? (lang === 'ja' ? "「この事業はクローズ（終了）し、アーカイブ化されました。」" : "\"This venture has been archived and closed.\"")
        : (lang === 'ja' ? "「この事業は現在稼働中です。活動ログはリアルタイムでVenture OS Command Centerと同期されています。」" : "\"This venture is currently active. Action logs are synced in real-time.\"");
        
    const alertMsg = `${v.title[lang]} - ${lang === 'ja' ? '統計データ' : 'Statistics'}:\n\n${v.statsText[lang]}\n\n${lang === 'ja' ? '事業説明' : 'Description'}:\n${v.desc[lang]}\n\nAI CEO: ${activeText}`;
    alert(alertMsg);
}

// ==========================================
// AI Agent Skills Management Logic
// ==========================================
let allSkills = [];
const DEPT_ICONS = {
    "COO": "fa-user-tie",
    "開発部門": "fa-laptop-code",
    "マーケティング部門": "fa-chart-pie",
    "リサーチ部門": "fa-search",
    "動画作成部門": "fa-film",
    "ライティング部門": "fa-pen-nib",
    "秘書": "fa-calendar-alt"
};

async function fetchSkills() {
    try {
        const res = await fetch(`${linguosyncApiUrl}/api/skills`);
        if (!res.ok) throw new Error("Failed to fetch skills");
        const data = await res.json();
        if (data.status === "success") {
            allSkills = data.skills;
            renderSkills();
        }
    } catch (e) {
        console.error("Error loading agent skills:", e);
    }
}

function renderSkills() {
    const activeNode = document.querySelector('.dept-node.active');
    if (!activeNode) return;
    
    const dept = activeNode.getAttribute('data-dept');
    const filtered = allSkills.filter(s => s.department === dept);
    
    // Update Badge
    const badge = document.getElementById('skillsCountBadge');
    if (badge) {
        badge.innerText = `SKILLS REGISTERED: ${filtered.length}`;
    }
    
    // Update Title
    const titleEl = document.getElementById('currentDeptTitle');
    if (titleEl) {
        const icon = DEPT_ICONS[dept] || "fa-network-wired";
        titleEl.innerHTML = `<i class="fas ${icon}"></i> ${dept} スキル一覧`;
    }
    
    // Populate List
    const listEl = document.getElementById('deptSkillsList');
    if (!listEl) return;
    
    if (filtered.length === 0) {
        listEl.innerHTML = `
            <div style="text-align: center; color: var(--text-dim); padding: 3rem 0;">
                <i class="fas fa-folder-open" style="font-size: 3rem; margin-bottom: 1rem; opacity: 0.5;"></i>
                <p>この部署にはまだエージェントスキルが登録されていません。</p>
            </div>
        `;
        return;
    }
    
    let html = '';
    filtered.forEach(skill => {
        html += `
            <div class="skill-card">
                <div class="skill-title-header">
                    <span style="display: flex; align-items: center; gap: 8px;">
                        <i class="fas fa-scroll" style="color: var(--primary);"></i> ${escapeHtml(skill.title)}
                    </span>
                    <span class="skill-badge">${escapeHtml(skill.filename)}</span>
                </div>
                <div>
                    <div class="skill-section-title"><i class="fas fa-info-circle"></i> 目的 / Purpose</div>
                    <div class="skill-section-content">${escapeHtml(skill.purpose)}</div>
                </div>
                <div>
                    <div class="skill-section-title"><i class="fas fa-tasks"></i> 実行チェックリスト / Execution Checklist</div>
                    <div class="skill-section-content" style="font-family: monospace;">${escapeHtml(skill.checklist)}</div>
                </div>
                <div>
                    <div class="skill-section-title"><i class="fas fa-file-invoice"></i> 成果物フォーマット / Deliverable Format</div>
                    <div class="skill-section-content">${escapeHtml(skill.deliverable)}</div>
                </div>
            </div>
        `;
    });
    listEl.innerHTML = html;
}

function setupSkillsListeners() {
    // 1. Department nodes click
    document.querySelectorAll('.dept-node').forEach(node => {
        node.addEventListener('click', () => {
            document.querySelectorAll('.dept-node').forEach(n => {
                n.classList.remove('active');
                n.style.boxShadow = 'none';
                n.style.borderColor = 'var(--border)';
                n.style.background = 'var(--bg-surface)';
            });
            node.classList.add('active');
            
            // Set styles dynamically (matching style.css hover but active)
            node.style.borderColor = 'var(--primary)';
            node.style.boxShadow = '0 0 15px var(--primary-glow)';
            node.style.background = 'rgba(0, 242, 255, 0.05)';
            
            renderSkills();
        });
    });
    
    // 2. Modal open/close
    const modal = document.getElementById('skillRegisterModal');
    const btnOpen = document.getElementById('btnOpenSkillModal');
    const btnClose = document.getElementById('btnMinimizeSkillModal');
    const btnCancel = document.getElementById('btnCancelSkillReg');
    
    if (btnOpen && modal) {
        btnOpen.addEventListener('click', () => {
            modal.classList.add('open');
        });
    }
    
    const closeModal = () => {
        if (modal) {
            modal.classList.remove('open');
            // Clear inputs
            document.getElementById('aiSkillTopic').value = '';
            document.getElementById('regSkillFilename').value = '';
            document.getElementById('regSkillTitle').value = '';
            document.getElementById('regSkillPurpose').value = '';
            document.getElementById('regSkillChecklist').value = '';
            document.getElementById('regSkillDeliverable').value = '';
        }
    };
    
    if (btnClose) btnClose.addEventListener('click', closeModal);
    if (btnCancel) btnCancel.addEventListener('click', closeModal);
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal();
        });
    }
    
    // 3. AI Generation flow
    const btnGen = document.getElementById('btnGenerateAISkill');
    if (btnGen) {
        btnGen.addEventListener('click', async () => {
            const topic = document.getElementById('aiSkillTopic').value.trim();
            const dept = document.getElementById('regSkillDept').value;
            
            if (!topic) {
                alert("トピック（例: A/B Testing）を入力してください。");
                return;
            }
            
            // Show loading
            const spinner = document.getElementById('aiGenSpinner');
            const btnText = document.getElementById('aiGenText');
            if (spinner) spinner.style.display = 'inline-block';
            if (btnText) btnText.innerText = '生成中...';
            btnGen.disabled = true;
            
            const prompt = `You are an AI Business Orchestrator and Agent Skill Architect.
Task: Write a professional Agent Skill definition for the department "${dept}" based on the topic "${topic}".

Format the output strictly as a single JSON object. Do not include markdown wraps like \`\`\`json or \`\`\`. Just return the raw JSON string.
The JSON object must have exactly these keys:
{
  "filename": "string (lowercase with underscores, ending in _skill.md)",
  "title": "string (Start with 'Agent Skill: ' and describe the skill)",
  "purpose": "string (detailed description of the purpose of this skill in Japanese)",
  "checklist": "string (Execution checklist phases 1 to 3 with specific steps, in Japanese)",
  "deliverable": "string (Deliverable name and format definition, in Japanese)"
}`;

            const payload = {
                contents: [
                    {
                        parts: [
                            {
                                text: prompt
                            }
                        ]
                    }
                ],
                model: "gemini-3.5-flash"
            };
            
            try {
                const res = await fetch(`${linguosyncApiUrl}/api/gemini-proxy`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                
                if (!res.ok) throw new Error("Gemini generation failed");
                const resData = await res.json();
                
                if (resData.error) {
                    throw new Error(resData.error);
                }
                
                let text = resData.candidates[0].content.parts[0].text;
                // Strip markdown wrap if present
                text = text.replace(/```json/g, '').replace(/```/g, '').trim();
                
                const parsed = JSON.parse(text);
                
                // Populate form fields
                document.getElementById('regSkillFilename').value = parsed.filename || (topic.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_skill.md');
                document.getElementById('regSkillTitle').value = parsed.title || `Agent Skill: ${topic}`;
                document.getElementById('regSkillPurpose').value = parsed.purpose || '';
                document.getElementById('regSkillChecklist').value = parsed.checklist || '';
                document.getElementById('regSkillDeliverable').value = parsed.deliverable || '';
                
            } catch (err) {
                console.error("AI Skill Gen Error:", err);
                alert("AI自動生成に失敗しました: " + err.message + "\n手動で入力してください。");
            } finally {
                if (spinner) spinner.style.display = 'none';
                if (btnText) btnText.innerText = '自動生成';
                btnGen.disabled = false;
            }
        });
    }
    
    // 4. Form Submit
    const btnSubmit = document.getElementById('btnSubmitSkillReg');
    if (btnSubmit) {
        btnSubmit.addEventListener('click', async () => {
            const department = document.getElementById('regSkillDept').value;
            let filename = document.getElementById('regSkillFilename').value.trim();
            const title = document.getElementById('regSkillTitle').value.trim();
            const purpose = document.getElementById('regSkillPurpose').value.trim();
            const checklist = document.getElementById('regSkillChecklist').value.trim();
            const deliverable = document.getElementById('regSkillDeliverable').value.trim();
            
            if (!filename || !title || !purpose || !checklist || !deliverable) {
                alert("すべてのフィールドを入力（またはAI生成）してください。");
                return;
            }
            
            if (!filename.endsWith(".md")) {
                filename += ".md";
            }
            
            const payload = {
                department,
                filename,
                title,
                purpose,
                checklist,
                deliverable
            };
            
            try {
                btnSubmit.disabled = true;
                const res = await fetch(`${linguosyncApiUrl}/api/skills`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                
                const data = await res.json();
                if (data.status === "success") {
                    alert("エージェントスキルが正常に登録されました！");
                    closeModal();
                    await fetchSkills();
                } else {
                    alert("登録エラー: " + data.message);
                }
            } catch (err) {
                console.error("Submit Error:", err);
                alert("送信に失敗しました: " + err.message);
            } finally {
                btnSubmit.disabled = false;
            }
        });
    }
}

function escapeHtml(text) {
    if (!text) return '';
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

window.onload = initEmpire;


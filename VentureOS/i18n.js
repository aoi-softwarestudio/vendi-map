const translations = {
    ja: {
        "brand-name": "VENTURE OS",
        "label-arr": "Total Est. ARR",
        "label-users": "Active Users (Combined)",
        "label-efficiency": "AI Efficiency Score",
        "label-capital": "Venture Capital Pool",
        "portfolio-title": "Venture Portfolio",
        "portfolio-desc": "全AI事業ユニットのモニタリング状況",
        "ceo-report-title": "AI 会長 報告書",
        "btn-synergy": "全事業シナジーを実行",
        "btn-report": "詳細レポートを表示",
        "status-scalable": "Scalable",
        "status-high-alpha": "High Alpha",
        "status-impact": "Impact High",
        "status-growth": "Rapid Growth",
        "title-studyflow": "StudyFlow AI",
        "title-novacapital": "Nova Capital",
        "title-linguosync": "LinguoSync",
        "desc-studyflow": "Education SaaS - Automated Exam Prep",
        "desc-novacapital": "WealthTech - Niche Asset Alpha",
        "desc-linguosync": "AdTech - Global Video Localization",
        "system-health": "システム稼働状況 & セキュリティ"
    },
    en: {
        "brand-name": "VENTURE OS",
        "label-arr": "Total Est. ARR",
        "label-users": "Active Users (Combined)",
        "label-efficiency": "AI Efficiency Score",
        "label-capital": "Venture Capital Pool",
        "portfolio-title": "Venture Portfolio",
        "portfolio-desc": "Monitoring all active AI business units.",
        "ceo-report-title": "AI EXECUTIVE CHAIRMAN REPORT",
        "btn-synergy": "Execute All Synergies",
        "btn-report": "Show Detailed Report",
        "status-scalable": "Scalable",
        "status-high-alpha": "High Alpha",
        "status-impact": "Impact High",
        "status-growth": "Rapid Growth",
        "title-studyflow": "StudyFlow AI",
        "title-novacapital": "Nova Capital",
        "title-linguosync": "LinguoSync",
        "desc-studyflow": "Education SaaS - Automated Exam Prep",
        "desc-novacapital": "WealthTech - Niche Asset Alpha",
        "desc-linguosync": "AdTech - Global Video Localization",
        "system-health": "SYSTEM HEALTH & SECURITY"
    }
};

let currentLang = localStorage.getItem('ventureos_lang') || 'ja';

function setLanguage(lang) {
    currentLang = lang;
    localStorage.setItem('ventureos_lang', lang);
    
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (translations[lang][key]) {
            el.innerText = translations[lang][key];
        }
    });

    // Update switcher UI
    document.querySelectorAll('.lang-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.lang === lang);
    });

    // Translate the AI CEO message manually as it's complex
    updateCEOMessage(lang);
}

function updateCEOMessage(lang) {
    const msgEl = document.querySelector('.ceo-message p');
    if (!msgEl) return;
    
    if (lang === 'ja') {
        msgEl.innerHTML = `
            「現在、帝国全体のパフォーマンスは極めて良好です。特に <span class="highlight">Nova Capital</span> のインデックス精度が向上しており、収益の柱となっています。
            <br><br>
            次の戦略的ステップとして、全事業のプロモーションを <span class="highlight">LinguoSync</span> で多言語展開し、グローバル市場からの資本流入を加速させることを推奨します。」
        `;
    } else {
        msgEl.innerHTML = `
            "Current performance across the empire is exceptional. <span class="highlight">Nova Capital</span>'s index accuracy has significantly improved, serving as our primary revenue pillar.
            <br><br>
            For the next strategic step, I recommend launching global promotions via <span class="highlight">LinguoSync</span> to accelerate capital inflow from international markets."
        `;
    }
}

// Initial set
window.addEventListener('DOMContentLoaded', () => {
    setLanguage(currentLang);
});

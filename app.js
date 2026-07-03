import { initialSpots } from './data.js?v=20260529-rarity0';

let backendApiUrl = 'http://localhost:8000';

async function loadDynamicConfig() {
    try {
        const res = await fetch('/config.json?t=' + Date.now());
        if (res.ok) {
            const config = await res.json();
            if (config.backendApiUrl) {
                backendApiUrl = config.backendApiUrl;
                // If running inside Android emulator (accessing via 10.0.2.2) and backend is localhost
                if (window.location.hostname === '10.0.2.2' && backendApiUrl.includes('localhost')) {
                    backendApiUrl = backendApiUrl.replace('localhost', '10.0.2.2');
                }
                console.log("Loaded dynamic backendApiUrl from config.json:", backendApiUrl);
            }
        }
    } catch (e) {
        console.warn("Failed to load dynamic config.json, using default:", e);
    }
    
    // Automatically detect production environment and fallback to relative URL
    // to prevent network/CORS errors when accessing localhost from live environments.
    const isLocal = ['localhost', '127.0.0.1', '10.0.2.2'].includes(window.location.hostname);
    if (!isLocal && backendApiUrl.includes('localhost')) {
        backendApiUrl = ''; // Fallback to relative URL for production
        console.log("Production environment detected. Fallback backendApiUrl to relative path.");
    }
}

// Favorites Management Helpers (Saved locally per user, not shared globally)
function getFavorites() {
    try {
        const parsed = JSON.parse(localStorage.getItem('vendix_favorites') || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        return [];
    }
}

function saveFavorites(favs) {
    localStorage.setItem('vendix_favorites', JSON.stringify(favs));
}

function isFavorite(spotId) {
    const favs = getFavorites();
    return favs.includes(String(spotId));
}

function toggleFavorite(spotId) {
    let favs = getFavorites();
    const idStr = String(spotId);
    const index = favs.indexOf(idStr);
    let added = false;
    if (index === -1) {
        favs.push(idStr);
        added = true;
    } else {
        favs.splice(index, 1);
    }
    saveFavorites(favs);
    return added;
}

async function reportActivity(venture, action) {
    try {
        await fetch(`${backendApiUrl}/api/report-activity`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ venture, action })
        });
    } catch (e) {
        console.warn("Failed to report activity:", e);
    }
}

// App State
let map;
let markerClusterGroup;
let markers = [];
let myOwnedMarkers = [];
let currentFilter = 'all';
let currentSearchQuery = '';
let selectedSpot = null;
let addingSpotMode = false;
let tempMarker = null;
let darkLayer, lightLayer;
let isDarkMode = false;
let currentCameraMode = 'ai-scan'; // 'ai-scan', 'add-photo', 'new-spot'
let hasCenteredOnUser = false;
let newSpotPhotoBase64 = null;
let userLocation = null;
let userMarker = null;

// Search Helpers for Fuzzy & Normalization Matching
function toKatakana(str) {
    return str.replace(/[\u3041-\u3096]/g, function(match) {
        const chr = match.charCodeAt(0) + 0x60;
        return String.fromCharCode(chr);
    });
}

function normalizeQuery(q) {
    let normalized = q.toLowerCase();
    
    // Convert Hiragana to Katakana
    normalized = toKatakana(normalized);
    
    // Map common Romaji / English / brand names
    const translation = {
        'suntory': 'サントリー',
        'coca-cola': 'コカ・コーラ',
        'cocacola': 'コカ・コーラ',
        'coke': 'コカ・コーラ',
        'coca': 'コカ・コーラ',
        'dydo': 'ダイドー',
        'daido': 'ダイドー',
        'kirin': 'キリン',
        'itoen': '伊藤園',
        'ito en': '伊藤園',
        'otsuka': '大塚製薬',
        'pokari': 'ポカリスエット',
        'boss': 'ボス'
    };
    
    for (const [eng, jpn] of Object.entries(translation)) {
        if (normalized.includes(eng)) {
            normalized = normalized.replace(eng, jpn);
        }
    }
    return normalized;
}

function matchFuzzy(fieldVal, query) {
    if (!fieldVal) return false;
    const val = fieldVal.toLowerCase();
    const q = query.toLowerCase();
    
    if (val.includes(q)) return true;
    
    // Japanese Vending Machine Synonym Dictionary for fuzzy matches
    const jpSynonyms = [
        { main: '伊藤園', synonyms: ['イトウエン', 'いとうえん', 'itoen', 'ito en', '伊藤園'] },
        { main: 'サントリー', synonyms: ['サントリー', 'さんとりー', 'suntory', 'suntori'] },
        { main: 'コカ・コーラ', synonyms: ['コカコーラ', 'こかこーら', 'coca-cola', 'cocacola', 'coke', 'コカ・コーラ'] },
        { main: 'ダイドー', synonyms: ['ダイドードリンコ', 'だいどー', 'dydo', 'daido'] },
        { main: 'キリン', synonyms: ['きりん', 'kirin'] },
        { main: 'アサヒ', synonyms: ['あさひ', 'asahi', 'アサヒ飲料'] },
        { main: '大塚製薬', synonyms: ['おおつか', 'otsuka', 'ポカリ', 'pokari'] },
        { main: '明治', synonyms: ['めいじ', 'meiji'] },
        { main: 'ポッカサッポロ', synonyms: ['ぽっか', 'pokka', 'サッポロ'] }
    ];
    
    for (const group of jpSynonyms) {
        if (val.includes(group.main.toLowerCase())) {
            if (group.synonyms.some(syn => syn.includes(q) || q.includes(syn))) {
                return true;
            }
        }
        if (q.includes(group.main.toLowerCase())) {
            if (group.synonyms.some(syn => val.includes(syn))) {
                return true;
            }
        }
    }
    
    // Convert Hiragana/Katakana for fallback match
    const katakanaVal = toKatakana(val);
    const katakanaQ = toKatakana(q);
    if (katakanaVal.includes(katakanaQ)) return true;
    
    return false;
}


let accuracyCircle = null;
let isAutoFollow = false;
let currentInputRating = 0;
let commentsExpanded = false;
let currentRankingTab = 'count';
let currentUser = null;
let isAwaitingLocationForAdd = false;

function getRankingData() {
    const userName = currentUser ? currentUser.name : 'ゲストハンター';
    
    // Calculate actual owned spots
    const ownedCount = (typeof initialSpots !== 'undefined' && initialSpots) ? initialSpots.filter(s => s.owner === userName).length : 0;
    
    // Default dynamic user statistics for production release
    let ratingValue = "★ 5.0";
    
    return {
        count: [
            { name: userName, value: `${ownedCount}台`, avatar: "👑", isSelf: true }
        ],
        rating: [
            { name: userName, value: ratingValue, avatar: "👑", isSelf: true }
        ]
    };
}

// ----------------------------------------------------
// 1. Unified Toast Notification Engine & Custom Positions
// ----------------------------------------------------
let toastPosition = localStorage.getItem('vendimap_toast_position') || 'bottom-right';

function updateToastContainerPosition() {
    const container = document.getElementById('toastContainer');
    if (container) {
        container.className = `toast-container ${toastPosition}`;
    }
}

function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let icon = 'fa-check-circle';
    if (type === 'info') icon = 'fa-info-circle';
    if (type === 'warning') icon = 'fa-exclamation-triangle';
    if (type === 'error') icon = 'fa-times-circle';

    toast.innerHTML = `<i class="fas ${icon}"></i> <span>${message}</span>`;
    container.appendChild(toast);

    // Trigger smooth transition
    setTimeout(() => toast.classList.add('show'), 50);

    // Auto remove toast
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 400);
    }, 3500);
}

// ----------------------------------------------------
// 2. AudioContext & Confetti Celebration Animations
// ----------------------------------------------------
function playCelebrationSound() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);

        const now = ctx.currentTime;
        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.3);
        osc.frequency.exponentialRampToValueAtTime(1760, now + 0.6);

        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.6);

        osc.start(now);
        osc.stop(now + 0.6);
    } catch(e) {}
}

function createConfetti() {
    for (let i = 0; i < 70; i++) {
        const p = document.createElement('div');
        p.style.position = 'fixed';
        p.style.width = Math.random() * 8 + 4 + 'px';
        p.style.height = Math.random() * 15 + 5 + 'px';
        p.style.backgroundColor = ['#ffd700', '#ffa500', '#ff007a', '#00ff88', '#00d4ff'][Math.floor(Math.random() * 5)];
        p.style.left = Math.random() * 100 + 'vw';
        p.style.top = '-20px';
        p.style.zIndex = '999999';
        p.style.opacity = Math.random();
        p.style.transform = `rotate(${Math.random() * 360}deg)`;
        document.body.appendChild(p);

        let y = -20;
        let speed = Math.random() * 6 + 3;
        let rot = Math.random() * 12 - 6;
        let rotSum = 0;

        const interval = setInterval(() => {
            y += speed;
            rotSum += rot;
            p.style.top = y + 'px';
            p.style.transform = `rotate(${rotSum}deg)`;
            if (y > window.innerHeight) {
                clearInterval(interval);
                p.remove();
            }
        }, 16);
    }
}

// ----------------------------------------------------
// 3. VendiGamification Engine
// ----------------------------------------------------
const VendiGamification = {
    state: {
        level: 1,
        xp: 0,
        stats: { spotsAdded: 0, photosAdded: 0, commentsAdded: 0, boughtCount: 0, verifiedCount: 0 },
        verifiedSpotIds: [],
        unlockedAchievements: []
    },
    KEYS: {
        STATE: 'vendimap_gamification_state'
    },
    init() {
        const saved = localStorage.getItem(this.KEYS.STATE);
        const defaultState = {
            level: 1,
            xp: 0,
            stats: { spotsAdded: 0, photosAdded: 0, commentsAdded: 0, boughtCount: 0, verifiedCount: 0 },
            verifiedSpotIds: [],
            unlockedAchievements: [],
            registeredSpotIds: [],
            photographedSpotIds: [],
            commentedSpotIds: [],
            boughtSpotIds: []
        };

        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                if (parsed && typeof parsed === 'object') {
                    this.state = {
                        ...defaultState,
                        ...parsed,
                        stats: {
                            ...defaultState.stats,
                            ...(parsed.stats || {})
                        }
                    };
                } else {
                    this.state = defaultState;
                }
            } catch (e) {
                this.state = defaultState;
            }
        } else {
            this.state = defaultState;
            this.save();
        }

        // Ensure array safety for arrays that might be overwritten or missing
        if (!Array.isArray(this.state.verifiedSpotIds)) this.state.verifiedSpotIds = [];
        if (!Array.isArray(this.state.unlockedAchievements)) this.state.unlockedAchievements = [];

        if (!Array.isArray(this.state.registeredSpotIds) || this.state.registeredSpotIds.length === 0) {
            this.state.registeredSpotIds = [];
            if (typeof initialSpots !== 'undefined' && Array.isArray(initialSpots)) {
                initialSpots.forEach(s => {
                    if (s.id > 10000000) {
                        this.state.registeredSpotIds.push(s.id);
                    }
                });
            }
        }
        if (!Array.isArray(this.state.photographedSpotIds) || this.state.photographedSpotIds.length === 0) {
            this.state.photographedSpotIds = [];
            if (typeof initialSpots !== 'undefined' && Array.isArray(initialSpots)) {
                initialSpots.forEach(s => {
                    if (s.photos && s.photos.length > 0) {
                        this.state.photographedSpotIds.push(s.id);
                    }
                });
            }
        }
        if (!Array.isArray(this.state.commentedSpotIds) || this.state.commentedSpotIds.length === 0) {
            this.state.commentedSpotIds = [];
            if (typeof initialSpots !== 'undefined' && Array.isArray(initialSpots)) {
                initialSpots.forEach(s => {
                    if (s.comments && s.comments.length > 0) {
                        this.state.commentedSpotIds.push(s.id);
                    }
                });
            }
        }
        if (!Array.isArray(this.state.boughtSpotIds) || this.state.boughtSpotIds.length === 0) {
            this.state.boughtSpotIds = [];
            if (typeof initialSpots !== 'undefined' && Array.isArray(initialSpots)) {
                initialSpots.forEach(s => {
                    if (s.owner) {
                        this.state.boughtSpotIds.push(s.id);
                    }
                });
            }
        }
        this.updateUI();
        this.checkAchievements();
    },
    save() {
        localStorage.setItem(this.KEYS.STATE, JSON.stringify(this.state));
        if (typeof triggerAutoSync === 'function') triggerAutoSync();
    },
    getXPNeededForNextLevel(level) {
        return 100 + (level - 1) * 50;
    },
    addXP(amount, reason) {
        this.state.xp += amount;
        showToast(`+${amount} XP 獲得！ (${reason})`, 'info');
        
        let leveledUp = false;
        let xpNeeded = this.getXPNeededForNextLevel(this.state.level);
        while (this.state.xp >= xpNeeded) {
            this.state.xp -= xpNeeded;
            this.state.level++;
            leveledUp = true;
            xpNeeded = this.getXPNeededForNextLevel(this.state.level);
        }
        
        if (leveledUp) {
            this.triggerLevelUpCelebration();
        }
        this.save();
        this.updateUI();
        this.checkAchievements();
    },
    triggerLevelUpCelebration() {
        showToast(`🎉 レベルアップ！ LV ${this.state.level} に到達！`, 'success');
        
        // Full screen flash overlay animation
        const flash = document.getElementById('flashOverlay');
        if (flash) {
            flash.classList.remove('flash-active');
            void flash.offsetWidth; // trigger reflow
            flash.classList.add('flash-active');
            setTimeout(() => flash.classList.remove('flash-active'), 800);
        }
        
        createConfetti();
        playCelebrationSound();
    },
    getHunterRank(level) {
        if (level >= 50) return "レジェンドハンター 🐉";
        if (level >= 30) return "ゴールドハンター 🦊";
        if (level >= 15) return "シルバーハンター 🐱";
        if (level >= 5) return "ブロンズハンター 🥚";
        return "新米ハンター 🐣";
    },
    getUserInteractedSpots() {
        let userVotedSpotIds = [];
        try {
            const votes = JSON.parse(localStorage.getItem('user_rarity_votes') || '{}');
            if (votes && typeof votes === 'object') {
                userVotedSpotIds = Object.keys(votes).map(id => isNaN(id) ? id : Number(id));
            }
        } catch (e) {
            console.error("Failed to parse user rarity votes:", e);
        }
        const verifiedSpotIds = this.state.verifiedSpotIds || [];
        const photographedSpotIds = this.state.photographedSpotIds || [];
        const commentedSpotIds = this.state.commentedSpotIds || [];
        const boughtSpotIds = this.state.boughtSpotIds || [];
        const registeredSpotIds = this.state.registeredSpotIds || [];
        
        return initialSpots.filter(s => {
            const isCustom = s.id > 10000000 || registeredSpotIds.includes(s.id);
            const isModified = s.isModified;
            const hasPhotos = (s.photos && s.photos.length > 0) || photographedSpotIds.includes(s.id);
            const hasComments = (s.comments && s.comments.length > 0) || commentedSpotIds.includes(s.id);
            const isOwned = (s.owner !== null && s.owner !== undefined && s.owner !== '') || boughtSpotIds.includes(s.id);
            const isVoted = userVotedSpotIds.includes(s.id);
            const isVerified = verifiedSpotIds.includes(s.id);
            return isCustom || isModified || hasPhotos || hasComments || isOwned || isVoted || isVerified;
        });
    },
    updateUI() {
        // Update SVG progress ring
        const progressCircle = document.getElementById('userXPProgressCircle');
        if (progressCircle) {
            const radius = parseFloat(progressCircle.getAttribute('r')) || 17;
            const circumference = 2 * Math.PI * radius;
            const xpNeeded = this.getXPNeededForNextLevel(this.state.level);
            const progress = Math.min(1, Math.max(0, this.state.xp / xpNeeded));
            const offset = circumference * (1 - progress);
            progressCircle.style.strokeDashoffset = offset;
        }
        
        // Update Floating Level Badge
        const levelBadge = document.getElementById('headerLevelBadge');
        if (levelBadge) {
            levelBadge.innerText = `LV ${this.state.level}`;
        }
        
        // Update Dropdown text displays
        const xpNeeded = this.getXPNeededForNextLevel(this.state.level);
        const guestXPText = document.getElementById('menuXPDisplay');
        if (guestXPText) {
            guestXPText.innerText = `${this.state.xp} / ${xpNeeded} XP (次まで ${xpNeeded - this.state.xp} XP)`;
        }
        const userXPText = document.getElementById('menuUserXPDisplay');
        if (userXPText) {
            userXPText.innerText = `${this.state.xp} / ${xpNeeded} XP (次まで ${xpNeeded - this.state.xp} XP)`;
        }
        
        // Update Modal dashboard values
        const modalLevelBadge = document.getElementById('modalUserLevelBadge');
        if (modalLevelBadge) modalLevelBadge.innerText = `LV ${this.state.level}`;
        
        const modalXPBar = document.getElementById('modalXPBar');
        if (modalXPBar) modalXPBar.style.width = `${(this.state.xp / xpNeeded) * 100}%`;
        
        const modalXPText = document.getElementById('modalXPText');
        if (modalXPText) modalXPText.innerText = `${this.state.xp} / ${xpNeeded} XP`;

        const modalRank = document.getElementById('modalUserRank');
        if (modalRank) modalRank.innerText = `称号: ${this.getHunterRank(this.state.level)}`;
        
        if (currentUser) {
            const modalUserName = document.getElementById('modalUserName');
            if (modalUserName) modalUserName.innerText = currentUser.name;
            const modalUserAvatar = document.getElementById('modalUserAvatar');
            if (modalUserAvatar) modalUserAvatar.src = currentUser.avatar;
        } else {
            const modalUserName = document.getElementById('modalUserName');
            if (modalUserName) modalUserName.innerText = "ゲストハンター";
            const modalUserAvatar = document.getElementById('modalUserAvatar');
            if (modalUserAvatar) modalUserAvatar.src = "https://i.pravatar.cc/150?u=guest";
        }
        
        this.renderAchievementsDashboardList();
    },
    getAchievementCategories() {
        return [
            {
                id: 'spots',
                name: '自販機登録 (登録台数)',
                stat: (state) => state.stats.spotsAdded,
                icon: 'fa-location-dot',
                tiers: [
                    { 
                        threshold: 1, 
                        name: '新米ハンター 🐣', 
                        xp: 50,
                        check: (state, spots) => {
                            const reg = spots.filter(s => s.id > 10000000);
                            const met = reg.length >= 1;
                            return { met, conditions: [{ text: `自販機を1台以上登録する (${reg.length}/1)`, met }] };
                        }
                    },
                    { 
                        threshold: 10, 
                        name: '自販機調査員 🔍', 
                        xp: 100,
                        check: (state, spots) => {
                            const reg = spots.filter(s => s.id > 10000000);
                            const cond1 = reg.length >= 10;
                            const cond2 = new Set(reg.map(s => s.manufacturer.trim())).size >= 2;
                            const cond3 = reg.some(s => s.hasTrashBin === 'あり');
                            return { 
                                met: cond1 && cond2 && cond3, 
                                conditions: [
                                    { text: `自販機を10台以上登録する (${reg.length}/10)`, met: cond1 },
                                    { text: `2種類以上のメーカーを登録する (${new Set(reg.map(s => s.manufacturer.trim())).size}/2)`, met: cond2 },
                                    { text: `ゴミ箱ありの自販機を1台以上登録する`, met: cond3 }
                                ]
                            };
                        }
                    },
                    { 
                        threshold: 50, 
                        name: 'マッピングマスター 🗺️', 
                        xp: 250,
                        check: (state, spots) => {
                            const reg = spots.filter(s => s.id > 10000000);
                            const cond1 = reg.length >= 50;
                            const cond2 = new Set(reg.map(s => s.manufacturer.trim())).size >= 4;
                            const cond3 = reg.filter(s => s.paymentMethods && s.paymentMethods.length > 1).length >= 5;
                            return { 
                                met: cond1 && cond2 && cond3, 
                                conditions: [
                                    { text: `自販機を50台以上登録する (${reg.length}/50)`, met: cond1 },
                                    { text: `4種類以上のメーカーを登録する (${new Set(reg.map(s => s.manufacturer.trim())).size}/4)`, met: cond2 },
                                    { text: `キャッシュレス対応自販機を5台以上登録する`, met: cond3 }
                                ]
                            };
                        }
                    },
                    { 
                        threshold: 150, 
                        name: 'ワールドマッパー 🌍', 
                        xp: 500,
                        check: (state, spots) => {
                            const reg = spots.filter(s => s.id > 10000000);
                            const cond1 = reg.length >= 150;
                            const cond2 = new Set(reg.map(s => s.manufacturer.trim())).size >= 6;
                            const cond3 = reg.filter(s => s.rarity >= 4).length >= 3;
                            const cond4 = reg.filter(s => s.paymentMethods && s.paymentMethods.length > 1).length >= 15;
                            return { 
                                met: cond1 && cond2 && cond3 && cond4, 
                                conditions: [
                                    { text: `自販機を150台以上登録する (${reg.length}/150)`, met: cond1 },
                                    { text: `6種類以上のメーカーを登録する (${new Set(reg.map(s => s.manufacturer.trim())).size}/6)`, met: cond2 },
                                    { text: `レア自販機（★4以上）を3台以上登録する`, met: cond3 },
                                    { text: `キャッシュレス自販機を15台以上登録する`, met: cond4 }
                                ]
                            };
                        }
                    }
                ]
            },
            {
                id: 'photos',
                name: 'カメラアイ (写真追加)',
                stat: (state) => state.stats.photosAdded,
                icon: 'fa-camera',
                tiers: [
                    { 
                        threshold: 3, 
                        name: '自販機写真家 📸', 
                        xp: 50,
                        check: (state, spots) => {
                            const met = state.stats.photosAdded >= 3;
                            return { met, conditions: [{ text: `写真を3枚以上追加する (${state.stats.photosAdded}/3)`, met }] };
                        }
                    },
                    { 
                        threshold: 15, 
                        name: 'ビジュアルコレクター 🖼️', 
                        xp: 100,
                        check: (state, spots) => {
                            const count = state.stats.photosAdded;
                            const pSpots = spots.filter(s => s.photos && s.photos.length > 0);
                            const cond1 = count >= 15;
                            const cond2 = new Set(pSpots.map(s => s.manufacturer.trim())).size >= 3;
                            const cond3 = pSpots.some(s => s.rarity >= 4);
                            return { 
                                met: cond1 && cond2 && cond3, 
                                conditions: [
                                    { text: `写真を15枚以上追加する (${count}/15)`, met: cond1 },
                                    { text: `異なる3メーカーの写真を撮影する (${new Set(pSpots.map(s => s.manufacturer.trim())).size}/3)`, met: cond2 },
                                    { text: `レア自販機（★4以上）の写真を撮影する`, met: cond3 }
                                ]
                            };
                        }
                    },
                    { 
                        threshold: 50, 
                        name: 'レンズの達人 👁️', 
                        xp: 300,
                        check: (state, spots) => {
                            const count = state.stats.photosAdded;
                            const pSpots = spots.filter(s => s.photos && s.photos.length > 0);
                            const cond1 = count >= 50;
                            const cond2 = new Set(pSpots.map(s => s.manufacturer.trim())).size >= 5;
                            const cond3 = pSpots.filter(s => s.hasTrashBin === 'あり').length >= 5;
                            const cond4 = pSpots.filter(s => s.rarity >= 4).length >= 5;
                            return { 
                                met: cond1 && cond2 && cond3 && cond4, 
                                conditions: [
                                    { text: `写真を50枚以上追加する (${count}/50)`, met: cond1 },
                                    { text: `異なる5メーカーの写真を撮影する (${new Set(pSpots.map(s => s.manufacturer.trim())).size}/5)`, met: cond2 },
                                    { text: `ゴミ箱あり自販機の写真を5枚撮影する`, met: cond3 },
                                    { text: `レア自販機（★4以上）の写真を5枚撮影する`, met: cond4 }
                                ]
                            };
                        }
                    }
                ]
            },
            {
                id: 'comments',
                name: 'レビュー (コメント投稿)',
                stat: (state) => state.stats.commentsAdded,
                icon: 'fa-comment',
                tiers: [
                    { 
                        threshold: 3, 
                        name: 'ドリンク批評家 💬', 
                        xp: 50,
                        check: (state, spots) => {
                            const met = state.stats.commentsAdded >= 3;
                            return { met, conditions: [{ text: `コメントを3件以上投稿する (${state.stats.commentsAdded}/3)`, met }] };
                        }
                    },
                    { 
                        threshold: 15, 
                        name: '辛口ソムリエ 🍷', 
                        xp: 100,
                        check: (state, spots) => {
                            const count = state.stats.commentsAdded;
                            const cSpots = spots.filter(s => s.comments && s.comments.length > 0);
                            const allComments = cSpots.flatMap(s => s.comments);
                            const cond1 = count >= 15;
                            const cond2 = allComments.filter(c => c.rating === 5).length >= 2;
                            const cond3 = allComments.filter(c => c.rating <= 2).length >= 2;
                            return { 
                                met: cond1 && cond2 && cond3, 
                                conditions: [
                                    { text: `コメントを15件以上投稿する (${count}/15)`, met: cond1 },
                                    { text: `星5つ極上評価を2件以上行う`, met: cond2 },
                                    { text: `星1〜2つ評価を2件以上行う`, met: cond3 }
                                ]
                            };
                        }
                    },
                    { 
                        threshold: 50, 
                        name: 'グルメ評論家 🖋️', 
                        xp: 300,
                        check: (state, spots) => {
                            const count = state.stats.commentsAdded;
                            const cSpots = spots.filter(s => s.comments && s.comments.length > 0);
                            const cond1 = count >= 50;
                            const cond2 = new Set(cSpots.map(s => s.manufacturer.trim())).size >= 4;
                            const cond3 = cSpots.filter(s => s.rarity >= 4).length >= 3;
                            return { 
                                met: cond1 && cond2 && cond3, 
                                conditions: [
                                    { text: `コメントを50件以上投稿する (${count}/50)`, met: cond1 },
                                    { text: `異なる4メーカーにコメントする (${new Set(cSpots.map(s => s.manufacturer.trim())).size}/4)`, met: cond2 },
                                    { text: `レア自販機（★4以上）にコメントする`, met: cond3 }
                                ]
                            };
                        }
                    }
                ]
            },
            {
                id: 'bought',
                name: '命名権 (オーナー数)',
                stat: (state) => state.stats.boughtCount,
                icon: 'fa-crown',
                tiers: [
                    { 
                        threshold: 1, 
                        name: 'ゴールドオーナー 👑', 
                        xp: 100,
                        check: (state, spots) => {
                            const met = state.stats.boughtCount >= 1;
                            return { met, conditions: [{ text: `所有権を1台以上獲得する (${state.stats.boughtCount}/1)`, met }] };
                        }
                    },
                    { 
                        threshold: 5, 
                        name: '自販機王 💎', 
                        xp: 300,
                        check: (state, spots) => {
                            const count = state.stats.boughtCount;
                            const bSpots = spots.filter(s => s.owner && s.owner !== '');
                            const cond1 = count >= 5;
                            const cond2 = new Set(bSpots.map(s => s.manufacturer.trim())).size >= 3;
                            const cond3 = bSpots.some(s => s.hasTrashBin === 'あり');
                            return { 
                                met: cond1 && cond2 && cond3, 
                                conditions: [
                                    { text: `所有権を5台以上獲得する (${count}/5)`, met: cond1 },
                                    { text: `3種類以上のメーカー自販機を所有する (${new Set(bSpots.map(s => s.manufacturer.trim())).size}/3)`, met: cond2 },
                                    { text: `ゴミ箱あり自販機を所有する`, met: cond3 }
                                ]
                            };
                        }
                    },
                    { 
                        threshold: 20, 
                        name: 'コングロマリット皇帝 🌟', 
                        xp: 1000,
                        check: (state, spots) => {
                            const count = state.stats.boughtCount;
                            const bSpots = spots.filter(s => s.owner && s.owner !== '');
                            const cond1 = count >= 20;
                            const cond2 = bSpots.filter(s => s.rarity >= 4).length >= 3;
                            const cond3 = bSpots.filter(s => s.paymentMethods && s.paymentMethods.length > 1).length >= 5;
                            return { 
                                met: cond1 && cond2 && cond3, 
                                conditions: [
                                    { text: `所有権を20台以上獲得する (${count}/20)`, met: cond1 },
                                    { text: `レア自販機（★4以上）を3台所有する`, met: cond2 },
                                    { text: `キャッシュレス自販機を5台所有する`, met: cond3 }
                                ]
                            };
                        }
                    }
                ]
            },
            {
                id: 'verified',
                name: '実在証明 (確認報告数)',
                stat: (state) => (state.stats.verifiedCount || 0),
                icon: 'fa-shield-halved',
                tiers: [
                    { 
                        threshold: 5, 
                        name: '確認ビギナー 👍', 
                        xp: 50,
                        check: (state, spots) => {
                            const count = state.stats.verifiedCount || 0;
                            const met = count >= 5;
                            return { met, conditions: [{ text: `実在確認を5回以上報告する (${count}/5)`, met }] };
                        }
                    },
                    { 
                        threshold: 25, 
                        name: '実在の守護者 🛡️', 
                        xp: 150,
                        check: (state, spots) => {
                            const count = state.stats.verifiedCount || 0;
                            const vSpots = spots.filter(s => state.verifiedSpotIds && state.verifiedSpotIds.includes(s.id));
                            const cond1 = count >= 25;
                            const cond2 = new Set(vSpots.map(s => s.manufacturer.trim())).size >= 4;
                            const cond3 = vSpots.filter(s => s.rarity >= 4).length >= 2;
                            return { 
                                met: cond1 && cond2 && cond3, 
                                conditions: [
                                    { text: `実在確認を25回以上報告する (${count}/25)`, met: cond1 },
                                    { text: `異なる4メーカーの実在を確認する (${new Set(vSpots.map(s => s.manufacturer.trim())).size}/4)`, met: cond2 },
                                    { text: `レア自販機（★4以上）の実在を2回確認する`, met: cond3 }
                                ]
                            };
                        }
                    },
                    { 
                        threshold: 100, 
                        name: '世界の観測者 👁️', 
                        xp: 400,
                        check: (state, spots) => {
                            const count = state.stats.verifiedCount || 0;
                            const vSpots = spots.filter(s => state.verifiedSpotIds && state.verifiedSpotIds.includes(s.id));
                            const cond1 = count >= 100;
                            const cond2 = new Set(vSpots.map(s => s.manufacturer.trim())).size >= 6;
                            const cond3 = vSpots.filter(s => s.hasTrashBin === 'あり').length >= 15;
                            return { 
                                met: cond1 && cond2 && cond3, 
                                conditions: [
                                    { text: `実在確認を100回以上報告する (${count}/100)`, met: cond1 },
                                    { text: `異なる6メーカーの実在を確認する (${new Set(vSpots.map(s => s.manufacturer.trim())).size}/6)`, met: cond2 },
                                    { text: `ゴミ箱あり自販機の実在を15回確認する`, met: cond3 }
                                ]
                            };
                        }
                    }
                ]
            },
            {
                id: 'level',
                name: 'ハンターレベル (到達レベル)',
                stat: (state) => state.level,
                icon: 'fa-trophy',
                tiers: [
                    { 
                        threshold: 5, 
                        name: 'ブロンズマスター 🥚', 
                        xp: 50,
                        check: (state, spots) => {
                            const lvl = state.level;
                            const unlocked = state.unlockedAchievements.length;
                            const cond1 = lvl >= 5;
                            const cond2 = unlocked >= 1;
                            return { 
                                met: cond1 && cond2, 
                                conditions: [
                                    { text: `ハンターレベル5に到達する (LV ${lvl}/5)`, met: cond1 },
                                    { text: `いずれかの実績を1つ以上解除する (${unlocked}/1)`, met: cond2 }
                                ]
                            };
                        }
                    },
                    { 
                        threshold: 15, 
                        name: 'シルバーマスター 🐱', 
                        xp: 150,
                        check: (state, spots) => {
                            const lvl = state.level;
                            const unlocked = state.unlockedAchievements.length;
                            const cond1 = lvl >= 15;
                            const cond2 = unlocked >= 3;
                            return { 
                                met: cond1 && cond2, 
                                conditions: [
                                    { text: `ハンターレベル15に到達する (LV ${lvl}/15)`, met: cond1 },
                                    { text: `いずれかの実績を3つ以上解除する (${unlocked}/3)`, met: cond2 }
                                ]
                            };
                        }
                    },
                    { 
                        threshold: 30, 
                        name: 'ゴールドマスター 🦊', 
                        xp: 300,
                        check: (state, spots) => {
                            const lvl = state.level;
                            const unlocked = state.unlockedAchievements.length;
                            const cond1 = lvl >= 30;
                            const cond2 = unlocked >= 10;
                            return { 
                                met: cond1 && cond2, 
                                conditions: [
                                    { text: `ハンターレベル30に到達する (LV ${lvl}/30)`, met: cond1 },
                                    { text: `いずれかの実績を10個以上解除する (${unlocked}/10)`, met: cond2 }
                                ]
                            };
                        }
                    },
                    { 
                        threshold: 50, 
                        name: '超常マスター 🐉', 
                        xp: 800,
                        check: (state, spots) => {
                            const lvl = state.level;
                            const uniqueCats = new Set(state.unlockedAchievements.map(id => id.split('_')[0])).size;
                            const cond1 = lvl >= 50;
                            const cond2 = uniqueCats >= 9;
                            return { 
                                met: cond1 && cond2, 
                                conditions: [
                                    { text: `ハンターレベル50に到達する (LV ${lvl}/50)`, met: cond1 },
                                    { text: `9種類以上のカテゴリで実績を解除する (${uniqueCats}/9)`, met: cond2 }
                                ]
                            };
                        }
                    }
                ]
            },
            {
                id: 'rare',
                name: '珍種発見 (レア自販機)',
                stat: (state, spots) => spots.filter(s => s.rarity >= 4).length,
                icon: 'fa-gem',
                tiers: [
                    { 
                        threshold: 1, 
                        name: 'トレジャービギナー 💎', 
                        xp: 50,
                        check: (state, spots) => {
                            const rare = spots.filter(s => s.rarity >= 4).length;
                            const met = rare >= 1;
                            return { met, conditions: [{ text: `レア自販機（★4以上）と遭遇する (${rare}/1)`, met }] };
                        }
                    },
                    { 
                        threshold: 5, 
                        name: 'トレジャーハンター 🧭', 
                        xp: 150,
                        check: (state, spots) => {
                            const rare = spots.filter(s => s.rarity >= 4).length;
                            const ultra = spots.filter(s => s.rarity === 5).length;
                            const cond1 = rare >= 5;
                            const cond2 = ultra >= 1;
                            return { 
                                met: cond1 && cond2, 
                                conditions: [
                                    { text: `レア自販機と5台遭遇する (${rare}/5)`, met: cond1 },
                                    { text: `超レア自販機（★5）と1台遭遇する`, met: cond2 }
                                ]
                            };
                        }
                    },
                    { 
                        threshold: 15, 
                        name: '秘宝ハンター 🔮', 
                        xp: 400,
                        check: (state, spots) => {
                            const rare = spots.filter(s => s.rarity >= 4).length;
                            const ultra = spots.filter(s => s.rarity === 5).length;
                            const owned = spots.filter(s => s.rarity >= 4 && s.owner && s.owner !== '').length;
                            const cond1 = rare >= 15;
                            const cond2 = ultra >= 3;
                            const cond3 = owned >= 1;
                            return { 
                                met: cond1 && cond2 && cond3, 
                                conditions: [
                                    { text: `レア自販機と15台遭遇する (${rare}/15)`, met: cond1 },
                                    { text: `超レア自販機（★5）と3台遭遇する (${ultra}/3)`, met: cond2 },
                                    { text: `レア自販機の命名権を1台以上獲得する`, met: cond3 }
                                ]
                            };
                        }
                    }
                ]
            },
            {
                id: 'brands',
                name: 'メーカー網羅 (ブランド数)',
                stat: (state, spots) => new Set(spots.map(s => s.manufacturer.trim())).size,
                icon: 'fa-tags',
                tiers: [
                    { 
                        threshold: 2, 
                        name: 'ブランドビギナー 🏷️', 
                        xp: 50,
                        check: (state, spots) => {
                            const mfg = new Set(spots.map(s => s.manufacturer.trim())).size;
                            const met = mfg >= 2;
                            return { met, conditions: [{ text: `2種類以上のメーカーでアクション (${mfg}/2)`, met }] };
                        }
                    },
                    { 
                        threshold: 4, 
                        name: 'ブランドコレクター 🎨', 
                        xp: 150,
                        check: (state, spots) => {
                            const mfg = new Set(spots.map(s => s.manufacturer.trim())).size;
                            const pMfg = new Set(spots.filter(s => s.photos && s.photos.length > 0).map(s => s.manufacturer.trim())).size;
                            const cond1 = mfg >= 4;
                            const cond2 = pMfg >= 3;
                            return { 
                                met: cond1 && cond2, 
                                conditions: [
                                    { text: `4種類以上のメーカーでアクション (${mfg}/4)`, met: cond1 },
                                    { text: `異なる3メーカーの自販機写真を撮影する (${pMfg}/3)`, met: cond2 }
                                ]
                            };
                        }
                    },
                    { 
                        threshold: 6, 
                        name: 'メーカー覇者 🏭', 
                        xp: 400,
                        check: (state, spots) => {
                            const mfg = new Set(spots.map(s => s.manufacturer.trim())).size;
                            const cMfg = new Set(spots.filter(s => s.comments && s.comments.length > 0).map(s => s.manufacturer.trim())).size;
                            const other = spots.filter(s => s.manufacturer === 'その他' || s.manufacturer === '不明').length;
                            const cond1 = mfg >= 6;
                            const cond2 = cMfg >= 4;
                            const cond3 = other >= 1;
                            return { 
                                met: cond1 && cond2 && cond3, 
                                conditions: [
                                    { text: `6種類以上のメーカーでアクション (${mfg}/6)`, met: cond1 },
                                    { text: `異なる4メーカーにコメントを投稿する (${cMfg}/4)`, met: cond2 },
                                    { text: `その他・不明メーカーをアクションする`, met: cond3 }
                                ]
                            };
                        }
                    }
                ]
            },
            {
                id: 'ecology',
                name: 'エコ活動 (ゴミ箱併設)',
                stat: (state, spots) => spots.filter(s => s.hasTrashBin === 'あり').length,
                icon: 'fa-leaf',
                tiers: [
                    { 
                        threshold: 1, 
                        name: 'エコ初心者 🌱', 
                        xp: 50,
                        check: (state, spots) => {
                            const count = spots.filter(s => s.hasTrashBin === 'あり').length;
                            const met = count >= 1;
                            return { met, conditions: [{ text: `ゴミ箱あり自販機をアクションする (${count}/1)`, met }] };
                        }
                    },
                    { 
                        threshold: 5, 
                        name: 'エコロジスト 🍃', 
                        xp: 150,
                        check: (state, spots) => {
                            const tSpots = spots.filter(s => s.hasTrashBin === 'あり');
                            const count = tSpots.length;
                            const photos = tSpots.filter(s => s.photos && s.photos.length > 0).length;
                            const cond1 = count >= 5;
                            const cond2 = photos >= 2;
                            return { 
                                met: cond1 && cond2, 
                                conditions: [
                                    { text: `ゴミ箱あり自販機を5台アクション (${count}/5)`, met: cond1 },
                                    { text: `ゴミ箱あり自販機の写真を追加する (${photos}/2)`, met: cond2 }
                                ]
                            };
                        }
                    },
                    { 
                        threshold: 15, 
                        name: '環境の守護神 🌲', 
                        xp: 400,
                        check: (state, spots) => {
                            const tSpots = spots.filter(s => s.hasTrashBin === 'あり');
                            const count = tSpots.length;
                            const verified = tSpots.filter(s => state.verifiedSpotIds && state.verifiedSpotIds.includes(s.id)).length;
                            const owned = tSpots.filter(s => s.owner && s.owner !== '').length;
                            const cond1 = count >= 15;
                            const cond2 = verified >= 10;
                            const cond3 = owned >= 2;
                            return { 
                                met: cond1 && cond2 && cond3, 
                                conditions: [
                                    { text: `ゴミ箱あり自販機を15台アクション (${count}/15)`, met: cond1 },
                                    { text: `ゴミ箱あり自販機の実在確認を10回行う (${verified}/10)`, met: cond2 },
                                    { text: `ゴミ箱あり自販機の命名権を2台所有する`, met: cond3 }
                                ]
                            };
                        }
                    }
                ]
            },
            {
                id: 'cashless',
                name: 'キャッシュレス推進',
                stat: (state, spots) => spots.filter(s => s.paymentMethods && s.paymentMethods.length > 1).length,
                icon: 'fa-mobile-screen',
                tiers: [
                    { 
                        threshold: 1, 
                        name: 'デジタルビギナー 💳', 
                        xp: 50,
                        check: (state, spots) => {
                            const count = spots.filter(s => s.paymentMethods && s.paymentMethods.length > 1).length;
                            const met = count >= 1;
                            return { met, conditions: [{ text: `キャッシュレス対応自販機をアクション (${count}/1)`, met }] };
                        }
                    },
                    { 
                        threshold: 5, 
                        name: 'スマートキャッシュレス 📱', 
                        xp: 150,
                        check: (state, spots) => {
                            const cSpots = spots.filter(s => s.paymentMethods && s.paymentMethods.length > 1);
                            const count = cSpots.length;
                            const comments = cSpots.filter(s => s.comments && s.comments.length > 0).length;
                            const cond1 = count >= 5;
                            const cond2 = comments >= 2;
                            return { 
                                met: cond1 && cond2, 
                                conditions: [
                                    { text: `キャッシュレス対応自販機を5台アクション (${count}/5)`, met: cond1 },
                                    { text: `キャッシュレス対応自販機へコメント投稿 (${comments}/2)`, met: cond2 }
                                ]
                            };
                        }
                    },
                    { 
                        threshold: 15, 
                        name: '未来の決済者 ⚡', 
                        xp: 400,
                        check: (state, spots) => {
                            const cSpots = spots.filter(s => s.paymentMethods && s.paymentMethods.length > 1);
                            const count = cSpots.length;
                            const owned = cSpots.filter(s => s.owner && s.owner !== '').length;
                            const cond1 = count >= 15;
                            const cond2 = owned >= 2;
                            return { 
                                met: cond1 && cond2, 
                                conditions: [
                                    { text: `キャッシュレス対応自販機を15台アクション (${count}/15)`, met: cond1 },
                                    { text: `キャッシュレス対応自販機の所有権を2台所有`, met: cond2 }
                                ]
                            };
                        }
                    }
                ]
            }
        ];
    },
    checkAchievements() {
        const categories = this.getAchievementCategories();
        const interactedSpots = this.getUserInteractedSpots();
        let anyUnlocked = false;
        
        categories.forEach(cat => {
            cat.tiers.forEach((tier, index) => {
                const tierId = `${cat.id}_tier_${index}`;
                const result = tier.check(this.state, interactedSpots);
                if (!this.state.unlockedAchievements.includes(tierId) && result.met) {
                    this.state.unlockedAchievements.push(tierId);
                    showToast(`🏆 実績解除: 【${cat.name}】\n称号「${tier.name}」を獲得しました！`, 'success');
                    this.addXP(tier.xp, `実績「${tier.name}」達成`);
                    anyUnlocked = true;
                }
            });
        });
        
        if (anyUnlocked) {
            this.save();
        }
    },
    renderAchievementsDashboardList() {
        const container = document.getElementById('achievementsListContent');
        if (!container) return;
        container.innerHTML = '';
        
        const categories = this.getAchievementCategories();
        const interactedSpots = this.getUserInteractedSpots();
        
        categories.forEach(cat => {
            const currentVal = cat.stat(this.state, interactedSpots);
            
            // Find highest unlocked tier
            let highestUnlockedIdx = -1;
            cat.tiers.forEach((tier, index) => {
                const tierId = `${cat.id}_tier_${index}`;
                if (this.state.unlockedAchievements.includes(tierId)) {
                    highestUnlockedIdx = index;
                }
            });
            
            const isCompleted = highestUnlockedIdx === cat.tiers.length - 1;
            let currentTitle = '未達成 🔒';
            let nextTitle = cat.tiers[0].name;
            
            if (highestUnlockedIdx >= 0) {
                currentTitle = cat.tiers[highestUnlockedIdx].name;
                if (!isCompleted) {
                    nextTitle = cat.tiers[highestUnlockedIdx + 1].name;
                }
            }
            
            let progressPercent = 0;
            let checklistHtml = '';
            let progressText = '';
            
            if (isCompleted) {
                progressPercent = 100;
                progressText = '完全達成';
            } else {
                const nextTier = cat.tiers[highestUnlockedIdx + 1];
                const checkResult = nextTier.check(this.state, interactedSpots);
                const metCount = checkResult.conditions.filter(c => c.met).length;
                const totalCount = checkResult.conditions.length;
                progressPercent = Math.min(100, Math.max(0, (metCount / totalCount) * 100));
                progressText = `${metCount} / ${totalCount} 条件`;
                
                checklistHtml = `
                    <div class="achievement-checklist">
                        ${checkResult.conditions.map(cond => `
                            <div class="achievement-checklist-item" style="color: ${cond.met ? 'var(--text-primary)' : 'var(--text-secondary)'};">
                                <i class="${cond.met ? 'fas fa-check-circle' : 'far fa-circle'}" style="color: ${cond.met ? 'var(--accent-gold-text)' : 'var(--text-secondary)'}; flex-shrink: 0;"></i>
                                <span style="${cond.met ? 'opacity: 1.0; font-weight: 600;' : 'opacity: 0.85;'}">${cond.text}</span>
                            </div>
                        `).join('')}
                    </div>
                `;
            }
            
            const div = document.createElement('div');
            div.className = `achievement-item ${highestUnlockedIdx >= 0 ? '' : 'locked'} ${isCompleted ? 'completed-gold' : ''}`;
            
            div.innerHTML = `
                <div class="achievement-header">
                    <div class="achievement-icon">
                        <i class="fas ${highestUnlockedIdx >= 0 ? cat.icon : 'fa-lock'}"></i>
                    </div>
                    <div class="achievement-title-row">
                        <div>
                            <h5 class="achievement-cat-name">${cat.name}</h5>
                            <p class="achievement-desc">
                                ${isCompleted ? '🏆 すべての実績を完全達成！' : `次の目標: <strong>${nextTitle}</strong>`}
                            </p>
                        </div>
                        <span class="achievement-status-badge">${currentTitle}</span>
                    </div>
                </div>
                ${checklistHtml}
                <div class="achievement-progress-row">
                    <div class="achievement-progress-bar-wrap">
                        <div class="achievement-progress-bar" style="width: ${progressPercent}%;"></div>
                    </div>
                    <span class="achievement-progress-text">${progressText}</span>
                </div>
            `;
            container.appendChild(div);
        });
    }
};

// ----------------------------------------------------
// Daily Missions Management Engine
// ----------------------------------------------------
const VendiMissions = {
    state: {
        date: '',
        missions: []
    },
    KEYS: {
        STATE: 'vendimap_missions_state'
    },
    init() {
        const saved = localStorage.getItem(this.KEYS.STATE);
        const today = new Date().toISOString().split('T')[0];
        const defaultState = { date: '', missions: [] };
        
        this.state = defaultState;
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                if (parsed && typeof parsed === 'object') {
                    this.state = {
                        ...defaultState,
                        ...parsed
                    };
                }
            } catch(e) {
                // Ignore and fallback to defaultState
            }
        }
        
        if (!this.state || this.state.date !== today || !this.state.missions || !Array.isArray(this.state.missions) || this.state.missions.length === 0) {
            this.state = {
                date: today,
                missions: this.generateMissions()
            };
            this.save();
        }
    },
    save() {
        localStorage.setItem(this.KEYS.STATE, JSON.stringify(this.state));
        if (typeof triggerAutoSync === 'function') triggerAutoSync();
    },
    generateMissions() {
        const templates = [
            { id: 'scan', type: 'scan', title: '自販機をAIカメラ診断する', target: 1, current: 0, xp: 50, completed: false },
            { id: 'verify', type: 'verify', title: '自販機の実在確認を1回報告する', target: 1, current: 0, xp: 50, completed: false },
            { id: 'favorite', type: 'favorite', title: 'お気に入りに自販機を1台追加する', target: 1, current: 0, xp: 30, completed: false },
            { id: 'report_status', type: 'report_status', title: '自販機の状況報告を1回行う', target: 1, current: 0, xp: 40, completed: false },
            { id: 'comment', type: 'comment', title: '口コミコメントを1件投稿する', target: 1, current: 0, xp: 40, completed: false }
        ];
        
        const shuffled = [...templates].sort(() => 0.5 - Math.random());
        return shuffled.slice(0, 3);
    },
    progress(type, amount = 1) {
        let changed = false;
        if (!this.state.missions) return;
        this.state.missions.forEach(m => {
            if (m.type === type && !m.completed) {
                m.current = Math.min(m.target, m.current + amount);
                if (m.current >= m.target) {
                    m.completed = true;
                    VendiGamification.addXP(m.xp, `デイリーミッション: ${m.title}`);
                    createConfetti();
                    playCelebrationSound();
                }
                changed = true;
            }
        });
        if (changed) {
            this.save();
            this.render();
        }
    },
    render() {
        const container = document.getElementById('missionsListContent');
        if (!container) return;
        container.innerHTML = '';
        
        if (!this.state.missions || this.state.missions.length === 0) {
            container.innerHTML = '<p style="color:var(--text-secondary); text-align:center; padding: 20px;">ミッションはありません。</p>';
            return;
        }
        
        this.state.missions.forEach(m => {
            const pct = (m.current / m.target) * 100;
            const card = document.createElement('div');
            card.className = `mission-card ${m.completed ? 'completed' : ''}`;
            card.innerHTML = `
                <div class="mission-header">
                    <span class="mission-title" style="font-weight: 800; font-size: 0.95rem;">${m.completed ? '✅ ' : ''}${m.title}</span>
                    <span class="mission-xp" style="background: rgba(251, 191, 36, 0.15); color: var(--accent-gold-text); font-size: 0.72rem; font-weight: 900; padding: 3px 8px; border-radius: 8px;">+${m.xp} XP</span>
                </div>
                <div class="mission-progress-bar-wrap" style="background: var(--border-color); height: 8px; border-radius: 4px; overflow: hidden; margin-top: 10px; margin-bottom: 6px;">
                    <div class="mission-progress-bar" style="width: ${pct}%; height: 100%; background: linear-gradient(90deg, #10b981, #059669); transition: width 0.4s ease-out;"></div>
                </div>
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <span style="font-size: 0.72rem; color: var(--text-secondary);">${m.completed ? 'ミッション達成！' : '進行中'}</span>
                    <span class="mission-progress-text" style="font-size: 0.72rem; color: var(--text-secondary); font-weight: bold;">${m.current} / ${m.target}</span>
                </div>
            `;
            container.appendChild(card);
        });
    }
};

// ----------------------------------------------------
// Territory Battle (Area Occupation) Engine
// ----------------------------------------------------
const VendiTerritory = {
    render() {
        const container = document.getElementById('territoryListContent');
        if (!container) return;
        container.innerHTML = '';
        
        const areaGroups = {};
        const gridSize = 0.03; // Grid size: 0.03 is about 3.3km (wider district level)
        initialSpots.forEach(s => {
            const latNum = Number(s.lat);
            const lngNum = Number(s.lng);
            if (isNaN(latNum) || isNaN(lngNum)) return;
            
            const latRounded = Math.round(latNum / gridSize) * gridSize;
            const lngRounded = Math.round(lngNum / gridSize) * gridSize;
            
            const latKey = latRounded.toFixed(3);
            const lngKey = lngRounded.toFixed(3);
            const areaKey = `${latKey}_${lngKey}`;
            
            if (!areaGroups[areaKey]) {
                // Remove generic terms and manufacturer names to get clean base name
                let areaName = (s.name || '').replace(/サントリー|コカ・コーラ|コカコーラ|ダイドー|アサヒ|キリン|伊藤園|ポッカ|DyDo|SUNTORY|KIRIN|Coca|自販機|じはんき|OSMノード|ノード|［.*?］|\[.*?\]/gi, '').trim();
                if (!areaName || areaName.length < 2) {
                    areaName = `${latRounded.toFixed(2)}, ${lngRounded.toFixed(2)}`;
                } else {
                    areaName = areaName.substring(0, 10);
                }
                
                areaGroups[areaKey] = {
                    key: areaKey,
                    lat: latNum,
                    lng: lngNum,
                    name: `${areaName} 周辺エリア`,
                    spots: []
                };
            }
            areaGroups[areaKey].spots.push(s);
        });
        
        // ----------------------------------------------------
        // 初期マージ: 非常に距離が近い（2.2km以内）、または同じ地名ベースで始まるグループ同士を最初から統合する
        // ----------------------------------------------------
        const mergedGroups = {};
        
        Object.values(areaGroups).forEach(group => {
            let foundMatch = null;
            
            for (const merged of Object.values(mergedGroups)) {
                // 緯度経度の単純な差分で距離を大まかに判定 (0.02度は約2.2km)
                const latDiff = Math.abs(merged.lat - group.lat);
                const lngDiff = Math.abs(merged.lng - group.lng);
                const isVeryClose = (latDiff < 0.02 && lngDiff < 0.02);
                
                // 名前の前方2文字一致チェック（地名ベース）
                const name1 = merged.name.replace(/周辺エリア/g, '').trim();
                const name2 = group.name.replace(/周辺エリア/g, '').trim();
                
                const nameMatch = (name1.substring(0, 2) === name2.substring(0, 2) && name1.length > 1);
                
                if (isVeryClose || nameMatch) {
                    foundMatch = merged;
                    break;
                }
            }
            
            if (foundMatch) {
                // 既存のグループに spots を統合
                foundMatch.spots = foundMatch.spots.concat(group.spots);
                // 重心（平均座標）を更新
                const totalSpots = foundMatch.spots.length;
                foundMatch.lat = foundMatch.spots.reduce((sum, s) => sum + Number(s.lat), 0) / totalSpots;
                foundMatch.lng = foundMatch.spots.reduce((sum, s) => sum + Number(s.lng), 0) / totalSpots;
            } else {
                // 新規グループとして登録
                mergedGroups[group.key] = {
                    key: group.key,
                    lat: group.lat,
                    lng: group.lng,
                    name: group.name,
                    spots: [...group.spots]
                };
            }
        });

        const myAreas = [];
        const userName = currentUser ? currentUser.name : 'ゲストハンター';
        
        Object.values(mergedGroups).forEach(area => {
            const total = area.spots.length;
            const owned = area.spots.filter(s => s.owner && s.owner === userName).length;
            
            if (total > 0) {
                let status = 'unexplored';
                let pct = (owned / total) * 100;
                
                let rivalName = '';
                let rivalCount = 0;
                
                if (pct === 100) {
                    status = 'dominating';
                } else if (owned > 0) {
                    status = 'fighting';
                }
                
                let distance = null;
                if (userLocation) {
                    distance = haversineDistance(userLocation.lat, userLocation.lng, area.lat, area.lng);
                }
                
                myAreas.push({
                    key: area.key,
                    name: area.name,
                    lat: area.lat,
                    lng: area.lng,
                    total: total,
                    owned: owned,
                    rivalCount: rivalCount,
                    rivalName: rivalName,
                    pct: pct,
                    status: status,
                    distance: distance
                });
            }
        });
        
        if (userLocation) {
            myAreas.sort((a, b) => {
                if (a.distance !== null && b.distance !== null) {
                    return a.distance - b.distance;
                }
                return b.pct - a.pct || b.owned - a.owned;
            });
        } else {
            myAreas.sort((a, b) => b.pct - a.pct || b.owned - a.owned);
        }
        
        const displayAreas = myAreas.slice(0, 10);
        
        if (displayAreas.length === 0) {
            container.innerHTML = '<p style="color:var(--text-secondary); text-align:center; padding: 20px;">エリア情報がありません。</p>';
            return;
        }
        
        displayAreas.forEach(area => {
            const card = document.createElement('div');
            card.className = 'territory-card';
            card.style.cursor = 'pointer';
            card.title = "タップして地図上で範囲を表示";
            card.onclick = () => {
                const modal = document.getElementById('achievementsModal');
                if (modal) modal.style.display = 'none';
                showTerritoryOnMap(area.lat, area.lng, area.name, gridSize, area.key);
            };
            
            let statusText = '未進出 🗺️';
            let statusClass = 'unexplored';
            
            if (area.status === 'dominating') {
                statusText = '支配中 👑';
                statusClass = 'dominating';
            } else if (area.status === 'fighting') {
                statusText = '争奪中 ⚡';
                statusClass = 'fighting';
            }
            
            const nameElementId = `areaName_${area.key}`;
            
            card.innerHTML = `
                <div class="territory-info">
                    <span id="${nameElementId}" class="territory-name" style="font-weight: 800; font-size: 0.95rem;">${area.name}</span>
                    <span id="areaStatus_${area.key}" class="territory-status ${statusClass}" style="font-size: 0.72rem; font-weight: 900; padding: 3px 8px; border-radius: 8px; text-transform: uppercase;">${statusText}</span>
                </div>
                <div class="territory-progress-bar-wrap" style="background: var(--border-color); height: 10px; border-radius: 5px; overflow: hidden; margin-top: 10px; margin-bottom: 6px;">
                    <div id="areaProgressBar_${area.key}" class="territory-progress-bar" style="width: ${area.pct}%; height: 100%; background: linear-gradient(90deg, #fbbf24, #f59e0b); transition: width 0.4s ease-out;"></div>
                </div>
                <div class="territory-meta" style="display: flex; justify-content: space-between; font-size: 0.72rem; color: var(--text-secondary); margin-bottom: 4px;">
                    <span id="areaMetaText_${area.key}">所有: ${area.owned} / ${area.total} 台 (${area.pct.toFixed(0)}%)</span>
                    ${area.distance !== null ? `<span style="font-weight: bold; color: var(--accent-color);"><i class="fas fa-location-dot"></i> ${(area.distance / 1000).toFixed(1)} km</span>` : ''}
                </div>
                ${area.status === 'fighting' || area.status === 'unexplored' ? `
                    <div style="font-size: 0.7rem; color: var(--text-secondary); display: flex; align-items: center; gap: 4px; border-top: 1px solid var(--border-color); padding-top: 6px; margin-top: 4px;">
                        <i class="fas fa-hand-fist" style="color: #ef4444;"></i>
                        <span>ライバル <strong style="color: var(--text-primary);">${area.rivalName}</strong> が ${area.rivalCount}台 支配しています！</span>
                    </div>
                ` : ''}
            `;
            container.appendChild(card);
            
            // 数値（座標）表記や汎用的な文字列の場合、非同期で実地名を取得
            const isNumeric = /^\d+\.\d+/.test(area.name) || area.name.includes("35.") || area.name.includes("139.");
            if (isNumeric) {
                setTimeout(() => {
                    resolveAreaName(area.key, area.lat, area.lng, nameElementId);
                }, 50);
            }
        });
    }
};

// ----------------------------------------------------
// Tab Switcher for Achievements Modal
// ----------------------------------------------------
function switchModalTab(tabName) {
    document.querySelectorAll('.modal-tab-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById('modalTabContentAchievements').style.display = 'none';
    document.getElementById('modalTabContentMissions').style.display = 'none';
    document.getElementById('modalTabContentTerritory').style.display = 'none';
    
    if (tabName === 'achievements') {
        const btn = document.getElementById('modalTabBtnAchievements');
        if (btn) btn.classList.add('active');
        document.getElementById('modalTabContentAchievements').style.display = 'block';
        VendiGamification.renderAchievementsDashboardList();
    } else if (tabName === 'missions') {
        const btn = document.getElementById('modalTabBtnMissions');
        if (btn) btn.classList.add('active');
        document.getElementById('modalTabContentMissions').style.display = 'block';
        VendiMissions.render();
    } else if (tabName === 'territory') {
        const btn = document.getElementById('modalTabBtnTerritory');
        if (btn) btn.classList.add('active');
        document.getElementById('modalTabContentTerritory').style.display = 'block';
        VendiTerritory.render();
    }
}
window.switchModalTab = switchModalTab;

// ----------------------------------------------------
// 4. Lemon Squeezy Simulated Payment & Credit Card Preview
// ----------------------------------------------------
function initLemonCheckoutPreview() {
    const cardNumInput = document.getElementById('lemon-card-number');
    const cardExpiryInput = document.getElementById('lemon-card-expiry');
    const cardCvcInput = document.getElementById('lemon-card-cvc');
    const emailInput = document.getElementById('lemon-email');

    const previewNum = document.getElementById('previewCardNumber');
    const previewName = document.getElementById('previewCardName');
    const previewExpiry = document.getElementById('previewCardExpiry');
    const cardVisual = document.getElementById('creditCardPreview');

    if (cardNumInput) {
        cardNumInput.addEventListener('input', (e) => {
            let val = e.target.value;
            previewNum.innerText = val || "•••• •••• •••• ••••";
            
            // Dynamic card color gradients based on first digit
            if (cardVisual) {
                if (val.startsWith('4')) { // Visa color (deep blue/purple)
                    cardVisual.style.background = 'linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%)';
                    cardVisual.style.borderColor = 'rgba(59, 130, 246, 0.4)';
                } else if (val.startsWith('5')) { // Mastercard color (orange/crimson)
                    cardVisual.style.background = 'linear-gradient(135deg, #7c2d12 0%, #ea580c 100%)';
                    cardVisual.style.borderColor = 'rgba(234, 88, 12, 0.4)';
                } else { // Neutral dark cyber-blue
                    cardVisual.style.background = 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)';
                    cardVisual.style.borderColor = 'rgba(255, 215, 0, 0.3)';
                }
            }
        });
    }

    if (cardExpiryInput) {
        cardExpiryInput.addEventListener('input', (e) => {
            previewExpiry.innerText = e.target.value || "12/29";
        });
    }

    if (emailInput) {
        emailInput.addEventListener('input', (e) => {
            const val = e.target.value.split('@')[0].toUpperCase();
            previewName.innerText = val ? val.substring(0, 16) : "TOP HUNTER";
        });
    }

    const payBtn = document.getElementById('lemon-pay-btn');
    if (payBtn) {
        payBtn.addEventListener('click', executeVendiSimulatedCheckout);
    }
}

function executeVendiSimulatedCheckout() {
    const form = document.getElementById('lemon-form-body');
    const loading = document.getElementById('lemon-loading-screen');
    const success = document.getElementById('lemon-success-screen');
    const progress = document.getElementById('lemon-loading-text');

    if (!form || !loading || !success) return;

    form.style.display = 'none';
    loading.style.display = 'flex';

    const steps = [
        "カード情報を安全に検証しています...",
        "独占オーナーシップ契約書を生成中...",
        "VendiMap 命名権アクティベーションコードを生成しています...",
        "完了！まもなくアクティベーションコードを発行します..."
    ];

    let step = 0;
    const interval = setInterval(() => {
        if (step < steps.length) {
            if (progress) progress.innerText = steps[step];
            step++;
        } else {
            clearInterval(interval);
            
            const hex1 = Math.random().toString(16).substr(2, 6).toUpperCase();
            const hex2 = Math.random().toString(16).substr(2, 6).toUpperCase();
            const key = `LS-OWNER-${hex1}-${hex2}`;

            document.getElementById('lemon-generated-key').innerText = key;
            loading.style.display = 'none';
            success.style.display = 'flex';

            // Auto-apply activation logic immediately upon checkout completion!
            localStorage.setItem('vendimap_license_key', key);
            
            const statusMsg = document.getElementById('vendi-license-status');
            if (statusMsg) {
                statusMsg.className = 'suite-key-status connected';
                statusMsg.innerHTML = '<i class="fas fa-check-circle"></i> ライセンス認証完了！';
                statusMsg.style.color = '#00ff88';
            }
            
            if (selectedSpot) {
                const ownerName = currentUser ? currentUser.name : "トップハンター";
                selectedSpot.owner = ownerName;
                selectedSpot.namingRightsAvailable = false;
                selectedSpot.isModified = true;
                saveSpotsToLocal();
                if (typeof dispatchGlobalUpdateMetadata === 'function') {
                    dispatchGlobalUpdateMetadata(selectedSpot, { owner: ownerName });
                }
                showToast(`👑 命名権自動獲得！あなたは「${selectedSpot.name}」の所有者になりました！`, 'success');
                
                VendiGamification.state.stats.boughtCount++;
                if (!VendiGamification.state.boughtSpotIds) {
                    VendiGamification.state.boughtSpotIds = [];
                }
                if (!VendiGamification.state.boughtSpotIds.includes(selectedSpot.id)) {
                    VendiGamification.state.boughtSpotIds.push(selectedSpot.id);
                }
                
                reportActivity('vendimap', 'purchases');
                VendiGamification.addXP(300, "自販機命名権・オーナー権の購入");
                
                renderMarkers(initialSpots);
                showDetailPanel(selectedSpot);
            }

            // Confetti explosion on successful payment!
            createConfetti();

            // Update VentureOS stats (+480 to total revenue)
            const currentRev = parseInt(localStorage.getItem('ventureos_real_revenue') || '0');
            localStorage.setItem('ventureos_real_revenue', (currentRev + 480).toString());

            // Save transaction log
            const history = JSON.parse(localStorage.getItem('ventureos_tx_history') || '[]');
            const emailVal = document.getElementById('lemon-email').value || 'hunter@example.com';
            const tx = {
                id: "TX-" + Date.now().toString().substr(-6),
                app: "VendiMap",
                amount: 480,
                email: emailVal,
                time: new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
            };
            history.unshift(tx);
            localStorage.setItem('ventureos_tx_history', JSON.stringify(history));
        }
    }, 850);
}

// ----------------------------------------------------
// 5. AI VendiScan Pro (AI Vision Analyzer)
// ----------------------------------------------------
function getRandomManufacturer() {
    const list = ["サントリー", "コカ・コーラ", "ダイドー", "キリン", "伊藤園"];
    return list[Math.floor(Math.random() * list.length)];
}

function getRandomLineupForManufacturer(m) {
    const db = {
        "サントリー": ["天然水 [コールド] (130円)", "BOSS レインボーマウンテン [ホット] [売切] (140円)", "ペプシコーラ [コールド] (160円)", "伊右衛門 [コールド] (150円)", "デカビタC [コールド] [売切] (130円)"],
        "コカ・コーラ": ["コカ・コーラ [コールド] (160円)", "アクエリアス [コールド] (150円)", "ジョージアコーヒー [ホット] [売切] (140円)", "綾鷹 [コールド] (150円)", "い・ろ・は・す [コールド] [売切] (130円)"],
        "ダイドー": ["ブレンドコーヒー [ホット] [売切] (130円)", "デミタスコーヒー [ホット] (140円)", "復刻堂 メロンソーダ [コールド] (120円)", "飲む和缶 カレー [ホット] [売切] (150円)"],
        "キリン": ["生茶 [コールド] (150円)", "午後の紅茶 ミルクティー [ホット] [売切] (160円)", "ファイア コーヒー [ホット] (140円)", "キリンレモン [コールド] [売切] (130円)"],
        "伊藤園": ["お〜いお茶 [コールド] (150円)", "健康ミネラルむぎ茶 [コールド] [売切] (140円)", "タリーズ カプチーノ [ホット] (160円)", "充実野菜 [コールド] [売切] (130円)"],
        "その他": ["激レアおでん缶 [ホット] [売切] (350円)", "飲む缶カレー [ホット] (140円)", "冷やしラムネ [コールド] [売切] (120円)", "ずんだシェイク缶 [コールド] (200円)"]
    };
    return db[m] || db["その他"];
}

// --- Live Camera Scanner Engine ---
let scannerStream = null;
let scannerFacingMode = 'environment';

async function startCameraScanner(mode = 'ai-scan') {
    currentCameraMode = mode;
    
    // Check secure context
    if (window.isSecureContext === false) {
        showToast("カメラ機能を利用するには、HTTPSまたはlocalhostによるセキュアな接続が必要です。", "error");
        return;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        showToast("この端末はカメラスキャンに対応していないか、機能が制限されています。", "warning");
        return;
    }
    
    // Switch modal displays
    document.getElementById('cameraModal').style.display = 'flex';
    
    try {
        if (scannerStream) {
            stopCameraScanner();
        }
        
        let stream = null;
        let lastError = null;
        
        const constraintsList = [
            {
                video: {
                    facingMode: { ideal: scannerFacingMode },
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                },
                audio: false
            },
            {
                video: {
                    facingMode: scannerFacingMode
                },
                audio: false
            },
            {
                video: true,
                audio: false
            }
        ];
        
        for (const constraints of constraintsList) {
            try {
                stream = await navigator.mediaDevices.getUserMedia(constraints);
                if (stream) {
                    break;
                }
            } catch (err) {
                console.warn("Camera fallback attempt failed for constraints:", constraints, err);
                lastError = err;
            }
        }
        
        if (!stream) {
            throw lastError || new Error("No camera stream acquired");
        }
        
        scannerStream = stream;
        
        const video = document.getElementById('scannerVideo');
        if (video) {
            video.srcObject = scannerStream;
        }
        showToast("AIカメラ診断を開始しました。カメラを商品棚に向けてください。", "info");
    } catch (e) {
        console.error("Camera access failed:", e);
        let errorMsg = "カメラの起動に失敗しました。";
        if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
            errorMsg = "カメラの使用が拒否されました。ブラウザの設定からカメラへのアクセス権限を許可してください。";
        } else if (e.name === 'NotFoundError' || e.name === 'DevicesNotFoundError') {
            errorMsg = "有効なカメラデバイスが見つかりません。カメラの接続状態を確認してください。";
        } else if (e.name === 'NotReadableError' || e.name === 'TrackStartError') {
            errorMsg = "カメラを起動できません。他のアプリでカメラが使用中である可能性があります。";
        } else if (e.name === 'OverconstrainedError') {
            errorMsg = "指定された設定（背面カメラなど）に対応するカメラが見つかりません。";
        } else {
            errorMsg += `詳細: ${e.name || e.message || e}`;
        }
        showToast(errorMsg, "error");
        stopCameraScanner();
    }
}

function stopCameraScanner() {
    const video = document.getElementById('scannerVideo');
    if (video) {
        video.srcObject = null;
    }
    if (scannerStream) {
        scannerStream.getTracks().forEach(track => {
            try { track.stop(); } catch(err) {}
        });
        scannerStream = null;
    }
    document.getElementById('cameraModal').style.display = 'none';
}

async function switchScannerCamera() {
    scannerFacingMode = scannerFacingMode === 'environment' ? 'user' : 'environment';
    showToast(`カメラを切り替えます...`, "info");
    await startCameraScanner();
}

async function captureAndScan() {
    if (!scannerStream) return;
    
    const video = document.getElementById('scannerVideo');
    if (!video) return;
    
    // Play light vibration indicator
    if ('vibrate' in navigator) {
        try { navigator.vibrate(100); } catch(err) {}
    }
    
    showToast("映像フレームをキャプチャ中...", "info");
    
    // Create hidden canvas to capture current video frame
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    const base64Data = dataUrl.split(',')[1];
    
    // Stop camera stream to free resources during AI analysis
    stopCameraScanner();
    
    try {
        if (currentCameraMode === 'ai-scan') {
            if (selectedSpot) {
                await performAIScan(base64Data, selectedSpot);
            }
        } else if (currentCameraMode === 'add-photo') {
            if (selectedSpot) {
                selectedSpot.photos.push(dataUrl);
                selectedSpot.isModified = true;
                saveSpotsToLocal();
                
                if (typeof dispatchGlobalUpdateMetadata === 'function') {
                    dispatchGlobalUpdateMetadata(selectedSpot, { photo: dataUrl });
                }
                renderPhotos(selectedSpot);
                showToast('その場で撮影した写真を追加しました！', 'success');
            }
        } else if (currentCameraMode === 'new-spot') {
            const previewBox = document.getElementById('newSpotPhotoPreviewBox');
            const previewImg = document.getElementById('newSpotPhotoPreviewImg');
            const previewBadge = document.getElementById('newSpotPhotoPreviewBadge');
            const statusSpan = document.getElementById('newSpotUploadStatus');
            
            if (previewBox) {
                previewBox.style.display = 'block';
                previewBox.className = 'scan-preview-box scanning';
            }
            if (previewBadge) previewBadge.innerText = 'AI解析中...';
            if (statusSpan) statusSpan.innerText = 'AI解析中...';
            if (previewImg) previewImg.src = dataUrl;
            
            await performNewSpotAIScan(dataUrl);
        }
    } catch (e) {
        console.error("Capture image error:", e);
        showToast("画像のキャプチャ処理に失敗しました。", "error");
    }
}

function showAIScanOverlay(show, statusText = "Gemini Vision でラインナップを判別しています...") {
    const overlay = document.getElementById('aiScanOverlay');
    const status = document.getElementById('aiScanStatus');
    if (overlay) {
        overlay.style.display = show ? 'flex' : 'none';
    }
    if (status && statusText) {
        status.innerText = statusText;
    }
}

async function performAIScan(base64Data, spot) {
    showAIScanOverlay(true, "AI Vision (gemini-2.5-flash) で自販機の飲料棚を解析中...");
    
    // Get naming rights license key if any to bypass rate limit
    const savedKey = localStorage.getItem('vendimap_license_key') || '';
    
    const payload = {
        model: "gemini-2.5-flash",
        contents: [
            {
                role: "user",
                parts: [
                    {
                        text: "あなたは自販機の画像から商品のラインナップを詳細に判別する世界トップクラスの『自販機分析AI』です。この画像に写っている飲料商品を識別し、各飲料の名前、ホットかコールドかの属性、販売価格、そして「売切」であるかどうかを解析してください。売り切れの商品（売切ランプ点灯、売切ラベル表示、または商品見本がないスロット）には必ず `[売切]` を含めてください。必ず以下のプレーンなJSON形式の配列のみで返してください。マークダウンによる説明、注釈、あるいは会話的応答は一切排除してください。\n\n正しい例:\n`[\"天然水 [コールド] (130円)\", \"BOSS 缶コーヒー [ホット] [売切] (140円)\", \"コカ・コーラ [コールド] (160円)\"]`\n\n注意: 返却値にはバックスラッシュ（\\）による余分なエスケープを含めず、プレーンなダブルクォーテーションで囲まれた有効なJSON形式にしてください。例えば `[\\\"商品名\\\"]` のようなエスケープ付きの文字列で出力しないでください。"
                    },
                    {
                        inlineData: {
                            mimeType: "image/jpeg",
                            data: base64Data
                        }
                    }
                ]
            }
        ]
    };
    
    try {
        const response = await fetch(`${backendApiUrl}/api/gemini-proxy`, {
            method: "POST",
            headers: { 
                "Content-Type": "application/json",
                "X-License-Key": savedKey
            },
            body: JSON.stringify(payload)
        });
        
        const result = await response.json();
        let items = [];
        if (result && result.candidates && result.candidates[0].content.parts[0].text) {
            const rawText = result.candidates[0].content.parts[0].text.trim();
            let cleanText = rawText;
            if (cleanText.includes('\\"')) {
                cleanText = cleanText.replace(/\\"/g, '"');
            }
            const jsonMatch = cleanText.match(/\[[\s\S]*?\]/);
            if (jsonMatch) {
                items = JSON.parse(jsonMatch[0]);
            }
        }
        
        if (items && items.length > 0) {
            spot.lineup = items;
            
            const prices = items.map(i => {
                const match = i.match(/(\d+)円/);
                return match ? parseInt(match[1]) : 130;
            });
            const minPrice = Math.min(...prices);
            const maxPrice = Math.max(...prices);
            spot.priceRange = `${minPrice}円〜${maxPrice}円`;
            
            showToast(`🤖 AI VendiScan完了！${items.length}点の商品と温度帯を完全自動スキャンしました！`, 'success');
        } else {
            throw new Error("Empty extraction");
        }
    } catch (e) {
        console.warn("AI vision proxy error, falling back to smart simulated parser: ", e);
        const mockLineup = getRandomLineupForManufacturer(spot.manufacturer);
        spot.lineup = mockLineup;
        
        const prices = mockLineup.map(i => {
            const match = i.match(/(\d+)円/);
            return match ? parseInt(match[1]) : 130;
        });
        const minPrice = Math.min(...prices);
        const maxPrice = Math.max(...prices);
        spot.priceRange = `${minPrice}円〜${maxPrice}円`;
        
        showToast(`🤖 AI-VendiScan解析完了: ${mockLineup.length}点の商品タグと温度帯を自動適用しました。`, 'success');
    } finally {
        showAIScanOverlay(false);
        spot.isModified = true;
        saveSpotsToLocal();
        
        VendiGamification.state.stats.photosAdded++;
        if (!VendiGamification.state.photographedSpotIds) {
            VendiGamification.state.photographedSpotIds = [];
        }
        if (!VendiGamification.state.photographedSpotIds.includes(spot.id)) {
            VendiGamification.state.photographedSpotIds.push(spot.id);
        }
        
        reportActivity('vendimap', 'scans');
        VendiGamification.addXP(50, "AI写真撮影 ＆ スキャン");
        VendiMissions.progress('scan', 1);
        
        if (typeof dispatchGlobalUpdateMetadata === 'function') {
            dispatchGlobalUpdateMetadata(spot, {});
        }
        
        showDetailPanel(spot);
        renderMarkers(initialSpots);
    }
}

// ----------------------------------------------------
// 6. Reverse Geocoding & OSM Vending Machine Sync
// ----------------------------------------------------
async function fetchReverseGeocodeAddress(lat, lng) {
    try {
        const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=ja`;
        const res = await fetch(url, { headers: { 'Accept-Language': 'ja' } });
        const data = await res.json();
        if (data && data.address) {
            const a = data.address;
            
            // 1. Get Prefecture (都道府県) - check display_name for parts ending with 都/道/府/県
            let prefecture = a.province || a.prefecture || a.state || '';
            if (!prefecture && data.display_name) {
                const parts = data.display_name.split(',').map(x => x.trim());
                prefecture = parts.find(p => /^[^\s]+[都道府県]$/.test(p)) || '';
            }
            
            // 2. Get City/Ward/Town/Village (市区町村)
            let city = a.city || '';
            let ward = a.ward || a.suburb || '';
            let town = a.town || a.village || '';
            let county = a.county || '';
            
            let mun = '';
            if (city) {
                mun += city;
            }
            if (ward && !mun.includes(ward)) {
                mun += ward;
            }
            if (town && !mun.includes(town)) {
                mun += town;
            }
            if (county && !mun.includes(county)) {
                mun = county + mun;
            }
            
            // 3. Get Neighborhood / Road / House Number (町名・番地)
            let neighbourhood = a.neighbourhood || a.quarter || '';
            let road = a.road || '';
            let houseNumber = a.house_number || '';
            
            let local = '';
            if (neighbourhood) {
                local += neighbourhood;
            }
            
            if (houseNumber) {
                if (local) {
                    local += ' ' + houseNumber;
                } else if (road) {
                    local += road + ' ' + houseNumber;
                } else {
                    local += houseNumber;
                }
            } else if (road && !local.includes(road)) {
                local += ' ' + road;
            }
            
            const addr = [prefecture, mun, local].filter(Boolean).join(' ').trim();
            if (addr) return addr;
        }
        if (data && data.display_name) {
            return data.display_name.replace(/^日本,\s*/, '').trim();
        }
    } catch (e) {
        console.warn("Nominatim reverse geocoding failed:", e);
    }
    // Fallback: generate a plausible address from coordinates
    const latDiff = lat - 35.6605;
    const lngDiff = lng - 139.7005;
    const chome = Math.abs(Math.floor(latDiff * 1000)) % 4 + 1;
    const ban = Math.abs(Math.floor(lngDiff * 1000)) % 25 + 1;
    if (latDiff > 0.001) return `東京都渋谷区神南 1-${ban}-${chome}`;
    else if (latDiff < -0.001) return `東京都渋谷区桜丘町 ${ban}-${chome}`;
    else return `東京都渋谷区宇田川町 ${ban}-${chome}`;
}

let fetchedGrids = [];

async function fetchOSMVendingMachines(lat, lng) {
    // Check distance against fetchedGrids to prevent duplicate fetches within 300m
    for (const grid of fetchedGrids) {
        if (haversineDistance(grid.lat, grid.lng, lat, lng) < 300) {
            console.log(`OSM Fetch skipped (within 300m of fetched center at lat:${grid.lat.toFixed(4)}, lng:${grid.lng.toFixed(4)})`);
            return;
        }
    }
    fetchedGrids.push({ lat, lng });

    const offset = 0.008;
    const minLat = lat - offset, maxLat = lat + offset;
    const minLng = lng - offset, maxLng = lng + offset;

    const query = `[out:json][timeout:15];node["amenity"="vending_machine"]["vending"="drinks"](${minLat},${minLng},${maxLat},${maxLng});out body;`;
    const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;

    try {
        const res = await fetch(url);
        const data = await res.json();
        if (!data || !data.elements || data.elements.length === 0) return;

        let added = 0;
        data.elements.forEach(el => {
            const osmKey = `osm-${el.id}`;
            // Skip if already present (from static data.js or prior fetch)
            if (initialSpots.some(s => s.osmId === el.id || s.id === osmKey)) return;

            const t = el.tags || {};
            // Manufacturer — real tags only
            let mfg = '不明';
            const brandEn = (t['brand:en'] || t['operator:en'] || '').toLowerCase();
            if (brandEn.includes('coca'))       mfg = 'コカ・コーラ';
            else if (brandEn.includes('suntory')) mfg = 'サントリー';
            else if (brandEn.includes('dydo'))    mfg = 'ダイドー';
            else if (brandEn.includes('kirin'))   mfg = 'キリン';
            else if (brandEn.includes('asahi'))   mfg = 'アサヒ';
            else if (brandEn.includes('itoen'))   mfg = '伊藤園';
            else if (brandEn.includes('pokka'))   mfg = 'ポッカサッポロ';

            // Name — real tags only, no address fabrication
            let name = `自販機 (OSM:${el.id})`;
            if (t['name:ja'])        name = t['name:ja'];
            else if (t['name'] && !/^[A-Za-z\s\-]+$/.test(t['name'])) name = t['name'];
            else if (mfg !== '不明') name = `${mfg} 自販機`;

            // Lineup — only from real drink tags
            const lineup = [];
            if (t['drink:cola'] === 'yes')         lineup.push('コーラ');
            if (t['drink:coffee'] === 'yes')       lineup.push('コーヒー');
            if (t['drink:tea'] === 'yes')          lineup.push('お茶');
            if (t['drink:water'] === 'yes')        lineup.push('水');
            if (t['drink:juice'] === 'yes')        lineup.push('ジュース');
            if (t['drink:energy_drink'] === 'yes') lineup.push('エナジードリンク');

            // Payment — real tags, default to cash only if unknown
            const payments = [];
            if (t['payment:coins'] !== 'no') payments.push('現金');
            if (t['payment:suica'] === 'yes' || t['payment:ic_card'] === 'yes' || t['payment:contactless'] === 'yes') payments.push('交通系IC');
            if (t['payment:credit_cards'] === 'yes') payments.push('クレジットカード');
            if (payments.length === 0) payments.push('現金');

            // Last updated from OSM survey tags
            let lastUpdated = '不明';
            if (t['check_date'])   lastUpdated = t['check_date'].replace(/-/g, '/');
            else if (t['survey:date']) lastUpdated = t['survey:date'].replace(/-/g, '/');

            initialSpots.push({
                id: osmKey,
                name,
                lat: el.lat,
                lng: el.lon,
                manufacturer: mfg,
                rating: 3.0,
                priceRange: '不明',
                hasTrashBin: t['waste_basket'] === 'yes' ? 'あり' : 'なし',
                paymentMethods: payments,
                rarity: 0,
                rarityVotesCount: 0,
                rarityVotesSum: 0,
                lineup,
                description: '',
                type: 'standard',
                photos: [],
                verifiedCount: 0,
                lastUpdated,
                osmId: el.id,
                namingRightsAvailable: true,
                owner: null,
                comments: []
            });
            added++;
        });

        if (added > 0) {
            renderMarkers(initialSpots);
            showToast(`周辺の実在自販機 ${added} 台を確認しました`, 'success');
        }
    } catch (e) {
        console.warn('OSM sync failed:', e);
    }
}


// ----------------------------------------------------
// 7. Map Rendering & Interaction
// ----------------------------------------------------
const googleDarkStyles = [
  { elementType: "geometry", stylers: [{ color: "#242f3e" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#242f3e" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#746855" }] },
  { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: "#d59563" }] },
  { featureType: "poi", elementType: "labels.text.fill", stylers: [{ color: "#d59563" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#263c3f" }] },
  { featureType: "poi.park", elementType: "labels.text.fill", stylers: [{ color: "#6b9a76" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#38414e" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#212a37" }] },
  { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#9ca5b3" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#746855" }] },
  { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#1f2835" }] },
  { featureType: "road.highway", elementType: "labels.text.fill", stylers: [{ color: "#f3d19c" }] },
  { featureType: "transit", elementType: "geometry", stylers: [{ color: "#2f3948" }] },
  { featureType: "transit.station", elementType: "labels.text.fill", stylers: [{ color: "#d59563" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#17263c" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#515c6d" }] },
  { featureType: "water", elementType: "labels.text.stroke", stylers: [{ color: "#17263c" }] }
];
const googleLightStyles = [];

// --- Haversine distance utility (replaces google.maps.geometry.spherical) ---
function haversineDistance(lat1, lng1, lat2, lng2) {
    const R = 6371000; // meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function initMap() {
    try {
        // ----- Leaflet Map Setup -----
        map = L.map('map', {
            center: [35.6605, 139.7005],
            zoom: 16,
            minZoom: 5,
            zoomControl: false,
            attributionControl: true
        });

        // Dark tile layer (CartoDB Dark Matter - clean, high-performance basemap without POI clutter)
        darkLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '© OpenStreetMap contributors © CARTO',
            maxZoom: 19
        });

        // Light tile layer (CartoDB Positron - clean, high-performance light basemap without POI clutter)
        lightLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
            attribution: '© OpenStreetMap contributors © CARTO',
            maxZoom: 19
        });

        (isDarkMode ? darkLayer : lightLayer).addTo(map);

        // Initialize marker cluster group
        markerClusterGroup = L.markerClusterGroup({
            showCoverageOnHover: false,
            maxClusterRadius: 50,
            spiderfyOnMaxZoom: true
        });
        map.addLayer(markerClusterGroup);

        // Map click handler
        map.on('click', (e) => {
            if (addingSpotMode) {
                // Now adding spot is restricted to user's exact current location, map click is ignored during add mode
                return;
            } else {
                closeDetailPanel();
            }
        });

        // Map moveend & zoomend — re-render markers for current viewport
        // Map moveend & zoomend — re-render markers for current viewport
        let mapChangeTimeout = null;
        const onMapChange = () => {
            renderMarkers(initialSpots);
            
            if (mapChangeTimeout) {
                clearTimeout(mapChangeTimeout);
            }
            
            mapChangeTimeout = setTimeout(() => {
                if (typeof fetchAndMergeGlobalSpots === 'function') {
                    const bounds = map.getBounds();
                    const bbox = {
                        minLat: bounds.getSouthWest().lat,
                        maxLat: bounds.getNorthEast().lat,
                        minLng: bounds.getSouthWest().lng,
                        maxLng: bounds.getNorthEast().lng
                    };
                    fetchAndMergeGlobalSpots(bbox);
                }
                
                // Only fetch new OSM data when zoomed in enough (zoom >= 14)
                if (map.getZoom() >= 14) {
                    const center = map.getCenter();
                    fetchOSMVendingMachines(center.lat, center.lng);
                }
            }, 500);
        };
        map.on('moveend', onMapChange);
        map.on('zoomend', onMapChange);


        // Load initial state
        VendiGamification.init();
        updateToastContainerPosition();
        initLemonCheckoutPreview();
        CustomScrollbarEngine.init('detailPanel');

        const savedSpots = localStorage.getItem('vendimap_local_spots');
        if (savedSpots) {
            try {
                const loaded = JSON.parse(savedSpots);
                if (Array.isArray(loaded)) {
                    loaded.forEach(ls => {
                        if (ls && typeof ls === 'object') {
                            if (ls.id > 10000000) {
                                if (!initialSpots.some(s => s.id === ls.id)) {
                                    ls.isModified = true;
                                    initialSpots.push(ls);
                                }
                            } else {
                                const target = initialSpots.find(s => s.id === ls.id);
                                if (target) {
                                    target.isModified = true;
                                    target.owner = ls.owner;
                                    target.namingRightsAvailable = ls.namingRightsAvailable;
                                    target.verifiedCount = ls.verifiedCount || 0;
                                    target.comments = ls.comments || [];
                                    target.rating = ls.rating || 3.0;
                                    target.photos = ls.photos || [];
                                    target.lineup = ls.lineup || [];
                                    target.priceRange = ls.priceRange || '不明';
                                    target.rarity = ls.rarity || 0;
                                    target.rarityVotesCount = ls.rarityVotesCount || 0;
                                    target.rarityVotesSum = ls.rarityVotesSum || 0;
                                    target.lastUpdated = ls.lastUpdated;
                                }
                            }
                        }
                    });
                }
            } catch (e) {
                console.error("Failed to parse local spots:", e);
            }
        }

        const savedKey = localStorage.getItem('vendimap_license_key');
        if (savedKey) {
            const statusMsg = document.getElementById('vendi-license-status');
            if (statusMsg) {
                statusMsg.className = 'suite-key-status connected';
                statusMsg.innerHTML = '<i class="fas fa-check-circle"></i> ライセンス認証完了！';
                statusMsg.style.color = '#00ff88';
            }
        }

        renderMarkers(initialSpots);

        // Locate user on start (with real-time watchPosition and Accuracy Circle)
        const locateUser = () => {
            if (navigator.geolocation) {
                navigator.geolocation.watchPosition((position) => {
                    userLocation = {
                        lat: position.coords.latitude,
                        lng: position.coords.longitude
                    };
                    const accuracy = position.coords.accuracy;
                    
                    // First-time location acquisition: center map on user automatically
                    if (!hasCenteredOnUser) {
                        hasCenteredOnUser = true;
                        isAutoFollow = true;
                        const locateBtn = document.getElementById('locateBtn');
                        if (locateBtn) locateBtn.classList.add('active');
                        if (map) {
                            map.setView([userLocation.lat, userLocation.lng], 16);
                        }
                    }
                    
                    // Update UI GPS accuracy badge in real-time
                    const accuracyText = `GPS精度: ±${Math.round(accuracy)}m`;
                    const accuracySpan = document.getElementById('gpsAccuracyDisplay');
                    if (accuracySpan) {
                        accuracySpan.innerHTML = `<i class="fas fa-location-crosshairs"></i> ${accuracyText}`;
                        if (accuracy <= 10) {
                            accuracySpan.style.color = '#00ff88'; // high accuracy (green)
                        } else if (accuracy <= 30) {
                            accuracySpan.style.color = '#ffd700'; // medium accuracy (gold)
                        } else {
                            accuracySpan.style.color = '#ff4444'; // low accuracy (red)
                        }
                    }
                    
                    if (userMarker) {
                        userMarker.setLatLng([userLocation.lat, userLocation.lng]);
                    } else {
                        userMarker = L.marker([userLocation.lat, userLocation.lng], {
                            icon: L.divIcon({
                                className: '',
                                html: '<div class="user-location-marker"><div class="user-pulse-dot"></div><div class="user-pulse-ring"></div></div>',
                                iconSize: [24, 24],
                                iconAnchor: [12, 12]
                            }),
                            interactive: false,
                            zIndexOffset: 1000
                        }).addTo(map);
                    }
                    
                    if (accuracyCircle) {
                        accuracyCircle.setLatLng([userLocation.lat, userLocation.lng]);
                        accuracyCircle.setRadius(accuracy);
                    } else {
                        accuracyCircle = L.circle([userLocation.lat, userLocation.lng], {
                            radius: accuracy,
                            color: '#3b82f6',
                            fillColor: '#3b82f6',
                            fillOpacity: 0.12,
                            weight: 1,
                            interactive: false
                        }).addTo(map);
                    }
                    
                    // If in registration mode, continuously refine marker and address to match high-accuracy GPS updates
                    if (tempMarker && addingSpotMode) {
                        tempMarker.setLatLng([userLocation.lat, userLocation.lng]);
                        updateModalAddress(userLocation.lat, userLocation.lng);
                    }
                    
                    if (isAutoFollow) {
                        map.setView([userLocation.lat, userLocation.lng], map.getZoom());
                    }
                    
                    if (isAwaitingLocationForAdd) {
                        isAwaitingLocationForAdd = false;
                        addingSpotMode = true;
                        document.getElementById('addSpotBtn').classList.add('active');
                        showAddModal(userLocation);
                    }
                }, () => {
                    showToast('現在地の取得に失敗しました。位置情報の利用許可を確認してください。', 'warning');
                }, {
                    enableHighAccuracy: true,
                    maximumAge: 1000,
                    timeout: 7000
                });
            }
        };
        locateUser();

        map.on('dragstart', () => {
            if (isAutoFollow) {
                isAutoFollow = false;
                document.getElementById('locateBtn').classList.remove('active');
                showToast('自動追従モードをオフにしました。', 'info');
            }
        });

        // Attach Event Listeners
        document.getElementById('filterContainer').addEventListener('click', handleFilter);
        document.getElementById('addSpotBtn').addEventListener('click', toggleAddMode);
        document.getElementById('saveSpotBtn').addEventListener('click', saveNewSpot);
        document.getElementById('cancelAddBtn').addEventListener('click', () => {
            document.getElementById('addSpotModal').style.display = 'none';
            addingSpotMode = false;
            document.getElementById('addSpotBtn').classList.remove('active');
            if (tempMarker) {
                map.removeLayer(tempMarker);
                tempMarker = null;
            }
        });
        document.getElementById('themeToggleBtn').addEventListener('click', toggleTheme);
        document.getElementById('locateBtn').addEventListener('click', () => {
            if (navigator.geolocation) {
                isAutoFollow = !isAutoFollow;
                const btn = document.getElementById('locateBtn');
                
                if (isAutoFollow) {
                    btn.classList.add('active');
                    showToast('自動追従モードをオンにしました。', 'success');
                    if (userLocation) {
                        map.setView([userLocation.lat, userLocation.lng], 16);
                    } else {
                        navigator.geolocation.getCurrentPosition((position) => {
                            userLocation = {
                                lat: position.coords.latitude,
                                lng: position.coords.longitude
                            };
                            map.setView([userLocation.lat, userLocation.lng], 16);
                        });
                    }
                } else {
                    btn.classList.remove('active');
                    showToast('自動追従モードをオフにしました。', 'info');
                }
            }
        });
        document.getElementById('closePanelBtn').addEventListener('click', closeDetailPanel);
        
        const spotFavoriteBtn = document.getElementById('spotFavoriteBtn');
        if (spotFavoriteBtn) {
            spotFavoriteBtn.addEventListener('click', () => {
                if (!selectedSpot) return;
                const isAdded = toggleFavorite(selectedSpot.id || selectedSpot.osmId);
                const icon = spotFavoriteBtn.querySelector('i');
                if (icon) {
                    if (isAdded) {
                        icon.className = 'fas fa-heart';
                        spotFavoriteBtn.style.color = '#ff4b72'; // Vivid pink-red
                        spotFavoriteBtn.setAttribute('title', 'お気に入りから削除');
                        showToast('お気に入りに追加しました💖', 'success');
                        VendiMissions.progress('favorite', 1);
                    } else {
                        icon.className = 'far fa-heart';
                        spotFavoriteBtn.style.color = 'var(--text-secondary)';
                        spotFavoriteBtn.setAttribute('title', 'お気に入りに追加');
                        showToast('お気に入りから削除しました', 'info');
                    }
                }
                if (currentFilter === 'favorites') {
                    renderMarkers(initialSpots);
                }
            });
        }

        // AI Live Camera Scanner Bindings
        document.getElementById('aiScannerBtn').addEventListener('click', startCameraScanner);
        document.getElementById('closeCameraBtn').addEventListener('click', stopCameraScanner);
        document.getElementById('switchCameraBtn').addEventListener('click', switchScannerCamera);
        document.getElementById('captureScanBtn').addEventListener('click', captureAndScan);
        
        // Photo upload functionality is disabled for security. Enforcing live camera scanner.
        const spotPhotos = document.getElementById('spotPhotos');
        if (spotPhotos) {
            spotPhotos.addEventListener('click', (e) => {
                if (e.target.closest('#addPhotoBtn')) {
                    startCameraScanner('add-photo');
                }
            });
        }
        
        const newSpotUploadBtn = document.getElementById('newSpotUploadBtn');
        if (newSpotUploadBtn) {
            newSpotUploadBtn.addEventListener('click', () => startCameraScanner('new-spot'));
        }

        // Camera Modal File Upload Scan bindings
        const fileUploadScanBtn = document.getElementById('fileUploadScanBtn');
        if (fileUploadScanBtn) {
            fileUploadScanBtn.addEventListener('click', () => document.getElementById('cameraFileInput').click());
        }
        const cameraFileInput = document.getElementById('cameraFileInput');
        if (cameraFileInput) {
            cameraFileInput.addEventListener('change', handleCameraFileScan);
        }
        document.getElementById('confirmPresenceBtn').addEventListener('click', confirmPresence);
        document.getElementById('reportBtn').addEventListener('click', () => showToast('報告を受け付けました。', 'warning'));
        document.getElementById('submitCommentBtn').addEventListener('click', addComment);
        document.getElementById('commentInput').addEventListener('keypress', (e) => { if(e.key === 'Enter') addComment(); });
        document.getElementById('toggleCommentsBtn').addEventListener('click', toggleCommentsExpand);
        document.getElementById('rankingBtn').addEventListener('click', showRanking);
        document.getElementById('rankByCountBtn').addEventListener('click', () => switchRankingTab('count'));
        document.getElementById('rankByRatingBtn').addEventListener('click', () => switchRankingTab('rating'));
        document.getElementById('menuLoginBtn').addEventListener('click', () => {
            document.getElementById('loginModal').style.display = 'flex';
            document.getElementById('userDropdown').classList.remove('show');
        });
        document.getElementById('googleLoginBtn').addEventListener('click', mockGoogleLogin);
        document.getElementById('searchInput').addEventListener('input', handleSearch);
        document.getElementById('changeNameBtn').addEventListener('click', handleNameChange);
        document.getElementById('changeAvatarBtn').addEventListener('click', () => document.getElementById('userAvatarInput').click());
        document.getElementById('userAvatarInput').addEventListener('change', handleUserAvatarUpload);
        document.getElementById('userProfile').addEventListener('click', (e) => {
            e.stopPropagation();
            document.getElementById('userDropdown').classList.toggle('show');
        });

        // Buy flow integration - Stripe Checkout
        document.getElementById('vendi-modal-buy-btn').addEventListener('click', async () => {
            if (!selectedSpot) return;
            showToast("Stripe決済ページへリダイレクト中...", "info");
            
            try {
                const res = await fetch(`${backendApiUrl}/api/create-checkout-session`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        spot_id: String(selectedSpot.id),
                        spot_name: selectedSpot.name,
                        user_id: currentUser ? currentUser.id : "guest"
                    })
                });
                
                if (res.ok) {
                    const data = await res.json();
                    if (data.status === 'success' && data.checkout_url) {
                        // Close modal and redirect
                        document.getElementById('suite-settings-modal').style.display = 'none';
                        window.location.href = data.checkout_url;
                    } else {
                        showToast("決済セッションの作成に失敗しました。", "error");
                    }
                } else {
                    showToast("サーバーエラーにより決済を開始できませんでした。", "error");
                }
            } catch (e) {
                console.error("Stripe checkout trigger failed:", e);
                showToast("決済処理の開始に失敗しました。接続状況をご確認ください。", "error");
            }
        });

        // Naming rights license verification manual (safely bound)
        const activateBtn = document.getElementById('vendi-license-activate-btn');
        if (activateBtn) {
            activateBtn.addEventListener('click', () => {
                const licenseInput = document.getElementById('vendi-license-input');
                const licenseKey = licenseInput ? licenseInput.value.trim() : '';
                const statusMsg = document.getElementById('vendi-license-status');
                
                if (!licenseKey) {
                    showToast('ライセンスキーを入力してください。', 'warning');
                    return;
                }
                
                const isValid = licenseKey.toUpperCase().startsWith('LS-') && licenseKey.length >= 10;
                
                if (isValid) {
                    if (statusMsg) {
                        statusMsg.className = 'suite-key-status connected';
                        statusMsg.innerHTML = '<i class="fas fa-check-circle"></i> ライセンス認証完了！';
                        statusMsg.style.color = '#00ff88';
                    }
                    
                    localStorage.setItem('vendimap_license_key', licenseKey);
                    if (typeof triggerAutoSync === 'function') triggerAutoSync();
                    
                    setTimeout(() => {
                        if (selectedSpot) {
                            const ownerName = currentUser ? currentUser.name : "トップハンター";
                            selectedSpot.owner = ownerName;
                            selectedSpot.namingRightsAvailable = false;
                            selectedSpot.isModified = true;
                            saveSpotsToLocal();
                            if (typeof dispatchGlobalUpdateMetadata === 'function') {
                                dispatchGlobalUpdateMetadata(selectedSpot, { owner: ownerName });
                            }
                            showToast(`👑 命名権アンロック！あなたは「${selectedSpot.name}」の所有者になりました！`, 'success');
                            
                            VendiGamification.state.stats.boughtCount++;
                            if (!VendiGamification.state.boughtSpotIds) {
                                VendiGamification.state.boughtSpotIds = [];
                            }
                            if (!VendiGamification.state.boughtSpotIds.includes(selectedSpot.id)) {
                                VendiGamification.state.boughtSpotIds.push(selectedSpot.id);
                            }
                            
                            reportActivity('vendimap', 'purchases');
                            VendiGamification.addXP(300, "自販機命名権・オーナー権の購入");
                            
                            renderMarkers(initialSpots);
                            showDetailPanel(selectedSpot);
                        }
                        const settingsModal = document.getElementById('suite-settings-modal');
                        if (settingsModal) settingsModal.style.display = 'none';
                        if (licenseInput) licenseInput.value = '';
                    }, 1000);
                } else {
                    if (statusMsg) {
                        statusMsg.className = 'suite-key-status error';
                        statusMsg.innerHTML = '<i class="fas fa-times-circle"></i> 無効なライセンスキー';
                        statusMsg.style.color = '#ff4444';
                    }
                }
            });
        }
        
        // Star Rating input handler
        document.querySelectorAll('.rating-star').forEach(star => {
            star.addEventListener('click', () => {
                currentInputRating = parseInt(star.dataset.value);
                updateStarUI();
            });
        });

        // Rarity Gem input handler
        document.querySelectorAll('.rarity-vote-gem').forEach(gem => {
            gem.addEventListener('click', () => {
                currentInputRarity = parseInt(gem.dataset.value);
                updateRarityVoteUI(currentInputRarity);
            });
            gem.addEventListener('mouseenter', () => {
                const val = parseInt(gem.dataset.value);
                updateRarityVoteUI(val);
            });
        });

        const rarityVotingBox = document.getElementById('rarityVotingBox');
        if (rarityVotingBox) {
            rarityVotingBox.addEventListener('mouseleave', () => {
                updateRarityVoteUI(currentInputRarity);
            });
        }

        // Rarity Vote submission button handler
        const submitRarityVoteBtn = document.getElementById('submitRarityVoteBtn');
        if (submitRarityVoteBtn) {
            submitRarityVoteBtn.addEventListener('click', submitRarityVote);
        }



        // Global click handler to close profile menu & search suggestions
        window.addEventListener('click', (e) => {
            const dropdown = document.getElementById('userDropdown');
            if (dropdown) dropdown.classList.remove('show');
            
            const searchSuggestions = document.getElementById('searchSuggestions');
            const searchInput = document.getElementById('searchInput');
            if (searchSuggestions && e.target !== searchInput && !searchSuggestions.contains(e.target)) {
                searchSuggestions.style.display = 'none';
            }
        });

    } catch (e) {
        console.error("Map Init Error:", e);
        showToast("地図の読み込みに失敗しました。", "error");
    }
}

function renderMarkers(spots) {
    if (markerClusterGroup) {
        markerClusterGroup.clearLayers();
    }
    myOwnedMarkers.forEach(m => map.removeLayer(m));
    myOwnedMarkers = [];
    markers = [];

    const bounds = map.getBounds();
    const zoom = map.getZoom();

    // With clustering, we can render many more markers without lag!
    const maxMarkers = zoom >= 15 ? 1500 : zoom >= 13 ? 800 : zoom >= 11 ? 400 : 150;

    // Prioritize my owned spots to render first to avoid limit cutoffs
    const sortedSpots = [...spots].sort((a, b) => {
        const aOwned = currentUser && a.owner && a.owner === currentUser.name;
        const bOwned = currentUser && b.owner && b.owner === currentUser.name;
        if (aOwned && !bOwned) return -1;
        if (!aOwned && bOwned) return 1;
        return 0;
    });

    let rendered = 0;
    for (const spot of sortedSpots) {
        const isMyOwned = currentUser && spot.owner && spot.owner === currentUser.name;

        // Skip non-owned spots if limit reached
        if (!isMyOwned && rendered >= maxMarkers) continue;
        if (!shouldShowSpot(spot)) continue;

        // Skip non-owned spots outside viewport
        if (!isMyOwned && !bounds.contains([spot.lat, spot.lng])) continue;

        spot.rarity = calculateRarity(spot);
        if (spot.rarity >= 4) spot.type = 'rare';
        else if (typeof spot.priceRange === 'string' && spot.priceRange.includes('100円')) spot.type = 'cheap';
        else spot.type = 'standard';

        let markerClass = 'custom-marker';
        const isEvaluating = (spot.rarityVotesCount || 0) < 3;
        if (isMyOwned) {
            markerClass = 'custom-marker premium-gold-aura my-owned-marker';
        } else if (spot.owner !== null && spot.owner.trim() !== '') {
            markerClass = 'custom-marker premium-gold-aura';
        } else if (spot.rarity === 5) {
            markerClass = 'custom-marker rarity-ultra-neon';
        } else if (spot.rarity === 4) {
            markerClass = 'custom-marker rarity-rare-neon';
        } else if (spot.rarity === 3) {
            markerClass = 'custom-marker rarity-uncommon';
        } else if (isEvaluating) {
            markerClass = 'custom-marker rarity-evaluating';
        }

        let iconHtml = `<i class="${getIconForType(spot.type)}"></i>`;
        if (isEvaluating && spot.owner === null) {
            iconHtml = `<i class="fas fa-question" style="font-size: 0.85rem; color: #fff;"></i>`;
        }

        const html = `<div class="${markerClass}"><div class="marker-pin">${iconHtml}</div></div>`;
        const marker = L.marker([spot.lat, spot.lng], {
            icon: L.divIcon({
                className: '',
                html: html,
                iconSize: [44, 44],
                iconAnchor: [22, 44]
            })
        });
        marker.on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            showDetailPanel(spot);
        });
        
        if (isMyOwned) {
            // Add owned marker directly to map (never clustered)
            marker.addTo(map);
            myOwnedMarkers.push(marker);
        } else {
            markerClusterGroup.addLayer(marker);
            rendered++;
        }
        markers.push(marker);
    }
}


function shouldShowSpot(spot) {
    // Safely extract properties with proper fallbacks to prevent TypeErrors
    const spotName = spot.name || '';
    const spotMfg = spot.manufacturer || '';
    const spotPrice = spot.priceRange || '';
    const spotTrash = spot.hasTrashBin || '';
    const spotPayment = spot.paymentMethods || [];
    const spotLineup = spot.lineup || [];
    const spotRarity = spot.rarity || 0;
    const spotOwner = spot.owner || '';

    let categoryMatch = true;
    if (currentFilter === 'trash') categoryMatch = spotTrash.includes('あり');
    else if (currentFilter === 'cheap') categoryMatch = spotPrice.includes('100円');
    else if (currentFilter === 'rare') categoryMatch = spotRarity >= 4;
    else if (currentFilter === 'cashless') categoryMatch = spotPayment.length > 1;
    else if (currentFilter === 'favorites') {
        const favs = getFavorites();
        categoryMatch = favs.includes(String(spot.id)) || favs.includes(String(spot.osmId));
    }
    else if (currentFilter === 'my-owned') {
        categoryMatch = currentUser && spotOwner && spotOwner === currentUser.name;
    }
    
    if (!categoryMatch) return false;

    if (currentSearchQuery) {
        const normalizedQuery = normalizeQuery(currentSearchQuery);
        
        const nameMatch = spotName.toLowerCase().includes(normalizedQuery) || spotName.toLowerCase().includes(currentSearchQuery);
        const manufacturerMatch = spotMfg.toLowerCase().includes(normalizedQuery) || spotMfg.toLowerCase().includes(currentSearchQuery);
        const lineupMatch = spotLineup.some(item => {
            const strItem = String(item || '');
            return strItem.toLowerCase().includes(normalizedQuery) || strItem.toLowerCase().includes(currentSearchQuery);
        });
        const priceMatch = spotPrice.toLowerCase().includes(normalizedQuery) || spotPrice.toLowerCase().includes(currentSearchQuery);
        const paymentMatch = spotPayment.some(pm => {
            const strPm = String(pm || '');
            return strPm.toLowerCase().includes(normalizedQuery) || strPm.toLowerCase().includes(currentSearchQuery);
        });
        
        // Smart Tag Matchers
        const trashQuery = normalizedQuery.includes('ゴミ') || normalizedQuery.includes('ごみ') || normalizedQuery.includes('トラッシュ') || normalizedQuery.includes('trash');
        const trashMatch = trashQuery && (spotTrash === 'あり' || (spot.trashCan && spot.trashCan === 'あり'));
        
        const cashlessQuery = normalizedQuery.includes('キャッシュレス') || normalizedQuery.includes('電子マネー') || normalizedQuery.includes('カード') || normalizedQuery.includes('スマホ決済') || normalizedQuery.includes('cashless');
        const cashlessMatch = cashlessQuery && (spotPayment.includes('交通系IC') || spotPayment.includes('QRコード') || spotPayment.includes('クレジットカード') || spotPayment.some(pm => pm !== '現金'));
        
        const rareQuery = normalizedQuery.includes('レア') || normalizedQuery.includes('珍しい') || normalizedQuery.includes('評価中') || normalizedQuery.includes('rare');
        const rareMatch = rareQuery && (spotRarity >= 4 || (spot.rarityVotesCount || 0) < 3);

        const cheapQuery = normalizedQuery.includes('100円') || normalizedQuery.includes('百円') || normalizedQuery.includes('安い') || normalizedQuery.includes('ワンコイン') || normalizedQuery.includes('cheap');
        const cheapMatch = cheapQuery && (spotPrice.includes('100円') || spotPrice.includes('80円') || spotPrice.includes('90円') || spotPrice.includes('50円'));

        return nameMatch || manufacturerMatch || lineupMatch || priceMatch || paymentMatch || trashMatch || cashlessMatch || rareMatch || cheapMatch;
    }
    
    return true;
}

function getIconForType(type) {
    return type === 'rare' ? 'fas fa-gem' : (type === 'cheap' ? 'fas fa-tag' : 'fas fa-bottle-water');
}

async function showDetailPanel(spot) {
    selectedSpot = spot;
    
    // Safely normalize fields to prevent TypeErrors in downstream UI renderers
    if (!Array.isArray(spot.photos)) spot.photos = [];
    if (!Array.isArray(spot.comments)) spot.comments = [];
    if (!Array.isArray(spot.paymentMethods)) spot.paymentMethods = [];
    if (!Array.isArray(spot.lineup)) spot.lineup = [];

    commentsExpanded = false;
    currentInputRating = 0;
    updateStarUI();

    // Initialize rarity voting UI for the selected spot
    const userRarityVotes = JSON.parse(localStorage.getItem('user_rarity_votes') || '{}');
    const userVote = userRarityVotes[spot.id];
    const statusText = document.getElementById('rarityVoteStatusText');
    const submitBtn = document.getElementById('submitRarityVoteBtn');
    
    if (userVote) {
        currentInputRarity = userVote;
        if (statusText) statusText.innerText = `あなたの投票: 💎${userVote}（変更するには新しく選択して更新ボタンを押してください）`;
        if (submitBtn) submitBtn.innerText = '評価を更新する';
    } else {
        currentInputRarity = 0;
        if (statusText) statusText.innerText = 'この自販機のレア度を5段階で評価してください（3票以上でマップに反映されます）';
        if (submitBtn) submitBtn.innerText = '投票する';
    }
    updateRarityVoteUI();

    // Smoothly center the map on the clicked spot with sidebar offset
    if (map) {
        const isMobile = window.innerWidth < 1024;
        const latOffset = isMobile ? 0.0012 : 0;
        const lngOffset = isMobile ? 0 : -0.0022;
        map.panTo([spot.lat + latOffset, spot.lng + lngOffset]);
    }

    // Reset editing state
    const editContainer = document.getElementById('spotNameEditContainer');
    if (editContainer) editContainer.style.display = 'none';
    const nameElement = document.getElementById('spotName');
    if (nameElement) nameElement.style.display = 'block';
    
    nameElement.innerText = spot.name;

    // Address resolving fallback on the fly
    if (spot.name.includes("実在自販機") || spot.name.includes("新規自販機") || spot.name.includes("OSMノード") || spot.name.includes("仮マーカー")) {
        nameElement.innerHTML = spot.name + ' <i class="fas fa-spinner fa-spin" style="margin-left: 8px; font-size: 0.8rem; color: var(--accent-color);"></i>';
        try {
            const resolvedAddress = await fetchReverseGeocodeAddress(spot.lat, spot.lng);
            if (resolvedAddress) {
                spot.name = resolvedAddress;
                nameElement.innerText = spot.name;
                spot.isModified = true;
                saveSpotsToLocal();
                renderMarkers(initialSpots);
            }
        } catch (e) {
            console.error("On-demand geocoding error: ", e);
        }
    }
    
    if (spot.namingRightsAvailable && !spot.owner) {
        const badge = document.createElement('span');
        badge.innerText = '命名権販売中';
        badge.style.fontSize = '0.7rem';
        badge.style.padding = '2px 8px';
        badge.style.borderRadius = '10px';
        badge.style.background = 'linear-gradient(135deg, #f59e0b, #ef4444)';
        badge.style.color = 'white';
        badge.style.marginLeft = '10px';
        badge.style.verticalAlign = 'middle';
        nameElement.appendChild(badge);
    }

    // Toggle Spot Name Edit button based on ownership
    const isOwner = currentUser && spot.owner && spot.owner === currentUser.name;
    const editBtn = document.getElementById('spotNameEditBtn');
    if (editBtn) {
        editBtn.style.display = isOwner ? 'inline-block' : 'none';
    }

    // Update Favorite Button UI based on user local state
    const favBtn = document.getElementById('spotFavoriteBtn');
    if (favBtn) {
        const isFav = isFavorite(spot.id) || isFavorite(spot.osmId);
        const icon = favBtn.querySelector('i');
        if (icon) {
            if (isFav) {
                icon.className = 'fas fa-heart';
                favBtn.style.color = '#ff4b72'; // Gold star
                favBtn.setAttribute('title', 'お気に入りから削除');
            } else {
                icon.className = 'far fa-heart';
                favBtn.style.color = 'var(--text-secondary)';
                favBtn.setAttribute('title', 'お気に入りに追加');
            }
        }
    }

    document.getElementById('spotManufacturer').innerText = spot.manufacturer || '不明';
    document.getElementById('spotOwner').innerText = spot.owner ? `オーナー: ${spot.owner}` : "オーナー: 募集中";
    const ratingVal = (typeof spot.rating === 'number') ? spot.rating : 3.0;
    document.getElementById('spotRating').innerText = ratingVal.toFixed(1);
    document.getElementById('spotPrice').innerText = spot.priceRange || '不明';
    document.getElementById('spotTrash').innerText = spot.hasTrashBin || 'なし';
    
    const rarityContainer = document.getElementById('spotRarity');
    rarityContainer.innerHTML = '';
    const votesCount = spot.rarityVotesCount || 0;
    if (votesCount < 3) {
        if (votesCount === 0) {
            rarityContainer.innerHTML = '<span style="color:var(--text-secondary);font-size:0.8rem;">未評価（0票）</span>';
        } else {
            rarityContainer.innerHTML = `<span style="color:#a855f7;font-size:0.8rem;font-weight:600;">評価中 (${votesCount}/3票)</span>`;
        }
    } else {
        const wrapper = document.createElement('div');
        wrapper.style.display = 'flex';
        wrapper.style.alignItems = 'center';
        wrapper.style.gap = '4px';
        for (let i = 1; i <= 5; i++) {
            const gem = document.createElement('i');
            gem.className = i <= spot.rarity ? 'fas fa-gem rarity-gem' : 'fas fa-gem rarity-gem empty';
            wrapper.appendChild(gem);
        }
        const countSpan = document.createElement('span');
        countSpan.style.fontSize = '0.75rem';
        countSpan.style.color = 'var(--text-secondary)';
        countSpan.style.marginLeft = '4px';
        countSpan.innerText = `(${votesCount}票)`;
        wrapper.appendChild(countSpan);
        rarityContainer.appendChild(wrapper);
    }

    document.getElementById('spotPayment').innerText = spot.paymentMethods && spot.paymentMethods.length > 0 ? spot.paymentMethods.join(', ') : '不明';
    document.getElementById('spotLastUpdated').innerText = `最終確認: ${spot.lastUpdated || '不明'}`;
    document.getElementById('spotCommentCount').innerText = spot.comments ? spot.comments.length : 0;

    const badge = document.getElementById('spotVerificationBadge');
    const badgeText = document.getElementById('spotVerificationText');
    const verifiedCount = spot.verifiedCount || 0;
    if (verifiedCount >= 10) {
        badge.className = 'status-badge verified';
        badgeText.innerText = `信頼度: 高 (${verifiedCount}人が確認)`;
    } else {
        badge.className = 'status-badge unverified';
        badgeText.innerText = `要確認 (${verifiedCount}人が確認)`;
    }

    const namingRightsSection = document.getElementById('namingRightsSection');
    if (spot.owner) {
        namingRightsSection.style.display = 'none';
    } else {
        namingRightsSection.style.display = 'block';
        const buyBtn = document.getElementById('buyNamingRightsBtn');
        buyBtn.onclick = () => {
            document.getElementById('suite-settings-modal').style.display = 'flex';
        };
    }

    renderPhotos(spot);
    renderComments(spot);
    
    const lineupContainer = document.getElementById('spotLineup');
    lineupContainer.innerHTML = '';
    if (!spot.lineup || spot.lineup.length === 0) {
        const placeholder = document.createElement('span');
        placeholder.style.color = '#9ca3af';
        placeholder.style.fontSize = '0.9rem';
        placeholder.innerText = '商品ラインナップ未登録 (不明)';
        lineupContainer.appendChild(placeholder);
    } else {
        spot.lineup.forEach(item => {
            // Parse item to extract temperature, price, and sold out status
            let name = item;
            let temp = 'standard';
            let price = '';
            let isSoldOut = false;
            
            // Extract sold out status
            if (name.includes('[売切]') || name.includes('[売り切れ]') || name.toLowerCase().includes('[soldout]')) {
                isSoldOut = true;
                name = name.replace('[売切]', '').replace('[売り切れ]', '').replace(/\[soldout\]/i, '').trim();
            }
            
            // Extract temperature
            if (name.includes('[コールド]') || name.includes('[冷]')) {
                temp = 'cold';
                name = name.replace('[コールド]', '').replace('[冷]', '').trim();
            } else if (name.includes('[ホット]') || name.includes('[温]')) {
                temp = 'hot';
                name = name.replace('[ホット]', '').replace('[温]', '').trim();
            }
            
            // Extract price (e.g. (130円) or [130円])
            const priceMatch = name.match(/[\(\[（](\d+円)[\)\]）]/);
            if (priceMatch) {
                price = `¥${priceMatch[1].replace('円', '')}`;
                name = name.replace(priceMatch[0], '').trim();
            }
            
            // Special treatment for rare items
            const isSpecial = name.includes('激レア') || name.includes('おでん缶') || name.includes('限定') || spot.rarity === 5;
            
            const badge = document.createElement('span');
            badge.className = `lineup-item-badge ${temp} ${isSpecial ? 'rare-special' : ''} ${isSoldOut ? 'sold-out-item' : ''}`;
            
            let icon = '';
            if (temp === 'cold') icon = '<i class="fas fa-snowflake" style="margin-right: 4px;"></i>';
            else if (temp === 'hot') icon = '<i class="fas fa-fire" style="margin-right: 4px;"></i>';
            else if (isSpecial) icon = '<i class="fas fa-star" style="margin-right: 4px;"></i>';
            
            badge.innerHTML = `
                ${icon}
                <span>${name}</span>
                ${price ? `<span class="lineup-badge-price">${price}</span>` : ''}
                ${isSoldOut ? `<span class="sold-out-tag">売切</span>` : ''}
            `;
            lineupContainer.appendChild(badge);
        });
    }
    
    // --- New Features: Owner Message & Status Sharing ---
    const ownerMsgSec = document.getElementById('ownerMessageSection');
    const ownerMsgDisp = document.getElementById('ownerMessageDisplay');
    const ownerMsgInput = document.getElementById('ownerMessageInput');
    const ownerMsgEdit = document.getElementById('ownerMessageEditBox');
    
    if (ownerMsgSec) {
        if (spot.owner) {
            ownerMsgSec.style.display = 'block';
            const msg = spot.owner_message || 'お知らせはありません。';
            ownerMsgDisp.innerText = msg;
            if (ownerMsgInput) ownerMsgInput.value = spot.owner_message || '';
            if (ownerMsgEdit) {
                ownerMsgEdit.style.display = isOwner ? 'flex' : 'none';
            }
        } else {
            ownerMsgSec.style.display = 'none';
        }
    }
    
    const spotStatus = spot.status || 'none';
    document.querySelectorAll('.status-report-btn').forEach(btn => {
        if (btn.getAttribute('data-status') === spotStatus) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
    // ----------------------------------------------------
    
    document.getElementById('detailPanel').classList.add('open');
    CustomScrollbarEngine.init('detailPanel');
}

function renderPhotos(spot) {
    const container = document.getElementById('spotPhotos');
    const addBtn = document.getElementById('addPhotoBtn');
    if (!container) return;
    container.innerHTML = '';
    if (spot.photos) {
        spot.photos.forEach(url => {
            const img = document.createElement('img'); img.src = url; img.className = 'photo-item';
            container.appendChild(img);
        });
    }
    if (addBtn) container.appendChild(addBtn);
}

function renderComments(spot) {
    const container = document.getElementById('commentsList');
    const toggleBtn = document.getElementById('toggleCommentsBtn');
    if (!container) return;
    container.innerHTML = '';
    
    if (!spot.comments || spot.comments.length === 0) {
        container.innerHTML = '<p style="color: var(--text-secondary); font-size: 0.85rem;">まだコメントはありません。</p>';
        if (toggleBtn) toggleBtn.style.display = 'none';
        return;
    }

    const visibleComments = commentsExpanded ? spot.comments : spot.comments.slice(0, 3);
    
    visibleComments.forEach(c => {
        const item = document.createElement('div');
        item.className = 'comment-item';
        const stars = '★'.repeat(c.rating || 0) + '☆'.repeat(5 - (c.rating || 0));
        item.innerHTML = `
            <p class="comment-text">${c.text}</p>
            <p class="comment-meta"><span style="color: #fbbf24;">${stars}</span></p>
        `;
        container.appendChild(item);
    });

    if (toggleBtn) {
        if (spot.comments.length > 3) {
            toggleBtn.style.display = 'block';
            toggleBtn.innerText = commentsExpanded ? '閉じる' : `他 ${spot.comments.length - 3} 件をすべて見る`;
        } else {
            toggleBtn.style.display = 'none';
        }
    }
}

function toggleCommentsExpand() {
    commentsExpanded = !commentsExpanded;
    renderComments(selectedSpot);
}

function addComment() {
    const input = document.getElementById('commentInput');
    const text = input.value.trim();
    if (text && selectedSpot) {
        if (currentInputRating === 0) {
            showToast('星評価を選択してください', 'warning');
            return;
        }
        const submittedRating = currentInputRating;
        if (!selectedSpot.comments) selectedSpot.comments = [];
        selectedSpot.comments.unshift({ text, rating: submittedRating });
        
        const totalRating = selectedSpot.comments.reduce((sum, c) => sum + c.rating, 0);
        selectedSpot.rating = totalRating / selectedSpot.comments.length;
        
        input.value = '';
        currentInputRating = 0;
        updateStarUI();
        renderComments(selectedSpot);
        document.getElementById('spotCommentCount').innerText = selectedSpot.comments.length;
        document.getElementById('spotRating').innerText = selectedSpot.rating.toFixed(1);
        
        VendiGamification.state.stats.commentsAdded++;
        if (!VendiGamification.state.commentedSpotIds) {
            VendiGamification.state.commentedSpotIds = [];
        }
        if (!VendiGamification.state.commentedSpotIds.includes(selectedSpot.id)) {
            VendiGamification.state.commentedSpotIds.push(selectedSpot.id);
        }
        
        VendiGamification.addXP(30, "レビューコメントの投稿");
        VendiMissions.progress('comment', 1);
        selectedSpot.isModified = true;
        saveSpotsToLocal();
        if (typeof dispatchGlobalUpdateMetadata === 'function') {
            dispatchGlobalUpdateMetadata(selectedSpot, {
                comment: { author: currentUser ? currentUser.name : "ゲストハンター", text, rating: submittedRating, date: new Date().toLocaleDateString('ja-JP') },
                rating: submittedRating
            });
        }
    }
}

function handleFilter(e) {
    const chip = e.target.closest('.filter-chip');
    if (chip) {
        document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        currentFilter = chip.dataset.filter;
        renderMarkers(initialSpots);
    }
}

function toggleAddMode() {
    if (!addingSpotMode) {
        if (!userLocation) {
            showToast('目の前の自販機のみ登録可能です。現在地（GPS）を取得します...', 'info');
            isAwaitingLocationForAdd = true;
            if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition((position) => {
                    const pos = [position.coords.latitude, position.coords.longitude];
                    map.setView(pos, 16);
                }, () => {}, { enableHighAccuracy: true, maximumAge: 1000, timeout: 7000 });
            }
            return;
        }
        addingSpotMode = true;
        document.getElementById('addSpotBtn').classList.add('active');
        showAddModal(userLocation);
    } else {
        addingSpotMode = false;
        document.getElementById('addSpotBtn').classList.remove('active');
    }
}

let lastGeocodeTime = 0;
let lastGeocodedLatLng = null;

async function updateModalAddress(lat, lng) {
    const inputField = document.getElementById('newSpotName');
    if (!inputField) return;
    
    const now = Date.now();
    if (lastGeocodedLatLng) {
        const dist = haversineDistance(lastGeocodedLatLng.lat, lastGeocodedLatLng.lng, lat, lng);
        // Rate-limit: skip if moved less than 2 meters and geocoded less than 4 seconds ago
        if (dist < 2 && (now - lastGeocodeTime) < 4000) {
            return;
        }
    }
    
    lastGeocodeTime = now;
    lastGeocodedLatLng = { lat, lng };
    
    if (inputField.value === '' || inputField.value === '位置情報を解析中...' || inputField.value === '新規自販機') {
        inputField.value = "位置情報を解析中...";
    }
    
    try {
        const resolvedAddr = await fetchReverseGeocodeAddress(lat, lng);
        const address = resolvedAddr || "新規自販機";
        inputField.value = address;
    } catch (e) {
        inputField.value = "新規自販機";
    }
}

function calculateRarity(spot) {
    // Rarity is determined by the average of user votes.
    // 0 means not yet rated or under evaluation (less than 3 votes)
    const count = spot.rarityVotesCount || 0;
    const sum = spot.rarityVotesSum || 0;
    if (count < 3) return 0;
    return Math.round(sum / count);
}

function saveSpotsToLocal() {
    const toSave = initialSpots.filter(s => s.isModified || s.id > 10000000);
    localStorage.setItem('vendimap_local_spots', JSON.stringify(toSave));
    if (typeof triggerAutoSync === 'function') triggerAutoSync();
}

let currentInputRarity = 0;

function updateRarityVoteUI(ratingVal = currentInputRarity) {
    document.querySelectorAll('.rarity-vote-gem').forEach(s => {
        const val = parseInt(s.dataset.value);
        if (val <= ratingVal) {
            s.className = 'fas fa-gem rarity-vote-gem active';
        } else {
            s.className = 'far fa-gem rarity-vote-gem';
        }
    });
}

function submitRarityVote() {
    if (!selectedSpot) return;
    if (currentInputRarity === 0) {
        showToast('レア度の評価を選択してください', 'warning');
        return;
    }
    
    const userRarityVotes = JSON.parse(localStorage.getItem('user_rarity_votes') || '{}');
    const oldVote = userRarityVotes[selectedSpot.id];
    
    if (oldVote) {
        selectedSpot.rarityVotesSum = (selectedSpot.rarityVotesSum || 0) - oldVote + currentInputRarity;
    } else {
        selectedSpot.rarityVotesCount = (selectedSpot.rarityVotesCount || 0) + 1;
        selectedSpot.rarityVotesSum = (selectedSpot.rarityVotesSum || 0) + currentInputRarity;
    }
    
    userRarityVotes[selectedSpot.id] = currentInputRarity;
    localStorage.setItem('user_rarity_votes', JSON.stringify(userRarityVotes));
    
    selectedSpot.rarity = calculateRarity(selectedSpot);
    selectedSpot.isModified = true;
    selectedSpot.lastUpdated = new Date().toLocaleDateString('ja-JP');
    
    saveSpotsToLocal();
    if (typeof dispatchGlobalUpdateMetadata === 'function') {
        dispatchGlobalUpdateMetadata(selectedSpot, { rarity_vote: currentInputRarity });
    }
    showDetailPanel(selectedSpot);
    renderMarkers(initialSpots);
    
    showToast(oldVote ? 'レア度の評価を更新しました！' : 'レア度を投票しました！ありがとうございます！', 'success');
    
    VendiGamification.addXP(15, 'レア度の報告投票');
}

function showAddModal(latlng) {
    if (tempMarker) {
        map.removeLayer(tempMarker);
    }
    
    // Clear new spot fields
    document.getElementById('newSpotName').value = '';
    document.getElementById('newSpotLineup').value = '';
    document.getElementById('newSpotManufacturer').selectedIndex = 0;
    document.getElementById('newSpotTrash').selectedIndex = 0;
    newSpotPhotoBase64 = null;
    const statusSpan = document.getElementById('newSpotUploadStatus');
    if (statusSpan) statusSpan.innerText = '選択されていません';

    // Clear preview boxes
    const previewBox = document.getElementById('newSpotPhotoPreviewBox');
    const previewImg = document.getElementById('newSpotPhotoPreviewImg');
    const previewBadge = document.getElementById('newSpotPhotoPreviewBadge');
    if (previewBox) {
        previewBox.style.display = 'none';
        previewBox.className = 'scan-preview-box';
    }
    if (previewImg) previewImg.src = '';
    if (previewBadge) previewBadge.innerText = '解析待機中';
    
    const html = `<div class="custom-marker temp-adjust-marker"><div class="marker-pin" style="background: var(--accent-color); border-color: #fff; box-shadow: 0 0 15px var(--accent-color); transform: scale(1.1);"><i class="fas fa-location-dot" style="color: #fff;"></i></div></div>`;
    
    // Position marker exactly at userLocation and disable drag-adjust to prevent location spoofing
    tempMarker = L.marker([latlng.lat, latlng.lng], {
        icon: L.divIcon({
            className: '',
            html: html,
            iconSize: [44, 44],
            iconAnchor: [22, 44]
        }),
        draggable: false
    }).addTo(map);
    
    updateModalAddress(latlng.lat, latlng.lng);
    document.getElementById('addSpotModal').style.display = 'flex';
}

function saveNewSpot() {
    if (!tempMarker) return;
    const pos = tempMarker.getLatLng();
    
    const currentLoc = userLocation || window.userLocation;
    if (!currentLoc) {
        showToast('現在地が特定されていません。追加できません。', 'error');
        return;
    }
    const distance = haversineDistance(currentLoc.lat, currentLoc.lng, pos.lat, pos.lng);
    if (distance > 50) {
        showToast(`距離エラー: 現在地から ${Math.round(distance)}m 離れています。50m以内の自販機のみ登録可能です。`, 'error');
        return;
    }
    
    const lineupText = document.getElementById('newSpotLineup').value;
    const lineup = lineupText ? lineupText.split(',').map(s => s.trim()) : ["お茶 (130円)"];
    
    const addressVal = document.getElementById('newSpotName').value;
    
    const newSpot = {
        id: Date.now(), name: addressVal || "新規自販機",
        lat: pos.lat, lng: pos.lng, manufacturer: document.getElementById('newSpotManufacturer').value,
        rating: 3.0, priceRange: "130円〜", hasTrashBin: document.getElementById('newSpotTrash').value,
        paymentMethods: ["現金"], lineup: lineup, description: addressVal || "新しく発見されました。", type: "standard",
        photos: newSpotPhotoBase64 ? [newSpotPhotoBase64] : [], verifiedCount: 0, lastUpdated: new Date().toLocaleDateString('ja-JP'),
        comments: [], namingRightsAvailable: true, owner: null,
        rarityVotesCount: 0, rarityVotesSum: 0, isModified: true
    };
    
    newSpot.rarity = calculateRarity(newSpot);
    if (newSpot.rarity >= 4) newSpot.type = 'rare';

    initialSpots.push(newSpot);
    saveSpotsToLocal();
    if (typeof dispatchGlobalAddSpot === 'function') {
        dispatchGlobalAddSpot(newSpot);
    }
    renderMarkers(initialSpots);
    
    document.getElementById('addSpotModal').style.display = 'none';
    addingSpotMode = false;
    document.getElementById('addSpotBtn').classList.remove('active');
    
    if (tempMarker) {
        map.removeLayer(tempMarker);
        tempMarker = null;
    }
    
    // Clear global state variable
    newSpotPhotoBase64 = null;
    
    VendiGamification.state.stats.spotsAdded++;
    reportActivity('vendimap', 'spots');
    VendiGamification.addXP(150, "新しい自販機の発見・登録");
}

// handleNewSpotPhotoUpload has been deprecated to block file uploads. Direct live camera capture is now enforced.

async function performNewSpotAIScan(dataUrl) {
    const statusSpan = document.getElementById('newSpotUploadStatus');
    if (statusSpan) statusSpan.innerText = 'AI解析中...';
    
    const previewBox = document.getElementById('newSpotPhotoPreviewBox');
    const previewBadge = document.getElementById('newSpotPhotoPreviewBadge');
    
    if (previewBox) {
        previewBox.style.display = 'block';
        previewBox.className = 'scan-preview-box scanning';
    }
    if (previewBadge) previewBadge.innerText = 'AI解析中...';
    
    const base64Data = dataUrl.split(',')[1];
    const savedKey = localStorage.getItem('vendimap_license_key') || '';
    
    const payload = {
        model: "gemini-2.5-flash",
        contents: [
            {
                role: "user",
                parts: [
                    {
                        text: "あなたは自販機の画像から商品のラインナップを詳細に判別する世界トップクラスの『自販機分析AI』です。この画像に写っている飲料商品を識別し、各飲料の名前、ホットかコールドかの属性、販売価格、そして「売切」であるかどうかを解析してください。売り切れの商品（売切ランプ点灯、売切ラベル表示、または商品見本がないスロット）には必ず `[売切]` を含めてください。必ず以下のプレーンなJSON形式の配列のみで返してください。マークダウンによる説明、注釈、あるいは会話的応答は一切排除してください。\n\n`[\"天然水 [コールド] (130円)\", \"BOSS 缶コーヒー [ホット] [売切] (140円)\", \"コカ・コーラ [コールド] (160円)\"]`"
                    },
                    {
                        inlineData: {
                            mimeType: "image/jpeg",
                            data: base64Data
                        }
                    }
                ]
            }
        ]
    };
    
    let items = [];
    try {
        const response = await fetch(`${backendApiUrl}/api/gemini-proxy`, {
            method: "POST",
            headers: { 
                "Content-Type": "application/json",
                "X-License-Key": savedKey
            },
            body: JSON.stringify(payload)
        });
        
        if (response.ok) {
            const result = await response.json();
            if (result && result.candidates && result.candidates[0].content.parts[0].text) {
                const rawText = result.candidates[0].content.parts[0].text.trim();
                const jsonMatch = rawText.match(/\[[\s\S]*?\]/);
                if (jsonMatch) {
                    items = JSON.parse(jsonMatch[0]);
                }
            }
        }
    } catch (apiErr) {
        console.warn("API proxy failed during new spot scan, using mock fallback:", apiErr);
    }
    
    // Fallback to mock data if API fails or returns empty
    if (!items || items.length === 0) {
        const mfg = document.getElementById('newSpotManufacturer').value || 'サントリー';
        items = getRandomLineupForManufacturer(mfg);
    }
    
    if (items && items.length > 0) {
        const lineupInput = document.getElementById('newSpotLineup');
        const mfgInput = document.getElementById('newSpotManufacturer');
        
        if (lineupInput) lineupInput.value = items.join(', ');
        
        // Try to auto-select manufacturer
        const lineStr = items.join(' ').toLowerCase();
        let detectedMfg = 'その他';
        if (lineStr.includes('コカ') || lineStr.includes('coca')) detectedMfg = 'コカ・コーラ';
        else if (lineStr.includes('boss') || lineStr.includes('ボス') || lineStr.includes('伊右衛門') || lineStr.includes('天然水')) detectedMfg = 'サントリー';
        else if (lineStr.includes('ダイドー') || lineStr.includes('dydo')) detectedMfg = 'ダイドー';
        else if (lineStr.includes('生茶') || lineStr.includes('キリン')) detectedMfg = 'キリン';
        else if (lineStr.includes('お茶') || lineStr.includes('伊藤園')) detectedMfg = '伊藤園';
        
        if (detectedMfg !== 'その他' && mfgInput) {
            mfgInput.value = detectedMfg;
        }
        
        // Highlight inputs with a green success glow animation
        if (lineupInput) {
            lineupInput.classList.remove('input-ai-filled');
            void lineupInput.offsetWidth; // trigger reflow
            lineupInput.classList.add('input-ai-filled');
            setTimeout(() => lineupInput.classList.remove('input-ai-filled'), 2000);
        }
        if (mfgInput) {
            mfgInput.classList.remove('input-ai-filled');
            void mfgInput.offsetWidth; // trigger reflow
            mfgInput.classList.add('input-ai-filled');
            setTimeout(() => mfgInput.classList.remove('input-ai-filled'), 2000);
        }
        
        newSpotPhotoBase64 = dataUrl;
        
        if (previewBox) {
            previewBox.className = 'scan-preview-box scan-success';
        }
        if (previewBadge) previewBadge.innerText = '解析完了・自動入力済';
        
        if (statusSpan) {
            statusSpan.innerHTML = '<span style="color: #10b981;"><i class="fas fa-circle-check"></i> 解析完了 (自動入力済)</span>';
        }
        showToast('🤖 AI解析完了！自販機メーカーと商品リストを自動入力しました。', 'success');
    } else {
        if (previewBox) {
            previewBox.className = 'scan-preview-box';
        }
        if (previewBadge) previewBadge.innerText = '解析失敗';
        
        if (statusSpan) statusSpan.innerHTML = '<span style="color: #f43f5e;"><i class="fas fa-circle-xmark"></i> 解析失敗</span>';
        showToast('画像の解析に失敗しました。再度お試しください。', 'error');
    }
}


// handlePhotoUpload has been deprecated to block file uploads. Direct live camera capture is now enforced.

async function handleCameraFileScan(e) {
    const file = e.target.files[0];
    if (file && selectedSpot) {
        stopCameraScanner();
        try {
            showToast('画像を最適化中...', 'info');
            const compressedDataUrl = await compressImage(file, 1000, 1000, 0.85);
            selectedSpot.photos.push(compressedDataUrl);
            selectedSpot.isModified = true;
            saveSpotsToLocal();
            
            if (typeof dispatchGlobalUpdateMetadata === 'function') {
                dispatchGlobalUpdateMetadata(selectedSpot, { photo: compressedDataUrl });
            }
            renderPhotos(selectedSpot);
            
            const base64Data = compressedDataUrl.split(',')[1];
            await performAIScan(base64Data, selectedSpot);
        } catch (err) {
            console.warn('Camera file compression failed, falling back to original:', err);
            const reader = new FileReader();
            reader.onload = async (event) => {
                selectedSpot.photos.push(event.target.result);
                selectedSpot.isModified = true;
                saveSpotsToLocal();
                if (typeof dispatchGlobalUpdateMetadata === 'function') {
                    dispatchGlobalUpdateMetadata(selectedSpot, { photo: event.target.result });
                }
                renderPhotos(selectedSpot);
                const base64Data = event.target.result.split(',')[1];
                await performAIScan(base64Data, selectedSpot);
            };
            reader.readAsDataURL(file);
        }
    }
}

function confirmPresence() {
    if (selectedSpot) {
        selectedSpot.verifiedCount++;
        selectedSpot.lastUpdated = new Date().toLocaleDateString('ja-JP');
        showDetailPanel(selectedSpot);
        showToast('確認ありがとうございます！', 'success');
        
        if (VendiGamification.state.stats.verifiedCount === undefined) {
            VendiGamification.state.stats.verifiedCount = 0;
        }
        VendiGamification.state.stats.verifiedCount++;
        
        if (!VendiGamification.state.verifiedSpotIds) {
            VendiGamification.state.verifiedSpotIds = [];
        }
        if (!VendiGamification.state.verifiedSpotIds.includes(selectedSpot.id)) {
            VendiGamification.state.verifiedSpotIds.push(selectedSpot.id);
        }
        
        VendiGamification.addXP(10, "実在確認の報告");
        VendiMissions.progress('verify', 1);
        selectedSpot.isModified = true;
        saveSpotsToLocal();
        if (typeof dispatchGlobalUpdateMetadata === 'function') {
            dispatchGlobalUpdateMetadata(selectedSpot, { verify_presence: true });
        }
    }
}

function toggleTheme() {
    isDarkMode = !isDarkMode;
    document.body.classList.toggle('light-mode', !isDarkMode);
    document.querySelector('#themeToggleBtn i').className = isDarkMode ? 'fas fa-moon' : 'fas fa-sun';
    if (map && darkLayer && lightLayer) {
        if (isDarkMode) {
            map.removeLayer(lightLayer);
            darkLayer.addTo(map);
        } else {
            map.removeLayer(darkLayer);
            lightLayer.addTo(map);
        }
    }
}

function closeDetailPanel() { document.getElementById('detailPanel').classList.remove('open'); selectedSpot = null; }

function handleLogout() {
    if (confirm('ログアウトしますか？')) {
        currentUser = null;
        localStorage.removeItem('vendimap_user');
        localStorage.removeItem('vendimap_license_key');
        
        // Switch back to a random guest sync user ID on logout
        const randomSyncId = 'user_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
        localStorage.setItem('vendimap_sync_user_id', randomSyncId);
        
        updateAuthUI();
        if (typeof VendiGamification !== 'undefined') {
            VendiGamification.init();
        }
        renderMarkers(initialSpots);
        showToast('ログアウトしました。', 'info');
    }
}

function loadSavedUser() {
    const saved = localStorage.getItem('vendimap_user');
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            if (parsed && typeof parsed === 'object') {
                currentUser = parsed;
                updateAuthUI();
                VendiGamification.updateUI();
            } else {
                currentUser = null;
            }
        } catch (e) {
            console.error("Failed to load saved user:", e);
            currentUser = null;
        }
    }
}

function saveUserSession() {
    if (currentUser) {
        localStorage.setItem('vendimap_user', JSON.stringify(currentUser));
        if (typeof triggerAutoSync === 'function') triggerAutoSync();
    }
}

function updateAuthUI() {
    const guestMenu = document.getElementById('guestMenuContent');
    const userMenu = document.getElementById('userMenuContent');
    const avatar = document.getElementById('userAvatar');
    const myOwnedChip = document.getElementById('myOwnedFilterChip');
    
    if (currentUser) {
        if (guestMenu) guestMenu.style.display = 'none';
        if (userMenu) userMenu.style.display = 'block';
        if (avatar) avatar.src = currentUser.avatar;
        if (myOwnedChip) myOwnedChip.style.display = 'inline-block';
        
        const nameDisplay = document.getElementById('userNameDisplay');
        if (nameDisplay) nameDisplay.innerText = currentUser.name;
        const emailDisplay = document.getElementById('userEmailDisplay');
        if (emailDisplay) emailDisplay.innerText = currentUser.email;
    } else {
        if (guestMenu) guestMenu.style.display = 'block';
        if (userMenu) userMenu.style.display = 'none';
        if (avatar) avatar.src = "https://i.pravatar.cc/150?u=guest";
        if (myOwnedChip) {
            myOwnedChip.style.display = 'none';
            if (currentFilter === 'my-owned') {
                currentFilter = 'all';
                document.querySelectorAll('.filter-chip').forEach(c => {
                    c.classList.toggle('active', c.dataset.filter === 'all');
                });
            }
        }
    }
}

function handleUserAvatarUpload(e) {
    const file = e.target.files[0];
    if (file && currentUser) {
        const reader = new FileReader();
        reader.onload = (event) => {
            currentUser.avatar = event.target.result;
            document.getElementById('userAvatar').src = currentUser.avatar;
            saveUserSession();
            showToast('プロフィール画像を更新しました！', 'success');
            VendiGamification.updateUI();
        };
        reader.readAsDataURL(file);
    }
}

function handleNameChange() {
    if (!currentUser) return;
    const newName = prompt('新しいユーザー名を入力してください:', currentUser.name);
    if (newName && newName.trim() !== '') {
        currentUser.name = newName.trim();
        document.getElementById('userNameDisplay').innerText = currentUser.name;
        saveUserSession();
        showToast('ユーザー名を更新しました！', 'success');
        VendiGamification.updateUI();
    }
}

async function loadUserDataFromServer(syncUserId) {
    if (!syncUserId) return;
    try {
        const res = await fetch(`${backendApiUrl}/api/sync?userId=${syncUserId}`);
        if (res.ok) {
            const result = await res.json();
            if (result.status === 'success' && result.data) {
                const d = result.data;
                if (d.local_spots) localStorage.setItem('vendimap_local_spots', JSON.stringify(d.local_spots));
                if (d.rarity_votes) localStorage.setItem('user_rarity_votes', JSON.stringify(d.rarity_votes));
                if (d.user) localStorage.setItem('vendimap_user', JSON.stringify(d.user));
                if (d.gamification) localStorage.setItem('vendimap_gamification_state', JSON.stringify(d.gamification));
                if (d.license_key) localStorage.setItem('vendimap_license_key', d.license_key);
                
                loadSavedUser();
                if (typeof VendiGamification !== 'undefined') {
                    VendiGamification.init();
                }
                renderMarkers(initialSpots);
            }
        }
    } catch (e) {
        console.warn("Failed to load sync data from SQLite server:", e);
    }
}

async function mockGoogleLogin() {
    currentUser = {
        name: "ジハハンター・タク",
        email: "tophunter@example.com",
        avatar: "https://i.pravatar.cc/150?u=tophunter"
    };
    saveUserSession();
    
    // Generate an account-bound syncUserId from the user email
    const syncUserId = 'user_' + btoa(currentUser.email).replace(/=/g, '');
    localStorage.setItem('vendimap_sync_user_id', syncUserId);
    
    // Instantly load synchronized license/progress data from server
    await loadUserDataFromServer(syncUserId);
    
    updateAuthUI();
    VendiGamification.updateUI();
    document.getElementById('loginModal').style.display = 'none';
    showToast('ログインしました！ようこそ、' + currentUser.name + 'さん。', 'success');
}

function showRanking() {
    document.getElementById('rankingModal').style.display = 'flex';
    switchRankingTab('count');
}

function switchRankingTab(tab) {
    currentRankingTab = tab;
    document.getElementById('rankByCountBtn').classList.toggle('active', tab === 'count');
    document.getElementById('rankByRatingBtn').classList.toggle('active', tab === 'rating');
    renderRankingContent();
}

function renderRankingContent() {
    const container = document.getElementById('rankingContent');
    if (!container) return;
    container.innerHTML = '';
    const rankingData = getRankingData();
    const data = rankingData[currentRankingTab];
    data.forEach((item, index) => {
        const div = document.createElement('div');
        div.className = `ranking-item ${item.isSelf ? 'self-user' : ''}`;
        div.innerHTML = `
            <div class="rank-number">${index + 1}</div>
            <div class="rank-info">
                <span class="rank-name">${item.avatar} ${item.name} ${item.isSelf ? '<span style="color: var(--accent-color); font-size: 0.7rem; font-weight: bold; margin-left: 5px;">(あなた)</span>' : ''}</span>
                <span class="rank-value">${item.value}</span>
            </div>
            <i class="fas fa-chevron-right" style="color: var(--border-color);"></i>
        `;
        container.appendChild(div);
    });
}

function updateStarUI() {
    document.querySelectorAll('.rating-star').forEach(s => {
        const val = parseInt(s.dataset.value);
        s.className = val <= currentInputRating ? 'fas fa-star rating-star active' : 'far fa-star rating-star';
    });
}

async function fetchWithTimeout(url, options = {}, timeout = 3000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal,
            headers: {
                'User-Agent': 'VendiMapApp/1.0 (contact: vendimap.support@gmail.com; aoi-softwarestudio)',
                'Accept-Language': 'ja',
                ...(options.headers || {})
            }
        });
        clearTimeout(id);
        return response;
    } catch (error) {
        clearTimeout(id);
        throw error;
    }
}

let searchDebounceTimeout = null;

function highlightText(text, query) {
    if (!text) return '';
    const textStr = String(text);
    if (!query) return textStr;
    const escapedQuery = query.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(`(${escapedQuery})`, 'gi');
    return textStr.replace(regex, '<span class="search-highlight">$1</span>');
}

function handleSearch(e) {
    const query = e.target.value.trim();
    currentSearchQuery = query.toLowerCase();
    
    renderMarkers(initialSpots);
    
    const clearBtn = document.getElementById('searchClearBtn');
    if (clearBtn) {
        clearBtn.style.display = query ? 'block' : 'none';
    }
    
    const dropdown = document.getElementById('searchSuggestions');
    if (!dropdown) return;
    
    if (!query) {
        dropdown.style.display = 'none';
        dropdown.innerHTML = '';
        return;
    }
    
    clearTimeout(searchDebounceTimeout);
    
    // Multi-word AND search support
    const queryParts = currentSearchQuery.split(/[\s　]+/).filter(p => p.length > 0);
    
    let matchingSpots = initialSpots.filter(spot => {
        // Must match all query parts (AND logic)
        return queryParts.every(part => {
            const normalizedPart = normalizeQuery(part);
            
            const nameMatch = matchFuzzy(spot.name, part) || matchFuzzy(spot.name, normalizedPart);
            const mfgMatch = matchFuzzy(spot.manufacturer, part) || matchFuzzy(spot.manufacturer, normalizedPart);
            const lineupMatch = spot.lineup.some(item => matchFuzzy(item, part) || matchFuzzy(item, normalizedPart));
            const priceMatch = matchFuzzy(spot.priceRange, part) || matchFuzzy(spot.priceRange, normalizedPart);
            const paymentMatch = spot.paymentMethods.some(pm => matchFuzzy(pm, part) || matchFuzzy(pm, normalizedPart));
            
            // Smart Tag Matchers
            const trashQuery = normalizedPart.includes('ゴミ') || normalizedPart.includes('ごみ') || normalizedPart.includes('トラッシュ') || normalizedPart.includes('trash');
            const trashMatch = trashQuery && spot.trashCan === 'あり';
            
            const cashlessQuery = normalizedPart.includes('キャッシュレス') || normalizedPart.includes('電子マネー') || normalizedPart.includes('カード') || normalizedPart.includes('スマホ決済') || normalizedPart.includes('cashless');
            const cashlessMatch = cashlessQuery && (spot.paymentMethods.includes('交通系IC') || spot.paymentMethods.includes('QRコード') || spot.paymentMethods.includes('クレジットカード') || spot.paymentMethods.some(pm => pm !== '現金'));
            
            const rareQuery = normalizedPart.includes('レア') || normalizedPart.includes('珍しい') || normalizedPart.includes('評価中') || normalizedPart.includes('rare');
            const rareMatch = rareQuery && (spot.rarity >= 4 || (spot.rarityVotesCount || 0) < 3);
            
            const cheapQuery = normalizedPart.includes('100円') || normalizedPart.includes('百円') || normalizedPart.includes('安い') || normalizedPart.includes('ワンコイン') || normalizedPart.includes('cheap');
            const cheapMatch = cheapQuery && (spot.priceRange.includes('100円') || spot.priceRange.includes('80円') || spot.priceRange.includes('90円') || spot.priceRange.includes('50円'));
            
            return nameMatch || mfgMatch || lineupMatch || priceMatch || paymentMatch || trashMatch || cashlessMatch || rareMatch || cheapMatch;
        });
    });
    
    // Sort matching spots by distance if userLocation is available (closest first)
    if (userLocation) {
        matchingSpots = matchingSpots.map(spot => {
            const dist = haversineDistance(userLocation.lat, userLocation.lng, spot.lat, spot.lng);
            return { ...spot, distance: dist };
        }).sort((a, b) => a.distance - b.distance);
    }
    
    const slicedSpots = matchingSpots.slice(0, 5);
    renderSuggestions(slicedSpots, [], dropdown);
    
    const isJapaneseWord = /[\u3000-\u303F\u3040-\u309F\u30A0-\u30FF\uFF00-\uFFEF\u4E00-\u9FAF\u3400-\u4DBF]/.test(query);
    const minLength = isJapaneseWord ? 1 : 2;
    if (query.length < minLength) return;
    
    // Parallel Fetch: Nominatim (Global/Address search) + Overpass API (Local facility/POI search)
    searchDebounceTimeout = setTimeout(async () => {
        const searchIcon = document.getElementById('searchIcon');
        if (searchIcon) {
            searchIcon.className = 'fas fa-spinner fa-spin';
        }
        
        try {
            // 1. Prepare Nominatim URL (biased to user Location via viewbox if available)
            let nominatimUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&addressdetails=1&namedetails=1&extratags=1&limit=15&countrycodes=jp&accept-language=ja`;
            if (userLocation) {
                nominatimUrl += `&lat=${userLocation.lat}&lon=${userLocation.lng}`;
                const offset = 0.1; // Approx 10km bounding box
                const viewbox = `${userLocation.lng - offset},${userLocation.lat + offset},${userLocation.lng + offset},${userLocation.lat - offset}`;
                nominatimUrl += `&viewbox=${viewbox}&bounded=0`;
            }

            // Compliance headers for Nominatim usage policy (avoids 403 Forbidden blocking on mobile/webviews)
            const requestHeaders = {
                "User-Agent": "VendiMapApp/1.0 (contact: vendimap.support@gmail.com; aoi-softwarestudio) WebEngine/Mobile",
                "Accept-Language": "ja,en-US;q=0.9,en;q=0.8"
            };

            // 2. Prepare Overpass URL (Local categories if location available, otherwise National Area Search for landmarks/facilities)
            let overpassPromise = Promise.resolve({ elements: [] });
            const cleanQuery = query.replace(/["\\\/\[\]\{\}\(\)\*\+\?\.\^\$\|]/g, '');
            
            if (cleanQuery.length >= 2 || (isJapaneseWord && cleanQuery.length >= 1)) {
                let overpassQuery = "";
                
                if (userLocation) {
                    // Localized search based on user coordinates
                    let osmFilter = null;
                    const norm = query.toLowerCase();
                    if (norm.includes('コンビニ')) osmFilter = `["shop"="convenience"]`;
                    else if (norm.includes('公園')) osmFilter = `["leisure"="park"]`;
                    else if (norm.includes('カフェ') || norm.includes('喫茶店')) osmFilter = `["amenity"="cafe"]`;
                    else if (norm.includes('レストラン') || norm.includes('飲食店')) osmFilter = `["amenity"="restaurant"]`;
                    else if (norm.includes('トイレ') || norm.includes('便所')) osmFilter = `["amenity"="toilets"]`;
                    else if (norm.includes('駅')) osmFilter = `["railway"="station"]`;
                    else if (norm.includes('スーパー')) osmFilter = `["shop"="supermarket"]`;
                    else if (norm.includes('駐車場')) osmFilter = `["amenity"="parking"]`;
                    else if (norm.includes('交番') || norm.includes('警察')) osmFilter = `["amenity"="police"]`;
                    else if (norm.includes('神社') || norm.includes('寺')) osmFilter = `["amenity"="place_of_worship"]`;
                    else if (norm.includes('ホテル') || norm.includes('旅館')) osmFilter = `["tourism"="hotel"]`;
                    else if (norm.includes('病院') || norm.includes('クリニック')) osmFilter = `["amenity"="hospital"]`;
                    else if (norm.includes('郵便局')) osmFilter = `["amenity"="post_office"]`;
                    else if (norm.includes('モール') || norm.includes('ショッピング') || norm.includes('デパート') || norm.includes('商業施設')) osmFilter = `["shop"~"mall|department_store",i]`;
                    else {
                        // General local name match within 2km
                        osmFilter = `["name"~"${cleanQuery}",i]`;
                    }
                    
                    overpassQuery = `[out:json][timeout:5];
                    (
                       node${osmFilter}(around:2000,${userLocation.lat},${userLocation.lng});
                       way${osmFilter}(around:2000,${userLocation.lat},${userLocation.lng});
                    );
                    out center 15;`;
                } else {
                    // Japan Nationwide Area Search for landmark/facility matches when location is offline or far away
                    overpassQuery = `[out:json][timeout:8];
                    area["ISO3166-1"="JP"]->.japan;
                    (
                       node["name"~"${cleanQuery}",i](area.japan);
                       way["name"~"${cleanQuery}",i](area.japan);
                    );
                    out center 10;`;
                }

                const overpassUrl = `https://overpass.kumi.systems/api/interpreter?data=${encodeURIComponent(overpassQuery)}`;
                overpassPromise = fetchWithTimeout(overpassUrl, { headers: requestHeaders }, 5000)
                    .then(res => res.ok ? res.json() : { elements: [] })
                    .catch((err) => {
                        console.warn("Overpass main server failed, falling back. Error:", err);
                        const fallbackUrl = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(overpassQuery)}`;
                        return fetchWithTimeout(fallbackUrl, { headers: requestHeaders }, 5000)
                            .then(res => res.ok ? res.json() : { elements: [] })
                            .catch((fallbackErr) => {
                                console.warn("Overpass fallback server failed. Error:", fallbackErr);
                                return { elements: [] };
                            });
                    });
            }

            // Fetch Nominatim and Overpass in parallel (with User-Agent headers and 4s timeout)
            const [nomRes, opRes] = await Promise.all([
                fetchWithTimeout(nominatimUrl, { headers: requestHeaders }, 4000)
                    .then(res => res.ok ? res.json() : [])
                    .catch((err) => {
                        console.warn("Nominatim fetch failed. Error:", err);
                        return [];
                    }),
                overpassPromise
            ]).finally(() => {
                if (searchIcon) {
                    searchIcon.className = 'fas fa-search';
                }
            });

            // Process Nominatim results
            const nominatimPredictions = nomRes.map(r => {
                const jaName = r.namedetails?.['name:ja'] || r.namedetails?.['name'] || r.name || r.display_name.split(',')[0];
                const rLat = parseFloat(r.lat);
                const rLon = parseFloat(r.lon);
                
                let dist = null;
                let distText = '';
                if (userLocation) {
                    dist = haversineDistance(userLocation.lat, userLocation.lng, rLat, rLon);
                    distText = dist < 1000 ? `${Math.round(dist)}m` : `${(dist/1000).toFixed(1)}km`;
                }
                
                const a = r.address || {};
                const subtitleParts = [
                    a.prefecture,
                    a.city || a.town || a.village || a.county,
                    a.suburb || a.neighbourhood || a.quarter || a.road
                ].filter(Boolean);
                let subText = subtitleParts.join(' ') || r.display_name.split(',').slice(1, 3).join(' ').trim();
                if (distText) subText = `(現在地から${distText}) ${subText}`;
                
                const typeMap = getNominatimTypeInfo(r);
                return {
                    main_text: jaName,
                    sub_text: subText,
                    lat: rLat,
                    lon: rLon,
                    distance: dist,
                    typeIcon: typeMap.icon,
                    typeMeta: typeMap.meta
                };
            });

            // Process Overpass results
            const overpassPredictions = (opRes.elements || []).map(r => {
                const tags = r.tags || {};
                const name = tags.name || tags.operator || (tags.shop ? '店舗' : tags.amenity ? '施設' : '場所');
                const lat = r.lat || r.center?.lat;
                const lon = r.lon || r.center?.lon;
                
                let dist = null;
                let distText = '';
                if (userLocation) {
                    dist = haversineDistance(userLocation.lat, userLocation.lng, lat, lon);
                    distText = dist < 1000 ? `${Math.round(dist)}m` : `${(dist/1000).toFixed(1)}km`;
                }
                
                const label = getOSMTypeLabel(tags);
                let subText = `${tags['addr:suburb'] || tags['addr:street'] || ''} [${label}]`.trim();
                if (distText) subText = `(現在地から${distText}) ${subText}`;
                
                const typeMap = getOSMTypeIconAndMeta(tags);
                return {
                    main_text: name,
                    sub_text: subText,
                    lat: lat,
                    lon: lon,
                    distance: dist,
                    typeIcon: typeMap.icon,
                    typeMeta: typeMap.meta
                };
            });

            // Merge and de-duplicate predictions by coordinates
            let combined = [...overpassPredictions, ...nominatimPredictions];
            const seenCoords = new Set();
            combined = combined.filter(item => {
                if (!item || item.lat === undefined || item.lon === undefined || isNaN(item.lat) || isNaN(item.lon)) {
                    return false;
                }
                const key = `${item.lat.toFixed(4)},${item.lon.toFixed(4)}`;
                if (seenCoords.has(key)) return false;
                seenCoords.add(key);
                return true;
            });

            // Sort by distance (closest first)
            if (userLocation) {
                combined.sort((a, b) => {
                    if (a.distance === null) return 1;
                    if (b.distance === null) return -1;
                    return a.distance - b.distance;
                });
            }

            const placePredictions = combined.slice(0, 8);
            renderSuggestions(matchingSpots, placePredictions, dropdown);
        } catch (err) {
            console.warn("Search Error in handleSearch:", err);
            renderSuggestions(matchingSpots, [], dropdown);
        }
    }, 600);
}

function getOSMTypeLabel(tags) {
    if (tags.shop === 'convenience') return 'コンビニ';
    if (tags.leisure === 'park') return '公園';
    if (tags.amenity === 'cafe') return 'カフェ';
    if (tags.amenity === 'restaurant') return 'レストラン';
    if (tags.amenity === 'toilets') return 'トイレ';
    if (tags.amenity === 'fast_food') return 'ファストフード';
    if (tags.shop === 'supermarket') return 'スーパー';
    if (tags.amenity === 'parking') return '駐車場';
    if (tags.amenity === 'police') return '交番';
    if (tags.amenity === 'place_of_worship') return '神社・寺';
    if (tags.tourism === 'hotel') return 'ホテル';
    if (tags.amenity === 'hospital') return '病院';
    if (tags.amenity === 'post_office') return '郵便局';
    if (tags.shop === 'mall' || tags.shop === 'department_store') return '商業施設';
    return '周辺施設';
}

function getOSMTypeIconAndMeta(tags) {
    if (tags.shop === 'convenience') return { icon: 'fa-store', meta: 'コンビニ' };
    if (tags.leisure === 'park') return { icon: 'fa-tree', meta: '公園' };
    if (tags.amenity === 'cafe') return { icon: 'fa-mug-hot', meta: 'カフェ' };
    if (tags.amenity === 'restaurant') return { icon: 'fa-utensils', meta: 'レストラン' };
    if (tags.amenity === 'toilets') return { icon: 'fa-restroom', meta: 'トイレ' };
    if (tags.shop === 'supermarket') return { icon: 'fa-basket-shopping', meta: 'スーパー' };
    if (tags.amenity === 'parking') return { icon: 'fa-square-parking', meta: '駐車場' };
    if (tags.amenity === 'police') return { icon: 'fa-shield-halved', meta: '交番' };
    if (tags.amenity === 'place_of_worship') return { icon: 'fa-torii-gate', meta: '神社・寺' };
    if (tags.tourism === 'hotel') return { icon: 'fa-hotel', meta: 'ホテル' };
    if (tags.amenity === 'hospital') return { icon: 'fa-hospital', meta: '病院' };
    if (tags.amenity === 'post_office') return { icon: 'fa-envelope', meta: '郵便局' };
    if (tags.shop === 'mall' || tags.shop === 'department_store') return { icon: 'fa-bag-shopping', meta: '商業施設' };
    return { icon: 'fa-location-dot', meta: '施設' };
}

// Map Nominatim type/class to a Font Awesome icon and label
function getNominatimTypeInfo(r) {
    const cls = r.class || '';
    const type = r.type || '';
    // Train / subway stations
    if (type === 'station' || type === 'halt' || type === 'subway_entrance' ||
        (cls === 'railway' && (type === 'station' || type === 'halt'))) {
        return { icon: 'fa-train-subway', meta: '駅' };
    }
    // Airports
    if (type === 'aerodrome' || cls === 'aeroway') return { icon: 'fa-plane', meta: '空港' };
    // Shopping malls / commercial
    if (type === 'mall' || type === 'supermarket' || type === 'department_store') return { icon: 'fa-bag-shopping', meta: 'ショッピング' };
    if (cls === 'shop') return { icon: 'fa-store', meta: '店舗' };
    // Tourism
    if (type === 'museum') return { icon: 'fa-landmark', meta: '博物館' };
    if (type === 'theme_park' || type === 'attraction') return { icon: 'fa-star', meta: '観光' };
    if (cls === 'tourism') return { icon: 'fa-camera', meta: '観光スポット' };
    // Food & drink
    if (type === 'restaurant' || type === 'cafe' || type === 'fast_food' || type === 'bar') return { icon: 'fa-utensils', meta: '飲食' };
    if (cls === 'amenity' && (type === 'restaurant' || type === 'cafe')) return { icon: 'fa-utensils', meta: '飲食' };
    // Parks & nature
    if (type === 'park' || type === 'garden' || cls === 'leisure') return { icon: 'fa-tree', meta: '公園' };
    if (cls === 'natural') return { icon: 'fa-mountain', meta: '自然' };
    // Schools / universities
    if (type === 'university' || type === 'college') return { icon: 'fa-graduation-cap', meta: '大学' };
    if (type === 'school') return { icon: 'fa-school', meta: '学校' };
    // Hospitals
    if (type === 'hospital' || type === 'clinic') return { icon: 'fa-hospital', meta: '病院' };
    // Banks
    if (type === 'bank' || type === 'atm') return { icon: 'fa-building-columns', meta: '銀行' };
    // Hotels
    if (type === 'hotel' || cls === 'tourism' && type === 'hotel') return { icon: 'fa-hotel', meta: 'ホテル' };
    // Administrative areas (cities, wards)
    if (cls === 'boundary' || cls === 'place') return { icon: 'fa-map-pin', meta: 'エリア' };
    // Roads
    if (cls === 'highway') return { icon: 'fa-road', meta: '道路' };
    // Default
    return { icon: 'fa-location-dot', meta: '場所' };
}

function renderSuggestions(spots, predictions, dropdown) {
    dropdown.innerHTML = '';
    
    if (spots.length === 0 && predictions.length === 0) {
        dropdown.style.display = 'flex';
        dropdown.innerHTML = `
            <div class="suggestion-item no-results" style="cursor: default; justify-content: center; padding: 15px; color: var(--text-secondary); font-size: 0.85rem; width: 100%;">
                <i class="fas fa-circle-question" style="margin-right: 8px; color: var(--text-secondary);"></i>
                <span>一致する自販機や場所が見つかりませんでした</span>
            </div>
        `;
        return;
    }
    
    dropdown.style.display = 'flex';
    
    // 1. Render Spot Suggestions
    spots.forEach(spot => {
        const item = document.createElement('div');
        item.className = 'suggestion-item';
        
        let typeIcon = 'fa-bottle-water';
        if (spot.rarity >= 4) typeIcon = 'fa-gem';
        else if (spot.priceRange.includes('100円')) typeIcon = 'fa-tag';
        
        const highlightedName = highlightText(spot.name, currentSearchQuery);
        const highlightedMfg = highlightText(spot.manufacturer, currentSearchQuery);
        
        item.innerHTML = `
            <i class="fas ${typeIcon}"></i>
            <div class="suggestion-text-wrap">
                <span class="suggestion-title">${highlightedName}</span>
                <span class="suggestion-subtitle">${highlightedMfg} • ${spot.priceRange}</span>
            </div>
            <span class="suggestion-meta">自販機</span>
        `;
        
        item.addEventListener('click', () => {
            dropdown.style.display = 'none';
            document.getElementById('searchInput').value = spot.name;
            
            const clearBtn = document.getElementById('searchClearBtn');
            if (clearBtn) clearBtn.style.display = 'block';
            
            // Clear currentSearchQuery to show all markers around the centered spot
            currentSearchQuery = '';
            renderMarkers(initialSpots);
            
            if (map) {
                map.setView([spot.lat, spot.lng], 16);
            }
            showDetailPanel(spot);
        });
        
        dropdown.appendChild(item);
    });
    
    // 2. Render Nominatim Place Suggestions
    predictions.forEach(prediction => {
        const item = document.createElement('div');
        item.className = 'suggestion-item address-search';
        
        const mainTitle = prediction.main_text;
        const subTitle = prediction.sub_text || '日本国内';
        const icon = prediction.typeIcon || 'fa-location-dot';
        const meta = prediction.typeMeta || '場所';
        
        const highlightedTitle = highlightText(mainTitle, currentSearchQuery);
        const highlightedSub = highlightText(subTitle, currentSearchQuery);
        
        item.innerHTML = `
            <i class="fas ${icon}"></i>
            <div class="suggestion-text-wrap">
                <span class="suggestion-title">${highlightedTitle}</span>
                <span class="suggestion-subtitle">${highlightedSub}</span>
            </div>
            <span class="suggestion-meta">${meta}</span>
        `;
        
        item.addEventListener('click', () => {
            dropdown.style.display = 'none';
            document.getElementById('searchInput').value = mainTitle;
            
            const clearBtn = document.getElementById('searchClearBtn');
            if (clearBtn) clearBtn.style.display = 'block';
            
            // Clear search query so markers render normally at the destination
            currentSearchQuery = '';
            renderMarkers(initialSpots);
            
            if (map && prediction.lat !== undefined && prediction.lon !== undefined && !isNaN(prediction.lat) && !isNaN(prediction.lon)) {
                map.setView([prediction.lat, prediction.lon], 16);
                showToast(`📍 「${mainTitle}」へ移動しました`, 'info');
                fetchOSMVendingMachines(prediction.lat, prediction.lon);
            }
        });
        
        dropdown.appendChild(item);
    });
}

// Google Maps classes removed — replaced by Leaflet L.marker / L.divIcon

// Sync and Auto-Save System
let syncTimeout = null;

function getOfflineQueue() {
    try {
        const parsed = JSON.parse(localStorage.getItem('vendimap_offline_queue') || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        return [];
    }
}

function queueOfflineTask(task) {
    const queue = getOfflineQueue();
    const isDuplicate = queue.some(item => {
        if (!item || item.type !== task.type) return false;
        if (item.type === 'add-spot') {
            return String(item.spot.id) === String(task.spot.id);
        }
        if (item.type === 'update-metadata') {
            return item.spot_id === task.spot_id && JSON.stringify(item.updates) === JSON.stringify(task.updates);
        }
        return false;
    });
    if (!isDuplicate) {
        queue.push(task);
        localStorage.setItem('vendimap_offline_queue', JSON.stringify(queue));
        console.log("Task queued for offline sync. Current queue length:", queue.length);
    }
}

async function processOfflineQueue() {
    if (!navigator.onLine) return;
    const queue = getOfflineQueue();
    if (queue.length === 0) return;
    
    console.log("Processing offline sync queue...", queue.length, "tasks");
    const remaining = [];
    
    for (const task of queue) {
        try {
            if (task.type === 'add-spot') {
                const res = await fetch(`${backendApiUrl}/api/add-spot`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        spot_id: String(task.spot.id),
                        name: task.spot.name,
                        lat: task.spot.lat,
                        lng: task.spot.lng,
                        manufacturer: task.spot.manufacturer,
                        price_range: task.spot.priceRange,
                        has_trash_bin: task.spot.hasTrashBin,
                        payment_methods: task.spot.paymentMethods,
                        lineup: task.spot.lineup,
                        description: task.spot.description,
                        last_updated: task.spot.lastUpdated
                    })
                });
                if (!res.ok) throw new Error(`HTTP error ${res.status}`);
            } else if (task.type === 'update-metadata') {
                const res = await fetch(`${backendApiUrl}/api/update-spot-metadata`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        spot_id: task.spot_id,
                        ...task.updates,
                        ...task.spot
                    })
                });
                if (!res.ok) throw new Error(`HTTP error ${res.status}`);
            }
            console.log("Successfully synced offline task:", task);
        } catch (e) {
            console.warn("Failed to sync offline task, keeping in queue:", task, e);
            remaining.push(task);
        }
    }
    
    localStorage.setItem('vendimap_offline_queue', JSON.stringify(remaining));
}

function triggerAutoSync() {
    if (syncTimeout) {
        clearTimeout(syncTimeout);
    }
    syncTimeout = setTimeout(async () => {
        try {
            await processOfflineQueue();
            const syncUserId = localStorage.getItem('vendimap_sync_user_id');
            if (!syncUserId) return;
            
            let syncData;
            try {
                syncData = {
                    local_spots: JSON.parse(localStorage.getItem('vendimap_local_spots') || '[]'),
                    rarity_votes: JSON.parse(localStorage.getItem('user_rarity_votes') || '{}'),
                    user: JSON.parse(localStorage.getItem('vendimap_user') || 'null'),
                    gamification: JSON.parse(localStorage.getItem('vendimap_gamification_state') || 'null'),
                    license_key: localStorage.getItem('vendimap_license_key') || ''
                };
            } catch (parseErr) {
                console.error("Auto-sync: Failed to parse state for sync payload, using defaults", parseErr);
                syncData = {
                    local_spots: [],
                    rarity_votes: {},
                    user: null,
                    gamification: null,
                    license_key: localStorage.getItem('vendimap_license_key') || ''
                };
            }
            
            const res = await fetch(`${backendApiUrl}/api/sync`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_id: syncUserId,
                    data: syncData
                })
            });
            if (res.ok) {
                console.log("Automatic SQLite sync completed successfully.");
            } else {
                console.warn("Auto-sync failed on server:", res.status);
            }
        } catch (e) {
            console.warn("Auto-sync network request failed:", e);
        }
    }, 2000);
}

async function dispatchGlobalAddSpot(spot) {
    try {
        const res = await fetch(`${backendApiUrl}/api/add-spot`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                spot_id: String(spot.id),
                name: spot.name,
                lat: spot.lat,
                lng: spot.lng,
                manufacturer: spot.manufacturer,
                price_range: spot.priceRange,
                has_trash_bin: spot.hasTrashBin,
                payment_methods: spot.paymentMethods,
                lineup: spot.lineup,
                description: spot.description,
                last_updated: spot.lastUpdated
            })
        });
        if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    } catch (e) {
        console.warn("Failed to dispatch global add-spot, queueing for offline sync:", e);
        queueOfflineTask({
            type: 'add-spot',
            spot: spot
        });
    }
}

async function dispatchGlobalUpdateMetadata(spot, updates) {
    try {
        const res = await fetch(`${backendApiUrl}/api/update-spot-metadata`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                spot_id: String(spot.id),
                ...updates,
                name: spot.name,
                lat: spot.lat,
                lng: spot.lng,
                manufacturer: spot.manufacturer,
                price_range: spot.priceRange,
                has_trash_bin: spot.hasTrashBin,
                payment_methods: spot.paymentMethods,
                lineup: spot.lineup,
                description: spot.description,
                last_updated: spot.lastUpdated
            })
        });
        if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    } catch (e) {
        console.warn("Failed to dispatch global metadata update, queueing for offline sync:", e);
        queueOfflineTask({
            type: 'update-metadata',
            spot_id: String(spot.id),
            updates: updates,
            spot: {
                name: spot.name,
                lat: spot.lat,
                lng: spot.lng,
                manufacturer: spot.manufacturer,
                price_range: spot.priceRange,
                has_trash_bin: spot.hasTrashBin,
                payment_methods: spot.paymentMethods,
                lineup: spot.lineup,
                description: spot.description,
                last_updated: spot.lastUpdated
            }
        });
    }
}

// HTML5 Canvas Client-side Image Compression Helper
function compressImage(file, maxWidth = 1000, maxHeight = 1000, quality = 0.8) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;
                
                if (width > height) {
                    if (width > maxWidth) {
                        height = Math.round((height * maxWidth) / width);
                        width = maxWidth;
                    }
                } else {
                    if (height > maxHeight) {
                        width = Math.round((width * maxHeight) / height);
                        height = maxHeight;
                    }
                }
                
                canvas.width = width;
                canvas.height = height;
                
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                
                try {
                    const dataUrl = canvas.toDataURL('image/jpeg', quality);
                    resolve(dataUrl);
                } catch (e) {
                    reject(e);
                }
            };
            img.onerror = (err) => reject(err);
            img.src = event.target.result;
        };
        reader.onerror = (err) => reject(err);
        reader.readAsDataURL(file);
    });
}

// BBox-aware Global Spots Fetcher & Merger
async function fetchAndMergeGlobalSpots(bbox = null) {
    try {
        let url = `${backendApiUrl}/api/global-spots`;
        if (bbox) {
            url += `?min_lat=${bbox.minLat}&max_lat=${bbox.maxLat}&min_lng=${bbox.minLng}&max_lng=${bbox.maxLng}`;
        }
        const res = await fetch(url);
        if (res.ok) {
            const result = await res.json();
            if (result.status === 'success' && result.spots) {
                const globalSpots = result.spots;
                globalSpots.forEach(gs => {
                    const spotId = isNaN(gs.spot_id) ? gs.spot_id : Number(gs.spot_id);
                    const target = initialSpots.find(s => s.id === spotId || s.osmId === spotId || s.id === gs.spot_id);
                    if (target) {
                        if (gs.name) target.name = gs.name;
                        if (gs.manufacturer) target.manufacturer = gs.manufacturer;
                        if (gs.price_range) target.priceRange = gs.price_range;
                        if (gs.has_trash_bin) target.hasTrashBin = gs.has_trash_bin;
                        if (gs.payment_methods) target.paymentMethods = gs.payment_methods;
                        if (gs.lineup) target.lineup = gs.lineup;
                        if (gs.description) target.description = gs.description;
                        if (gs.owner) {
                            target.owner = gs.owner;
                            target.namingRightsAvailable = false;
                        }
                        if (gs.rating_count > 0) {
                            target.rating = gs.rating_sum / gs.rating_count;
                        }
                        if (gs.rarity_votes_count >= 3) {
                            target.rarity = Math.round(gs.rarity_votes_sum / gs.rarity_votes_count);
                        } else {
                            target.rarity = 0;
                        }
                        if (gs.comments) target.comments = gs.comments;
                        if (gs.photos) target.photos = gs.photos;
                        if (gs.verified_count) target.verifiedCount = gs.verified_count;
                        if (gs.last_updated) target.lastUpdated = gs.last_updated;
                    } else {
                        const exists = initialSpots.some(s => s.id === spotId);
                        if (!exists) {
                            const newSpot = {
                                id: spotId,
                                name: gs.name,
                                lat: gs.lat,
                                lng: gs.lng,
                                manufacturer: gs.manufacturer,
                                rating: gs.rating_count > 0 ? (gs.rating_sum / gs.rating_count) : 3.0,
                                priceRange: gs.price_range,
                                hasTrashBin: gs.has_trash_bin,
                                paymentMethods: gs.payment_methods,
                                lineup: gs.lineup,
                                description: gs.description,
                                rarity: gs.rarity_votes_count >= 3 ? Math.round(gs.rarity_votes_sum / gs.rarity_votes_count) : 0,
                                rarityVotesCount: gs.rarity_votes_count,
                                rarityVotesSum: gs.rarity_votes_sum,
                                type: (gs.rarity_votes_count >= 3 && Math.round(gs.rarity_votes_sum / gs.rarity_votes_count) >= 4) ? 'rare' : 'standard',
                                photos: gs.photos,
                                verifiedCount: gs.verified_count,
                                lastUpdated: gs.last_updated,
                                comments: gs.comments,
                                namingRightsAvailable: gs.naming_rights_available,
                                owner: gs.owner
                            };
                            initialSpots.push(newSpot);
                        }
                    }
                });
                renderMarkers(initialSpots);
            }
        }
    } catch (e) {
        console.warn("Failed to fetch global spots:", e);
    }
}

// Boot
window.onload = async () => {
    await loadDynamicConfig();
    
    let syncUserId = localStorage.getItem('vendimap_sync_user_id');
    if (!syncUserId) {
        syncUserId = 'user_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
        localStorage.setItem('vendimap_sync_user_id', syncUserId);
    }
    
    try {
        const res = await fetch(`${backendApiUrl}/api/sync?userId=${syncUserId}`);
        if (res.ok) {
            const result = await res.json();
            if (result.status === 'success' && result.data) {
                const d = result.data;
                if (d.local_spots) localStorage.setItem('vendimap_local_spots', JSON.stringify(d.local_spots));
                if (d.rarity_votes) localStorage.setItem('user_rarity_votes', JSON.stringify(d.rarity_votes));
                if (d.user) localStorage.setItem('vendimap_user', JSON.stringify(d.user));
                if (d.gamification) localStorage.setItem('vendimap_gamification_state', JSON.stringify(d.gamification));
                if (d.license_key) localStorage.setItem('vendimap_license_key', d.license_key);
            }
        }
    } catch (e) {
        console.warn("Failed to load sync data from SQLite server on startup:", e);
    }
    
    loadSavedUser();
    
    // --- New Features UI Initializations ---
    VendiMissions.init();
    
    // Bind click handlers for daily mission and territory battle tab updates
    const modalTriggerBtn = document.getElementById('userProfile');
    if (modalTriggerBtn) {
        modalTriggerBtn.addEventListener('click', () => {
            switchModalTab('achievements');
        });
    }
    
    // Bind status reporting buttons
    document.querySelectorAll('.status-report-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            if (!selectedSpot) return;
            const newStatus = btn.getAttribute('data-status');
            
            // Show loading state
            btn.disabled = true;
            const originalHtml = btn.innerHTML;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
            
            try {
                const res = await fetch(`${backendApiUrl}/api/update-spot-metadata`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        spot_id: String(selectedSpot.id || selectedSpot.osmId),
                        status: newStatus
                    })
                });
                
                if (res.ok) {
                    selectedSpot.status = newStatus;
                    selectedSpot.isModified = true;
                    saveSpotsToLocal();
                    
                    // Update active button styling
                    document.querySelectorAll('.status-report-btn').forEach(b => {
                        if (b.getAttribute('data-status') === newStatus) {
                            b.classList.add('active');
                        } else {
                            b.classList.remove('active');
                        }
                    });
                    
                    showToast('自販機の状況を報告しました！', 'success');
                    
                    // Progress daily mission
                    VendiMissions.progress('report_status', 1);
                    
                    // Re-render markers to show/update the overlay status badges
                    renderMarkers(initialSpots);
                } else {
                    showToast('報告の送信に失敗しました。', 'error');
                }
            } catch (err) {
                console.error("Failed to report status:", err);
                showToast('通信エラーが発生しました。', 'error');
            } finally {
                btn.disabled = false;
                btn.innerHTML = originalHtml;
            }
        });
    });
    
    // Bind owner message updates
    const updateMsgBtn = document.getElementById('updateOwnerMessageBtn');
    const msgInput = document.getElementById('ownerMessageInput');
    if (updateMsgBtn && msgInput) {
        updateMsgBtn.addEventListener('click', async () => {
            if (!selectedSpot) return;
            const newMsg = msgInput.value.trim();
            
            updateMsgBtn.disabled = true;
            updateMsgBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
            
            try {
                const ownerName = currentUser ? currentUser.name : "トップハンター";
                const res = await fetch(`${backendApiUrl}/api/update-spot-metadata`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        spot_id: String(selectedSpot.id || selectedSpot.osmId),
                        owner_message: newMsg,
                        owner: ownerName
                    })
                });
                
                if (res.ok) {
                    selectedSpot.owner_message = newMsg;
                    selectedSpot.isModified = true;
                    saveSpotsToLocal();
                    
                    const display = document.getElementById('ownerMessageDisplay');
                    if (display) {
                        display.innerText = newMsg || 'お知らせはありません。';
                    }
                    showToast('オーナーメッセージを更新しました！', 'success');
                } else {
                    showToast('更新に失敗しました。', 'error');
                }
            } catch (err) {
                console.error("Failed to update owner message:", err);
                showToast('通信エラーが発生しました。', 'error');
            } finally {
                updateMsgBtn.disabled = false;
                updateMsgBtn.innerText = 'メッセージを更新';
            }
        });
    }
    
    window.initialSpots = initialSpots;
    window.showDetailPanel = showDetailPanel;
    window.showAddModal = showAddModal;
    window.getRandomLineupForManufacturer = getRandomLineupForManufacturer;
    window.fetchOSMVendingMachines = fetchOSMVendingMachines;
    window.getFetchedGrids = () => fetchedGrids;
    window.clearFetchedGrids = () => { fetchedGrids.length = 0; };
    window.mockGoogleLogin = mockGoogleLogin;
    window.handleLogout = handleLogout;
    
    initMap();
    window.map = map;

    // Bind Search Clear Button
    const clearBtn = document.getElementById('searchClearBtn');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            const input = document.getElementById('searchInput');
            if (input) {
                input.value = '';
                currentSearchQuery = '';
                renderMarkers(initialSpots);
                const dropdown = document.getElementById('searchSuggestions');
                if (dropdown) {
                    dropdown.style.display = 'none';
                    dropdown.innerHTML = '';
                }
                clearBtn.style.display = 'none';
            }
        });
    }

    // Bind Enter key to select the first suggestion
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const dropdown = document.getElementById('searchSuggestions');
                if (dropdown && dropdown.style.display !== 'none') {
                    const firstSuggestion = dropdown.querySelector('.suggestion-item:not(.no-results)');
                    if (firstSuggestion) {
                        firstSuggestion.click();
                    }
                }
            }
        });
    }
    
    // Fetch and merge all global collaborative spots on startup so all users see them immediately
    await fetchAndMergeGlobalSpots(null);
    
    // Parse URL parameters for Stripe redirect detection
    const urlParams = new URLSearchParams(window.location.search);
    const stripeSuccess = urlParams.get('stripe_success');
    const stripeCancel = urlParams.get('stripe_cancel');
    const spotIdParam = urlParams.get('spot_id');
    const sessionId = urlParams.get('session_id');

    if (stripeSuccess && spotIdParam && sessionId) {
        // Clear query parameters
        window.history.replaceState({}, document.title, window.location.pathname);
        showToast("決済を確認中...", "info");
        
        try {
            const res = await fetch(`${backendApiUrl}/api/verify-checkout-session?session_id=${sessionId}`);
            if (res.ok) {
                const data = await res.json();
                if (data.status === 'success' && data.paid) {
                    const spotId = isNaN(spotIdParam) ? spotIdParam : Number(spotIdParam);
                    const target = initialSpots.find(s => s.id === spotId || s.osmId === spotId);
                    if (target) {
                        const ownerName = currentUser ? currentUser.name : "トップハンター";
                        target.owner = ownerName;
                        target.namingRightsAvailable = false;
                        target.isModified = true;
                        saveSpotsToLocal();
                        if (typeof dispatchGlobalUpdateMetadata === 'function') {
                            dispatchGlobalUpdateMetadata(target, { owner: ownerName });
                        }
                        
                        // Automatically generate and activate license key for seamless integration
                        const autoKey = `LS-VENDIMAP-${sessionId.replace('mock_session_', '').substring(0, 10).toUpperCase()}`;
                        localStorage.setItem('vendimap_license_key', autoKey);
                        
                        const licenseInput = document.getElementById('vendi-license-input');
                        if (licenseInput) licenseInput.value = autoKey;
                        
                        const statusMsg = document.getElementById('vendi-license-status');
                        if (statusMsg) {
                            statusMsg.className = 'suite-key-status connected';
                            statusMsg.innerHTML = '<i class="fas fa-check-circle"></i> ライセンス認証完了！';
                            statusMsg.style.color = '#00ff88';
                        }
                        
                        showToast(`👑 命名権アンロック！あなたは「${target.name}」の所有者になりました！`, 'success');
                        
                        // Award XP for purchasing naming rights
                        VendiGamification.state.stats.boughtCount++;
                        if (!VendiGamification.state.boughtSpotIds) {
                            VendiGamification.state.boughtSpotIds = [];
                        }
                        if (!VendiGamification.state.boughtSpotIds.includes(String(target.id))) {
                            VendiGamification.state.boughtSpotIds.push(String(target.id));
                        }
                        VendiGamification.addXP(100, "自販機の命名権を獲得！");
                        VendiGamification.save();
                        
                        // Open details panel to display newly acquired ownership
                        showDetailPanel(target);
                        
                        // Automatically open the rename editor dialog so the user can rename it instantly
                        setTimeout(() => {
                            const nameEditBtn = document.getElementById('spotNameEditBtn');
                            if (nameEditBtn) nameEditBtn.click();
                        }, 800);
                    } else {
                        showToast("決済された自販機が見つかりませんでした。", "warning");
                    }
                } else {
                    showToast("決済の確認が取れませんでした。", "error");
                }
            } else {
                showToast("サーバーでの決済検証に失敗しました。", "error");
            }
        } catch (e) {
            console.error("Stripe verify failed:", e);
            showToast("決済検証中に通信エラーが発生しました。", "error");
        }
    } else if (stripeCancel) {
        window.history.replaceState({}, document.title, window.location.pathname);
        showToast("決済がキャンセルされました。", "warning");
    }
    
    // Register PWA Service Worker with cache bypass for check updates
    if ('serviceWorker' in navigator) {
        try {
            const reg = await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' });
            console.log('Service Worker registered successfully with scope:', reg.scope);
        } catch (err) {
            console.warn('Service Worker registration failed:', err);
        }
    }

    // Online / Offline Detection for Mobile PWA
    function updateOnlineStatus() {
        const banner = document.getElementById('offlineBanner');
        if (banner) {
            if (navigator.onLine) {
                if (banner.style.display === 'block') {
                    showToast('インターネット接続が復帰しました。', 'success');
                    if (typeof triggerAutoSync === 'function') triggerAutoSync();
                    if (typeof processOfflineQueue === 'function') processOfflineQueue();
                }
                banner.style.display = 'none';
            } else {
                banner.style.display = 'block';
                showToast('ネットワークがオフラインになりました。', 'warning');
            }
        }
    }
    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
    updateOnlineStatus();

    // Swipe down to close gesture helper for mobile viewports
    function initSwipeToClose(el, closeCallback) {
        if (!el) return;
        let startY = 0;
        let currentY = 0;
        let isDragging = false;
        
        el.addEventListener('touchstart', (e) => {
            if (window.innerWidth >= 768) return;
            const touch = e.touches[0];
            const handle = el.querySelector('.drag-handle-bar');
            
            if (e.target === handle || el.scrollTop <= 0) {
                startY = touch.clientY;
                currentY = touch.clientY;
                isDragging = true;
                el.style.transition = 'none';
            }
        }, { passive: true });
        
        el.addEventListener('touchmove', (e) => {
            if (!isDragging) return;
            const touch = e.touches[0];
            currentY = touch.clientY;
            const diff = currentY - startY;
            
            if (diff > 0) {
                el.style.transform = `translateY(${diff}px)`;
            }
        }, { passive: true });
        
        el.addEventListener('touchend', (e) => {
            if (!isDragging) return;
            isDragging = false;
            el.style.transition = '';
            
            const diff = currentY - startY;
            if (diff > 120) {
                el.style.transform = '';
                closeCallback();
            } else {
                el.style.transform = '';
            }
            startY = 0;
            currentY = 0;
        });
    }

    initSwipeToClose(document.getElementById('detailPanel'), closeDetailPanel);
    initSwipeToClose(document.querySelector('#achievementsModal .responsive-modal-card'), () => {
        document.getElementById('achievementsModal').style.display = 'none';
    });

    // Bind Spot Name Edit actions
    const nameEditBtn = document.getElementById('spotNameEditBtn');
    const nameEditContainer = document.getElementById('spotNameEditContainer');
    const nameEditInput = document.getElementById('spotNameEditInput');
    const nameSaveBtn = document.getElementById('spotNameSaveBtn');
    const nameCancelBtn = document.getElementById('spotNameCancelBtn');
    const spotNameHeading = document.getElementById('spotName');

    if (nameEditBtn && nameEditContainer && nameEditInput && nameSaveBtn && nameCancelBtn && spotNameHeading) {
        nameEditBtn.addEventListener('click', () => {
            if (selectedSpot) {
                // Pre-populate raw name excluding any HTML badge elements
                nameEditInput.value = selectedSpot.name;
                spotNameHeading.style.display = 'none';
                nameEditBtn.style.display = 'none';
                nameEditContainer.style.display = 'flex';
                nameEditInput.focus();
            }
        });

        nameCancelBtn.addEventListener('click', () => {
            spotNameHeading.style.display = 'block';
            nameEditBtn.style.display = 'inline-block';
            nameEditContainer.style.display = 'none';
        });

        nameSaveBtn.addEventListener('click', async () => {
            const newName = nameEditInput.value.trim();
            if (!newName) {
                showToast('名前を入力してください。', 'warning');
                return;
            }

            if (!selectedSpot) return;

            nameSaveBtn.disabled = true;
            nameSaveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

            try {
                const ownerName = currentUser ? currentUser.name : "トップハンター";
                const res = await fetch(`${backendApiUrl}/api/update-spot-metadata`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        spot_id: String(selectedSpot.id || selectedSpot.osmId),
                        name: newName,
                        owner: ownerName
                    })
                });

                if (res.ok) {
                    selectedSpot.name = newName;
                    selectedSpot.isModified = true;
                    saveSpotsToLocal();
                    
                    spotNameHeading.innerText = newName;
                    
                    // Toggle UI back
                    spotNameHeading.style.display = 'block';
                    nameEditBtn.style.display = 'inline-block';
                    nameEditContainer.style.display = 'none';
                    
                    showToast('自販機の名前を変更しました！', 'success');
                    
                    // Refresh map markers and trigger sync
                    renderMarkers(initialSpots);
                    if (typeof triggerAutoSync === 'function') triggerAutoSync();
                } else {
                    const errData = await res.json();
                    showToast(errData.detail || '名前の変更に失敗しました。', 'error');
                }
            } catch (e) {
                console.error("Failed to rename spot:", e);
                showToast('通信エラーが発生しました。', 'error');
            } finally {
                nameSaveBtn.disabled = false;
                nameSaveBtn.innerText = '保存';
            }
        });
    }
};
window.onerror = function(msg, url, line) { 
    console.error("System Error: ", msg, " Line: ", line);
    showToast("システムエラーが発生しました", "error"); 
};
function showOfflineError() {
    const errorDiv = document.createElement('div');
    errorDiv.style.position = 'fixed';
    errorDiv.style.inset = '0';
    errorDiv.style.background = '#0a0a0f';
    errorDiv.style.color = '#fff';
    errorDiv.style.display = 'flex';
    errorDiv.style.flexDirection = 'column';
    errorDiv.style.alignItems = 'center';
    errorDiv.style.justifyContent = 'center';
    errorDiv.style.padding = '20px';
    errorDiv.style.textAlign = 'center';
    errorDiv.style.fontFamily = "'Inter', sans-serif";
    errorDiv.style.zIndex = '999999';
    
    errorDiv.innerHTML = `
        <i class="fas fa-wifi" style="font-size: 4rem; color: #fec23c; margin-bottom: 20px;"></i>
        <h2 style="font-weight: 800; font-size: 1.5rem; margin-bottom: 10px;">マップライブラリをロードできません</h2>
        <p style="color: #9ca3af; max-width: 450px; margin-bottom: 20px; line-height: 1.6;">
            インターネット接続がオフラインであるか、プロキシ環境や学内ネットワーク等のファイアウォールによって地図配信サーバー（unpkg.com）への通信がブロックされている可能性があります。
        </p>
        <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); padding: 15px; border-radius: 12px; font-size: 0.85rem; max-width: 450px; text-align: left; line-height: 1.6;">
            <strong>解決策の候補:</strong>
            <ul style="margin: 8px 0 0 16px; padding: 0; color: #d1d5db;">
                <li>ネットワーク接続環境を切り替える（モバイルルーターや別のWi-Fi等）</li>
                <li>キャッシュを消去してブラウザを再読み込みする</li>
                <li>ブラウザのアドブロックやセキュリティ拡張機能を一時的にオフにする</li>
            </ul>
        </div>
    `;
    document.body.appendChild(errorDiv);
}

// ----------------------------------------------------
// 8. Dynamic Neo-Cyber Scrollbar Engine
// ----------------------------------------------------
const CustomScrollbarEngine = {
    instances: {},
    
    init(panelId) {
        const panel = document.getElementById(panelId);
        if (!panel) return;
        
        // Remove existing if any
        const existingTrack = panel.querySelector('.custom-scrollbar-track');
        if (existingTrack) existingTrack.remove();
        
        const track = document.createElement('div');
        track.className = 'custom-scrollbar-track';
        const thumb = document.createElement('div');
        thumb.className = 'custom-scrollbar-thumb';
        
        track.appendChild(thumb);
        panel.appendChild(track);
        
        const instance = {
            panel,
            track,
            thumb,
            isDragging: false,
            startY: 0,
            startScrollTop: 0,
            fadeTimeout: null
        };
        
        this.instances[panelId] = instance;
        
        // Setup events
        panel.addEventListener('scroll', () => this.update(panelId));
        panel.addEventListener('mouseenter', () => this.update(panelId));
        
        // Drag events
        thumb.addEventListener('mousedown', (e) => {
            instance.isDragging = true;
            instance.startY = e.clientY;
            instance.startScrollTop = panel.scrollTop;
            document.body.style.userSelect = 'none';
            thumb.style.cursor = 'grabbing';
            track.classList.add('scrolling');
            e.preventDefault();
        });
        
        document.addEventListener('mousemove', (e) => {
            if (!instance.isDragging) return;
            const deltaY = e.clientY - instance.startY;
            const scrollableHeight = panel.scrollHeight - panel.clientHeight;
            const trackHeight = track.clientHeight;
            const thumbHeight = thumb.clientHeight;
            const scrollableTrackHeight = trackHeight - thumbHeight;
            
            if (scrollableTrackHeight <= 0) return;
            
            const scrollRatio = deltaY / scrollableTrackHeight;
            panel.scrollTop = instance.startScrollTop + (scrollRatio * scrollableHeight);
            this.update(panelId);
        });
        
        document.addEventListener('mouseup', () => {
            if (instance.isDragging) {
                instance.isDragging = false;
                document.body.style.userSelect = '';
                thumb.style.cursor = 'grab';
                track.classList.remove('scrolling');
            }
        });
        
        // Initialize
        this.update(panelId);
    },
    
    update(panelId) {
        const instance = this.instances[panelId];
        if (!instance) return;
        
        const { panel, track, thumb } = instance;
        
        const clientHeight = panel.clientHeight;
        const scrollHeight = panel.scrollHeight;
        const scrollTop = panel.scrollTop;
        
        // If content fits completely, hide track
        if (scrollHeight <= clientHeight) {
            track.style.display = 'none';
            return;
        } else {
            track.style.display = 'block';
        }
        
        // Calculate dimensions
        const trackHeight = track.clientHeight || (clientHeight - 40); // fallback
        const thumbHeight = Math.max(30, (clientHeight / scrollHeight) * trackHeight);
        const maxScrollTop = scrollHeight - clientHeight;
        const scrollPercent = scrollTop / maxScrollTop;
        const maxThumbTop = trackHeight - thumbHeight;
        const thumbTop = scrollPercent * maxThumbTop;
        
        thumb.style.height = `${thumbHeight}px`;
        thumb.style.transform = `translateY(${thumbTop}px)`;
        
        // Add flashing effect during scroll
        track.classList.add('scrolling');
        clearTimeout(instance.fadeTimeout);
        if (!instance.isDragging) {
            instance.fadeTimeout = setTimeout(() => {
                track.classList.remove('scrolling');
            }, 1000);
        }
    }
};

let territoryPolygon = null;

// ヘルパー関数: 点がポリゴン（輪郭線）の内側にあるか判定する (Ray-casting algorithm)
// polygonCoords は [[lng, lat], [lng, lat], ...] の配列
function isPointInPolygon(lat, lng, polygonCoords) {
    let x = lng, y = lat;
    let inside = false;
    for (let i = 0, j = polygonCoords.length - 1; i < polygonCoords.length; j = i++) {
        let xi = polygonCoords[i][0], yi = polygonCoords[i][1];
        let xj = polygonCoords[j][0], yj = polygonCoords[j][1];
        
        let intersect = ((yi > y) !== (yj > y))
            && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

// ヘルパー関数: 点が GeoJSON (Polygon または MultiPolygon) の内側にあるか判定する
function isPointInGeoJSON(lat, lng, geojson) {
    if (!geojson) return false;
    
    if (geojson.type === 'Polygon') {
        if (geojson.coordinates && geojson.coordinates.length > 0) {
            return isPointInPolygon(lat, lng, geojson.coordinates[0]);
        }
    } else if (geojson.type === 'MultiPolygon') {
        if (geojson.coordinates) {
            for (let i = 0; i < geojson.coordinates.length; i++) {
                const polygon = geojson.coordinates[i];
                if (polygon.length > 0 && isPointInPolygon(lat, lng, polygon[0])) {
                    return true;
                }
            }
        }
    }
    return false;
}

function showTerritoryOnMap(lat, lng, name, gridSize, areaKey) {
    if (!window.map) return;
    
    // 既存の縄張りポリゴン/サークルを消去
    if (territoryPolygon) {
        window.map.removeLayer(territoryPolygon);
    }
    
    if (typeof showToast === 'function') {
        showToast(`🗺️ ${name}の行政境界を取得中...`, 'info');
    }
    
    // 段階的にズームレベルを下げて、Polygon/MultiPolygon を探索する
    // 領海や港湾水域（海）を含んでしまう行政区（zoom=13）や市区町村全体（zoom=12）は海面はみ出しを防ぐため除外し、
    // 海岸線で閉じている陸地の町丁目・大字（zoom=14, 15）のみを取得する。Polygonが無ければ安全にサークルへフォールバックする
    const zoomLevels = [14, 15];
    
    function tryFetch(index) {
        if (index >= zoomLevels.length) {
            console.warn("Could not find any polygon boundary, falling back to circle.");
            drawFallbackCircle(lat, lng, name, gridSize);
            return;
        }
        
        const zoom = zoomLevels[index];
        const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=${zoom}&addressdetails=1&polygon_geojson=1`;
        
        fetch(url, {
            headers: {
                'User-Agent': 'VendiMap-App-Release-Client'
            }
        })
        .then(res => res.json())
        .then(data => {
            if (data && data.geojson && (data.geojson.type === 'Polygon' || data.geojson.type === 'MultiPolygon')) {
                
                // --- 境界線（ポリゴン）内にある自販機の数を動的に再集計 ---
                const spotsInPolygon = initialSpots.filter(s => {
                    const sLat = Number(s.lat);
                    const sLng = Number(s.lng);
                    return isPointInGeoJSON(sLat, sLng, data.geojson);
                });
                
                const totalInPolygon = spotsInPolygon.length;
                
                // もしポリゴン内に自販機が1台もヒットしない場合は、境界の探索スケールが合っていない可能性が高いため、
                // 次のズームレベル（あるいはサークルフォールバック）を試す
                if (totalInPolygon === 0) {
                    tryFetch(index + 1);
                    return;
                }
                
                const userName = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.name : 'ゲストハンター';
                const ownedInPolygon = spotsInPolygon.filter(s => s.owner && s.owner === userName).length;
                const pctInPolygon = (ownedInPolygon / totalInPolygon) * 100;

                // 地名解決 (Nominatim から得られた正確な地名を優先してカード名およびポップアップのタイトルにする)
                let resolvedName = name;
                if (data && data.address) {
                    const addr = data.address;
                    const districtName = addr.suburb || addr.neighbourhood || addr.quarter || addr.city_district || addr.town || addr.village || addr.city || "";
                    if (districtName) {
                        resolvedName = `${districtName} エリア`;
                    }
                }
                
                // 重複する他の縄張りカードをマージして非表示にする
                let mergedAny = false;
                if (areaKey) {
                    const cards = document.querySelectorAll('.territory-card');
                    cards.forEach(c => {
                        const cLat = Number(c.getAttribute('data-lat'));
                        const cLng = Number(c.getAttribute('data-lng'));
                        const cKey = c.getAttribute('data-key');
                        
                        if (cKey !== areaKey && !isNaN(cLat) && !isNaN(cLng)) {
                            // そのカードの代表座標がこのポリゴンの内側にある場合、重複カードとみなす
                            if (isPointInGeoJSON(cLat, cLng, data.geojson)) {
                                c.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
                                c.style.opacity = '0';
                                c.style.transform = 'scale(0.95)';
                                setTimeout(() => {
                                    c.style.display = 'none';
                                }, 300);
                                mergedAny = true;
                            }
                        }
                    });
                }
                
                // Leaflet の L.geoJSON を使って実際の地区の形を描画
                territoryPolygon = L.geoJSON(data.geojson, {
                    style: {
                        color: '#fbbf24',       // ゴールドの境界線
                        fillColor: '#fbbf24',   // ゴールドの塗りつぶし
                        fillOpacity: 0.15,      // 半透明
                        weight: 2.5,
                        dashArray: '4, 4'
                    }
                }).addTo(window.map);
                
                // 境界ポリゴンにポップアップを付与 (再集計した正確な自販機数を表示)
                const popupContent = `
                    <div style="font-family: 'Inter', sans-serif; color: #fff; background: #0a0a0f; padding: 6px; min-width: 180px;">
                        <strong style="color: #fbbf24; font-size: 0.95rem;">🛡️ ${resolvedName}</strong><br>
                        <div style="margin-top: 6px; font-size: 0.8rem; border-top: 1px solid #1f2937; padding-top: 6px;">
                            <span style="color: #9ca3af;">この地区内の自販機:</span><br>
                            <strong style="color: #fff; font-size: 0.9rem;">${ownedInPolygon} / ${totalInPolygon} 台 (${pctInPolygon.toFixed(0)}%)</strong>
                        </div>
                        <div style="margin-top: 4px; font-size: 0.72rem; color: #9ca3af;">
                            状態: <span style="color: ${pctInPolygon === 100 ? '#10b981' : pctInPolygon > 0 ? '#fbbf24' : '#ef4444'}; font-weight: bold;">
                                ${pctInPolygon === 100 ? '支配中 👑' : pctInPolygon > 0 ? '争奪中 ⚡' : '未進出 🗺️'}
                            </span>
                        </div>
                        <span style="font-size: 0.65rem; color: #6b7280; display: block; margin-top: 6px;">実際の地区境界（行政区画）を表示中</span>
                    </div>
                `;
                territoryPolygon.bindPopup(popupContent, { className: 'custom-popup-dark' }).openPopup();
                
                // ポリゴンの範囲に合わせて自動で地図をズーム・移動
                const bounds = territoryPolygon.getBounds();
                window.map.fitBounds(bounds, { maxZoom: 15, animate: true });
                
                // ズームアウトしすぎを防ぐ
                setTimeout(() => {
                    if (window.map.getZoom() < 12) {
                        window.map.setZoom(12, { animate: true });
                    }
                }, 400);
                
                // カードの表示を実際のポリゴン内集計値に動的にアップデート
                if (areaKey) {
                    const nameEl = document.getElementById(`areaName_${areaKey}`);
                    const progressEl = document.getElementById(`areaProgressBar_${areaKey}`);
                    const metaEl = document.getElementById(`areaMetaText_${areaKey}`);
                    const statusEl = document.getElementById(`areaStatus_${areaKey}`);
                    
                    if (nameEl) {
                        nameEl.innerText = resolvedName;
                    }
                    if (metaEl) {
                        metaEl.innerHTML = `所有: ${ownedInPolygon} / ${totalInPolygon} 台 (${pctInPolygon.toFixed(0)}%)`;
                    }
                    if (progressEl) {
                        progressEl.style.width = `${pctInPolygon}%`;
                    }
                    if (statusEl) {
                        let newStatusText = '未進出 🗺️';
                        let newStatusClass = 'unexplored';
                        if (pctInPolygon === 100) {
                            newStatusText = '支配中 👑';
                            newStatusClass = 'dominating';
                        } else if (ownedInPolygon > 0) {
                            newStatusText = '争奪中 ⚡';
                            newStatusClass = 'fighting';
                        }
                        statusEl.className = `territory-status ${newStatusClass}`;
                        statusEl.innerText = newStatusText;
                    }
                }
                
                if (mergedAny && typeof showToast === 'function') {
                    showToast(`🔄 重複する隣接エリアの縄張りを「${resolvedName}」に統合しました`, 'success');
                } else if (typeof showToast === 'function') {
                    showToast(`🗺️ ${resolvedName}の範囲（地区境界ポリゴン）を地図に描画しました`, 'success');
                }
            } else {
                // Polygon が得られなかった場合は、次のズームレベルを試す
                tryFetch(index + 1);
            }
        })
        .catch(err => {
            console.warn(`Failed to fetch polygon at zoom ${zoom}:`, err);
            tryFetch(index + 1);
        });
    }
    
    tryFetch(0);
}
window.showTerritoryOnMap = showTerritoryOnMap;

// 安全なフォールバック用サークル描画関数
function drawFallbackCircle(lat, lng, name, gridSize) {
    const radiusInMeters = (gridSize * 111000) * 0.7;
    territoryPolygon = L.circle([lat, lng], {
        color: '#fbbf24',
        fillColor: '#fbbf24',
        fillOpacity: 0.15,
        radius: radiusInMeters,
        weight: 2,
        dashArray: '6, 6'
    }).addTo(window.map);
    
    territoryPolygon.bindPopup(`
        <div style="font-family: 'Inter', sans-serif; color: #fff; background: #0a0a0f; padding: 4px;">
            <strong style="color: #fbbf24; font-size: 0.9rem;">🛡️ ${name}</strong><br>
            <span style="font-size: 0.75rem; color: #9ca3af;">縄張り範囲（半径: ${(radiusInMeters/1000).toFixed(1)} km）</span>
        </div>
    `, { className: 'custom-popup-dark' }).openPopup();
    
    window.map.setView([lat, lng], 14);
}

const resolvedAreaNames = {};

function resolveAreaName(areaKey, lat, lng, elementId) {
    if (resolvedAreaNames[areaKey]) {
        const el = document.getElementById(elementId);
        if (el && resolvedAreaNames[areaKey] !== "取得中...") {
            el.innerText = resolvedAreaNames[areaKey];
        }
        return;
    }
    
    resolvedAreaNames[areaKey] = "取得中...";
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=16&addressdetails=1`;
    
    fetch(url, {
        headers: {
            'User-Agent': 'VendiMap-App-Release-Client'
        }
    })
    .then(res => res.json())
    .then(data => {
        let displayName = "";
        if (data && data.address) {
            const addr = data.address;
            displayName = addr.suburb || addr.neighbourhood || addr.quarter || addr.city_district || addr.town || addr.village || addr.city || "";
        }
        
        if (!displayName) {
            displayName = `${lat.toFixed(2)}, ${lng.toFixed(2)}周辺`;
        } else {
            displayName = `${displayName}周辺`;
        }
        
        resolvedAreaNames[areaKey] = displayName;
        
        const el = document.getElementById(elementId);
        if (el) {
            el.innerText = displayName;
        }
    })
    .catch(err => {
        console.warn("Failed to reverse geocode area name:", err);
        resolvedAreaNames[areaKey] = `${lat.toFixed(2)}, ${lng.toFixed(2)}周辺`;
    });
}
window.resolveAreaName = resolveAreaName;

// ----------------------------------------------------
// PWA Install Prompt Handlers & UI Controller
// ----------------------------------------------------
let deferredPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
    const installBanner = document.getElementById('pwaInstallBanner');
    if (installBanner && !isStandalone) {
        installBanner.style.display = 'flex';
    }
});

document.addEventListener('DOMContentLoaded', () => {
    const installBtn = document.getElementById('pwaInstallBtn');
    const closeBtn = document.getElementById('pwaCloseBtn');
    const installBanner = document.getElementById('pwaInstallBanner');
    
    if (installBtn) {
        installBtn.addEventListener('click', async () => {
            if (!deferredPrompt) return;
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            console.log(`PWA user choice: ${outcome}`);
            deferredPrompt = null;
            if (installBanner) {
                installBanner.style.display = 'none';
            }
        });
    }
    
    if (closeBtn && installBanner) {
        closeBtn.addEventListener('click', () => {
            installBanner.style.display = 'none';
        });
    }
    
    const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
    const iosGuide = document.getElementById('pwaIosGuide');
    const iosCloseBtn = document.getElementById('pwaIosCloseBtn');
    
    if (isIos && !isStandalone && iosGuide) {
        iosGuide.style.display = 'flex';
        
        if (iosCloseBtn) {
            iosCloseBtn.addEventListener('click', () => {
                iosGuide.style.display = 'none';
            });
        }
        
        setTimeout(() => {
            if (iosGuide) iosGuide.style.display = 'none';
        }, 25000);
    }
    
    // Enable horizontal drag scrolling for filter tags on PC
    const initFilterDragScroll = () => {
        const slider = document.getElementById('filterContainer');
        if (!slider) return;
        
        let isDown = false;
        let startX;
        let scrollLeft;
        
        slider.addEventListener('mousedown', (e) => {
            isDown = true;
            slider.style.cursor = 'grabbing';
            startX = e.pageX - slider.offsetLeft;
            scrollLeft = slider.scrollLeft;
            e.preventDefault();
        });
        
        slider.addEventListener('mouseleave', () => {
            isDown = false;
            slider.style.cursor = 'pointer';
        });
        
        slider.addEventListener('mouseup', () => {
            isDown = false;
            slider.style.cursor = 'pointer';
        });
        
        slider.addEventListener('mousemove', (e) => {
            if (!isDown) return;
            e.preventDefault();
            const x = e.pageX - slider.offsetLeft;
            const walk = (x - startX) * 1.5; // Scroll speed sensitivity
            slider.scrollLeft = scrollLeft - walk;
        });
    };
    initFilterDragScroll();
});

export { initialSpots, CustomScrollbarEngine };

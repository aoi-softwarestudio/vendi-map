/* ==========================================================================
   ReporTweak Application Logic (Vanilla JS)
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
    // --- 状態管理 ---
    const state = {
        apiKey: localStorage.getItem('reportweak_api_key') || '',
        model: localStorage.getItem('reportweak_model') || 'gemini-2.5-flash',
        history: JSON.parse(localStorage.getItem('reportweak_history')) || [],
        activeHistoryId: null,
        activeTab: 'output' // 'output' or 'diff'
    };

    // --- サンプル文章データ ---
    const samples = {
        sample1: `本研究の目的は、現代社会におけるSNSの急速な普及に伴う若年層のコミュニケーション変容を実証的に検証することにある。先行研究において指摘されている通り、非対面型メディアの利用頻度上昇は、対面コミュニケーション能力の減退を惹起する懸念がある。詳細な分析を行った結果、対面での相互作用時における非言語的シグナルの解読力に、統計的に有意な差が認められた。したがって、デジタルコミュニケーションへの依存は、社会関係資本の構築過程において何らかの齟齬を生じさせていると考察される。この状況はもはや不可避であり、教育現場における対面コミュニケーションの再評価という課題が山積していると言わざるを得ない。`,
        
        sample2: `最近みんながSNSを使うようになって、若者のコミュニケーションが変わってきたなと思います。画面を見ないで話すことが増えると、面と向かって話すのが苦手になっちゃうんじゃないかと心配されています。実際に色々調べてみたら、直接会って話すときに、相手の表情や態度から気持ちを読み取るのが難しくなっているという、はっきりとした違いがありました。だから、スマホばかり使っていると、友達との良い関係を作るのが難しくなるんじゃないかなと思います。これはしょうがないことかもしれないけど、学校とかでもっと話し合う機会を作るなど、問題がたくさんある気がします。`
    };

    // --- DOM要素の取得 ---
    const rangeIntelligence = document.getElementById('range-intelligence');
    const valIntelligence = document.getElementById('val-intelligence');
    const rangeFormalness = document.getElementById('range-formalness');
    const valFormalness = document.getElementById('val-formalness');
    const selectTone = document.getElementById('select-tone');
    const selectEnding = document.getElementById('select-ending');
    
    const textSource = document.getElementById('text-source');
    const textTarget = document.getElementById('text-target');
    const sourceWordCount = document.getElementById('source-word-count');
    const targetWordCount = document.getElementById('target-word-count');
    const processTimeBadge = document.getElementById('process-time-badge');
    
    const btnTransform = document.getElementById('btn-transform');
    const btnClearSource = document.getElementById('btn-clear-source');
    const btnSample1 = document.getElementById('btn-sample-1');
    const btnSample2 = document.getElementById('btn-sample-2');
    const btnCopy = document.getElementById('btn-copy');
    const btnDownload = document.getElementById('btn-download');
    
    const tabOutput = document.getElementById('tab-output');
    const tabDiff = document.getElementById('tab-diff');
    const outputTextContainer = document.getElementById('output-text-container');
    const outputDiffContainer = document.getElementById('output-diff-container');
    const diffViewer = document.getElementById('diff-viewer');
    
    const apiStatusBadge = document.getElementById('api-status-badge');
    const btnSettings = document.getElementById('btn-settings');
    const modalSettings = document.getElementById('modal-settings');
    const btnCloseModal = document.getElementById('btn-close-modal');
    const inputApiKey = document.getElementById('input-api-key');
    const btnToggleApiKeyVis = document.getElementById('btn-toggle-api-key-vis');
    const selectModel = document.getElementById('select-model');
    const btnTestApi = document.getElementById('btn-test-api');
    const btnSaveSettings = document.getElementById('btn-save-settings');
    
    const historyList = document.getElementById('history-list');
    const btnClearHistory = document.getElementById('btn-clear-history');
    
    const toast = document.getElementById('toast');

    // --- 初期化処理 ---
    function init() {
        updateIntelligenceLabel(rangeIntelligence.value);
        updateFormalnessLabel(rangeFormalness.value);
        updateApiBadge();
        renderHistory();
        
        // パスワード入力フィールドの初期値
        if (state.apiKey) {
            inputApiKey.value = state.apiKey;
        }
        selectModel.value = state.model;
        
        // イベントリスナーの登録
        registerEvents();
    }

    // --- イベントリスナーの定義 ---
    function registerEvents() {
        // パラメータスライダー
        rangeIntelligence.addEventListener('input', (e) => updateIntelligenceLabel(e.target.value));
        rangeFormalness.addEventListener('input', (e) => updateFormalnessLabel(e.target.value));
        
        // 文字数カウント
        textSource.addEventListener('input', updateSourceWordCount);
        
        // サンプル読込 & クリア
        btnSample1.addEventListener('click', () => loadSample(samples.sample1));
        btnSample2.addEventListener('click', () => loadSample(samples.sample2));
        btnClearSource.addEventListener('click', () => {
            textSource.value = '';
            updateSourceWordCount();
            showToast('入力テキストをクリアしました', 'info');
        });
        
        // コピペ & 保存
        btnCopy.addEventListener('click', copyTargetText);
        btnDownload.addEventListener('click', downloadTargetText);
        
        // タブ切り替え
        tabOutput.addEventListener('click', () => switchTab('output'));
        tabDiff.addEventListener('click', () => switchTab('diff'));
        
        // 変換処理
        btnTransform.addEventListener('click', runTransformation);
        
        // 設定モーダル
        btnSettings.addEventListener('click', openSettingsModal);
        btnCloseModal.addEventListener('click', closeSettingsModal);
        btnToggleApiKeyVis.addEventListener('click', toggleApiKeyVisibility);
        btnSaveSettings.addEventListener('click', saveSettings);
        btnTestApi.addEventListener('click', testApiConnection);
        
        // 履歴
        btnClearHistory.addEventListener('click', clearAllHistory);
    }

    // --- UI更新ヘルパー ---
    function updateIntelligenceLabel(val) {
        let label = '';
        if (val <= 30) label = `${val} (高校生レベル)`;
        else if (val <= 60) label = `${val} (大学生レベル)`;
        else if (val <= 85) label = `${val} (大学院生レベル)`;
        else label = `${val} (研究者・教授レベル)`;
        
        valIntelligence.textContent = label;
    }

    function updateFormalnessLabel(val) {
        valFormalness.textContent = `${val}%`;
    }

    function updateSourceWordCount() {
        sourceWordCount.textContent = `文字数: ${textSource.value.length}`;
    }

    function updateTargetWordCount() {
        targetWordCount.textContent = `文字数: ${textTarget.value.length}`;
    }

    function updateApiBadge() {
        if (state.apiKey) {
            apiStatusBadge.className = 'status-badge online-mode';
            apiStatusBadge.querySelector('.status-text').textContent = 'Gemini API 有効';
        } else {
            apiStatusBadge.className = 'status-badge mock-mode';
            apiStatusBadge.querySelector('.status-text').textContent = 'オフライン・モックモード';
        }
    }

    function showToast(message, type = 'info') {
        const iconMap = {
            info: 'info',
            success: 'check-circle-2',
            error: 'alert-triangle'
        };
        
        toast.className = `toast toast-${type}`;
        toast.querySelector('.toast-message').textContent = message;
        
        const iconEl = toast.querySelector('.toast-icon');
        iconEl.setAttribute('data-lucide', iconMap[type]);
        lucide.createIcons({ attrs: { class: 'toast-icon' }, nameAttr: 'data-lucide' });
        
        toast.classList.remove('hidden');
        
        // アニメーション用に再描画を促す
        toast.style.animation = 'none';
        toast.offsetHeight; // トリガー
        toast.style.animation = '';
        
        // 3秒後に非表示
        if (window.toastTimeout) clearTimeout(window.toastTimeout);
        window.toastTimeout = setTimeout(() => {
            toast.classList.add('hidden');
        }, 3000);
    }

    function loadSample(text) {
        textSource.value = text;
        updateSourceWordCount();
        showToast('サンプル文章をロードしました', 'success');
    }

    function switchTab(tab) {
        state.activeTab = tab;
        if (tab === 'output') {
            tabOutput.classList.add('active');
            tabDiff.classList.remove('active');
            outputTextContainer.classList.remove('hidden');
            outputDiffContainer.classList.add('hidden');
        } else {
            tabOutput.classList.remove('active');
            tabDiff.classList.add('active');
            outputTextContainer.classList.add('hidden');
            outputDiffContainer.classList.remove('hidden');
            
            // Diffを表示
            renderDiff();
        }
    }

    // --- 設定モーダルロジック ---
    function openSettingsModal() {
        modalSettings.classList.remove('hidden');
    }

    function closeSettingsModal() {
        modalSettings.classList.add('hidden');
    }

    function toggleApiKeyVisibility() {
        const type = inputApiKey.getAttribute('type') === 'password' ? 'text' : 'password';
        inputApiKey.setAttribute('type', type);
        const iconName = type === 'password' ? 'eye' : 'eye-off';
        btnToggleApiKeyVis.querySelector('i').setAttribute('data-lucide', iconName);
        lucide.createIcons();
    }

    function saveSettings() {
        const key = inputApiKey.value.trim();
        const model = selectModel.value;
        
        state.apiKey = key;
        state.model = model;
        
        if (key) {
            localStorage.setItem('reportweak_api_key', key);
        } else {
            localStorage.removeItem('reportweak_api_key');
        }
        localStorage.setItem('reportweak_model', model);
        
        updateApiBadge();
        closeSettingsModal();
        showToast('設定を保存しました', 'success');
    }

    async function testApiConnection() {
        const key = inputApiKey.value.trim();
        const model = selectModel.value;
        
        if (!key) {
            showToast('APIキーを入力してください', 'error');
            return;
        }
        
        btnTestApi.disabled = true;
        btnTestApi.innerHTML = '<i data-lucide="loader" class="animate-spin"></i> 接続中...';
        lucide.createIcons();
        
        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: 'Hello, reply with "OK".' }] }]
                })
            });
            
            const data = await response.json();
            
            if (response.ok && data.candidates && data.candidates[0].content.parts[0].text) {
                showToast('API接続テストに成功しました！', 'success');
            } else {
                const errMsg = data.error ? data.error.message : 'APIキーが無効、またはモデルが利用できません。';
                showToast(`接続失敗: ${errMsg}`, 'error');
            }
        } catch (error) {
            showToast(`接続エラー: ${error.message}`, 'error');
        } finally {
            btnTestApi.disabled = false;
            btnTestApi.innerHTML = '<i data-lucide="check-circle-2"></i> 接続テスト';
            lucide.createIcons();
        }
    }

    // --- コピー & ダウンロード ---
    function copyTargetText() {
        const text = textTarget.value;
        if (!text) {
            showToast('コピーするテキストがありません', 'error');
            return;
        }
        navigator.clipboard.writeText(text).then(() => {
            showToast('クリップボードにコピーしました', 'success');
        }).catch(err => {
            showToast('コピーに失敗しました', 'error');
        });
    }

    function downloadTargetText() {
        const text = textTarget.value;
        if (!text) {
            showToast('保存するテキストがありません', 'error');
            return;
        }
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `reportweak-transformed-${new Date().toISOString().slice(0, 10)}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('ファイルとして保存しました', 'success');
    }

    // --- スタイル変換の実行 ---
    async function runTransformation() {
        const source = textSource.value.trim();
        if (!source) {
            showToast('変換元の文章を入力してください', 'error');
            return;
        }
        
        btnTransform.disabled = true;
        btnTransform.innerHTML = '<i data-lucide="loader" class="animate-spin"></i> 変換処理中...';
        lucide.createIcons();
        processTimeBadge.classList.add('hidden');
        
        const startTime = performance.now();
        let target = '';
        
        const intelligence = parseInt(rangeIntelligence.value);
        const formalness = parseInt(rangeFormalness.value);
        const tone = selectTone.value;
        const ending = selectEnding.value;
        
        try {
            if (state.apiKey) {
                // Gemini API リクエスト
                target = await callGeminiAPI(source, intelligence, formalness, tone, ending);
            } else {
                // 内蔵モックエンジンによるリライト
                target = await runMockRewrite(source, intelligence, formalness, tone, ending);
            }
            
            textTarget.value = target;
            updateTargetWordCount();
            
            const endTime = performance.now();
            const timeDiff = ((endTime - startTime) / 1000).toFixed(2);
            processTimeBadge.textContent = `変換時間: ${timeDiff}秒`;
            processTimeBadge.classList.remove('hidden');
            
            // 履歴に保存
            saveToHistory(source, target, intelligence, formalness, tone, ending);
            showToast('スタイル変換が完了しました！', 'success');
            
            // Diff表示の更新
            if (state.activeTab === 'diff') {
                renderDiff();
            }
        } catch (error) {
            showToast(`変換失敗: ${error.message}`, 'error');
            console.error(error);
        } finally {
            btnTransform.disabled = false;
            btnTransform.innerHTML = '<i data-lucide="zap"></i> スタイル変換を実行';
            lucide.createIcons();
        }
    }

    // --- Gemini API 呼び出しロジック ---
    async function callGeminiAPI(source, intelligence, formalness, tone, ending) {
        const prompt = `あなたは文章のトーン・難易度・言い回しを正確に校正するプロフェッショナルなリライトAIです。
以下の【元の文章】について、提供された【リライトパラメータ】に厳密に従って書き換えてください。元の文章の主張やファクト、重要な意味合いは完全に維持してください。

【リライトパラメータ】
1. 知能レベル (10〜100): ${intelligence}
   - 10〜30: 高校生レベル。専門的で難しい語彙や熟語は簡単な言葉に置き換えてください。一文を短くし、簡潔で分かりやすい日常的な日本語表現にします。
   - 31〜60: 大学生レベル。標準的な論説・レポート用の口調。適度に一般的な専門用語を使用し、読みやすいロジック構成にします。
   - 61〜85: 大学院生レベル。専門用語やアカデミックな概念語を積極的に取り入れ、論理的接続詞を多用した知的で高度な文章にします。
   - 86〜100: 研究者・教授レベル。非常に高度で抽象的な語彙を用い、極めて厳格かつ洗練された学術的な論文スタイルに書き換えます。

2. 文章の厳格さ (Formalness) (0〜100): ${formalness}%
   - 0%に近いほど親しみやすく自然な表現に、100%に近いほど感情や装飾的な表現を一切排除した、極めて客観的で硬質な表現にします。

3. トーンの方向性: ${tone}
   - standard: 標準的（内容重視で偏りのないトーン）
   - academic: 学術的・論文調（学問的なレポート・論文に適したスタイル）
   - business: ビジネス・論理的（結論ファースト、無駄のない構成、ビジネス文書調）
   - easy: 平易（小中学生でも完全に理解できる、非常に平易で具体的な説明）
   - creative: 表現豊か（エッセイやコラムのような、味わいのある豊かな語彙のスタイル）

4. 文末スタイル: ${ending}
   - keep: 元の文章の文末スタイル（です・ます、である、等の混合）を極力維持します。
   - da: すべての文末を「だ・である」に統一します。
   - desu: すべての文末を「です・ます」に統一します。

【元の文章】
${source}

【出力時の重要ルール】
出力は【リライト後の文章】のみを返してください。挨拶、説明、前置き、コードブロックの囲み（\`\`\`等）は一切含めないでください。リライト後の日本語テキストだけを出力してください。`;

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${state.model}:generateContent?key=${state.apiKey}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: 0.3 // 一貫性を高めるために低めにする
                }
            })
        });

        const data = await response.json();
        
        if (!response.ok) {
            const msg = data.error ? data.error.message : 'API呼び出し中にエラーが発生しました';
            throw new Error(msg);
        }

        let resultText = data.candidates[0].content.parts[0].text;
        
        // 前後の不要な改行やマークダウンをトリミング
        resultText = resultText.replace(/^```html?\n?|^```markdown?\n?|^```plaintext?\n?|^```\n?/, '');
        resultText = resultText.replace(/\n?```$/, '');
        return resultText.trim();
    }

    // --- 内蔵モックAIリライトエンジン ---
    function runMockRewrite(source, intelligence, formalness, tone, ending) {
        return new Promise((resolve) => {
            // ローカル処理を演出するためのわずかな遅延
            setTimeout(() => {
                let text = source;
                
                // 難解から平易へのルール（知能レベルが低い場合）
                const rulesToLow = [
                    { pattern: /本研究の目的は/g, replacement: "このレポートの目的は" },
                    { pattern: /実証的に検証することにある/g, replacement: "実際に確かめてみることです" },
                    { pattern: /先行研究において/g, replacement: "以前行われた研究で" },
                    { pattern: /指摘されている通り/g, replacement: "言われている通り" },
                    { pattern: /非対面型メディア/g, replacement: "スマホやSNSなどのネットのコミュニケーション" },
                    { pattern: /利用頻度上昇/g, replacement: "使う回数が増えること" },
                    { pattern: /対面コミュニケーション能力の減退/g, replacement: "直接会って話すのが下手になること" },
                    { pattern: /惹起する懸念がある/g, replacement: "引き起こす心配があります" },
                    { pattern: /詳細な分析を行った結果/g, replacement: "詳しく調べてみた結果" },
                    { pattern: /相互作用時/g, replacement: "話し合っているとき" },
                    { pattern: /非言語的シグナル/g, replacement: "表情やしぐさ、空気" },
                    { pattern: /解読力/g, replacement: "読み取る力" },
                    { pattern: /統計的に有意な差が認められた/g, replacement: "はっきりとした違いが見られました" },
                    { pattern: /したがって/g, replacement: "だから" },
                    { pattern: /デジタルコミュニケーションへの依存/g, replacement: "ネットばかりに頼ること" },
                    { pattern: /社会関係資本の構築過程/g, replacement: "友達との良い関係を作っていく中" },
                    { pattern: /齟齬を生じさせている/g, replacement: "ズレや問題が起きている" },
                    { pattern: /考察される/g, replacement: "考えられます" },
                    { pattern: /不可避であり/g, replacement: "仕方のないことであり" },
                    { pattern: /教育現場における/g, replacement: "学校などの教育の場所で" },
                    { pattern: /対面コミュニケーションの再評価/g, replacement: "直接話すことの大切さを見直すこと" },
                    { pattern: /課題が山積している/g, replacement: "問題がたくさん残っている" },
                    { pattern: /言わざるを得ない/g, replacement: "と思います" },
                    { pattern: /極めて重要である/g, replacement: "とても重要です" },
                    { pattern: /示唆している/g, replacement: "示している" }
                ];
                
                // 平易から難解へのルール（知能レベルが高い場合）
                const rulesToHigh = [
                    { pattern: /ネットのコミュニケーション|スマホやSNS/g, replacement: "非対面型デジタルメディア" },
                    { pattern: /直接会って話すこと/g, replacement: "対面におけるコミュニケーション" },
                    { pattern: /下手になる/g, replacement: "能力の減退が生じる" },
                    { pattern: /心配されています/g, replacement: "懸念が指摘されている" },
                    { pattern: /詳しく調べてみた結果/g, replacement: "詳細な分析を試みた結果" },
                    { pattern: /表情やしぐさ、空気/g, replacement: "非言語的コミュニケーションシグナル" },
                    { pattern: /はっきりとした違いが見られました/g, replacement: "統計的有意差が検出された" },
                    { pattern: /だから|なので/g, replacement: "したがって" },
                    { pattern: /友達との良い関係を作っていく/g, replacement: "社会関係資本を構築する" },
                    { pattern: /ズレや問題が起きている/g, replacement: "齟齬が惹起されている" },
                    { pattern: /〜だと思います/g, replacement: "〜と考察される" },
                    { pattern: /仕方のないこと/g, replacement: "不可避の事態" },
                    { pattern: /問題がたくさん残っている/g, replacement: "課題が山積している" },
                    { pattern: /とても重要です/g, replacement: "極めて重要である" },
                    { pattern: /言われている通り/g, replacement: "指摘されている通り" }
                ];

                // 1. 知能レベルに応じた置換処理
                if (intelligence <= 30) {
                    // 高校生レベル: 平易化ルールをフル適用
                    rulesToLow.forEach(r => {
                        text = text.replace(r.pattern, r.replacement);
                    });
                    
                    // カジュアル補正
                    if (formalness < 50) {
                        text = text.replace(/です。/g, "だよ。").replace(/ます。/g, "るよ。");
                    }
                } else if (intelligence <= 60) {
                    // 大学生レベル: 半分の確率でルール適用（標準化）
                    rulesToLow.slice(0, Math.floor(rulesToLow.length / 2)).forEach(r => {
                        text = text.replace(r.pattern, r.replacement);
                    });
                } else if (intelligence <= 85) {
                    // 大学院生レベル: 難解化ルールを適用
                    rulesToHigh.slice(0, Math.floor(rulesToHigh.length / 2)).forEach(r => {
                        text = text.replace(r.pattern, r.replacement);
                    });
                } else {
                    // 研究者レベル: 難解化ルールをフル適用
                    rulesToHigh.forEach(r => {
                        text = text.replace(r.pattern, r.replacement);
                    });
                    
                    // アカデミック用語の更なる強調
                    text = text.replace(/つまり/g, "すなわち")
                               .replace(/しかし/g, "しかしながら")
                               .replace(/思う/g, "考察する")
                               .replace(/分かった/g, "判明した");
                }

                // 2. トーンの方向性に応じた追加補正 (モック)
                if (tone === 'academic') {
                    text = text.replace(/思う/g, "推察される").replace(/考えます/g, "考察される");
                } else if (tone === 'business') {
                    text = text.replace(/したがって/g, "【結論】以上の結果より、").replace(/本当に/g, "定量的に効果が");
                } else if (tone === 'easy') {
                    text = text.replace(/相互作用/g, "やり取り").replace(/変容/g, "変化");
                }

                // 3. 文末統一
                if (ending === 'da') {
                    // 「です・ます」を「だ・である」へ
                    text = text.replace(/です（。|\b)/g, "である。")
                               .replace(/でした（。|\b)/g, "であった。")
                               .replace(/ます（。|\b)/g, "る。")
                               .replace(/ました（。|\b)/g, "た。")
                               .replace(/あります（。|\b)/g, "ある。")
                               .replace(/見られました（。|\b)/g, "見られた。")
                               .replace(/認められました（。|\b)/g, "認められた。")
                               .replace(/懸念があります（。|\b)/g, "懸念がある。")
                               .replace(/残っている気がします（。|\b)/g, "残っていると言える。");
                } else if (ending === 'desu') {
                    // 「だ・である」を「です・ます」へ
                    text = text.replace(/である（。|\b)/g, "です。")
                               .replace(/であった（。|\b)/g, "でした。")
                               .replace(/であると言わざるを得ない（。|\b)/g, "だと思います。")
                               .replace(/考察される（。|\b)/g, "考察されます。")
                               .replace(/認められた（。|\b)/g, "認められました。")
                               .replace(/見られた（。|\b)/g, "見られました。")
                               .replace(/検証することにある（。|\b)/g, "検証することにあります。");
                }

                resolve(text);
            }, 600); // リアルな遅延
        });
    }

    // --- 文字Diff生成ロジック (最長共通部分系列: LCS) ---
    function diffChars(oldStr, newStr) {
        const dp = Array(oldStr.length + 1).fill().map(() => Array(newStr.length + 1).fill(0));
        
        for (let i = 1; i <= oldStr.length; i++) {
            for (let j = 1; j <= newStr.length; j++) {
                if (oldStr[i - 1] === newStr[j - 1]) {
                    dp[i][j] = dp[i - 1][j - 1] + 1;
                } else {
                    dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
                }
            }
        }
        
        const result = [];
        let i = oldStr.length;
        let j = newStr.length;
        
        while (i > 0 || j > 0) {
            if (i > 0 && j > 0 && oldStr[i - 1] === newStr[j - 1]) {
                result.unshift({ type: 'equal', value: oldStr[i - 1] });
                i--;
                j--;
            } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
                result.unshift({ type: 'insert', value: newStr[j - 1] });
                j--;
            } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
                result.unshift({ type: 'delete', value: oldStr[i - 1] });
                i--;
            }
        }
        
        // 連続する同一種類の操作を結合する
        const grouped = [];
        if (result.length === 0) return grouped;
        
        let current = { type: result[0].type, value: result[0].value };
        for (let k = 1; k < result.length; k++) {
            if (result[k].type === current.type) {
                current.value += result[k].value;
            } else {
                grouped.push(current);
                current = { type: result[k].type, value: result[k].value };
            }
        }
        grouped.push(current);
        return grouped;
    }

    function renderDiff() {
        const source = textSource.value;
        const target = textTarget.value;
        
        if (!source || !target) {
            diffViewer.innerHTML = '<p class="diff-placeholder">文章を入力して「スタイル変換を実行」すると、変更された箇所が色分けされて表示されます。</p>';
            return;
        }
        
        diffViewer.innerHTML = '<span class="value-badge" style="margin-bottom:12px; display:inline-block;">赤：削除 / 緑：追加</span><br>';
        
        // 非常に長いテキストの場合はフリーズ回避のため、文単位で大まかにDiffをとる
        if (source.length > 2000 || target.length > 2000) {
            diffViewer.innerHTML += '<span style="color:var(--text-secondary)">文章が長いため、簡易差分表示を行います。</span><br><br>' + 
                                    escapeHtml(target);
            return;
        }
        
        const diffs = diffChars(source, target);
        
        diffs.forEach(part => {
            const span = document.createElement('span');
            if (part.type === 'insert') {
                span.className = 'diff-ins';
                span.textContent = part.value;
            } else if (part.type === 'delete') {
                span.className = 'diff-del';
                span.textContent = part.value;
            } else {
                span.textContent = part.value;
            }
            diffViewer.appendChild(span);
        });
    }

    function escapeHtml(string) {
        return String(string).replace(/[&<>"']/g, function (s) {
            return {
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;'
            }[s];
        });
    }

    // --- 履歴管理 ---
    function saveToHistory(source, target, intelligence, formalness, tone, ending) {
        const item = {
            id: 'hist_' + Date.now(),
            timestamp: new Date().toISOString(),
            source,
            target,
            params: { intelligence, formalness, tone, ending }
        };
        
        state.history.unshift(item);
        
        // 履歴上限（20件）
        if (state.history.length > 20) {
            state.history.pop();
        }
        
        localStorage.setItem('reportweak_history', JSON.stringify(state.history));
        state.activeHistoryId = item.id;
        renderHistory();
    }

    function renderHistory() {
        historyList.innerHTML = '';
        
        if (state.history.length === 0) {
            historyList.innerHTML = `
                <div class="empty-state">
                    <i data-lucide="folder-open"></i>
                    <p>履歴はありません</p>
                </div>
            `;
            lucide.createIcons();
            return;
        }
        
        state.history.forEach(item => {
            const date = new Date(item.timestamp);
            const timeStr = `${date.getMonth()+1}/${date.getDate()} ${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
            
            let levelLabel = '大学生';
            if (item.params.intelligence <= 30) levelLabel = '高校生';
            else if (item.params.intelligence <= 85) levelLabel = '院生';
            else levelLabel = '教授';
            
            const div = document.createElement('div');
            div.className = `history-item ${state.activeHistoryId === item.id ? 'active' : ''}`;
            div.dataset.id = item.id;
            
            div.innerHTML = `
                <div class="history-item-header">
                    <span class="history-time">${timeStr}</span>
                    <span class="history-badge">Lv.${item.params.intelligence} (${levelLabel})</span>
                </div>
                <div class="history-preview">${escapeHtml(item.source)}</div>
                <button class="history-item-delete" title="削除">
                    <i data-lucide="trash-2" style="width:14px; height:14px;"></i>
                </button>
            `;
            
            // アイテムクリックで読込
            div.addEventListener('click', (e) => {
                if (e.target.closest('.history-item-delete')) {
                    deleteHistoryItem(item.id);
                } else {
                    loadHistoryItem(item.id);
                }
            });
            
            historyList.appendChild(div);
        });
        
        lucide.createIcons();
    }

    function loadHistoryItem(id) {
        const item = state.history.find(h => h.id === id);
        if (!item) return;
        
        state.activeHistoryId = id;
        
        // フォームに反映
        textSource.value = item.source;
        textTarget.value = item.target;
        rangeIntelligence.value = item.params.intelligence;
        rangeFormalness.value = item.params.formalness;
        selectTone.value = item.params.tone;
        selectEnding.value = item.params.ending;
        
        // UIラベルの更新
        updateIntelligenceLabel(item.params.intelligence);
        updateFormalnessLabel(item.params.formalness);
        updateSourceWordCount();
        updateTargetWordCount();
        
        // 履歴のハイライトを更新
        document.querySelectorAll('.history-item').forEach(el => {
            el.classList.toggle('active', el.dataset.id === id);
        });
        
        showToast('履歴から文章をロードしました', 'success');
        
        // Diffタブがアクティブなら再描画
        if (state.activeTab === 'diff') {
            renderDiff();
        }
    }

    function deleteHistoryItem(id) {
        state.history = state.history.filter(h => h.id !== id);
        localStorage.setItem('reportweak_history', JSON.stringify(state.history));
        
        if (state.activeHistoryId === id) {
            state.activeHistoryId = null;
        }
        
        renderHistory();
        showToast('履歴から削除しました', 'info');
    }

    function clearAllHistory() {
        if (confirm('すべての履歴を削除してよろしいですか？')) {
            state.history = [];
            state.activeHistoryId = null;
            localStorage.removeItem('reportweak_history');
            renderHistory();
            showToast('すべての履歴をクリアしました', 'success');
        }
    }

    // --- 実行 ---
    init();
});

/* Generator view: models, modules, generation, preview editing, deploy. */

let currentStep = 1;
let stepInterval = null;
let autoModelId = null;
let autoModelLabel = null;

/* ---------- Models ---------- */

function modelStorageKey() {
    return currentCourseId ? `easylearn_model_${currentCourseId}` : "easylearn_model_default";
}

async function fetchModels() {
    const select = document.getElementById("model-select");
    select.disabled = true;
    const wrapper = select.closest(".select-wrapper");
    if (wrapper) wrapper.classList.add("is-loading");
    try {
        const res = await fetch("/api/models");
        if (!res.ok) throw new Error("Failed to load models");
        const payload = await res.json();
        loadedModels = Array.isArray(payload) ? payload : (payload.models || []);
        autoModelId = Array.isArray(payload) ? null : (payload.auto_model_id || null);
        autoModelLabel = Array.isArray(payload) ? null : (payload.auto_model_label || null);
        populateModelSelect();
        modelsReady = Boolean(autoModelId) || loadedModels.some(m => m.available);
        select.disabled = false;
        updateGenerateEnabled();
    } catch (err) {
        console.error("Error loading models:", err);
        modelsReady = false;
        autoModelId = null;
        autoModelLabel = null;
        select.innerHTML = `<option value="">Models unavailable</option>`;
        updateGenerateEnabled();
    } finally {
        if (wrapper) wrapper.classList.remove("is-loading");
    }
}

function populateModelSelect() {
    const select = document.getElementById("model-select");
    select.innerHTML = "";

    const autoOpt = document.createElement("option");
    autoOpt.value = "";
    autoOpt.textContent = autoModelLabel ? `Auto (${autoModelLabel})` : "Auto";
    select.appendChild(autoOpt);

    if (!loadedModels.length) {
        return;
    }

    const storedId = sessionStorage.getItem(modelStorageKey());

    loadedModels.forEach(model => {
        const opt = document.createElement("option");
        opt.value = model.id;
        opt.textContent = model.label;
        if (!model.available) {
            opt.disabled = true;
            opt.title = "Not configured on server (missing API key)";
        }
        select.appendChild(opt);
    });

    if (storedId && loadedModels.some(m => m.id === storedId && m.available)) {
        select.value = storedId;
    } else {
        select.value = "";
        sessionStorage.removeItem(modelStorageKey());
    }
    onModelChange();
}

function onModelChange() {
    const select = document.getElementById("model-select");
    if (!select) return;
    if (select.value) {
        const model = loadedModels.find(m => m.id === select.value);
        if (model?.available) {
            sessionStorage.setItem(modelStorageKey(), select.value);
        }
    } else {
        sessionStorage.removeItem(modelStorageKey());
    }
}

function selectedModelId() {
    const select = document.getElementById("model-select");
    return (select && select.value) ? select.value : null;
}

function selectedModelLabel() {
    const id = selectedModelId();
    if (!id) return autoModelLabel || "Auto";
    const model = loadedModels.find(m => m.id === id);
    return model ? model.label : "AI model";
}

function showPreviewModelLabel(label) {
    const el = document.getElementById("preview-model-label");
    if (!el) return;
    if (label) {
        el.hidden = false;
        el.textContent = `Generated with ${label}`;
    } else {
        el.hidden = true;
        el.textContent = "";
    }
}

/* ---------- Modules & materials ---------- */

async function fetchModules({ refresh = false } = {}) {
    const moduleSelect = document.getElementById("module-select");
    const refreshBtn = document.getElementById("btn-refresh-modules");
    const materialList = document.getElementById("material-list-container");

    modulesReady = false;
    moduleSelect.disabled = true;
    moduleSelect.innerHTML = `<option value="">Loading course modules...</option>`;
    if (materialList) {
        materialList.classList.add("is-loading");
        if (refresh) {
            materialList.innerHTML = `<p class="material-empty">Refreshing from Canvas…</p>`;
        }
    }
    if (refreshBtn) {
        refreshBtn.disabled = true;
        refreshBtn.classList.add("is-spinning");
    }
    updateGenerateEnabled();

    try {
        const url = refresh ? "/api/modules?refresh=1" : "/api/modules";
        const res = await fetch(url);
        if (res.status === 401) { window.location.reload(); return; }
        if (!res.ok) throw new Error("Failed to fetch course modules");
        loadedModules = await res.json();
        moduleSelect.innerHTML = "";
        if (loadedModules.length === 0) {
            moduleSelect.innerHTML = `<option value="">No modules with PDF/PPTX materials</option>`;
            document.getElementById("material-list-container").innerHTML =
                `<p class="material-empty">No modules contain supported materials (PDF or PPTX).</p>`;
            modulesReady = true;
            moduleSelect.disabled = false;
            updateGenerateEnabled();
            return;
        }
        loadedModules.forEach(mod => {
            const opt = document.createElement("option");
            opt.value = mod.id;
            opt.innerText = mod.name;
            moduleSelect.appendChild(opt);
        });
        onModuleChange();
        modulesReady = true;
        moduleSelect.disabled = false;
        updateGenerateEnabled();
        if (typeof setSourceStatus === "function" && refresh) {
            setSourceStatus("Modules refreshed from Canvas", "ok");
            window.setTimeout(() => setSourceStatus(""), 1500);
        }
    } catch (err) {
        console.error("Error fetching modules:", err);
        modulesReady = false;
        moduleSelect.innerHTML = `<option value="">Error loading course modules</option>`;
        if (refresh) {
            alert(err.message || "Could not refresh modules from Canvas.");
            if (typeof setSourceStatus === "function") {
                setSourceStatus("Could not refresh modules", "error");
            }
        }
        updateGenerateEnabled();
    } finally {
        if (materialList) materialList.classList.remove("is-loading");
        if (refreshBtn) {
            refreshBtn.disabled = false;
            refreshBtn.classList.remove("is-spinning");
        }
        const wrapper = moduleSelect.closest(".select-wrapper");
        if (wrapper && modulesReady) wrapper.classList.remove("is-loading");
    }
}

function refreshModules() {
    return fetchModules({ refresh: true });
}

function onModuleChange() {
    const moduleSelect = document.getElementById("module-select");
    const selectedId = moduleSelect.value;
    if (!selectedId) return;

    const selectedMod = loadedModules.find(m => String(m.id) === String(selectedId));
    const container = document.getElementById("material-list-container");
    container.innerHTML = "";

    if (!selectedMod || !selectedMod.items || selectedMod.items.length === 0) {
        container.innerHTML = `<p class="material-empty">No file attachments in this module.</p>`;
        return;
    }

    selectedMod.items.forEach(item => {
        const div = document.createElement("div");
        div.className = "material-item";
        div.innerHTML = `
            <input type="checkbox" id="mat-${escapeAttr(item.id)}" value="${escapeAttr(item.id)}" checked>
            <label class="material-name" for="mat-${escapeAttr(item.id)}" style="margin: 0; text-transform: none; font-weight: normal; cursor: pointer; flex: 1;">
                ${escapeHtml(item.title)}
            </label>
            <span class="material-meta">${escapeHtml(item.size)}</span>
        `;
        container.appendChild(div);
    });

    const selectedText = moduleSelect.options[moduleSelect.selectedIndex].text;
    const prefix = selectedText.split(":")[0];
    document.getElementById("quiz-title").value = `${prefix} Quiz`;
}

/* ---------- Question type rows + layout summary ---------- */

function toggleQtype(key) {
    const body = document.getElementById(`qtype-body-${key}`);
    const chevron = document.getElementById(`qtype-chevron-${key}`);
    const toggle = chevron ? chevron.closest(".qtype-toggle") : null;
    if (!body) return;
    const isHidden = body.hidden;
    body.hidden = !isHidden;
    if (toggle) toggle.setAttribute("aria-expanded", String(isHidden));
}

function updateLayoutSummary() {
    const mc = readCount("count-mc");
    const tf = readCount("count-tf");
    const matching = readCount("count-matching");
    const totalQs = mc + tf + matching;
    const totalPoints =
        mc * readPoints("points-mc") +
        tf * readPoints("points-tf") +
        matching * readPoints("points-matching");
    const qLabel = totalQs === 1 ? "question" : "questions";
    const pLabel = totalPoints === 1 ? "point" : "points";
    const el = document.getElementById("layout-summary-text");
    if (el) el.innerHTML = `${totalQs} ${qLabel} &bull; ${totalPoints} ${pLabel} total`;
}

/** Product always uses AI feedback + Auto model; no professor toggles. */
function syncFeedbackToggles(opts = {}) {
    const shouldRender = opts.render !== false;
    const staticEl = document.getElementById("include-answer-feedback");
    const agenticEl = document.getElementById("include-agentic-feedback");
    if (staticEl) staticEl.checked = false;
    if (agenticEl) agenticEl.checked = true;
    if (shouldRender && currentActiveQuiz) {
        currentActiveQuiz.includes_agentic_feedback = true;
        currentActiveQuiz.includes_answer_feedback = false;
        if (typeof renderQuizUI === "function") {
            renderQuizUI();
        }
    }
}

/* ---------- Generation progress animation ---------- */

function animateSteps() {
    currentStep = 1;
    const overrideId = selectedModelId();
    const titleEl = document.getElementById("gen-loader-title");
    if (overrideId) {
        titleEl.innerText = `Generating Quiz via ${selectedModelLabel()}...`;
    } else {
        titleEl.innerText = "Generating Quiz...";
    }
    const modelLabel = selectedModelLabel();
    const updateStepUI = () => {
        for (let i = 1; i <= 4; i++) {
            const el = document.getElementById(`step-${i}`);
            if (i < currentStep) {
                el.className = "step-item completed";
                if (i === 1) el.innerHTML = `<i class="fa-solid fa-circle-check"></i> Extracted course materials.`;
                if (i === 2) el.innerHTML = `<i class="fa-solid fa-circle-check"></i> Checked context and parameters.`;
                if (i === 3) el.innerHTML = `<i class="fa-solid fa-circle-check"></i> JSON generated & validated.`;
                if (i === 4) el.innerHTML = `<i class="fa-solid fa-circle-check"></i> Ready.`;
            } else if (i === currentStep) {
                el.className = "step-item active";
                if (i === 1) el.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Downloading and extracting materials...`;
                if (i === 2) el.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Analyzing conceptual topics...`;
                if (i === 3) el.innerHTML = overrideId
                    ? `<i class="fa-solid fa-spinner fa-spin"></i> Generating structured JSON via ${escapeHtml(modelLabel)}...`
                    : `<i class="fa-solid fa-spinner fa-spin"></i> Generating structured JSON...`;
                if (i === 4) el.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Formatting preview controls...`;
            } else {
                el.className = "step-item";
                if (i === 1) el.innerHTML = `<i class="fa-regular fa-circle"></i> Extracting slide & note text...`;
                if (i === 2) el.innerHTML = `<i class="fa-regular fa-circle"></i> Analyzing conceptual material...`;
                if (i === 3) el.innerHTML = `<i class="fa-regular fa-circle"></i> Generating structured JSON...`;
                if (i === 4) el.innerHTML = `<i class="fa-regular fa-circle"></i> Rendering question controls...`;
            }
        }
    };

    updateStepUI();
    stepInterval = setInterval(() => {
        if (currentStep < 3) {
            currentStep++;
            updateStepUI();
        }
    }, 1800);
}

function completeAllSteps() {
    clearInterval(stepInterval);
    for (let i = 1; i <= 4; i++) {
        const el = document.getElementById(`step-${i}`);
        el.className = "step-item completed";
        if (i === 1) el.innerHTML = `<i class="fa-solid fa-circle-check"></i> Downloaded & extracted course materials.`;
        if (i === 2) el.innerHTML = `<i class="fa-solid fa-circle-check"></i> Analysis complete.`;
        if (i === 3) el.innerHTML = `<i class="fa-solid fa-circle-check"></i> Structured JSON generated & validated.`;
        if (i === 4) el.innerHTML = `<i class="fa-solid fa-circle-check"></i> Question controls rendered.`;
    }
}

/* ---------- Generate ---------- */

async function triggerQuizGeneration() {
    if (!modulesReady || !modelsReady) {
        alert("Still loading course data. Please wait a moment.");
        return;
    }

    const moduleSelect = document.getElementById("module-select");
    const moduleId = moduleSelect.value;
    if (!moduleId) {
        alert("Please select a target course module.");
        return;
    }

    const checkedBoxes = document.querySelectorAll("#material-list-container input[type='checkbox']:checked");
    const fileIds = Array.from(checkedBoxes).map(cb => parseInt(cb.value));

    if (fileIds.length === 0) {
        alert("Please select at least one material file.");
        return;
    }

    const quizTitle = document.getElementById("quiz-title").value.trim();
    if (!quizTitle) {
        alert("Please specify a quiz title.");
        return;
    }

    const numMc = readCount("count-mc");
    const numTf = readCount("count-tf");
    const numMatching = readCount("count-matching");
    const pointsMc = readPoints("points-mc");
    const pointsTf = readPoints("points-tf");
    const pointsMatching = readPoints("points-matching");
    const mcOptions = Math.max(2, parseInt(document.getElementById("mc-options").value) || 4);
    const matchingPairs = Math.max(3, parseInt(document.getElementById("matching-pairs").value) || 4);

    if (numMc + numTf + numMatching === 0) {
        alert("Please request a count of at least 1 question of any type.");
        return;
    }

    if (!autoModelId && !loadedModels.some(m => m.available)) {
        alert("No AI provider is configured on the server.");
        return;
    }

    const generateBtn = document.getElementById("btn-generate");
    if (generateBtn) {
        generateBtn.dataset.generating = "1";
        generateBtn.disabled = true;
    }

    document.getElementById("preview-placeholder").style.display = "none";
    document.getElementById("quiz-preview-content").style.display = "none";
    document.getElementById("gen-loader").style.display = "flex";
    document.getElementById("success-banner").style.display = "none";

    animateSteps();

    try {
        // Always AI feedback; model always Auto (no model_id override).
        const body = {
            module_id: moduleId,
            quiz_title: quizTitle,
            file_ids: fileIds,
            question_types: {
                multiple_choice: numMc,
                true_false: numTf,
                matching: numMatching
            },
            points_per_type: {
                multiple_choice: pointsMc,
                true_false: pointsTf,
                matching: pointsMatching
            },
            mc_options: mcOptions,
            matching_pairs: matchingPairs,
            include_answer_feedback: false,
            include_agentic_feedback: true,
        };

        const res = await fetch("/api/generate-quiz", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });

        if (!res.ok) {
            let data = {};
            try { data = await res.json(); } catch (_) {}
            throw new Error(parseApiDetail(data) || "Could not generate quiz. Please try again.");
        }

        currentActiveQuiz = await res.json();
        currentActiveQuiz.includes_answer_feedback = false;
        currentActiveQuiz.includes_agentic_feedback = true;
        if (Array.isArray(currentActiveQuiz.questions)) {
            currentActiveQuiz.questions.forEach(q => { q.feedback_enabled = true; });
        }

        completeAllSteps();

        setTimeout(() => {
            document.getElementById("gen-loader").style.display = "none";
            renderQuizUI();
        }, 850);

    } catch (err) {
        clearInterval(stepInterval);
        console.error("Error generating quiz:", err);
        alert(err.message || "Could not generate quiz. Please try again.");
        document.getElementById("gen-loader").style.display = "none";
        document.getElementById("preview-placeholder").style.display = "flex";
    } finally {
        if (generateBtn) {
            generateBtn.dataset.generating = "0";
            updateGenerateEnabled();
        }
    }
}

function regenerateQuestions() {
    triggerQuizGeneration();
}

/* ---------- Preview rendering ---------- */

/** Match deploy order: content item, then optional confidence + explanation metas. */
function canvasTakeLayout(questions, agenticOn) {
    const items = [];
    let canvasPos = 0;
    let feedbackCount = 0;
    (questions || []).forEach((q, qIndex) => {
        canvasPos += 1;
        const contentCanvasNumber = canvasPos;
        const fbEnabled = agenticOn && q.feedback_enabled !== false;
        items.push({
            kind: "content",
            qIndex,
            canvasNumber: contentCanvasNumber,
            feedbackEnabled: fbEnabled,
        });
        if (fbEnabled) {
            canvasPos += 1;
            items.push({
                kind: "confidence",
                qIndex,
                canvasNumber: canvasPos,
                parentCanvasNumber: contentCanvasNumber,
            });
            canvasPos += 1;
            items.push({
                kind: "explanation",
                qIndex,
                canvasNumber: canvasPos,
                parentCanvasNumber: contentCanvasNumber,
            });
            feedbackCount += 2;
        }
    });
    return {
        items,
        contentCount: (questions || []).length,
        feedbackCount,
        canvasItemCount: canvasPos,
    };
}

function appendFeedbackFollowupCard(container, item, parentQuestion) {
    const parentLabel = `Question ${item.parentCanvasNumber}`;
    const isConfidence = item.kind === "confidence";
    const card = document.createElement("div");
    card.className = "question-card feedback-followup-card";
    card.innerHTML = `
        <div class="question-meta">
            <div style="display: flex; align-items: center; gap: 0.5rem;">
                <span class="canvas-q-label">Canvas Q${item.canvasNumber}</span>
                <span class="type-badge badge-feedback">${isConfidence ? "Confidence" : "Explanation"}</span>
            </div>
            <span style="color: var(--text-muted);">0 pts · not graded</span>
        </div>
        <div class="feedback-followup-banner">Question ${item.parentCanvasNumber} Feedback (Not Graded)</div>
        <div class="question-title feedback-followup-text">
            ${isConfidence
                ? `How confident were you in your answer to <strong>${parentLabel}</strong>?`
                : `Briefly explain <strong>why</strong> you chose your answer for <strong>${parentLabel}</strong>.`}
        </div>
    `;
    container.appendChild(card);
}

function updatePreviewMetaTag(agenticOn) {
    const totalPoints = currentActiveQuiz.questions.reduce(
        (sum, q) => sum + parseInt(q.points_possible || 1, 10),
        0,
    );
    const layout = canvasTakeLayout(currentActiveQuiz.questions, agenticOn);
    const metaEl = document.getElementById("preview-meta-tag");
    if (agenticOn && layout.feedbackCount > 0) {
        metaEl.innerText =
            `${layout.canvasItemCount} Canvas items ` +
            `(${layout.contentCount} content + ${layout.feedbackCount} feedback) • ${totalPoints} Points`;
    } else {
        metaEl.innerText = `${layout.contentCount} Questions • ${totalPoints} Points total`;
    }
    const deployHint = document.getElementById("deploy-canvas-count");
    if (deployHint) {
        if (agenticOn && layout.feedbackCount > 0) {
            deployHint.hidden = false;
            deployHint.textContent =
                `${layout.canvasItemCount} Canvas items ` +
                `(${layout.contentCount} content + ${layout.feedbackCount} feedback)`;
        } else {
            deployHint.hidden = true;
            deployHint.textContent = "";
        }
    }
}

function renderQuizUI() {
    if (!currentActiveQuiz) return;

    syncFeedbackToggles({ render: false });
    // Always AI feedback for this product.
    const agenticOn = true;
    currentActiveQuiz.includes_agentic_feedback = true;

    document.getElementById("preview-quiz-title").innerText = currentActiveQuiz.quiz_title;
    updatePreviewMetaTag(agenticOn);
    showPreviewModelLabel(currentActiveQuiz.model_label || null);

    const container = document.getElementById("questions-list-container");
    container.innerHTML = "";

    const layout = canvasTakeLayout(currentActiveQuiz.questions, agenticOn);

    layout.items.forEach((item) => {
        if (item.kind !== "content") {
            appendFeedbackFollowupCard(
                container,
                item,
                currentActiveQuiz.questions[item.qIndex],
            );
            return;
        }

        const qIndex = item.qIndex;
        const q = currentActiveQuiz.questions[qIndex];
        const card = document.createElement("div");
        card.className = "question-card";
        card.id = `q-card-${qIndex}`;

        let typeBadgeClass = "badge-mc";
        let typeLabel = "Multiple Choice";
        if (q.question_type === "true_false_question") {
            typeLabel = "True/False";
            typeBadgeClass = "badge-tf";
        } else if (q.question_type === "matching_question") {
            typeLabel = "Matching";
            typeBadgeClass = "badge-matching";
        }

        let answersHTML = "";
        if (q.question_type === "matching_question") {
            q.answers.forEach(ans => {
                answersHTML += `
                    <div class="answer-option correct">
                        <i class="fa-solid fa-left-right" style="color: var(--accent-blue);"></i>
                        <span style="font-weight: 500; margin-right: 0.5rem;">${escapeHtml(ans.answer_text)}</span>
                        <i class="fa-solid fa-arrow-right-long" style="color: var(--text-muted); margin: 0 0.5rem;"></i>
                        <span style="color: var(--success); font-weight: 600;">${escapeHtml(ans.answer_match_right)}</span>
                    </div>
                `;
            });
        } else {
            q.answers.forEach(ans => {
                const isCorrect = ans.answer_weight === 100;
                answersHTML += `
                    <div class="answer-option ${isCorrect ? 'correct' : 'incorrect'}">
                        <i class="${isCorrect ? 'fa-solid fa-circle-check' : 'fa-regular fa-circle'}"></i>
                        <span style="flex: 1;">${escapeHtml(ans.answer_text)}</span>
                        ${ans.answer_comments ? `<span style="font-size: 0.75rem; color: var(--accent-blue); font-style: italic;">(${escapeHtml(ans.answer_comments)})</span>` : ''}
                    </div>
                `;
            });
        }

        const points = q.points_possible || 1;
        const ptLabel = points === 1 ? "pt" : "pts";

        const numberLabel = `<span class="canvas-q-label">Q${item.canvasNumber}</span>`;

        card.innerHTML = `
            <div class="question-meta">
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                    ${numberLabel}
                    <span class="type-badge ${typeBadgeClass}">${typeLabel}</span>
                </div>
                <div style="display: flex; align-items: center; gap: 0.75rem;">
                    <span style="color: var(--text-muted);">${points} ${ptLabel}</span>
                </div>
            </div>
            <div class="question-title" id="q-text-${qIndex}">${q.question_text}</div>

            <div class="answers-list" id="q-answers-list-${qIndex}">
                ${answersHTML}
            </div>

            <div class="q-actions">
                <button type="button" class="btn btn-secondary btn-sm" onclick="toggleEditForm(${qIndex})">Edit</button>
            </div>

            <div class="editor-form" id="editor-form-${qIndex}" style="display: none;">
                <div class="form-group">
                    <label>Question text</label>
                    <textarea id="edit-qtext-${qIndex}" rows="2">${escapeHtml(q.question_text)}</textarea>
                </div>
                <div class="form-group">
                    <label>Answers</label>
                    <div style="display: flex; flex-direction: column; gap: 0.5rem;" id="edit-answers-container-${qIndex}">
                        ${q.question_type === 'matching_question' ?
                            q.answers.map((ans, aIndex) => `
                                <div style="display: flex; gap: 0.5rem; align-items: center;">
                                    <span style="font-size: 0.85rem; color: var(--text-muted); width: 20px;">${aIndex + 1}:</span>
                                    <input type="text" style="padding: 0.5rem; flex: 1;" id="edit-anstext-${qIndex}-${aIndex}" value="${escapeAttr(ans.answer_text)}" placeholder="Left">
                                    <span style="color: var(--text-muted);">→</span>
                                    <input type="text" style="padding: 0.5rem; flex: 1;" id="edit-ansmatch-${qIndex}-${aIndex}" value="${escapeAttr(ans.answer_match_right)}" placeholder="Right">
                                </div>
                            `).join('')
                        :
                            q.answers.map((ans, aIndex) => `
                                <div style="display: flex; gap: 0.5rem; align-items: center;">
                                    <input type="radio" name="edit-correct-${qIndex}" value="${aIndex}" ${ans.answer_weight === 100 ? 'checked' : ''}>
                                    <input type="text" style="padding: 0.5rem; flex: 1;" id="edit-anstext-${qIndex}-${aIndex}" value="${escapeAttr(ans.answer_text)}">
                                </div>
                            `).join('')
                        }
                    </div>
                </div>
                <div style="display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 1rem;">
                    <button type="button" class="btn btn-secondary btn-sm" onclick="toggleEditForm(${qIndex})">Cancel</button>
                    <button type="button" class="btn btn-primary btn-sm" onclick="saveQuestionEdit(${qIndex})">Save</button>
                </div>
            </div>
        `;

        container.appendChild(card);
    });

    document.getElementById("quiz-preview-content").style.display = "flex";
}

function toggleQuestionFeedback(qIndex, enabled) {
    if (!currentActiveQuiz || !currentActiveQuiz.questions[qIndex]) return;
    currentActiveQuiz.questions[qIndex].feedback_enabled = enabled;
    renderQuizUI();
}

function toggleEditForm(qIndex) {
    const form = document.getElementById(`editor-form-${qIndex}`);
    const isVisible = form.style.display === "block";
    form.style.display = isVisible ? "none" : "block";
}

function saveQuestionEdit(qIndex) {
    const qText = document.getElementById(`edit-qtext-${qIndex}`).value;
    const q = currentActiveQuiz.questions[qIndex];
    q.question_text = qText;

    // Static correct/incorrect comments are no longer edited in the UI.
    q.correct_comments = "";
    q.incorrect_comments = "";

    if (q.question_type === 'matching_question') {
        q.answers.forEach((ans, aIndex) => {
            const ansText = document.getElementById(`edit-anstext-${qIndex}-${aIndex}`).value;
            const matchText = document.getElementById(`edit-ansmatch-${qIndex}-${aIndex}`).value;
            ans.answer_text = ansText;
            ans.answer_match_left = ansText;
            ans.answer_match_right = matchText;
        });
    } else {
        const checkedRadio = document.querySelector(`input[name="edit-correct-${qIndex}"]:checked`);
        const correctRadioVal = checkedRadio ? parseInt(checkedRadio.value) : 0;

        q.answers.forEach((ans, aIndex) => {
            const ansText = document.getElementById(`edit-anstext-${qIndex}-${aIndex}`).value;
            ans.answer_text = ansText;
            ans.answer_weight = (correctRadioVal === aIndex) ? 100 : 0;
        });
    }

    renderQuizUI();
}

function resetPreview() {
    currentActiveQuiz = null;
    document.getElementById("quiz-preview-content").style.display = "none";
    document.getElementById("preview-placeholder").style.display = "flex";
    document.getElementById("success-banner").style.display = "none";
}

/* ---------- Deploy ---------- */

async function deployQuiz() {
    if (!currentActiveQuiz) return;

    const moduleSelect = document.getElementById("module-select");
    const moduleId = moduleSelect.value;
    if (!moduleId) {
        alert("Please select a module first.");
        return;
    }

    const deployBtn = document.querySelector("button[onclick='deployQuiz()']");
    const originalHTML = deployBtn ? deployBtn.innerHTML : "Deploy to Canvas";
    if (deployBtn) {
        deployBtn.disabled = true;
        deployBtn.textContent = "Deploying…";
    }

    try {
        if (currentActiveQuiz.questions) {
            currentActiveQuiz.questions.forEach(q => { q.feedback_enabled = true; });
        }
        currentActiveQuiz.includes_agentic_feedback = true;
        const res = await fetch("/api/deploy-quiz", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                module_id: moduleId,
                quiz: currentActiveQuiz,
                include_agentic_feedback: true
            })
        });

        if (!res.ok) {
            const data = await res.json();
            throw new Error(parseApiDetail(data) || "Server error during deployment");
        }

        const data = await res.json();
        const draftId = currentActiveQuiz && currentActiveQuiz.id
            ? String(currentActiveQuiz.id)
            : "";

        const banner = document.getElementById("success-banner");
        banner.style.display = "flex";
        let actions = `
            <a href="${escapeAttr(data.quiz_url)}" target="_blank" class="btn btn-secondary btn-sm btn-link">View in Canvas</a>`;
        if (draftId) {
            actions = `
            <a href="#" class="action-link" data-quiz-id="${escapeAttr(draftId)}"
                data-quiz-title="${escapeAttr((currentActiveQuiz && currentActiveQuiz.quiz_title) || "Quiz")}"
                onclick="openQuizModal(this.dataset.quizId, this.dataset.quizTitle); return false;">Results</a>
            ` + actions;
        }
        banner.innerHTML = `
            <div>
                <strong>Sent to Canvas.</strong> Publish when ready. After students submit, open Quizzes and click Generate feedback.
                <div class="banner-actions">${actions}</div>
            </div>
        `;

        document.getElementById("success-banner").scrollIntoView({ behavior: "smooth" });

    } catch (err) {
        console.error("Error deploying quiz:", err);
        alert(`Could not deploy quiz: ${err.message}`);
    } finally {
        if (deployBtn) {
            deployBtn.disabled = false;
            deployBtn.innerHTML = originalHTML;
        }
    }
}

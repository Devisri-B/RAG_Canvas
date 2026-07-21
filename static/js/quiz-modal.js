/* Results panel: hardest questions + pending comments. No tabs, no Re-process. */

let modalQuizId = null;

function openQuizModal(quizId, title) {
    modalQuizId = quizId;
    document.getElementById("quiz-modal-title").textContent = title
        ? `Results · ${title}`
        : "Results";
    document.getElementById("quiz-modal-overlay").classList.add("open");
    document.body.style.overflow = "hidden";
    loadQuizResults(quizId);
}

function closeQuizModal() {
    const overlay = document.getElementById("quiz-modal-overlay");
    if (!overlay || !overlay.classList.contains("open")) return;
    overlay.classList.remove("open");
    document.body.style.overflow = "";
    modalQuizId = null;
}

function onModalOverlayClick(event) {
    if (event.target === document.getElementById("quiz-modal-overlay")) {
        closeQuizModal();
    }
}

function isMetaQuestionName(name) {
    const n = String(name || "");
    return n.startsWith("[Agentic]") || n.startsWith("[Feedback]");
}

async function loadQuizResults(quizId) {
    const el = document.getElementById("modal-results");
    if (!el) return;
    el.innerHTML = `<p class="text-muted-inline">Loading…</p>`;

    try {
        const [statsRes, quizRes] = await Promise.all([
            fetch(`/api/quizzes/${quizId}/stats`),
            fetch(`/api/quizzes/${quizId}`)
        ]);
        const stats = statsRes.ok ? await statsRes.json() : null;
        const draft = quizRes.ok ? await quizRes.json() : null;

        if (modalQuizId !== quizId) return;

        renderResults(el, quizId, stats, draft);
    } catch (err) {
        console.error("Error loading results:", err);
        el.innerHTML = `<p class="error-cell">Could not load results.</p>`;
    }
}

function renderResults(el, quizId, stats, draft) {
    const processed = (draft && draft.agentic_feedback_processed) || {};
    const done = Object.keys(processed).length;
    const subs = stats && stats.available ? (stats.submission_count || 0) : null;
    const pending = subs != null ? Math.max(0, subs - done) : null;

    let summaryLine = "";
    if (subs == null) {
        summaryLine = "No student results yet. Results appear after students take the quiz in Canvas.";
    } else if (subs === 0) {
        summaryLine = "No submissions yet.";
    } else if (pending > 0) {
        summaryLine = `${subs} submitted · <strong>${pending} need comments</strong>`;
    } else {
        summaryLine = `${subs} submitted · all comments written`;
    }

    let actions = "";
    if (pending == null || pending > 0) {
        actions = `<button type="button" class="btn btn-primary btn-sm" data-quiz-id="${escapeAttr(quizId)}" onclick="processAgenticFeedback(this.dataset.quizId)">Generate feedback</button>`;
    }

    let html = `
        <div class="results-summary">
            <p class="results-summary-line">${summaryLine}</p>
            <div class="results-actions">${actions}</div>
            <div id="agentic-process-status"></div>
        </div>`;

    if (stats && stats.available) {
        const contentQs = (stats.questions || []).filter(q => !isMetaQuestionName(q.question_name));
        const ranked = contentQs.map((q, idx) => {
            const total = q.responses || 0;
            const pct = total ? Math.round((q.correct_count / total) * 100) : 0;
            return { q, idx, total, pct, severity: total ? (100 - pct) * Math.log10(total + 1) : 0 };
        }).sort((a, b) => b.severity - a.severity || a.pct - b.pct);

        if (ranked.length) {
            html += `<h5 class="modal-section-title">Hardest questions</h5>`;
            ranked.forEach(({ q, idx, total, pct }) => {
                const name = q.question_name || `Question ${idx + 1}`;
                const barClass = pct >= 70 ? "good" : (pct >= 40 ? "mid" : "poor");
                html += `
                    <div class="qstat-row">
                        <span class="qstat-name" title="${escapeAttr(name)}">${escapeHtml(name)}</span>
                        <div class="qstat-track">
                            <div class="qstat-fill ${barClass}" style="width:${pct}%"></div>
                        </div>
                        <span class="qstat-pct">${pct}% <span class="qstat-n">(${total})</span></span>
                    </div>`;
            });
        }
    }

    el.innerHTML = html;
}

/**
 * Write comments for submissions that do not have them yet (late work included).
 * No "re-process all" — force is always false.
 */
async function processAgenticFeedback(quizId) {
    const statusEl =
        document.getElementById("agentic-process-status") ||
        document.getElementById("library-feedback-status");

    if (statusEl) {
        statusEl.hidden = false;
        statusEl.innerHTML = `<p class="text-muted-inline">Generating feedback… This can take a few minutes for a full class. Already-done students are skipped.</p>`;
    }

    try {
        const res = await fetch(`/api/quizzes/${quizId}/agentic-feedback/process`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ force: false })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(parseApiDetail(data) || "Processing failed");

        let html = `<p class="agentic-success"><strong>Done.</strong> `;
        html += `Wrote comments for ${escapeHtml(data.processed)} submission(s)`;
        if (data.skipped) html += `; skipped ${escapeHtml(data.skipped)} already done`;
        if (data.remaining) html += `; ${escapeHtml(data.remaining)} still need comments — run again later for late work`;
        else if (data.remaining === 0) html += `; all caught up`;
        html += `.</p>`;
        if (data.errors && data.errors.length) {
            const messages = data.errors.slice(0, 5)
                .map(e => `Submission ${escapeHtml(e.submission_id ?? "?")}: ${escapeHtml(e.error ?? "unknown")}`)
                .join("<br>");
            html += `<p class="error-cell" style="text-align:left;">${escapeHtml(String(data.errors.length))} error(s):<br>${messages}</p>`;
        }
        if (statusEl) statusEl.innerHTML = html;

        // Refresh list and open results if modal is showing this quiz
        if (typeof fetchQuizzesOverview === "function") {
            await fetchQuizzesOverview();
        }
        if (modalQuizId === quizId) {
            await loadQuizResults(quizId);
            const newStatus = document.getElementById("agentic-process-status");
            if (newStatus && statusEl) newStatus.innerHTML = html;
        }
    } catch (err) {
        if (statusEl) {
            statusEl.hidden = false;
            statusEl.innerHTML = `<p class="error-cell">${escapeHtml(err.message)}</p>`;
        } else {
            alert(err.message);
        }
    }
}

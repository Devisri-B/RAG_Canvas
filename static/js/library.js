/* Quizzes list: state-driven actions, Generate feedback, Results. */

async function fetchQuizzesOverview() {
    const tbody = document.getElementById("quizzes-table-body");
    tbody.innerHTML = `<tr><td colspan="5" class="empty-cell">Loading...</td></tr>`;
    try {
        const res = await fetch("/api/quizzes/overview");
        if (!res.ok) throw new Error("Failed to load quizzes");
        const quizzes = await res.json();
        if (quizzes.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" class="empty-cell">No quizzes yet. Create one from the Create page.</td></tr>`;
            return;
        }
        tbody.innerHTML = "";
        quizzes.forEach(q => {
            const tr = document.createElement("tr");
            const status = q.status || (q.deployed ? "deployed" : "draft");
            const canvasUrl = q.quiz_url || null;
            const hasCanvas = Boolean(q.canvas_quiz_id || canvasUrl);
            const title = q.title || "Quiz";
            const id = q.id;

            const commentsHtml = commentsStatusHtml(q, status);
            const actionsHtml = rowActionsHtml(q, status, hasCanvas, canvasUrl, id, title);

            tr.innerHTML = `
                <td>
                    <div class="quiz-title-cell">${escapeHtml(title)}</div>
                </td>
                <td>${escapeHtml(q.module_name || "—")}</td>
                <td><span class="status-badge status-${escapeAttr(status)}">${escapeHtml(status)}</span></td>
                <td class="comments-cell">${commentsHtml}</td>
                <td class="action-cell">${actionsHtml}</td>`;
            tbody.appendChild(tr);
        });
    } catch (err) {
        console.error("Error loading quizzes:", err);
        tbody.innerHTML = `<tr><td colspan="5" class="error-cell">Error loading quizzes</td></tr>`;
    }
}

function commentsStatusHtml(q, status) {
    if (status === "draft") return "—";
    const pending = q.feedback_pending;
    const done = q.feedback_done;
    const subs = q.submission_count;
    if (subs == null && (done == null || done === 0)) {
        return `<span class="text-muted-inline">—</span>`;
    }
    if (subs === 0) {
        return `<span class="text-muted-inline">No submissions yet</span>`;
    }
    if (pending != null && pending > 0) {
        return `<span class="comments-pending">${escapeHtml(pending)} need comments</span>`;
    }
    if (subs != null && pending === 0) {
        return `<span class="comments-ok">All written</span>`;
    }
    if (done > 0) {
        return `<span class="comments-ok">${escapeHtml(done)} written</span>`;
    }
    return `<span class="text-muted-inline">—</span>`;
}

/**
 * One primary button + text links. Label stays "Generate feedback".
 */
function rowActionsHtml(q, status, hasCanvas, canvasUrl, id, title) {
    const links = [];
    let primary = "";

    if (status === "draft") {
        primary = `<button type="button" class="btn btn-primary btn-sm" onclick="loadDraft('${escapeAttr(id)}')">Edit</button>`;
        return primary;
    }

    const pending = q.feedback_pending;
    const needsComments = pending == null || pending > 0; // unknown → still offer generate

    if (status === "deployed") {
        primary = `<button type="button" class="btn btn-primary btn-sm" onclick="publishQuiz('${escapeAttr(id)}')">Publish</button>`;
        if (hasCanvas && canvasUrl) {
            links.push(`<a href="${escapeAttr(canvasUrl)}" target="_blank" class="action-link">Canvas</a>`);
        }
    } else if (status === "published") {
        // Primary: Generate feedback when students may need comments; else Results.
        if (q.submission_count === 0) {
            primary = "";
        } else if (needsComments) {
            primary = `<button type="button" class="btn btn-primary btn-sm" data-quiz-id="${escapeAttr(id)}" onclick="processAgenticFeedback(this.dataset.quizId)">Generate feedback</button>`;
        } else {
            primary = `<button type="button" class="btn btn-primary btn-sm" data-quiz-id="${escapeAttr(id)}" data-quiz-title="${escapeAttr(title)}" onclick="openQuizModal(this.dataset.quizId, this.dataset.quizTitle)">Results</button>`;
        }
        if (!primary.includes("Results")) {
            links.push(`<a href="#" class="action-link" data-quiz-id="${escapeAttr(id)}" data-quiz-title="${escapeAttr(title)}" onclick="openQuizModal(this.dataset.quizId, this.dataset.quizTitle); return false;">Results</a>`);
        }
        if (!primary.includes("Generate feedback")) {
            links.push(`<a href="#" class="action-link" data-quiz-id="${escapeAttr(id)}" onclick="processAgenticFeedback(this.dataset.quizId); return false;">Generate feedback</a>`);
        }
        if (hasCanvas && canvasUrl) {
            links.push(`<a href="${escapeAttr(canvasUrl)}" target="_blank" class="action-link">Canvas</a>`);
        }
    } else if (hasCanvas) {
        primary = `<button type="button" class="btn btn-primary btn-sm" data-quiz-id="${escapeAttr(id)}" onclick="processAgenticFeedback(this.dataset.quizId)">Generate feedback</button>`;
        links.push(`<a href="#" class="action-link" data-quiz-id="${escapeAttr(id)}" data-quiz-title="${escapeAttr(title)}" onclick="openQuizModal(this.dataset.quizId, this.dataset.quizTitle); return false;">Results</a>`);
        if (canvasUrl) {
            links.push(`<a href="${escapeAttr(canvasUrl)}" target="_blank" class="action-link">Canvas</a>`);
        }
    }

    const linkBlock = links.length
        ? `<span class="action-links">${links.join('<span class="action-sep">·</span>')}</span>`
        : "";
    return `${primary}${linkBlock}`;
}

async function loadDraft(quizId) {
    try {
        const res = await fetch(`/api/quizzes/${quizId}`);
        if (!res.ok) throw new Error("Could not load draft");
        currentActiveQuiz = await res.json();
        switchView("generator");
        renderQuizUI();
    } catch (err) {
        alert(err.message);
    }
}

async function publishQuiz(quizId) {
    try {
        const res = await fetch(`/api/quizzes/${quizId}/publish`, { method: "POST" });
        if (!res.ok) {
            const data = await res.json();
            throw new Error(parseApiDetail(data) || "Publish failed");
        }
        await fetchQuizzesOverview();
    } catch (err) {
        alert(`Publish failed: ${err.message}`);
    }
}

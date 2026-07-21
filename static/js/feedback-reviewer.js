/* Feedback Review Workspace: inspect, edit, regenerate, and push student feedback comments to Canvas. */

let currentFeedbackData = null;

async function loadFeedbackWorkspace(quizId) {
    switchView("feedback-review");
    const container = document.getElementById("feedback-submissions-container");
    const statusEl = document.getElementById("feedback-review-status");
    if (statusEl) statusEl.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Fetching student submissions and generating feedback preview...`;
    if (container) container.innerHTML = `<div class="empty-cell" style="padding: 3rem;"><i class="fa-solid fa-spinner fa-spin" style="font-size: 1.5rem; color: var(--brand-primary);"></i><p style="margin-top: 0.75rem;">Analyzing student answers, confidence ratings, and explanations...</p></div>`;

    try {
        const res = await fetch(`/api/quizzes/${quizId}/agentic-feedback/preview`, {
            method: "POST",
            headers: { "Content-Type": "application/json" }
        });
        if (!res.ok) {
            const data = await res.json();
            throw new Error(parseApiDetail(data) || "Could not load feedback preview.");
        }
        currentFeedbackData = await res.json();
        renderFeedbackWorkspace(currentFeedbackData);
    } catch (err) {
        console.error("Error loading feedback preview:", err);
        if (container) {
            container.innerHTML = `<div class="glass-card" style="padding: 2rem; text-align: center; color: var(--danger);">
                <i class="fa-solid fa-circle-exclamation" style="font-size: 2rem; margin-bottom: 0.5rem;"></i>
                <h4>Could not load student submissions</h4>
                <p style="color: var(--text-muted); font-size: 0.875rem;">${escapeHtml(err.message)}</p>
                <button type="button" class="btn btn-secondary btn-sm" style="margin-top: 1rem;" onclick="switchView('quizzes')">Return to Quiz Library</button>
            </div>`;
        }
    }
}

function renderFeedbackWorkspace(data) {
    const container = document.getElementById("feedback-submissions-container");
    const titleEl = document.getElementById("feedback-quiz-title");
    const metaEl = document.getElementById("feedback-meta-summary");
    const statusEl = document.getElementById("feedback-review-status");

    if (titleEl) titleEl.textContent = data.quiz_title || "Quiz Feedback Review";
    if (metaEl) {
        metaEl.textContent = `${data.submissions ? data.submissions.length : 0} Submissions Ready • ${data.questions ? data.questions.length : 0} Questions`;
    }
    if (statusEl) {
        statusEl.innerHTML = `<span class="type-badge badge-matching"><i class="fa-solid fa-eye"></i> Review Mode</span> Review AI comments below before pushing to Canvas.`;
    }

    if (!container) return;
    container.innerHTML = "";

    if (!data.submissions || data.submissions.length === 0) {
        container.innerHTML = `<div class="glass-card" style="padding: 2.5rem; text-align: center; color: var(--text-muted);">
            <i class="fa-solid fa-user-clock" style="font-size: 2rem; margin-bottom: 0.5rem;"></i>
            <p>No completed student submissions found in Canvas yet for this quiz.</p>
            <button type="button" class="btn btn-secondary btn-sm" style="margin-top: 0.75rem;" onclick="switchView('quizzes')">Back to Quiz Library</button>
        </div>`;
        return;
    }

    data.submissions.forEach((sub, sIndex) => {
        const card = document.createElement("div");
        card.className = "glass-card";
        card.style.marginBottom = "1.25rem";

        let questionsHTML = "";
        (sub.questions || []).forEach((q, qIndex) => {
            const isCorrect = q.score > 0;
            questionsHTML += `
                <div class="feedback-question-row" style="padding: 1rem; border: 1px solid var(--border-light); border-radius: 6px; margin-top: 0.75rem; background: var(--bg-surface);">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                        <strong style="font-size: 0.9rem;">Q${qIndex + 1}: ${escapeHtml(q.question_text)}</strong>
                        <span class="type-badge ${isCorrect ? 'badge-matching' : 'badge-tf'}">${isCorrect ? 'Correct' : 'Needs Review'}</span>
                    </div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; font-size: 0.82rem; background: var(--bg-subtle); padding: 0.65rem 0.85rem; border-radius: 4px; margin-bottom: 0.75rem;">
                        <div><strong style="color: var(--text-muted);">Student Choice:</strong> ${escapeHtml(q.student_answer || "No response")}</div>
                        <div><strong style="color: var(--text-muted);">Confidence:</strong> ${escapeHtml(q.confidence || "Not reported")}</div>
                        <div style="grid-column: 1 / -1;"><strong style="color: var(--text-muted);">Explanation:</strong> <em>"${escapeHtml(q.explanation || "None provided")}"</em></div>
                    </div>
                    <div class="form-group" style="margin-bottom: 0.25rem;">
                        <label style="font-size: 0.8rem; font-weight: 600; color: var(--brand-primary);"><i class="fa-solid fa-wand-magic-sparkles"></i> AI Feedback Comment for Student:</label>
                        <textarea id="fb-comment-${sIndex}-${qIndex}" rows="3" style="width: 100%; font-size: 0.85rem; padding: 0.5rem; border-radius: 4px; border: 1px solid var(--border);">${escapeHtml(q.ai_feedback || "")}</textarea>
                    </div>
                </div>
            `;
        });

        card.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; padding-bottom: 0.75rem; border-bottom: 1px solid var(--border-light);">
                <div>
                    <h4 style="margin: 0; font-size: 1.05rem;">${escapeHtml(sub.user_name || `Student #${sub.user_id}`)}</h4>
                    <span style="font-size: 0.78rem; color: var(--text-muted);">Submission ID: ${escapeHtml(sub.submission_id)} · Score: ${sub.score !== undefined ? sub.score : "—"}</span>
                </div>
                <button type="button" class="btn btn-secondary btn-sm" onclick="loadFeedbackWorkspace('${data.quiz_id}')"><i class="fa-solid fa-arrows-rotate"></i> Regenerate</button>
            </div>
            ${questionsHTML}
        `;
        container.appendChild(card);
    });
}

async function approveAndPushFeedback() {
    if (!currentFeedbackData || !currentFeedbackData.submissions) return;

    const pushBtn = document.getElementById("btn-approve-push");
    const originalHTML = pushBtn ? pushBtn.innerHTML : "Approve & Push to Canvas";
    if (pushBtn) {
        pushBtn.disabled = true;
        pushBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Pushing to Canvas...`;
    }

    try {
        const approvedSubmissions = currentFeedbackData.submissions.map((sub, sIndex) => {
            const comments = {};
            (sub.questions || []).forEach((q, qIndex) => {
                const textarea = document.getElementById(`fb-comment-${sIndex}-${qIndex}`);
                if (textarea) {
                    comments[q.question_id || qIndex] = textarea.value;
                }
            });
            return {
                submission_id: sub.submission_id,
                user_id: sub.user_id,
                comments: comments
            };
        });

        const res = await fetch(`/api/quizzes/${currentFeedbackData.quiz_id}/agentic-feedback/approve`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ submissions: approvedSubmissions })
        });

        if (!res.ok) {
            const data = await res.json();
            throw new Error(parseApiDetail(data) || "Failed to push feedback to Canvas.");
        }

        alert("Feedback comments successfully approved and pushed to Canvas!");
        switchView("quizzes");
    } catch (err) {
        console.error("Error pushing feedback:", err);
        alert(`Could not push feedback: ${err.message}`);
    } finally {
        if (pushBtn) {
            pushBtn.disabled = false;
            pushBtn.innerHTML = originalHTML;
        }
    }
}

// Browser logic for ReviewPulse AI.
// All text from the server or the AI is added with textContent, never innerHTML.

const form = document.getElementById("analyze-form");
const reviewsInput = document.getElementById("reviews-input");
const csvInput = document.getElementById("csv-input");
const analyzeButton = document.getElementById("analyze-button");
const clearButton = document.getElementById("clear-button");
const loadingIndicator = document.getElementById("loading");
const errorMessage = document.getElementById("error-message");
const lineCount = document.getElementById("line-count");
const emptyState = document.getElementById("empty-state");
const resultsSection = document.getElementById("results");

const MAX_REVIEWS = Number(document.body.dataset.maxReviews);
const MAX_LENGTH = Number(document.body.dataset.maxLength);

// Small helper that builds an element safely.
function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function capitalize(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function showError(message) {
  errorMessage.textContent = message;
  errorMessage.hidden = false;
}

function hideError() {
  errorMessage.hidden = true;
  errorMessage.textContent = "";
}

function setLoading(isLoading) {
  analyzeButton.disabled = isLoading;
  loadingIndicator.hidden = !isLoading;
}

function countPastedReviews() {
  return reviewsInput.value.split("\n").filter((line) => line.trim() !== "").length;
}

function updateLineCount() {
  const count = countPastedReviews();
  lineCount.textContent = count === 1 ? "1 review entered" : count + " reviews entered";
}

// Quick checks for a friendlier experience. The server checks everything again.
function checkInputBeforeSending() {
  const hasFile = csvInput.files.length > 0;
  const lines = reviewsInput.value.split("\n").map((line) => line.trim()).filter(Boolean);

  if (hasFile && lines.length > 0) return "Please use either pasted reviews or a CSV file, not both.";
  if (!hasFile && lines.length === 0) return "Please paste at least one review or choose a CSV file.";
  if (!hasFile && lines.length > MAX_REVIEWS) return "Please enter at most " + MAX_REVIEWS + " reviews.";
  const tooLong = lines.findIndex((line) => line.length > MAX_LENGTH);
  if (tooLong !== -1) return "Review " + (tooLong + 1) + " is longer than " + MAX_LENGTH + " characters.";
  if (hasFile && csvInput.files[0].size > 1024 * 1024) return "The CSV file is larger than 1 MB.";
  return null;
}

async function readJson(response) {
  try {
    return await response.json();
  } catch (error) {
    return null;
  }
}

async function submitAnalysis(event) {
  event.preventDefault();
  hideError();

  const problem = checkInputBeforeSending();
  if (problem) {
    showError(problem);
    return;
  }

  setLoading(true);
  try {
    const response = await fetch("/api/analyze", { method: "POST", body: new FormData(form) });
    const data = await readJson(response);
    if (!response.ok) {
      showError((data && data.error) || "Something went wrong. Please try again.");
      return;
    }
    renderRun(data);
    loadHistory();
  } catch (error) {
    showError("Could not reach the server. Check that the app is running and try again.");
  } finally {
    setLoading(false);
  }
}

function renderStats(run) {
  const stats = document.getElementById("stats");
  stats.replaceChildren();
  const items = [
    ["Reviews analyzed", String(run.review_count)],
    ["Positive", run.counts.positive + " (" + run.percentages.positive + "%)"],
    ["Neutral", run.counts.neutral + " (" + run.percentages.neutral + "%)"],
    ["Negative", run.counts.negative + " (" + run.percentages.negative + "%)"],
  ];
  for (const [label, value] of items) {
    const stat = createElement("div", "stat");
    stat.append(createElement("div", "stat-value", value), createElement("div", "stat-label", label));
    stats.append(stat);
  }
}

function renderSentimentBar(run) {
  const bar = document.getElementById("sentiment-bar");
  bar.replaceChildren();
  for (const sentiment of ["positive", "neutral", "negative"]) {
    const percent = Number(run.percentages[sentiment]);
    if (percent > 0) {
      const segment = createElement("div", "bar-" + sentiment);
      segment.style.width = percent + "%";
      segment.title = capitalize(sentiment) + ": " + percent + "%";
      bar.append(segment);
    }
  }
}

function renderThemes(themes) {
  const list = document.getElementById("themes-list");
  list.replaceChildren();
  if (themes.length === 0) {
    list.append(createElement("li", "item-detail", "No common themes were found."));
    return;
  }
  for (const theme of themes) {
    const item = createElement("li");
    item.append(
      createElement("div", "item-title", theme.name),
      createElement("p", "item-detail", theme.explanation),
      createElement("span", "tag", "Estimated impact: " + theme.impact)
    );
    list.append(item);
  }
}

function renderRecommendations(recommendations) {
  const list = document.getElementById("recs-list");
  list.replaceChildren();
  for (const recommendation of recommendations) {
    const item = createElement("li");
    item.append(
      createElement("div", "item-title", recommendation.title),
      createElement("p", "item-detail", recommendation.detail)
    );
    list.append(item);
  }
}

async function copyText(text, button) {
  const originalLabel = button.textContent;
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = "Copied";
  } catch (error) {
    button.textContent = "Copy failed";
  }
  setTimeout(() => {
    button.textContent = originalLabel;
  }, 1500);
}

function buildReviewItem(review) {
  const item = createElement("article", "review-item");

  const meta = createElement("div", "review-meta");
  meta.append(
    createElement("span", "review-number", "Review " + review.index),
    createElement("span", "tag sentiment-" + review.sentiment, capitalize(review.sentiment)),
    createElement("span", "tag urgency-" + review.urgency, "Urgency: " + review.urgency)
  );
  item.append(meta, createElement("p", "review-text", review.review_text));

  if (review.themes.length > 0) {
    item.append(createElement("p", "review-themes", "Themes: " + review.themes.join(", ")));
  }

  const box = createElement("div", "response-box");
  box.append(createElement("p", "response-label", "Suggested response (AI draft, please review)"));
  if (review.suggested_response) {
    const copyButton = createElement("button", "button small", "Copy response");
    copyButton.type = "button";
    copyButton.addEventListener("click", () => copyText(review.suggested_response, copyButton));
    box.append(createElement("p", "response-text", review.suggested_response), copyButton);
  } else {
    box.append(createElement("p", "response-text", "No response suggested for this review."));
  }
  item.append(box);
  return item;
}

function renderRun(run) {
  emptyState.hidden = true;
  resultsSection.hidden = false;

  renderStats(run);
  renderSentimentBar(run);
  document.getElementById("summary-text").textContent = run.summary;
  renderThemes(run.common_themes);
  renderRecommendations(run.recommendations);

  const reviewList = document.getElementById("review-list");
  reviewList.replaceChildren(...run.reviews.map(buildReviewItem));

  document.getElementById("export-link").href = "/api/export/" + run.id;
  resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

function formatDate(isoText) {
  const date = new Date(isoText);
  return Number.isNaN(date.getTime()) ? isoText : date.toLocaleString();
}

function buildHistoryItem(run) {
  const item = createElement("li");
  const row = createElement("div", "history-row");

  const info = createElement("div", "history-info");
  info.append(
    createElement("div", "item-title", formatDate(run.created_at) + " - " + run.review_count + " reviews"),
    createElement(
      "p",
      "item-detail",
      "Positive " + run.positive_count + ", neutral " + run.neutral_count + ", negative " + run.negative_count + ". " + run.summary
    )
  );

  const openButton = createElement("button", "button small", "Open analysis");
  openButton.type = "button";
  openButton.addEventListener("click", () => openRun(run.id));

  row.append(info, openButton);
  item.append(row);
  return item;
}

async function loadHistory() {
  const list = document.getElementById("history-list");
  const emptyMessage = document.getElementById("history-empty");
  try {
    const response = await fetch("/api/history");
    const data = await readJson(response);
    if (!response.ok || !data) throw new Error("History request failed");
    list.replaceChildren(...data.runs.map(buildHistoryItem));
    emptyMessage.hidden = data.runs.length > 0;
  } catch (error) {
    emptyMessage.textContent = "Could not load history.";
    emptyMessage.hidden = false;
  }
}

async function openRun(runId) {
  hideError();
  try {
    const response = await fetch("/api/history/" + runId);
    const data = await readJson(response);
    if (!response.ok) {
      showError((data && data.error) || "Could not open that analysis.");
      return;
    }
    renderRun(data);
  } catch (error) {
    showError("Could not reach the server.");
  }
}

function clearForm() {
  form.reset();
  hideError();
  updateLineCount();
}

form.addEventListener("submit", submitAnalysis);
clearButton.addEventListener("click", clearForm);
reviewsInput.addEventListener("input", updateLineCount);
updateLineCount();
loadHistory();

// Nadir — Satellite Geo-Quiz game logic
// No backend, no database. All state lives in memory for this page load.

const NUM_QUESTIONS = 10;
const TIMER_SECONDS = 60;
const RING_CIRCUMFERENCE = 175.93; // 2π × 28 (ring radius)
const IMAGE_SIZE = 700;

// ── Difficulty config ─────────────────────────────────────────────────────────
const DIFF_TIERS  = { easy: ['easy'], medium: ['easy','medium'],
                       hard: ['easy','medium','hard'], expert: ['easy','medium','hard','expert'] };
const DIFF_LABELS = { easy:'Easy', medium:'Medium', hard:'Hard', expert:'World Traveler' };
const DIFF_ICONS  = { easy:'🌍', medium:'🗺️', hard:'🧭', expert:'🛰️' };

// ── DOM refs ──────────────────────────────────────────────────────────────────
const screens = {
  start:      document.getElementById('screen-start'),
  difficulty: document.getElementById('screen-difficulty'),
  quiz:       document.getElementById('screen-quiz'),
  results:    document.getElementById('screen-results'),
};
const el = {
  btnStart:        document.getElementById('btn-start'),
  btnNext:         document.getElementById('btn-next'),
  btnRestart:      document.getElementById('btn-restart'),
  btnShareX:       document.getElementById('btn-share-x'),
  btnShareFb:      document.getElementById('btn-share-fb'),
  btnShareWa:      document.getElementById('btn-share-wa'),
  btnShareThreads: document.getElementById('btn-share-threads'),
  btnShareImage:   document.getElementById('btn-share-image'),
  btnShareCopy:    document.getElementById('btn-share-copy'),
  btnShareNative:  document.getElementById('btn-share-native'),
  copyConfirm:     document.getElementById('copy-confirm'),
  challengeBanner: document.getElementById('challenge-banner'),
  challengeText:   document.getElementById('challenge-text'),
  progressLabel:   document.getElementById('progress-label'),
  progressFill:    document.getElementById('progress-fill'),
  scoreLabel:      document.getElementById('score-label'),
  image:           document.getElementById('sat-image'),
  imageLoading:    document.getElementById('image-loading'),
  options:         document.getElementById('options'),
  feedbackText:    document.getElementById('feedback-text'),
  timerText:       document.getElementById('timer-text'),
  ringArc:         document.getElementById('ring-arc'),
  resultsTitle:    document.getElementById('results-title'),
  finalScore:      document.getElementById('final-score'),
  diffBadge:       document.getElementById('diff-badge'),
  resultsMessage:  document.getElementById('results-message'),
  emojiGrid:       document.getElementById('emoji-grid'),
  reviewList:      document.getElementById('review-list'),
  shareCanvas:     document.getElementById('share-canvas'),
};

// ── State ─────────────────────────────────────────────────────────────────────
let selectedDifficulty = 'easy';
let quiz        = [];   // 10 question objects
let currentIdx  = 0;
let score       = 0;
let review      = [];   // { answer, picked, outcome: 'correct'|'wrong'|'timeout' }
let answered    = false;
let timerHandle = null;
let timeLeft    = TIMER_SECONDS;

// ── Helpers ───────────────────────────────────────────────────────────────────
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildImageUrl(loc) {
  const latRad  = loc.lat * Math.PI / 180;
  const dLat    = loc.radiusKm / 111.32;
  const dLon    = dLat / Math.cos(latRad);
  const bbox    = [loc.lng-dLon, loc.lat-dLat, loc.lng+dLon, loc.lat+dLat].join(',');
  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export` +
         `?bbox=${bbox}&bboxSR=4326&imageSR=3857&size=${IMAGE_SIZE},${IMAGE_SIZE}&format=jpg&f=image`;
}

// Build 4 options: correct + near + 2 cluster siblings (overthink)
function buildOptions(loc, pool) {
  const siblings = shuffle(
    pool.filter(l => l.cluster === loc.cluster && l.answer !== loc.answer && l.answer !== loc.near)
  );
  const overthink = siblings.slice(0, 2).map(l => l.answer);

  if (overthink.length < 2) {
    const extra = shuffle(
      pool.filter(l => l.cluster !== loc.cluster && l.answer !== loc.answer && l.answer !== loc.near)
    );
    while (overthink.length < 2 && extra.length) overthink.push(extra.shift().answer);
  }

  return shuffle([loc.answer, loc.near, ...overthink.slice(0, 2)]);
}

function buildQuiz() {
  const tiers  = DIFF_TIERS[selectedDifficulty];
  const pool   = LOCATIONS.filter(l => tiers.includes(l.difficulty));
  const chosen = shuffle(pool).slice(0, NUM_QUESTIONS);
  return chosen.map(loc => ({
    loc,
    imageUrl: buildImageUrl(loc),
    options:  buildOptions(loc, pool),
  }));
}

// ── Screen management ─────────────────────────────────────────────────────────
function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
}

// ── Timer ─────────────────────────────────────────────────────────────────────
function updateTimerDisplay() {
  const pct = timeLeft / TIMER_SECONDS;
  el.timerText.textContent = timeLeft;
  el.ringArc.style.strokeDashoffset = RING_CIRCUMFERENCE * (1 - pct);

  const warn   = timeLeft <= 20 && timeLeft > 10;
  const urgent = timeLeft <= 10;
  el.ringArc.classList.toggle('warn',   warn && !urgent);
  el.ringArc.classList.toggle('urgent', urgent);
  el.timerText.classList.toggle('warn',   warn && !urgent);
  el.timerText.classList.toggle('urgent', urgent);
}

function startTimer() {
  clearInterval(timerHandle);
  timeLeft = TIMER_SECONDS;
  updateTimerDisplay();
  timerHandle = setInterval(() => {
    timeLeft--;
    updateTimerDisplay();
    if (timeLeft <= 0) {
      clearInterval(timerHandle);
      handleTimeout();
    }
  }, 1000);
}

function stopTimer() { clearInterval(timerHandle); }

function handleTimeout() {
  if (answered) return;
  answered = true;
  const q = quiz[currentIdx];

  [...el.options.children].forEach(btn => {
    btn.disabled = true;
    if (btn.textContent === q.loc.answer) btn.classList.add('correct');
  });

  review.push({ answer: q.loc.answer, picked: null, outcome: 'timeout' });

  el.feedbackText.textContent = `⏱️ Time's up! It was ${q.loc.answer}.`;
  el.feedbackText.className   = 'feedback-text timeout';
  el.btnNext.textContent = currentIdx === NUM_QUESTIONS - 1 ? 'See Results →' : 'Next →';
  el.btnNext.classList.remove('hidden');
}

// ── Quiz logic ────────────────────────────────────────────────────────────────
function startQuiz() {
  quiz       = buildQuiz();
  currentIdx = 0;
  score      = 0;
  review     = [];
  showScreen('quiz');
  renderQuestion();
}

function renderQuestion() {
  answered = false;
  const q  = quiz[currentIdx];

  el.progressLabel.textContent = `${currentIdx + 1} / ${NUM_QUESTIONS}`;
  el.progressFill.style.width  = `${(currentIdx / NUM_QUESTIONS) * 100}%`;
  el.scoreLabel.textContent    = `${score} pts`;
  el.feedbackText.textContent  = '';
  el.feedbackText.className    = 'feedback-text';
  el.btnNext.classList.add('hidden');

  el.imageLoading.classList.remove('hidden');
  el.image.style.opacity = '0';
  el.image.src = q.imageUrl;
  el.image.onload  = () => { el.imageLoading.classList.add('hidden'); el.image.style.opacity = '1'; };
  el.image.onerror = () => { el.imageLoading.textContent = 'Imagery unavailable — check connection.'; };

  el.options.innerHTML = '';
  q.options.forEach(text => {
    const btn = document.createElement('button');
    btn.className   = 'option-btn';
    btn.textContent = text;
    btn.addEventListener('click', () => selectAnswer(text, btn));
    el.options.appendChild(btn);
  });

  startTimer();
}

function selectAnswer(picked, btnEl) {
  if (answered) return;
  answered = true;
  stopTimer();

  const correct = quiz[currentIdx].loc.answer;
  const isRight = picked === correct;
  if (isRight) score++;
  review.push({ answer: correct, picked, outcome: isRight ? 'correct' : 'wrong' });

  [...el.options.children].forEach(btn => {
    btn.disabled = true;
    if (btn.textContent === correct) btn.classList.add('correct');
    else if (btn === btnEl)          btn.classList.add('incorrect');
  });

  el.scoreLabel.textContent = `${score} pts`;
  el.feedbackText.textContent = isRight ? '✅ Correct!' : `❌ It was ${correct}.`;
  el.feedbackText.className   = `feedback-text ${isRight ? 'correct' : 'incorrect'}`;
  el.btnNext.textContent      = currentIdx === NUM_QUESTIONS - 1 ? 'See Results →' : 'Next →';
  el.btnNext.classList.remove('hidden');
}

function nextQuestion() {
  currentIdx++;
  if (currentIdx >= NUM_QUESTIONS) showResults();
  else renderQuestion();
}

// ── Results & Share ───────────────────────────────────────────────────────────
const OUTCOME_EMOJI = { correct:'🟩', wrong:'🟥', timeout:'⬜' };

// The link people click when you share — carries score+difficulty so the
// landing page can show a "beat this score" teaser (drives click-through).
function buildShareUrl() {
  const base = location.origin + location.pathname;
  return `${base}?s=${score}&d=${selectedDifficulty}`;
}

function buildShareText(withUrl) {
  const grid  = review.map(r => OUTCOME_EMOJI[r.outcome]).join('');
  const label = `${DIFF_ICONS[selectedDifficulty]} ${DIFF_LABELS[selectedDifficulty]}`;
  let text = `🛰️ Nadir — ${label}\n${score}/10\n\n${grid}`;
  if (withUrl) text += `\n\nPlay: ${buildShareUrl()}`;
  return text;
}

function showResults() {
  stopTimer();
  el.progressFill.style.width = '100%';
  showScreen('results');

  el.finalScore.textContent = score;
  el.diffBadge.textContent  = `${DIFF_ICONS[selectedDifficulty]} ${DIFF_LABELS[selectedDifficulty]}`;

  const msgs = [
    [10,  '🌍 Perfect! A true human satellite.'],
    [8,   '🛰️ Excellent — you really know your planet.'],
    [6,   '🗺️ Solid! Geography instincts are strong.'],
    [4,   '🧭 Not bad, but the decoys got you a few times.'],
    [0,   '🌀 Rough round — time to spin the globe and try again.'],
  ];
  el.resultsMessage.textContent = msgs.find(([min]) => score >= min)[1];
  el.emojiGrid.textContent = review.map(r => OUTCOME_EMOJI[r.outcome]).join('');

  const shareUrl  = buildShareUrl();
  const plainText = buildShareText(false); // emoji grid + score, no link (link passed separately)
  const fullText  = buildShareText(true);  // for platforms with no separate url field (WhatsApp)

  el.btnShareX.onclick = () => {
    const u = 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(plainText) +
              '&url=' + encodeURIComponent(shareUrl);
    window.open(u, '_blank', 'noopener');
  };

  el.btnShareFb.onclick = () => {
    const u = 'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(shareUrl) +
              '&quote=' + encodeURIComponent(plainText);
    window.open(u, '_blank', 'noopener');
  };

  el.btnShareWa.onclick = () => {
    const u = 'https://api.whatsapp.com/send?text=' + encodeURIComponent(fullText);
    window.open(u, '_blank', 'noopener');
  };

  el.btnShareThreads.onclick = () => {
    const u = 'https://www.threads.net/intent/post?text=' + encodeURIComponent(plainText) +
              '&url=' + encodeURIComponent(shareUrl);
    window.open(u, '_blank', 'noopener');
  };

  // Instagram has no website share-intent for Stories — the real path is an
  // image + the OS-native share sheet (Instagram Stories shows up there on
  // mobile), with a plain download as the fallback everywhere else.
  el.btnShareImage.onclick = () => shareOrDownloadImage(fullText, shareUrl);

  el.btnShareCopy.onclick = async () => {
    try {
      await navigator.clipboard.writeText(fullText);
      flashCopyConfirm();
    } catch {
      const ta = document.createElement('textarea');
      ta.value = fullText; document.body.appendChild(ta);
      ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
      flashCopyConfirm();
    }
  };

  if (navigator.share) {
    el.btnShareNative.classList.remove('hidden');
    el.btnShareNative.onclick = () => navigator.share({ text: fullText, url: shareUrl }).catch(() => {});
  }

  renderReview();
}

function flashCopyConfirm() {
  el.copyConfirm.classList.remove('hidden');
  setTimeout(() => el.copyConfirm.classList.add('hidden'), 2500);
}

function renderReview() {
  el.reviewList.innerHTML = '';
  review.forEach((r, i) => {
    const row = document.createElement('div');
    row.className = `review-item ${r.outcome}`;
    const marks  = { correct:'✔', wrong:'✘', timeout:'⏱' };
    const suffix = r.outcome === 'correct'
      ? ''
      : r.outcome === 'timeout'
        ? ` <span class="review-answer">(ran out of time)</span>`
        : ` <span class="review-answer">(you picked ${r.picked})</span>`;
    row.innerHTML = `<span class="review-mark">${marks[r.outcome]}</span>
                     <span>Q${i+1}: ${r.answer}${suffix}</span>`;
    el.reviewList.appendChild(row);
  });
}

// ── Shareable score-card image (for Instagram Story / native share sheet) ────
function drawShareCard() {
  const c = el.shareCanvas;
  const ctx = c.getContext('2d');
  const W = c.width, H = c.height;

  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, '#131b34');
  grad.addColorStop(1, '#0b1021');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.font = '160px system-ui, -apple-system, sans-serif';
  ctx.fillText('🛰️', W / 2, 340);

  ctx.font = '700 76px system-ui, -apple-system, sans-serif';
  wrapText(ctx, 'Nadir', W / 2, 460, W - 140, 84);

  ctx.font = '400 40px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#aab4d4';
  ctx.fillText('Satellite Geo-Quiz', W / 2, 560);

  // Score
  ctx.fillStyle = '#5b8dfb';
  ctx.font = '800 220px system-ui, -apple-system, sans-serif';
  ctx.fillText(`${score}/10`, W / 2, 900);

  // Difficulty badge
  const label = `${DIFF_ICONS[selectedDifficulty]}  ${DIFF_LABELS[selectedDifficulty]}`;
  ctx.font = '600 44px system-ui, -apple-system, sans-serif';
  const badgeW = ctx.measureText(label).width + 80;
  ctx.fillStyle = '#1c2957';
  roundRect(ctx, W / 2 - badgeW / 2, 970, badgeW, 90, 45);
  ctx.fill();
  ctx.fillStyle = '#8fb2ff';
  ctx.fillText(label, W / 2, 1030);

  // Emoji grid card
  const gridText = review.map(r => OUTCOME_EMOJI[r.outcome]).join(' ');
  ctx.font = '80px system-ui, -apple-system, sans-serif';
  const cardW = Math.min(W - 100, ctx.measureText(gridText).width + 120);
  ctx.fillStyle = '#ffffff';
  roundRect(ctx, W / 2 - cardW / 2, 1150, cardW, 220, 32);
  ctx.fill();
  ctx.fillStyle = '#000000';
  ctx.fillText(gridText, W / 2, 1290);

  // Footer / call to action
  ctx.font = '500 40px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#aab4d4';
  ctx.fillText('Think you can beat it?', W / 2, 1480);
  ctx.font = '700 44px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#ffffff';
  wrapText(ctx, location.origin + location.pathname, W / 2, 1550, W - 140, 54);

  return c;
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(' ');
  let line = '', lines = [];
  words.forEach(word => {
    const test = line ? line + ' ' + word : word;
    if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = word; }
    else line = test;
  });
  lines.push(line);
  lines.forEach((l, i) => ctx.fillText(l, x, y + i * lineHeight));
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function shareOrDownloadImage(text, url) {
  const canvas = drawShareCard();
  canvas.toBlob(async (blob) => {
    const file = new File([blob], 'nadir-score.png', { type: 'image/png' });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], text, url });
        return;
      } catch { /* user cancelled — fall through to download */ }
    }

    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'nadir-score.png';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    el.copyConfirm.textContent = 'Image saved — open Instagram → Story → pick it from your gallery ✓';
    el.copyConfirm.classList.remove('hidden');
    setTimeout(() => {
      el.copyConfirm.classList.add('hidden');
      el.copyConfirm.textContent = 'Copied ✓';
    }, 4000);
  }, 'image/png');
}

// ── Viral loop: read ?s=&d= from an incoming shared link ─────────────────────
function checkIncomingChallenge() {
  const params = new URLSearchParams(location.search);
  const s = parseInt(params.get('s'), 10);
  const d = params.get('d');
  if (!Number.isNaN(s) && DIFF_LABELS[d]) {
    el.challengeText.textContent =
      `🎯 Someone scored ${s}/10 on ${DIFF_ICONS[d]} ${DIFF_LABELS[d]}. Think you can beat it?`;
    el.challengeBanner.classList.remove('hidden');
  }
  // Clean the URL so a replay/refresh doesn't keep re-showing the same banner
  if (params.has('s') || params.has('d')) {
    history.replaceState(null, '', location.pathname);
  }
}

// ── Wiring ────────────────────────────────────────────────────────────────────
el.btnStart.addEventListener('click', () => showScreen('difficulty'));

document.querySelectorAll('.diff-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedDifficulty = btn.dataset.diff;
    setTimeout(startQuiz, 180);
  });
});

el.btnNext.addEventListener('click', nextQuestion);

el.btnRestart.addEventListener('click', () => {
  stopTimer();
  showScreen('difficulty');
  document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('selected'));
});

checkIncomingChallenge();

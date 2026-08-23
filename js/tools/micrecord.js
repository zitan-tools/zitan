(() => {
  const timerEl = document.getElementById("micrecord-timer");
  const segInfoEl = document.getElementById("micrecord-segment-info");
  const startBtn = document.getElementById("micrecord-start");
  const pauseBtn = document.getElementById("micrecord-pause");
  const resumeBtn = document.getElementById("micrecord-resume");
  const deleteLastBtn = document.getElementById("micrecord-delete-last");
  const undoBtn = document.getElementById("micrecord-undo");
  const redoBtn = document.getElementById("micrecord-redo");
  const finishBtn = document.getElementById("micrecord-finish");
  const resetBtn = document.getElementById("micrecord-reset");
  const errorEl = document.getElementById("micrecord-error");
  const recordArea = document.getElementById("micrecord-record-area");
  const postArea = document.getElementById("micrecord-post-area");
  const deviceArea = document.getElementById("micrecord-device-area");
  const inputSelect = document.getElementById("micrecord-input-select");
  const outputSelect = document.getElementById("micrecord-output-select");
  const testInputBtn = document.getElementById("micrecord-test-input");
  const meterBarEl = document.getElementById("micrecord-meter-bar");
  const meterNoteEl = document.getElementById("micrecord-meter-note");
  const testOutputBtn = document.getElementById("micrecord-test-output");
  const outputNoteEl = document.getElementById("micrecord-output-note");
  const previewRawBtn = document.getElementById("micrecord-preview-raw");
  const rawAudioEl = document.getElementById("micrecord-raw-audio");
  const optNoise = document.getElementById("micrecord-opt-noise");
  const optQuality = document.getElementById("micrecord-opt-quality");
  const optVolume = document.getElementById("micrecord-opt-volume");
  const previewBtn = document.getElementById("micrecord-preview");
  const previewAudioEl = document.getElementById("micrecord-preview-audio");
  const previewVolumeEl = document.getElementById("micrecord-preview-volume");
  const exportBtn = document.getElementById("micrecord-export");
  const backBtn = document.getElementById("micrecord-back");
  const statusEl = document.getElementById("micrecord-status");
  const resultArea = document.getElementById("micrecord-result");

  const RNNOISE_BASE_URL = "https://cdn.jsdelivr.net/npm/@jitsi/rnnoise-wasm@0.2.1/dist/";
  const TARGET_SAMPLE_RATE = 48000;

  let stream = null;
  let recorder = null;
  let segments = []; // { blob, durationMs }
  let trash = [];
  let recordingStartedAt = 0;
  let confirmedMs = 0;
  let timerInterval = null;
  let rawSamplesCache = null; // 録音完了後、結合済みの元音声(Float32Array)をキャッシュしておく
  let rawAudioUrl = null;
  let previewAudioUrl = null;
  let micTestStream = null;
  let micTestCtx = null;
  let micTestRAF = null;

  // ---------- 録音前の確認(入力レベル・入出力デバイス) ----------

  function populateSelect(selectEl, list, fallbackLabel) {
    const prevValue = selectEl.value;
    selectEl.innerHTML = "";
    if (!list.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = `(${fallbackLabel}が見つかりません)`;
      selectEl.appendChild(opt);
      return;
    }
    list.forEach((d, i) => {
      const opt = document.createElement("option");
      opt.value = d.deviceId;
      opt.textContent = d.label || `${fallbackLabel} ${i + 1}`;
      selectEl.appendChild(opt);
    });
    if (list.some((d) => d.deviceId === prevValue)) selectEl.value = prevValue;
  }

  async function refreshDeviceList() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      populateSelect(inputSelect, devices.filter((d) => d.kind === "audioinput"), "マイク");
      populateSelect(outputSelect, devices.filter((d) => d.kind === "audiooutput"), "スピーカー");
    } catch {
      // 一覧が取れなくても致命的ではないため、そのまま無視する
    }
  }

  refreshDeviceList();
  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    navigator.mediaDevices.addEventListener("devicechange", refreshDeviceList);
  }

  // マイクテスト用のstreamは、実際の録音用streamとは別に保持する(録音開始時に停止する)
  async function startMicTest() {
    stopMicTest();
    errorEl.hidden = true;
    testInputBtn.disabled = true;
    try {
      const deviceId = inputSelect.value;
      const constraints = { audio: deviceId ? { deviceId: { exact: deviceId } } : true };
      micTestStream = await navigator.mediaDevices.getUserMedia(constraints);
      await refreshDeviceList();
      micTestCtx = new (window.AudioContext || window.webkitAudioContext)();
      const source = micTestCtx.createMediaStreamSource(micTestStream);
      const analyser = micTestCtx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let sumSq = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sumSq += v * v;
        }
        const rms = Math.sqrt(sumSq / data.length);
        const level = Math.min(1, rms * 4);
        meterBarEl.style.width = `${Math.round(level * 100)}%`;
        micTestRAF = requestAnimationFrame(tick);
      };
      tick();
      meterNoteEl.hidden = false;
      testInputBtn.textContent = "■ テストを止める";
    } catch (err) {
      errorEl.textContent = "マイクを使用できませんでした。ブラウザの設定でマイクの使用を許可してください。";
      errorEl.hidden = false;
    }
    testInputBtn.disabled = false;
  }

  function stopMicTest() {
    if (micTestRAF) {
      cancelAnimationFrame(micTestRAF);
      micTestRAF = null;
    }
    if (micTestCtx) {
      micTestCtx.close();
      micTestCtx = null;
    }
    if (micTestStream) {
      micTestStream.getTracks().forEach((t) => t.stop());
      micTestStream = null;
    }
    meterBarEl.style.width = "0%";
    meterNoteEl.hidden = true;
    testInputBtn.textContent = "🎤 マイクをテストする";
  }

  testInputBtn.addEventListener("click", () => {
    if (micTestStream) stopMicTest();
    else startMicTest();
  });

  inputSelect.addEventListener("change", () => {
    if (micTestStream) startMicTest();
  });

  testOutputBtn.addEventListener("click", async () => {
    testOutputBtn.disabled = true;
    outputNoteEl.hidden = true;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      osc.frequency.value = 523.25;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.25, ctx.currentTime + 0.05);
      gain.gain.setValueAtTime(0.25, ctx.currentTime + 1.0);
      gain.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 1.3);
      const dest = ctx.createMediaStreamDestination();
      osc.connect(gain).connect(dest);
      osc.start();
      osc.stop(ctx.currentTime + 1.3);

      const audioEl = new Audio();
      audioEl.srcObject = dest.stream;
      const outputId = outputSelect.value;
      if (outputId && typeof audioEl.setSinkId === "function") {
        try {
          await audioEl.setSinkId(outputId);
        } catch {
          outputNoteEl.textContent = "選んだ出力先には切り替えられませんでした。既定のスピーカーで再生します。";
          outputNoteEl.hidden = false;
        }
      } else if (outputId && typeof audioEl.setSinkId !== "function") {
        outputNoteEl.textContent = "お使いのブラウザは出力先の切り替えに対応していないため、既定のスピーカーで再生します。";
        outputNoteEl.hidden = false;
      }
      await audioEl.play();
      setTimeout(() => {
        try { ctx.close(); } catch {}
      }, 1500);
    } catch (err) {
      outputNoteEl.textContent = "テスト音を再生できませんでした。";
      outputNoteEl.hidden = false;
    }
    setTimeout(() => { testOutputBtn.disabled = false; }, 1400);
  });

  // ---------- 録音まわり ----------

  function formatTime(ms) {
    const totalSec = Math.floor(Math.max(0, ms) / 1000);
    const m = String(Math.floor(totalSec / 60)).padStart(2, "0");
    const s = String(totalSec % 60).padStart(2, "0");
    return `${m}:${s}`;
  }

  function updateTimerDisplay() {
    const liveMs = recordingStartedAt ? Date.now() - recordingStartedAt : 0;
    timerEl.textContent = formatTime(confirmedMs + liveMs);
  }

  function updateSegmentInfo() {
    segInfoEl.textContent = segments.length
      ? `${segments.length}個の区間を録音済み(合計 ${formatTime(confirmedMs)})`
      : "";
  }

  function updateButtons(state) {
    const hasSegments = segments.length > 0;
    deviceArea.hidden = state !== "idle";
    if (state !== "idle") stopMicTest();
    startBtn.hidden = state !== "idle";
    pauseBtn.hidden = state !== "recording";
    resumeBtn.hidden = state !== "paused";
    deleteLastBtn.hidden = state !== "paused";
    deleteLastBtn.disabled = !hasSegments;
    undoBtn.hidden = state !== "paused";
    undoBtn.disabled = trash.length === 0;
    redoBtn.hidden = state !== "paused";
    redoBtn.disabled = !hasSegments;
    finishBtn.hidden = state !== "paused";
    finishBtn.disabled = !hasSegments;
    resetBtn.hidden = state === "idle";
    previewRawBtn.hidden = state !== "paused";
    previewRawBtn.disabled = !hasSegments;
    if (state !== "paused") {
      rawAudioEl.hidden = true;
      rawAudioEl.pause();
    }
  }

  function pickMimeType() {
    if (!window.MediaRecorder) return "";
    const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
    for (const t of candidates) {
      if (MediaRecorder.isTypeSupported(t)) return t;
    }
    return "";
  }

  async function ensureStream() {
    if (stream) return stream;
    const deviceId = inputSelect.value;
    const constraints = { audio: deviceId ? { deviceId: { exact: deviceId } } : true };
    stream = await navigator.mediaDevices.getUserMedia(constraints);
    return stream;
  }

  function startNewChunkRecorder() {
    const mimeType = pickMimeType();
    recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    const chunks = [];
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
      const durationMs = Date.now() - recordingStartedAt;
      segments.push({ blob, durationMs });
      trash = [];
      rawSamplesCache = null;
      confirmedMs += durationMs;
      recordingStartedAt = 0;
      updateSegmentInfo();
      updateButtons("paused");
    };
    recorder.start();
    recordingStartedAt = Date.now();
  }

  startBtn.addEventListener("click", async () => {
    errorEl.hidden = true;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      errorEl.textContent = "お使いのブラウザはマイク録音に対応していません。";
      errorEl.hidden = false;
      return;
    }
    stopMicTest();
    try {
      await ensureStream();
    } catch (err) {
      errorEl.textContent = "マイクを使用できませんでした。ブラウザの設定でマイクの使用を許可してください。";
      errorEl.hidden = false;
      return;
    }
    segments = [];
    trash = [];
    confirmedMs = 0;
    startNewChunkRecorder();
    updateButtons("recording");
    if (!timerInterval) timerInterval = setInterval(updateTimerDisplay, 200);
  });

  pauseBtn.addEventListener("click", () => {
    if (recorder && recorder.state === "recording") recorder.stop();
  });

  resumeBtn.addEventListener("click", () => {
    startNewChunkRecorder();
    updateButtons("recording");
  });

  deleteLastBtn.addEventListener("click", () => {
    if (!segments.length) return;
    const removed = segments.pop();
    trash.push(removed);
    rawSamplesCache = null;
    confirmedMs -= removed.durationMs;
    updateTimerDisplay();
    updateSegmentInfo();
    updateButtons("paused");
  });

  undoBtn.addEventListener("click", () => {
    if (!trash.length) return;
    const restored = trash.pop();
    segments.push(restored);
    rawSamplesCache = null;
    confirmedMs += restored.durationMs;
    updateTimerDisplay();
    updateSegmentInfo();
    updateButtons("paused");
  });

  redoBtn.addEventListener("click", () => {
    deleteLastBtn.click(); // 「直前の区間を削除」と同じ操作
  });

  resetBtn.addEventListener("click", () => {
    if (recorder && recorder.state === "recording") recorder.stop();
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    segments = [];
    trash = [];
    rawSamplesCache = null;
    confirmedMs = 0;
    recordingStartedAt = 0;
    timerEl.textContent = "00:00";
    if (rawAudioUrl) { URL.revokeObjectURL(rawAudioUrl); rawAudioUrl = null; }
    if (previewAudioUrl) { URL.revokeObjectURL(previewAudioUrl); previewAudioUrl = null; }
    rawAudioEl.removeAttribute("src");
    previewAudioEl.removeAttribute("src");
    previewAudioEl.hidden = true;
    previewVolumeEl.hidden = true;
    updateSegmentInfo();
    updateButtons("idle");
    postArea.hidden = true;
    recordArea.hidden = false;
    resultArea.innerHTML = "";
  });

  finishBtn.addEventListener("click", () => {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    recordArea.hidden = true;
    postArea.hidden = false;
    resultArea.innerHTML = "";
    previewAudioEl.hidden = true;
    previewAudioEl.pause();
    previewVolumeEl.hidden = true;
  });

  backBtn.addEventListener("click", () => {
    postArea.hidden = true;
    recordArea.hidden = false;
    updateButtons(segments.length ? "paused" : "idle");
    previewAudioEl.pause();
  });

  previewRawBtn.addEventListener("click", async () => {
    previewRawBtn.disabled = true;
    errorEl.hidden = true;
    const originalText = previewRawBtn.textContent;
    previewRawBtn.textContent = "読み込み中...";
    try {
      const samples = await concatenateSegments(segments);
      const wav = encodeWav(samples, TARGET_SAMPLE_RATE);
      if (rawAudioUrl) URL.revokeObjectURL(rawAudioUrl);
      rawAudioUrl = URL.createObjectURL(wav);
      rawAudioEl.src = rawAudioUrl;
      rawAudioEl.hidden = false;
      rawAudioEl.play();
    } catch (err) {
      errorEl.textContent = "再生用の音声を準備できませんでした。もう一度お試しください。";
      errorEl.hidden = false;
    }
    previewRawBtn.disabled = !segments.length;
    previewRawBtn.textContent = originalText;
  });

  // ---------- 書き出し(結合・ノイズ除去・音質調整・音量・MP3化) ----------

  async function decodeSegment(blob) {
    const arrayBuffer = await blob.arrayBuffer();
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    try {
      return await ctx.decodeAudioData(arrayBuffer);
    } finally {
      ctx.close();
    }
  }

  // 複数の録音区間を、順番につなげて1本のFloat32Array(48kHzモノラル)にする。
  // OfflineAudioContextに任せることで、サンプリングレートの違いやステレオ→
  // モノラルの変換も自動でまとめて処理できる
  async function concatenateSegments(segs) {
    const decoded = [];
    for (const seg of segs) decoded.push(await decodeSegment(seg.blob));
    const totalSeconds = decoded.reduce((sum, b) => sum + b.duration, 0);
    const offlineCtx = new OfflineAudioContext(1, Math.ceil((totalSeconds + 1) * TARGET_SAMPLE_RATE), TARGET_SAMPLE_RATE);
    let offset = 0;
    for (const buf of decoded) {
      const src = offlineCtx.createBufferSource();
      src.buffer = buf;
      src.connect(offlineCtx.destination);
      src.start(offset);
      offset += buf.duration;
    }
    const rendered = await offlineCtx.startRendering();
    const actualLength = Math.round(offset * TARGET_SAMPLE_RATE);
    return rendered.getChannelData(0).slice(0, actualLength);
  }

  let rnnoiseModulePromise = null;
  function getRNNoiseModule() {
    if (!rnnoiseModulePromise) {
      rnnoiseModulePromise = import(RNNOISE_BASE_URL + "rnnoise.js")
        .then((mod) => mod.default({ locateFile: (path) => RNNOISE_BASE_URL + path }))
        .catch((err) => {
          rnnoiseModulePromise = null;
          throw err;
        });
    }
    return rnnoiseModulePromise;
  }

  // RNNoise(AIノイズ除去)は48kHz・480サンプル(10ミリ秒)単位の16bit相当スケールの
  // フレームを1つずつ処理する仕様のため、その形式に変換しながら処理する
  async function denoiseSamples(samples) {
    const Module = await getRNNoiseModule();
    const FRAME_SIZE = 480;
    const state = Module._rnnoise_create(0);
    const inPtr = Module._malloc(FRAME_SIZE * 4);
    const outPtr = Module._malloc(FRAME_SIZE * 4);
    const output = new Float32Array(samples.length);
    const frameBuf = new Float32Array(FRAME_SIZE);
    try {
      for (let i = 0; i < samples.length; i += FRAME_SIZE) {
        const end = Math.min(i + FRAME_SIZE, samples.length);
        frameBuf.fill(0);
        for (let j = i; j < end; j++) frameBuf[j - i] = samples[j] * 32768;
        Module.HEAPF32.set(frameBuf, inPtr / 4);
        Module._rnnoise_process_frame(state, outPtr, inPtr);
        const outFrame = Module.HEAPF32.subarray(outPtr / 4, outPtr / 4 + FRAME_SIZE);
        for (let j = i; j < end; j++) output[j] = outFrame[j - i] / 32768;
      }
    } finally {
      Module._free(inPtr);
      Module._free(outPtr);
      Module._rnnoise_destroy(state);
    }
    return output;
  }

  // 低音のこもり・くすみを抑え、声の輪郭がはっきりするよう軽く圧縮をかける
  async function applyQualityChain(samples, sampleRate) {
    const ctx = new OfflineAudioContext(1, samples.length, sampleRate);
    const buffer = ctx.createBuffer(1, samples.length, sampleRate);
    buffer.copyToChannel(samples, 0);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const highpass = ctx.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = 90;
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -24;
    compressor.knee.value = 30;
    compressor.ratio.value = 3;
    compressor.attack.value = 0.02;
    compressor.release.value = 0.2;
    src.connect(highpass).connect(compressor).connect(ctx.destination);
    src.start(0);
    const rendered = await ctx.startRendering();
    return rendered.getChannelData(0).slice();
  }

  function normalizeVolume(samples, targetPeak = 0.95) {
    let max = 0;
    for (let i = 0; i < samples.length; i++) {
      const v = Math.abs(samples[i]);
      if (v > max) max = v;
    }
    if (max < 1e-6) return samples;
    const gain = Math.min(targetPeak / max, 6);
    const out = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) out[i] = samples[i] * gain;
    return out;
  }

  function encodeWav(samples, sampleRate) {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);
    function writeString(offset, str) {
      for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    }
    writeString(0, "RIFF");
    view.setUint32(4, 36 + samples.length * 2, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, "data");
    view.setUint32(40, samples.length * 2, true);
    let offset = 44;
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
    return new Blob([buffer], { type: "audio/wav" });
  }

  async function encodeMp3(wavBlob) {
    const ffmpeg = await getSharedFFmpeg();
    const uid = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const inputName = `mic_${uid}.wav`;
    const outputName = `mic_${uid}.mp3`;
    const bytes = new Uint8Array(await wavBlob.arrayBuffer());
    await ffmpeg.writeFile(inputName, bytes);
    try {
      await ffmpeg.exec(["-i", inputName, "-codec:a", "libmp3lame", "-b:a", "192k", outputName]);
      const data = await ffmpeg.readFile(outputName);
      return new File([data], "録音.mp3", { type: "audio/mpeg" });
    } finally {
      try { await ffmpeg.deleteFile(inputName); } catch {}
      try { await ffmpeg.deleteFile(outputName); } catch {}
    }
  }

  // 結合済みの元音声はキャッシュして使い回す(区間を変更したらキャッシュを破棄している)
  async function getRawSamples() {
    if (!rawSamplesCache) {
      rawSamplesCache = await concatenateSegments(segments);
    }
    return rawSamplesCache;
  }

  // チェックの状態に応じて、元音声に処理を適用する(試し聴き・書き出しの両方から使う)
  async function processSamples(onStatus) {
    let samples = await getRawSamples();
    if (optNoise.checked) {
      onStatus("AIでノイズを除去しています。(初回のみエンジンのダウンロードが必要です)");
      samples = await denoiseSamples(samples);
    }
    if (optQuality.checked) {
      onStatus("音質を整えています...");
      samples = await applyQualityChain(samples, TARGET_SAMPLE_RATE);
    }
    if (optVolume.checked) {
      onStatus("音量を調整しています...");
      samples = normalizeVolume(samples);
    }
    return samples;
  }

  function computeLoudnessLabel(samples) {
    let peak = 0;
    let sumSq = 0;
    for (let i = 0; i < samples.length; i++) {
      const v = samples[i];
      const av = Math.abs(v);
      if (av > peak) peak = av;
      sumSq += v * v;
    }
    const rms = Math.sqrt(sumSq / Math.max(1, samples.length));
    const peakDb = peak > 0 ? 20 * Math.log10(peak) : -Infinity;
    const rmsDb = rms > 0 ? 20 * Math.log10(rms) : -Infinity;
    let label = "ちょうどいい音量です";
    if (rmsDb < -30) label = "やや小さめの音量です";
    else if (rmsDb > -12) label = "やや大きめの音量です(割れて聞こえないか確認してください)";
    const peakLabel = peakDb === -Infinity ? "-∞" : peakDb.toFixed(1);
    return `${label}(ピーク音量の目安: ${peakLabel}dB、0dBに近いほど大きい音です)`;
  }

  previewBtn.addEventListener("click", async () => {
    if (!segments.length) return;
    previewBtn.disabled = true;
    exportBtn.disabled = true;
    backBtn.disabled = true;
    previewVolumeEl.hidden = true;
    try {
      const samples = await processSamples((msg) => { statusEl.textContent = msg; });
      statusEl.textContent = "";
      const wav = encodeWav(samples, TARGET_SAMPLE_RATE);
      if (previewAudioUrl) URL.revokeObjectURL(previewAudioUrl);
      previewAudioUrl = URL.createObjectURL(wav);
      previewAudioEl.src = previewAudioUrl;
      previewAudioEl.hidden = false;
      previewVolumeEl.textContent = computeLoudnessLabel(samples);
      previewVolumeEl.hidden = false;
      previewAudioEl.play();
    } catch (err) {
      statusEl.textContent = "";
      resultArea.innerHTML = `<p style="color:red;">試し聴き用の音声を準備できませんでした。もう一度お試しください。</p>`;
    }
    previewBtn.disabled = false;
    exportBtn.disabled = false;
    backBtn.disabled = false;
  });

  exportBtn.addEventListener("click", async () => {
    if (!segments.length) return;
    exportBtn.disabled = true;
    backBtn.disabled = true;
    previewBtn.disabled = true;
    resultArea.innerHTML = "";

    try {
      const samples = await processSamples((msg) => { statusEl.textContent = msg; });

      statusEl.textContent = "MP3に変換しています。(初回のみ変換エンジンのダウンロードが必要です)";
      const wavBlob = encodeWav(samples, TARGET_SAMPLE_RATE);
      const mp3File = await encodeMp3(wavBlob);

      statusEl.textContent = "";
      const url = URL.createObjectURL(mp3File);
      resultArea.innerHTML = `
        <div class="result-card">
          <div class="result-info">
            <p>書き出しが完了しました。</p>
            <audio controls src="${url}" style="width:100%; margin:10px 0;"></audio>
          </div>
        </div>
      `;
      const dlBtn = document.createElement("button");
      dlBtn.type = "button";
      dlBtn.className = "run-btn";
      dlBtn.textContent = "MP3をダウンロード";
      dlBtn.addEventListener("click", () => downloadFile(mp3File));
      resultArea.querySelector(".result-card").appendChild(dlBtn);
    } catch (err) {
      statusEl.textContent = "";
      resultArea.innerHTML = `<p style="color:red;">書き出しに失敗しました。もう一度お試しください。</p>`;
    }

    exportBtn.disabled = false;
    backBtn.disabled = false;
    previewBtn.disabled = false;
  });
})();

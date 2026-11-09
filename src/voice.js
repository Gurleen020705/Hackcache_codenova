const locale = (language) => ({ en: 'en-IN', hi: 'hi-IN', ta: 'ta-IN', bn: 'bn-IN' })[language] || 'en-IN';

export async function speakWithGnani(text, language = 'en') {
  const response = await fetch('/api/voice/synthesize', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, language }),
  });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Gnani speech is unavailable.');
  const audio = new Audio(URL.createObjectURL(await response.blob()));
  audio.onended = () => URL.revokeObjectURL(audio.src);
  await audio.play();
  return audio;
}

export function speakWithBrowser(text, language = 'en') {
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = locale(language);
  speechSynthesis.speak(utterance);
}

async function toWav(recordedAudio) {
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await recordedAudio.arrayBuffer());
    const sourceRate = decoded.sampleRate;
    const targetRate = Math.min(sourceRate, 44100);
    const ratio = sourceRate / targetRate;
    const samples = new Float32Array(Math.ceil(decoded.length / ratio));
    for (let i = 0; i < samples.length; i++) {
      const sourceIndex = i * ratio;
      let value = 0;
      for (let channel = 0; channel < decoded.numberOfChannels; channel++) value += decoded.getChannelData(channel)[Math.floor(sourceIndex)] || 0;
      samples[i] = value / decoded.numberOfChannels;
    }
    const wav = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(wav);
    const write = (offset, value) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
    write(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); write(8, 'WAVE'); write(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, targetRate, true); view.setUint32(28, targetRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    write(36, 'data'); view.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i++) { const value = Math.max(-1, Math.min(1, samples[i])); view.setInt16(44 + i * 2, value < 0 ? value * 32768 : value * 32767, true); }
    return new Blob([wav], { type: 'audio/wav' });
  } finally { await context.close(); }
}

export async function recordAndTranscribe(language = 'en', durationMs = 7000) {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error('Microphone recording is not supported in this browser.');
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  try {
    const preferred = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/mp4'].find((type) => MediaRecorder.isTypeSupported(type));
    const recorder = new MediaRecorder(stream, preferred ? { mimeType: preferred } : undefined);
    const chunks = [];
    const stopped = new Promise((resolve, reject) => {
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => reject(new Error('Microphone recording failed.'));
      recorder.onstop = resolve;
    });
    recorder.start();
    await new Promise((resolve) => setTimeout(resolve, durationMs));
    if (recorder.state !== 'inactive') recorder.stop();
    await stopped;
    const blob = await toWav(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }));
    const audio = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
      reader.onerror = () => reject(new Error('Could not read microphone recording.'));
      reader.readAsDataURL(blob);
    });
    const response = await fetch('/api/voice/transcribe', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio, mimeType: blob.type, language }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Gnani speech recognition failed.');
    if (!result.transcript) throw new Error('No speech was detected. Please try again.');
    return result.transcript;
  } finally { stream.getTracks().forEach((track) => track.stop()); }
}

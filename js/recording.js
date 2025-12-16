import { updateGalleryUI, addMediaToGallery } from './gallery.js';

let mediaRecorder;
let recordedChunks = [];
let recordStartTime;
let timerInterval;
let isRecording = false;
let isReadyToStop = false;

// FFmpeg State
let ffmpegInstance = null; 
let ffmpegLoaded = false; // Neuer Status, um .load() nur einmal aufzurufen

// Korrekte ESM-Pfade und gleiche Version 0.12.10
const FFmpegModuleUrl = 'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js';
const FFmpegCoreUrl = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/ffmpeg-core.js'; 

// UI Elemente
const btnCapture = document.getElementById('btn-capture');
const recInfo = document.getElementById('rec-info');
const msg = document.getElementById('msg');
const msgContainer = document.getElementById('msg-container');

// --- Audio Helper (FIX: AR-Audio ID) ---
function getAudioStream() {
    // Hole das Audio-Element mit der ID 'ar-audio'
    const audioEl = document.getElementById('ar-audio');
    if (audioEl && !audioEl.paused) {
        // Erstelle einen MediaStreamSource für MediaRecorder
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const source = audioCtx.createMediaElementSource(audioEl);
        const destination = audioCtx.createMediaStreamDestination();
        source.connect(destination);
        return destination.stream;
    }
    return null;
}

// --- FFmpeg Management (Dynamischer ESM-Import) ---
async function ensureFFmpeg() {
    try {
        // Bereits initialisiert?
        if (ffmpegInstance) {
            if (!ffmpegLoaded) {
                // Nur laden, wenn Instanz da, aber noch nicht geladen
                await ffmpegInstance.load();
                ffmpegLoaded = true;
            }
            return ffmpegInstance;
        }

        // 1) Versuche globalen FFmpeg-Namespace (falls später lokal gehostet)
        if (window.FFmpeg?.createFFmpeg) {
            ffmpegInstance = window.FFmpeg.createFFmpeg({ log: false });
        } else {
            // 2) Dynamischer ESM-Import von jsDelivr
            const { createFFmpeg } = await import(FFmpegModuleUrl);
            ffmpegInstance = createFFmpeg({
                log: false,
                corePath: FFmpegCoreUrl // Wichtig: Version 0.12.10
            });
        }

        await ffmpegInstance.load();
        ffmpegLoaded = true;
        return ffmpegInstance;

    } catch (e) {
        console.warn('FFmpeg.js Laden/Initialisierung fehlgeschlagen:', e);
        // Fehlerstatus markieren, um erneutes Laden zu verhindern
        ffmpegInstance = null; 
        ffmpegLoaded = false;
        return null; // sorgt dafür, dass auf WebM-Fallback zurückgefallen wird
    }
}

// --- Video/Timer Management ---
function updateTimer() {
    const elapsed = Date.now() - recordStartTime;
    const totalSeconds = Math.floor(elapsed / 1000);
    const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
    const seconds = String(totalSeconds % 60).padStart(2, '0');
    recInfo.textContent = `${minutes}:${seconds}`;
    recInfo.style.display = 'block';

    if (totalSeconds >= 600) { // Max 10 Minuten
        stopRecording();
    }
}

function startRecording(videoStream) {
    if (isRecording) return;
    
    isReadyToStop = false; 
    recordedChunks = [];
    
    // Audio Stream holen und mit Video Stream kombinieren
    const audioStream = getAudioStream();
    let combinedStream;

    if (audioStream) {
        // Kombiniere Video- und Audio-Tracks
        combinedStream = new MediaStream();
        videoStream.getVideoTracks().forEach(track => combinedStream.addTrack(track));
        audioStream.getAudioTracks().forEach(track => combinedStream.addTrack(track));
    } else {
        combinedStream = videoStream;
    }

    const options = { mimeType: 'video/webm; codecs=vp9' };

    try {
        mediaRecorder = new MediaRecorder(combinedStream, options);
    } catch (e) {
        console.warn('VP9 Codec nicht unterstützt, Fallback auf Standard WebM.', e);
        mediaRecorder = new MediaRecorder(combinedStream, { mimeType: 'video/webm' });
    }

    mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
            recordedChunks.push(event.data);
        }
    };

    mediaRecorder.onstop = () => {
        processVideoChunks();
        // Streams manuell beenden
        combinedStream.getTracks().forEach(track => track.stop());
    };

    mediaRecorder.start();
    isRecording = true;
    recordStartTime = Date.now();
    btnCapture.classList.add('recording');
    timerInterval = setInterval(updateTimer, 1000);
    msg.textContent = 'Videoaufnahme läuft...';

    setTimeout(() => isReadyToStop = true, 500); 
}

function stopRecording() {
    if (!isRecording || !isReadyToStop) return;
    
    isRecording = false;
    clearInterval(timerInterval);
    recInfo.style.display = 'none';
    btnCapture.classList.remove('recording');
    msg.textContent = 'Verarbeite Video...';

    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
    }
}

async function processVideoChunks() {
    if (recordedChunks.length === 0) {
        msg.textContent = 'Videoaufnahme leer.';
        return;
    }

    const blob = new Blob(recordedChunks, { type: 'video/webm' });
    const videoUrl = URL.createObjectURL(blob);
    const filenameBase = `AR_Video_${Date.now()}`;
    const filenameWebm = `${filenameBase}.webm`;

    // Füge WebM-Datei immer zur Galerie hinzu (als Fallback)
    addMediaToGallery({
        type: 'video',
        url: videoUrl,
        filename: filenameWebm,
        date: new Date(),
        blob: blob
    });
    updateGalleryUI();
    msg.textContent = 'WebM Video gespeichert.';

    // Optional: MP4 Konvertierung starten
    await convertToMp4(blob, filenameBase);

    // Abschließende Nachricht nach Abschluss beider Prozesse
    msg.textContent = 'Aufnahme abgeschlossen.';
}

async function convertToMp4(webmBlob, filenameBase) {
    const ffmpeg = await ensureFFmpeg();
    if (!ffmpeg) {
        msg.textContent = 'MP4 Konvertierung übersprungen (FFmpeg nicht geladen).';
        return;
    }

    msg.textContent = 'Konvertiere zu MP4 (kann dauern)...';
    msgContainer.style.background = '#005f73'; // Visuelles Feedback für langen Prozess

    try {
        const inputFilename = 'input.webm';
        const outputFilename = `${filenameBase}.mp4`;
        
        ffmpeg.FS('writeFile', inputFilename, new Uint8Array(await webmBlob.arrayBuffer()));

        // Führe Konvertierung aus
        await ffmpeg.run('-i', inputFilename, '-c:v', 'libx264', '-crf', '23', '-preset', 'fast', '-pix_fmt', 'yuv420p', outputFilename);

        const data = ffmpeg.FS('readFile', outputFilename);
        const mp4Blob = new Blob([data.buffer], { type: 'video/mp4' });
        const mp4Url = URL.createObjectURL(mp4Blob);

        addMediaToGallery({
            type: 'video',
            url: mp4Url,
            filename: outputFilename,
            date: new Date(),
            blob: mp4Blob
        });
        updateGalleryUI();
        msg.textContent = 'MP4 Video gespeichert.';
    } catch(e) {
        console.error("FFmpeg Konvertierungsfehler:", e);
        msg.textContent = 'MP4 Konvertierung fehlgeschlagen.';
    } finally {
        try {
            ffmpeg.FS('unlink', 'input.webm');
        } catch(e) {/* ignore */ }
        msgContainer.style.background = 'rgba(0,0,0,0.55)'; 
    }
}

// --- Extern zugängliche Funktionen ---

function initRecording() {
    let longPressTimeout;
    const LONG_PRESS_THRESHOLD = 500; 

    const handleStart = (e) => {
        e.preventDefault(); 
        if (isRecording) {
            stopRecording();
            return;
        }

        recordStartTime = Date.now(); 
        longPressTimeout = setTimeout(() => {
            if (!isRecording) {
                const canvas = document.getElementById('ar-scene-element');
                if (canvas) {
                    const videoStream = canvas.captureStream(60); 
                    startRecording(videoStream);
                } else {
                    console.error("AR Canvas nicht gefunden.");
                }
            }
        }, LONG_PRESS_THRESHOLD);
    };

    const handleEnd = (e) => {
        e.preventDefault();
        clearTimeout(longPressTimeout);

        if (!isRecording && (Date.now() - recordStartTime) < LONG_PRESS_THRESHOLD) {
            takeScreenshot();
        }
    };
    
    btnCapture.addEventListener('touchstart', handleStart, { passive: false });
    btnCapture.addEventListener('touchend', handleEnd, { passive: false });
    btnCapture.addEventListener('mousedown', handleStart);
    btnCapture.addEventListener('mouseup', handleEnd);
}

function stopRecordingOnARSessionEnd() {
    if (isRecording) {
        stopRecording();
    }
}

function takeScreenshot() {
    const canvas = document.getElementById('ar-scene-element');
    if (!canvas) {
        msg.textContent = "Screenshot fehlgeschlagen.";
        return;
    }

    msg.textContent = "Foto aufgenommen.";
    btnCapture.classList.add('snap');
    setTimeout(() => btnCapture.classList.remove('snap'), 180);

    canvas.toBlob((blob) => {
        if (!blob) return;

        const filename = `AR_Foto_${Date.now()}.jpg`;
        const url = URL.createObjectURL(blob);

        addMediaToGallery({
            type: 'image',
            url: url,
            filename: filename,
            date: new Date(),
            blob: blob
        });
        updateGalleryUI();

    }, 'image/jpeg', 0.95); 
}

export { initRecording, stopRecordingOnARSessionEnd };

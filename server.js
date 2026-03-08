const express = require('express');
const cors = require('cors');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

// Configure FFmpeg
ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
app.use(cors());

app.get('/', (req, res) => {
    res.send('Video Persona Backend is Running 🚀');
});

// Directories
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const OUTPUT_DIR = path.join(__dirname, 'public', 'output');
const TEMP_DIR = path.join(__dirname, 'temp');

[UPLOADS_DIR, OUTPUT_DIR, TEMP_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Configure Task Queue
const taskQueue = [];
let isProcessingQueue = false;

const processQueue = async () => {
    if (isProcessingQueue || taskQueue.length === 0) return;

    isProcessingQueue = true;
    const task = taskQueue.shift();

    // Update queue position for remaining tasks
    taskQueue.forEach((t, i) => {
        if (t.notifyPosition) t.notifyPosition(i + 1);
    });

    try {
        await task.execute();
    } catch (err) {
        console.error("Queue Task Error:", err);
    } finally {
        isProcessingQueue = false;
        processQueue(); // Process next in queue
    }
};

// Multer
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});

const upload = multer({ storage });

app.post('/api/process-video-stream', upload.single('doctorImage'), async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const sendEvent = (event, data) => {
        if (!res.writableEnded) {
            res.write(`event: ${event}\n`);
            res.write(`data: ${JSON.stringify(data)}\n\n`);
        }
    };

    const heartbeat = setInterval(() => {
        if (!res.writableEnded) res.write(': keep-alive\n\n');
    }, 15000);

    let isRequestActive = true;

    res.on('close', () => {
        clearInterval(heartbeat);
        isRequestActive = false;
    });
    res.on('finish', () => {
        clearInterval(heartbeat);
        isRequestActive = false;
    });

    const runGenerationTask = async () => {
        if (!isRequestActive) {
            console.log("⚠️ Client disconnected. Skipping queued video task.");
            // Clean up the uploaded file if we skip
            if (req.file && req.file.path && fs.existsSync(req.file.path)) {
                fs.unlinkSync(req.file.path);
            }
            return;
        }

        try {
            console.log("🚀 Starting Dynamic Video Generation...");
            sendEvent('progress', { percent: 5, status: 'Processing started...' });

            // 1. Extract and Validate Parameters
            const isPortrait = req.body.isPortrait === 'true';
            const templateId = req.body.templateId || 'default';
            const VIDEO_WIDTH = isPortrait ? 1080 : 1920;
            const VIDEO_HEIGHT = isPortrait ? 1920 : 1080;

            let staticVideoSrc = req.body.staticVideoSrc;
            const dynamicVideoSrc = req.body.dynamicVideoSrc;
            const gender = req.body.gender || 'Female';

            if (templateId === 'womens_day') {
                staticVideoSrc = gender === 'Male'
                    ? 'Woman day video static video Male.mp4'
                    : 'Woman day video static video Female.mp4';
            }

            const dynamicVideoPath = path.join(__dirname, 'public', 'videos', dynamicVideoSrc);
            const staticVideoPath = staticVideoSrc ? path.join(__dirname, 'public', 'videos', staticVideoSrc) : null;

            if (!fs.existsSync(dynamicVideoPath)) {
                throw new Error(`Dynamic video segment not found: ${dynamicVideoSrc}`);
            }

            const overlayImagePath = req.file.path;
            const overlayX_Pct = parseFloat(req.body.overlayX) || 0;
            const overlayY_Pct = parseFloat(req.body.overlayY) || 0;

            const imageX = Math.round(overlayX_Pct * VIDEO_WIDTH);
            const imageY = Math.round(overlayY_Pct * VIDEO_HEIGHT);

            const doctorName = req.body.doctorName || 'Doctor';
            const sanitizedName = doctorName.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_');
            const requestId = Date.now();
            const outputFilename = `${sanitizedName}-${requestId}.mp4`;
            const finalOutputPath = path.join(OUTPUT_DIR, outputFilename);
            const tempOverlayPath = path.join(TEMP_DIR, `overlay-${requestId}.mp4`);

            console.log(`🎬 Template: ${templateId}, Portrait: ${isPortrait}`);
            console.log(`📍 Overlay At: ${imageX}px, ${imageY}px`);

            // 2. STAGE 1: Render Overlay on Dynamic Slide
            sendEvent('progress', { percent: 15, status: 'Adding overlay to dynamic segment...' });

            const renderOverlay = () => {
                return new Promise((resolve, reject) => {
                    ffmpeg(dynamicVideoPath)
                        .input(overlayImagePath)
                        .complexFilter([
                            {
                                filter: 'overlay',
                                options: { x: imageX, y: imageY },
                                inputs: ['0:v', '1:v'],
                                outputs: 'v_out'
                            }
                        ])
                        .outputOptions([
                            '-map [v_out]',
                            '-map 0:a?', // Map audio if exists
                            '-c:v libx264',
                            '-preset ultrafast', // Use lowest CPU/Memory possible
                            '-crf 30',           // Higher compression
                            '-threads 1',        // Reduce memory overhead
                            '-pix_fmt yuv420p'
                        ])
                        .on('start', (cmd) => console.log('FFmpeg Overlay Start'))
                        .on('progress', (p) => {
                            // Progress for this segment (roughly 15-50% of total)
                            const subPercent = 15 + (parseInt(p.percent) || 0) * 0.35;
                            sendEvent('progress', { percent: Math.round(subPercent), status: 'Rendering personalized slide...' });
                        })
                        .on('end', resolve)
                        .on('error', (err) => {
                            console.error('Overlay Error:', err);
                            reject(new Error(`Overlay failed: ${err.message}`));
                        })
                        .save(tempOverlayPath);
                });
            };

            await renderOverlay();

            // 3. STAGE 2: Concatenate with Static Intro (if needed)
            if (staticVideoPath && fs.existsSync(staticVideoPath)) {
                sendEvent('progress', { percent: 60, status: 'Merging segments...' });

                await new Promise((resolve, reject) => {
                    // Using complex filter for concatenation - more robust for different durations
                    ffmpeg(staticVideoPath)
                        .input(tempOverlayPath)
                        .complexFilter([
                            {
                                filter: 'concat',
                                options: { n: 2, v: 1, a: 1 },
                                inputs: ['0:v', '0:a', '1:v', '1:a'],
                                outputs: ['v_final', 'a_final']
                            }
                        ])
                        .outputOptions([
                            '-map [v_final]',
                            '-map [a_final]',
                            '-c:v libx264',
                            '-preset ultrafast', // Use lowest CPU/Memory possible
                            '-crf 30',           // Higher compression
                            '-threads 1',        // Reduce memory overhead
                            '-y'
                        ])
                        .on('progress', (p) => {
                            const subPercent = 60 + (parseInt(p.percent) || 0) * 0.35;
                            sendEvent('progress', { percent: Math.round(subPercent), status: 'Finalizing video merge...' });
                        })
                        .on('end', resolve)
                        .on('error', (err) => {
                            console.error('Concat Error:', err);
                            reject(new Error(`Concatenation failed: ${err.message}`));
                        })
                        .save(finalOutputPath);
                });
            } else {
                // No intro, just move the overlay result to output
                fs.renameSync(tempOverlayPath, finalOutputPath);
            }

            // 4. Cleanup and Respond
            try {
                if (fs.existsSync(overlayImagePath)) fs.unlinkSync(overlayImagePath);
                if (fs.existsSync(tempOverlayPath)) fs.unlinkSync(tempOverlayPath);
            } catch (e) {
                console.error("Cleanup error:", e);
            }

            const protocol = req.get('host').includes('localhost') ? 'http' : 'https';
            const downloadUrl = `${protocol}://${req.get('host')}/download/${outputFilename}`;

            sendEvent('complete', { url: downloadUrl, name: outputFilename });
            res.end();

        } catch (fatalError) {
            console.error("❌ Fatal Error:", fatalError);
            sendEvent('error', { error: fatalError.message });
            res.end();
        }
    };

    // Add task to queue and notify user
    const positionInQueue = taskQueue.length + (isProcessingQueue ? 1 : 0);

    taskQueue.push({
        execute: runGenerationTask,
        notifyPosition: (pos) => {
            if (isRequestActive) {
                sendEvent('progress', { percent: 1, status: `Waiting in queue... Position: ${pos}` });
            }
        }
    });

    if (positionInQueue > 0) {
        sendEvent('progress', { percent: 1, status: `Waiting in queue... Position: ${positionInQueue}` });
        console.log(`⏳ Request queued. Position: ${positionInQueue}`);
    }

    processQueue();
});

// Download endpoint - sends file and deletes it
app.get('/download/:filename', (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(OUTPUT_DIR, filename);

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'File not found' });
    }

    res.download(filePath, filename, (err) => {
        if (err) {
            // If the user canceled the download or closed the connection, it's not a fatal server error
            if (err.code === 'ECONNABORTED' || err.message === 'Request aborted') {
                console.log(`⚠️ Download aborted by client: ${filename}`);
            } else {
                console.error('Download error:', err);
            }
        }

        // Regardless of success or abortion, try to delete the temporary file to free space
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                console.log(`🗑️  Deleted temporary video: ${filename}`);
            }
        } catch (e) {
            console.error('Delete error:', e);
        }
    });
});

app.use('/output', express.static(OUTPUT_DIR));

const PORT = process.env.PORT || 3001;
const server = app.listen(PORT, () => {
    console.log(`🚀 High-Performance Video Generator running on port ${PORT}`);
});

// Set timeouts to 10 minutes to support long video rendering
server.setTimeout(10 * 60 * 1000);
server.keepAliveTimeout = 120 * 1000;
server.headersTimeout = 120 * 1000;

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

// Import Remotion render helper
const { renderLastSlide } = require('./remotion/render.js');

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

app.post('/api/process-video-stream', upload.fields([
    { name: 'doctorImage', maxCount: 1 },
    { name: 'doctorNameImage', maxCount: 1 }
]), async (req, res) => {
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
            // Clean up files if we skip
            if (req.files) {
                Object.values(req.files).flat().forEach(f => {
                    if (fs.existsSync(f.path)) fs.unlinkSync(f.path);
                });
            }
            return;
        }

        try {
            console.log("🚀 Starting Dynamic Video Generation...");
            sendEvent('progress', { percent: 5, status: 'Processing started...' });

            // Extract files (already uploaded by the route-level handler)
            const doctorImageFile = req.files && req.files['doctorImage'] ? req.files['doctorImage'][0] : null;
            const nameImageFile = req.files && req.files['doctorNameImage'] ? req.files['doctorNameImage'][0] : null;

            if (!doctorImageFile) {
                return res.status(400).json({ error: 'Doctor photo is required' });
            }

            // Extract parameters
            const isPortrait = req.body.isPortrait === 'true';
            const templateId = req.body.templateId || 'default';
            const VIDEO_WIDTH = isPortrait ? 1080 : 1920;
            const VIDEO_HEIGHT = isPortrait ? 1920 : 1080;
            const gender = req.body.gender || 'Female';
            const overlayX_Pct = parseFloat(req.body.overlayX) || 0;
            const overlayY_Pct = parseFloat(req.body.overlayY) || 0;
            const imageX = Math.round(overlayX_Pct * VIDEO_WIDTH);
            const imageY = Math.round(overlayY_Pct * VIDEO_HEIGHT);
            const doctorName = req.body.doctorName || 'Doctor';

            let staticVideoSrc = req.body.staticVideoSrc;
            const dynamicVideoSrc = req.body.dynamicVideoSrc;

            if (templateId === 'womens_day') {
                staticVideoSrc = gender === 'Male'
                    ? 'Woman day video static video Male.mp4'
                    : 'Woman day video static video Female.mp4';
            }

            const dynamicVideoPath = path.join(__dirname, 'public', 'videos', dynamicVideoSrc);
            const staticVideoPath = staticVideoSrc ? path.join(__dirname, 'public', 'videos', staticVideoSrc) : null;
            
            if (!fs.existsSync(dynamicVideoPath)) {
                return res.status(400).json({ error: `Dynamic video segment not found: ${dynamicVideoSrc}` });
            }

            const sanitizedName = doctorName.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_');
            const requestId = Date.now();
            const outputFilename = `${sanitizedName}-${requestId}.mp4`;
            const finalOutputPath = path.join(OUTPUT_DIR, outputFilename);
            const tempOverlayPath = path.join(TEMP_DIR, `overlay-${requestId}.mp4`);

            // 2. STAGE 1: Render Animated Overlay on Dynamic Slide using Remotion
            sendEvent('progress', { percent: 15, status: 'Generating animated slide with Remotion...' });

            const tempAssets = [];
            let photoUrl = ""; 
            let nameImageUrl = "";

            if (doctorImageFile) {
                 const photoFilename = `photo-${Date.now()}-${path.basename(doctorImageFile.path)}`;
                 const dest = path.join(OUTPUT_DIR, photoFilename);
                 fs.copyFileSync(doctorImageFile.path, dest);
                 photoUrl = `output/${photoFilename}`;
                 tempAssets.push(dest);
            }

            if (nameImageFile) {
                 const nameFilename = `name-${Date.now()}-${path.basename(nameImageFile.path)}`;
                 const dest = path.join(OUTPUT_DIR, nameFilename);
                 fs.copyFileSync(nameImageFile.path, dest);
                 nameImageUrl = `output/${nameFilename}`;
                 tempAssets.push(dest);
            }

            const relativeVideoPath = `videos/${path.basename(dynamicVideoPath)}`;

            console.log("Remotion Args (Multi-Asset):", { doctorName, photoUrl, nameImageUrl, imageX, imageY, relativeVideoPath });

            await renderLastSlide({
                doctorName,
                photoUrl,
                nameImageUrl,
                theme: templateId || 'womens_day',
                imageX,
                imageY,
                backgroundVideoPath: relativeVideoPath,
                outputPath: tempOverlayPath
            });

            // Cleanup local copies in public/
            tempAssets.forEach(f => {
                if (fs.existsSync(f)) fs.unlinkSync(f);
            });

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
                if (fs.existsSync(tempOverlayPath)) fs.unlinkSync(tempOverlayPath);
            } catch (e) {
                console.error("Cleanup error:", e);
            }

            const protocol = req.get('host').includes('localhost') ? 'http' : 'https';
            const downloadUrl = `${protocol}://${req.get('host')}/download/${outputFilename}`;

            sendEvent('complete', { url: downloadUrl, name: outputFilename });

        } catch (fatalError) {
            console.error("❌ Fatal Error:", fatalError);
            sendEvent('error', { error: fatalError.message });
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

    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'video/mp4');

    const fileStream = fs.createReadStream(filePath);

    fileStream.on('open', () => {
        fileStream.pipe(res);
    });

    fileStream.on('error', (err) => {
        console.error('File stream error:', err);
        if (!res.headersSent) res.status(500).json({ error: 'Stream error' });
    });

    res.on('close', () => {
        // Stop streaming if client disconnects
        if (!fileStream.destroyed) {
            fileStream.destroy();
        }

        // Always delete the temp file
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

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

app.post('/api/render-slide', upload.fields([
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
    res.on('close', () => { clearInterval(heartbeat); isRequestActive = false; });
    res.on('finish', () => { clearInterval(heartbeat); isRequestActive = false; });

    const runRenderTask = async () => {
        if (!isRequestActive) {
            if (req.files) {
                Object.values(req.files).flat().forEach(f => {
                    if (fs.existsSync(f.path)) fs.unlinkSync(f.path);
                });
            }
            return;
        }

        try {
            console.log("🚀 Starting Slide Rendering...");
            sendEvent('progress', { percent: 5, status: 'Processing started...' });

            const doctorImageFile = req.files && req.files['doctorImage'] ? req.files['doctorImage'][0] : null;
            const nameImageFile = req.files && req.files['doctorNameImage'] ? req.files['doctorNameImage'][0] : null;

            if (!doctorImageFile) throw new Error('Doctor photo is required');

            const isPortrait = req.body.isPortrait === 'true';
            const templateId = req.body.templateId || 'default';
            const VIDEO_WIDTH = isPortrait ? 1080 : 1920;
            const VIDEO_HEIGHT = isPortrait ? 1920 : 1080;
            const overlayX_Pct = parseFloat(req.body.overlayX) || 0;
            const overlayY_Pct = parseFloat(req.body.overlayY) || 0;
            const imageX = Math.round(overlayX_Pct * VIDEO_WIDTH);
            const imageY = Math.round(overlayY_Pct * VIDEO_HEIGHT);
            const doctorName = req.body.doctorName || 'Doctor';
            const dynamicVideoSrc = req.body.dynamicVideoSrc;

            const relativeVideoPath = `videos/${dynamicVideoSrc}`;
            const requestId = Date.now();
            const tempOverlayPath = path.join(TEMP_DIR, `overlay-5s-${requestId}.mp4`);

            // Save assets temporarily for Remotion
            const photoFilename = `photo-${requestId}-${path.basename(doctorImageFile.path)}`;
            const photoDest = path.join(OUTPUT_DIR, photoFilename);
            fs.copyFileSync(doctorImageFile.path, photoDest);
            const photoUrl = `output/${photoFilename}`;

            let nameImageUrl = "";
            if (nameImageFile) {
                const nameFilename = `name-${requestId}-${path.basename(nameImageFile.path)}`;
                const nameDest = path.join(OUTPUT_DIR, nameFilename);
                fs.copyFileSync(nameImageFile.path, nameDest);
                nameImageUrl = `output/${nameFilename}`;
            }

            sendEvent('progress', { percent: 15, status: 'Generating 5s animated slide...' });

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

            // Cleanup upload files (but keep the copied output assets for now)
            if (req.files) {
                Object.values(req.files).flat().forEach(f => {
                    if (fs.existsSync(f.path)) fs.unlinkSync(f.path);
                });
            }

            sendEvent('complete', { requestId, tempOverlayPath });
            res.end();

        } catch (fatalError) {
            console.error("❌ Fatal Error:", fatalError);
            sendEvent('error', { error: fatalError.message });
        }
    };

    taskQueue.push({ execute: runRenderTask });
    processQueue();
});

app.post('/api/merge-video', express.json(), async (req, res) => {
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

    const runMergeTask = async () => {
        const heartbeat = setInterval(() => {
            if (!res.writableEnded) res.write(': keep-alive\n\n');
        }, 15000);

        res.on('close', () => { clearInterval(heartbeat); });
        res.on('finish', () => { clearInterval(heartbeat); });

        try {
            const { requestId, doctorName, gender, templateId } = req.body;
            const tempOverlayPath = path.join(TEMP_DIR, `overlay-5s-${requestId}.mp4`);
            const normOverlayPath = path.join(TEMP_DIR, `norm-overlay-${requestId}.mp4`);
            const listPath = path.join(TEMP_DIR, `list-${requestId}.txt`);
            
            let staticVideoSrc = req.body.staticVideoSrc;
            if (templateId === 'womens_day') {
                staticVideoSrc = gender === 'Male'
                    ? 'Woman day video static video Male.mp4'
                    : 'Woman day video static video Female.mp4';
            }
            const staticVideoPath = path.join(__dirname, 'public', 'videos', staticVideoSrc);
            
            const sanitizedName = doctorName.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_');
            const outputFilename = `${sanitizedName}-${requestId}.mp4`;
            const finalOutputPath = path.join(OUTPUT_DIR, outputFilename);

            if (!fs.existsSync(tempOverlayPath)) throw new Error("Slide animation not found. Please render again.");

            sendEvent('progress', { percent: 20, status: 'Normalizing slide for merge...' });

            await new Promise((resolve, reject) => {
                ffmpeg(tempOverlayPath)
                    .outputOptions([
                        '-map 0:a', // Force Audio to #0:0
                        '-map 0:v', // Force Video to #0:1
                        '-c:v libx264',
                        '-preset superfast',
                        '-pix_fmt yuv420p',
                        '-profile:v main',
                        '-vf scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2',
                        '-r 30',
                        '-video_track_timescale 30000',
                        '-c:a aac',
                        '-ar 48000',
                        '-ac 2',
                        '-threads 1'
                    ])
                    .on('error', reject)
                    .on('end', resolve)
                    .save(normOverlayPath);
            });

            sendEvent('progress', { percent: 70, status: 'Joining segments (Fast)...' });

            const listContent = `file '${staticVideoPath.replace(/\\/g, '/')}'\nfile '${normOverlayPath.replace(/\\/g, '/')}'`;
            fs.writeFileSync(listPath, listContent);

            await new Promise((resolve, reject) => {
                ffmpeg()
                    .input(listPath)
                    .inputOptions(['-f concat', '-safe 0'])
                    .outputOptions([
                        '-map 0:0', // Resulting Audio
                        '-map 0:1', // Resulting Video
                        '-c copy', 
                        '-movflags +faststart'
                    ])
                    .on('error', reject)
                    .on('end', resolve)
                    .save(finalOutputPath);
            });

            // Cleanup
            [tempOverlayPath, normOverlayPath, listPath].forEach(f => { if (fs.existsSync(f)) fs.unlinkSync(f); });

            const protocol = req.get('host').includes('localhost') ? 'http' : 'https';
            const downloadUrl = `${protocol}://${req.get('host')}/download/${outputFilename}`;
            sendEvent('complete', { url: downloadUrl, name: outputFilename });
            res.end();

        } catch (error) {
            console.error("Merge error:", error);
            sendEvent('error', { error: error.message });
        }
    };

    taskQueue.push({ execute: runMergeTask });
    processQueue();
});

app.post('/api/process-video-stream', (req, res) => {
    res.status(410).json({ error: "This endpoint is deprecated. Use /api/render-slide and /api/merge-video instead." });
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

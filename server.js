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

    // Heartbeat to prevent timeouts
    const heartbeat = setInterval(() => {
        if (!res.writableEnded) res.write(': keep-alive\n\n');
    }, 15000);

    // Clean up heartbeat on finish/close
    res.on('close', () => clearInterval(heartbeat));
    res.on('finish', () => clearInterval(heartbeat));

    try {
        console.log("🚀 Starting Video Generation...");
        sendEvent('progress', { percent: 0, status: 'Starting...' });

        const doctorName = req.body.doctorName || "Dr. Name";
        const originalImagePath = req.file.path;
        const videoPath = path.join(__dirname, 'public', 'videos', 'Empagliflozin video.mp4');

        if (!fs.existsSync(videoPath)) {
            sendEvent('error', { error: "Base video not found." });
            return res.end();
        }

        sendEvent('progress', { percent: 10, status: 'Processing image...' });

        sendEvent('progress', { percent: 25, status: 'Merging video...' });

        const VIDEO_WIDTH = 1920;
        const VIDEO_HEIGHT = 1080;

        let overlayX_Pct = parseFloat(req.body.overlayX) || 0.75;
        const overlayY_Pct = parseFloat(req.body.overlayY) || 0.6;

        console.log(`📍 Received position: X=${overlayX_Pct}, Y=${overlayY_Pct}`);

        // Simple positioning - server just trusts the x/y
        const imageX = Math.round(overlayX_Pct * VIDEO_WIDTH);
        const imageY = Math.round(overlayY_Pct * VIDEO_HEIGHT);

        console.log(`📍 Calculated pixels: X=${imageX}px, Y=${imageY}px`);

        // --- Robust FFmpeg Implementation (Restored with Fixes) ---
        const fontPath = path.join(__dirname, 'fonts', 'arial.ttf');

        // 1. Validation
        if (!fs.existsSync(fontPath)) {
            console.error(`❌ CRITICAL: Font missing at ${fontPath}`);
        }

        // 2. Constants & Helpers
        const outputFilename = `video-${Date.now()}.mp4`;
        const outputPath = path.join(OUTPUT_DIR, outputFilename);

        // Helper: Sanitize paths - Just normalize slashes
        const sanitizePath = (p) => p.split(path.sep).join('/');

        // --- Client-Side Strategy ---
        // The frontend sends a ready-made PNG with photo+text. We just overlay it.
        const overlayImagePath = req.file.path;

        // 3. Render Function (Simplified "Stamper" Mode)
        const renderVideo = async () => {
            return new Promise((resolve, reject) => {

                // Extremely Simple Filter: Video + Image -> Output
                const filterChain = [
                    {
                        filter: 'overlay',
                        options: {
                            x: imageX,
                            y: imageY
                        },
                        inputs: ['0:v', '1:v'],
                        outputs: 'v1'
                    }
                ];

                ffmpeg(videoPath)
                    .input(overlayImagePath) // [1:v] - This is now the Full Badge (Photo+Text)
                    .complexFilter(filterChain)
                    .outputOptions([
                        '-map [v1]',         // Map final video output
                        '-map 0:a',          // Map audio from Input 0 (Base Video)
                        '-c:v libx264',
                        '-c:a copy',         // Copy audio without re-encoding (Fast)
                        '-preset ultrafast', // Low Memory
                        '-crf 30',           // Small Size
                        '-threads 1',        // Stability
                        '-movflags +faststart',
                        '-pix_fmt yuv420p',
                        '-y'
                    ])
                    .on('start', (cmd) => {
                        console.log(`🎬 FFmpeg Start (Client Overlay Mode)`);
                        console.log(`Command: ${cmd}`);
                    })
                    .on('progress', (progress) => {
                        const timemark = progress.timemark || '00:00:00';
                        const timeParts = timemark.split(':');
                        let currentSeconds = 0;
                        if (timeParts.length === 3) {
                            currentSeconds = (parseInt(timeParts[0]) || 0) * 3600 + (parseInt(timeParts[1]) || 0) * 60 + (parseFloat(timeParts[2]) || 0);
                        }
                        const duration = 152;
                        const percent = Math.min((currentSeconds / duration) * 100, 100);
                        sendEvent('progress', { percent: Math.round(percent), status: 'Rendering...' });
                    })
                    .on('end', resolve)
                    .on('error', reject)
                    .save(outputPath);
            });
        };

        // Execution
        try {
            await renderVideo();
            console.log('✅ Render Success');
        } catch (err) {
            console.error(`Render Failed: ${err.message}`);
            throw err;
        }

        // 5. Success Response
        const protocol = req.get('host').includes('localhost') ? 'http' : 'https';
        const downloadUrl = `${protocol}://${req.get('host')}/download/${outputFilename}`;

        // Send complete event with warning if text failed
        // Send complete event
        sendEvent('complete', {
            url: downloadUrl,
            name: outputFilename
        });

        // Cleanup
        try {
            // req.file.path is the 'originalImagePath' we assigned to overlayImagePath
            if (fs.existsSync(originalImagePath)) fs.unlinkSync(originalImagePath);
        } catch (e) { console.error("Cleanup error:", e); }

        res.end();

    } catch (fatalError) {
        console.error("❌ Fatal Error:", fatalError);
        // Send the specific error message to help debugging
        sendEvent('error', { error: 'Render failed completely. Details: ' + fatalError.message });
        res.end();
        if (fs.existsSync(textFilePath)) fs.unlinkSync(textFilePath);
    }


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
            console.error('Download error:', err);
        } else {
            try {
                fs.unlinkSync(filePath);
                console.log(`🗑️  Deleted temporary video: ${filename}`);
            } catch (e) {
                console.error('Delete error:', e);
            }
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

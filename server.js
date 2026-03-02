const express = require('express');
const cors = require('cors');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const os = require('os');

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

    const heartbeat = setInterval(() => {
        if (!res.writableEnded) res.write(': keep-alive\n\n');
    }, 15000);

    res.on('close', () => clearInterval(heartbeat));
    res.on('finish', () => clearInterval(heartbeat));

    try {
        console.log("🚀 Starting Dynamic Video Generation...");
        sendEvent('progress', { percent: 5, status: 'Initializing...' });

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

        console.log(`🎬 Template: ${templateId}, Portrait: ${isPortrait}`);
        console.log(`📍 Overlay At: ${imageX}px, ${imageY}px`);

        // 2. STAGE 1: Render Overlay on Dynamic Slide
        const outputFilename = `${sanitizedName}_${requestId}.mp4`;
        const tempOverlayPath = path.join(TEMP_DIR, `overlay_${requestId}.mp4`); // Standard MP4
        const finalOutputPath = path.join(OUTPUT_DIR, outputFilename);

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
                        '-profile:v main',   // Match intro profile
                        '-level:v 4.1',      // Specific level for compatibility
                        '-r 30',             // Match intro FPS
                        '-pix_fmt yuv420p',  // Match intro pixel format
                        '-color_primaries bt709',
                        '-color_trc bt709',
                        '-colorspace bt709',
                        '-video_track_timescale 30000', // CRITICAL: Fixes 41s freeze
                        '-c:a aac',
                        '-ar 48000',
                        '-ac 2',
                        '-preset ultrafast',
                        '-crf 26',
                        '-x264-params "keyint=30:min-keyint=30:scenecut=0"', // CRITICAL: GOP alignment
                        '-threads 1'
                    ])
                    .on('start', (cmd) => console.log('FFmpeg Overlay Start'))
                    .on('progress', (p) => {
                        const subPercent = 15 + (parseInt(p.percent) || 0) * 0.45;
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

        if (staticVideoPath && fs.existsSync(staticVideoPath)) {
            sendEvent('progress', { percent: 70, status: 'Merging segments instantly...' });

            await new Promise((resolve, reject) => {
                const listFilePath = path.join(TEMP_DIR, `concat_${requestId}.txt`);
                // FFmpeg concat demuxer needs forward slashes
                const content = [
                    `file '${staticVideoPath.replace(/\\/g, '/')}'`,
                    `file '${tempOverlayPath.replace(/\\/g, '/')}'`
                ].join('\n');

                fs.writeFileSync(listFilePath, content);

                ffmpeg()
                    .input(listFilePath)
                    .inputOptions(['-f concat', '-safe 0'])
                    .outputOptions([
                        '-c copy',
                        '-movflags +faststart', // Web optimized
                        '-y'
                    ])
                    .on('start', (cmd) => console.log('FFmpeg Concat Start (Stabilized)'))
                    .on('end', () => {
                        if (fs.existsSync(listFilePath)) fs.unlinkSync(listFilePath);
                        if (fs.existsSync(tempOverlayPath)) fs.unlinkSync(tempOverlayPath);
                        resolve();
                    })
                    .on('error', (err) => {
                        if (fs.existsSync(listFilePath)) fs.unlinkSync(listFilePath);
                        if (fs.existsSync(tempOverlayPath)) fs.unlinkSync(tempOverlayPath);
                        console.error('Merge Error:', err);
                        reject(new Error(`Merge failed: ${err.message}`));
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

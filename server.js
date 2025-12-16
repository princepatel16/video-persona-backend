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
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
        console.log("🚀 Starting Video Generation...");
        sendEvent('progress', { percent: 0, status: 'Starting...' });
        
        const doctorName = req.body.doctorName || "Dr. Name";
        const originalImagePath = req.file.path;
        const videoPath = path.join(__dirname, 'public', 'videos', 'hypertension_video english.mp4');
        
        if (!fs.existsSync(videoPath)) {
            sendEvent('error', { error: "Base video not found." });
            return res.end();
        }

        sendEvent('progress', { percent: 10, status: 'Processing image...' });

        // Process image - simple circle without shadow
        const processedImagePath = path.join(TEMP_DIR, `circle-${Date.now()}.png`);
        
        const width = 230;
        const height = 230;
        
        const circleBuffer = Buffer.from(
            `<svg><circle cx="${width/2}" cy="${height/2}" r="${width/2}" /></svg>`
        );

        await sharp(originalImagePath)
            .resize(width, height, { fit: 'cover' })
            .composite([{
                input: circleBuffer,
                blend: 'dest-in'
            }])
            .png()
            .toFile(processedImagePath);

        sendEvent('progress', { percent: 20, status: 'Calculating text box...' });

        // Calculate text box dimensions (must match preview CSS)
        const fontSize = 48;
        const charWidth = fontSize * 0.6; // Approximate character width
        const textWidth = Math.ceil(doctorName.length * charWidth);
        const textPadding = 40; // 20px on each side
        const textBoxWidth = Math.min(Math.max(textWidth + textPadding, 240), 800);
        const textBoxHeight = 80;
        
        // Create dynamic text background
        const textBgPath = path.join(TEMP_DIR, `textbg-${Date.now()}.png`);
        const roundedRectSvg = `
            <svg width="${textBoxWidth}" height="${textBoxHeight}">
                <rect width="${textBoxWidth}" height="${textBoxHeight}" rx="8" ry="8" fill="rgba(0,0,0,0.7)" />
            </svg>
        `;
        
        await sharp(Buffer.from(roundedRectSvg)).png().toFile(textBgPath);

        sendEvent('progress', { percent: 25, status: 'Merging video...' });

        const VIDEO_WIDTH = 1920;
        const VIDEO_HEIGHT = 1080;
        
        let overlayX_Pct = parseFloat(req.body.overlayX) || 0.75;
        const overlayY_Pct = parseFloat(req.body.overlayY) || 0.6;
        
        console.log(`📍 Received position: X=${overlayX_Pct}, Y=${overlayY_Pct}`);
        
        // Simple positioning - no shadow padding
        const imageX = Math.round(overlayX_Pct * VIDEO_WIDTH);
        const imageY = Math.round(overlayY_Pct * VIDEO_HEIGHT);
        
        console.log(`📍 Calculated pixels: X=${imageX}px, Y=${imageY}px`);
        
        const gap = 17;
        const circleCenterX = imageX + 115; // 115 = 230/2
        let textBgX = circleCenterX - (textBoxWidth / 2);
        const textBgY = imageY + 230 + gap;
        
        // Check if text box goes off screen and adjust
        if (textBgX + textBoxWidth > VIDEO_WIDTH) {
            textBgX = VIDEO_WIDTH - textBoxWidth - 10; // 10px margin from edge
            console.log(`⚠️  Text box adjusted to prevent overflow`);
        }
        if (textBgX < 0) {
            textBgX = 10; // 10px margin from left edge
        }
        
        // --- Robust FFmpeg Implementation ---

        // 1. Validation
        if (!fs.existsSync(fontPath)) {
            console.error(`❌ CRITICAL: Font missing at ${fontPath}`);
            // We proceed to try text, but it will likely fail and trigger fallback.
        }

        // 2. Constants & Helpers
        const outputFilename = `video-${Date.now()}.mp4`;
        const outputPath = path.join(OUTPUT_DIR, outputFilename);
        
        // Helper: Sanitize paths for FFmpeg on Linux/Windows
        const sanitizePath = (p) => p.split(path.sep).join('/').replace(/:/g, '\\\\:');
        
        const safeFontPath = sanitizePath(fontPath);
        const textFilePath = path.join(TEMP_DIR, `text-${Date.now()}.txt`);
        const safeTextFilePath = sanitizePath(textFilePath);
        
        // Write text file
        fs.writeFileSync(textFilePath, doctorName);

        // 3. Render Function (Supports Retry)
        const renderVideo = async (withText) => {
            return new Promise((resolve, reject) => {
                let filterChain = [];
                
                // Linear operations: [0:v] -> [v1] -> [v2]
                filterChain.push(`[0:v][2:v]overlay=x=${textBgX}:y=${textBgY}[v1]`);
                filterChain.push(`[v1][1:v]overlay=x=${imageX}:y=${imageY}[v2]`);
                
                if (withText) {
                    // Safe command with quoted paths
                    filterChain.push(`[v2]drawtext=fontfile='${safeFontPath}':textfile='${safeTextFilePath}':fontcolor=white:fontsize=${fontSize}:x=${textBgX}+(${textBoxWidth}-tw)/2:y=${textBgY}+16`);
                }

                ffmpeg(videoPath)
                    .input(processedImagePath)
                    .input(textBgPath)
                    .complexFilter(filterChain)
                    .outputOptions([
                        '-c:v libx264',
                        '-preset ultrafast',
                        '-movflags +faststart',
                        '-pix_fmt yuv420p',
                        '-y'
                    ])
                    .on('start', (cmd) => {
                         console.log(`🎬 FFmpeg Start (${withText ? 'Text' : 'Fallback'})`);
                         console.log(`Filters: ${JSON.stringify(filterChain)}`);
                    })
                    .on('progress', (progress) => {
                        // Progress calculation
                         const timemark = progress.timemark || '00:00:00';
                         const timeParts = timemark.split(':');
                         let currentSeconds = 0;
                         if (timeParts.length === 3) {
                             currentSeconds = (parseInt(timeParts[0])||0)*3600 + (parseInt(timeParts[1])||0)*60 + (parseFloat(timeParts[2])||0);
                         }
                         const duration = 152; 
                         const percent = Math.min((currentSeconds / duration) * 100, 100);
                         sendEvent('progress', { percent: Math.round(percent), status: withText ? 'Rendering...' : 'Rendering (Fallback mode)...' });
                    })
                    .on('end', resolve)
                    .on('error', reject)
                    .save(outputPath);
            });
        };

        // 4. Execution Strategy
        try {
            // Attempt 1: With Text
            try {
                await renderVideo(true);
                console.log('✅ Render Success (With Text)');
            } catch (err) {
                console.error(`⚠️ Text Render Failed: ${err.message}`);
                console.log('🔄 Retrying without text (Fallback)...');
                await renderVideo(false);
                console.log('✅ Render Success (Fallback)');
            }

            // 5. Success Response
            const protocol = req.get('host').includes('localhost') ? 'http' : 'https';
            const downloadUrl = `${protocol}://${req.get('host')}/download/${outputFilename}`;
            
            sendEvent('complete', { url: downloadUrl, name: outputFilename });
            
            // Cleanup
            try {
                if (fs.existsSync(originalImagePath)) fs.unlinkSync(originalImagePath);
                if (fs.existsSync(processedImagePath)) fs.unlinkSync(processedImagePath);
                if (fs.existsSync(textBgPath)) fs.unlinkSync(textBgPath);
                if (fs.existsSync(textFilePath)) fs.unlinkSync(textFilePath);
            } catch (e) { console.error("Cleanup error:", e); }
            
            res.end();

        } catch (fatalError) {
            console.error("❌ Fatal Error:", fatalError);
            sendEvent('error', { error: 'Render failed completely.' });
            res.end();
            if (fs.existsSync(textFilePath)) fs.unlinkSync(textFilePath);
        }

    } catch (error) {
        console.error("❌ Server Error:", error);
        sendEvent('error', { error: error.message });
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
app.listen(PORT, () => {
    console.log(`🚀 High-Performance Video Generator running on port ${PORT}`);
});

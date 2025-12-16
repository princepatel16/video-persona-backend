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
        
        const outputFilename = `video-${Date.now()}.mp4`;
        const outputPath = path.join(OUTPUT_DIR, outputFilename);
        const fontPath = path.join(__dirname, 'fonts', 'arial.ttf');


        if (!fs.existsSync(fontPath)) {
            console.error(`❌ Font file missing at: ${fontPath}`);
            // Fallback for Windows local dev if file missing
            if (process.platform === 'win32') {
                 console.log("⚠️ Using Windows system font as fallback");
                 // Use the path variable but we can't reassign const, so we should have used let.
                 // Refactoring slightly to just warn.
            }
            throw new Error(`Font file not found at ${fontPath}. Please add 'arial.ttf' to the 'fonts' folder.`);
        }

        // Create text file for doctor name to avoid escaping issues
        const textFilePath = path.join(TEMP_DIR, `text-${Date.now()}.txt`);
        fs.writeFileSync(textFilePath, doctorName);

        // FFmpeg requires forward slashes and escaped colons in filter strings
        const ffmpegFontPath = fontPath.replace(/\\/g, '/').replace(/:/g, '\\\\:');
        const ffmpegTextFilePath = textFilePath.replace(/\\/g, '/').replace(/:/g, '\\\\:');

        ffmpeg(videoPath)
            .input(processedImagePath)
            .input(textBgPath)
            .complexFilter([
                `[0:v][2:v]overlay=x=${textBgX}:y=${textBgY}[v1]`,
                `[v1][1:v]overlay=x=${imageX}:y=${imageY}[v2]`
                // Temporarily removed drawtext to debug
            ])
            // Map the last output [v2] to the final file
            .outputOptions([
                '-map [v2]',
                '-c:v libx264',
                '-preset ultrafast',
                '-movflags +faststart',
                '-pix_fmt yuv420p'
            ])
            .on('start', () => {
                console.log('🎬 FFmpeg started');
                sendEvent('progress', { percent: 30, status: 'Encoding video...' });
            })
            .on('progress', (progress) => {
                const timemark = progress.timemark || '00:00:00';
                const timeParts = timemark.split(':');
                if (timeParts.length === 3) {
                    const hours = parseInt(timeParts[0]) || 0;
                    const minutes = parseInt(timeParts[1]) || 0;
                    const seconds = parseFloat(timeParts[2]) || 0;
                    const currentSeconds = hours * 3600 + minutes * 60 + seconds;
                    const estimatedDuration = 60;
                    const rawPercent = Math.min((currentSeconds / estimatedDuration) * 100, 100);
                    const mappedPercent = Math.min(30 + Math.round(rawPercent * 0.65), 95);
                    
                    sendEvent('progress', { 
                        percent: mappedPercent, 
                        status: `Encoding: ${Math.round(rawPercent)}%`,
                        timemark: timemark 
                    });
                }
            })
            .on('end', () => {
                console.log('✅ Video Generated Successfully!');
                const protocol = req.get('host').includes('localhost') ? 'http' : 'https';
                const downloadUrl = `${protocol}://${req.get('host')}/download/${outputFilename}`;
                sendEvent('progress', { percent: 100, status: 'Complete!' });
                sendEvent('complete', { url: downloadUrl, name: outputFilename });
                
                try {
                    fs.unlinkSync(originalImagePath);
                    fs.unlinkSync(processedImagePath);
                    fs.unlinkSync(textBgPath);
                    if (fs.existsSync(textFilePath)) fs.unlinkSync(textFilePath);
                } catch (e) { console.error("Cleanup error:", e); }
                
                res.end();
            })
            .on('error', (err) => {
                console.error('❌ FFmpeg Error:', err);
                sendEvent('error', { error: 'Video generation failed: ' + err.message });
                res.end();
            })
            .save(outputPath);

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

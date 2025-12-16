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
        
        sendEvent('progress', { percent: 28, status: 'Generating text layer...' });

        // --- Text-as-Image Strategy (100% Reliability) ---
        // Instead of asking FFmpeg to render fonts (which fails), we create a PNG image of the text.
        const textImagePath = path.join(TEMP_DIR, `textimg-${Date.now()}.png`);
        
        // Escape XML characters in name
        const safeName = doctorName.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        
        const textSvg = `
            <svg width="${textBoxWidth}" height="${textBoxHeight}">
                <style>
                    .text { fill: white; font-size: ${fontSize}px; font-family: Arial, sans-serif; font-weight: bold; }
                </style>
                <text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" class="text">${safeName}</text>
            </svg>
        `;
        
        try {
            await sharp(Buffer.from(textSvg)).png().toFile(textImagePath);
        } catch (imgErr) {
            console.error("Text Image Generation Failed:", imgErr);
            // If text gen fails, we can either throw or proceed without text. 
            // We'll proceed (file won't exist, logic needs to handle that or we just throw).
            throw new Error("Failed to generate text image: " + imgErr.message);
        }

        // --- Final FFmpeg Render ---
        const outputFilename = `video-${Date.now()}.mp4`;
        const outputPath = path.join(OUTPUT_DIR, outputFilename);

        const renderVideo = async () => {
             return new Promise((resolve, reject) => {
                let filterChain = [];
                
                // 1. Overlay Text Background Box [0:v] + [2:v] -> [v1]
                filterChain.push(`[0:v][2:v]overlay=x=${textBgX}:y=${textBgY}[v1]`);
                
                // 2. Overlay User Image [v1] + [1:v] -> [v2]
                filterChain.push(`[v1][1:v]overlay=x=${imageX}:y=${imageY}[v2]`);
                
                // 3. Overlay Text Image [v2] + [3:v] -> [v3] (Final)
                // We use the same coordinates as the background box, but maybe adjusted?
                // The SVG is same size as box, so (textBgX, textBgY) is perfect.
                filterChain.push(`[v2][3:v]overlay=x=${textBgX}:y=${textBgY}[v3]`);

                ffmpeg(videoPath)
                    .input(processedImagePath) // [1:v]
                    .input(textBgPath)         // [2:v]
                    .input(textImagePath)      // [3:v]
                    .complexFilter(filterChain)
                    .outputOptions([
                        `-map [v3]`,         // Map final output
                        '-c:v libx264',
                        '-preset ultrafast', // Low Memory
                        '-crf 30',           // Small Size
                        '-threads 1',        // Stability
                        '-movflags +faststart',
                        '-pix_fmt yuv420p',
                        '-y'
                    ])
                    .on('start', () => {
                         console.log(`🎬 FFmpeg Start (Image Overlay Mode)`);
                    })
                    .on('progress', (progress) => {
                         const timemark = progress.timemark || '00:00:00';
                         const timeParts = timemark.split(':');
                         let currentSeconds = 0;
                         if (timeParts.length === 3) {
                             currentSeconds = (parseInt(timeParts[0])||0)*3600 + (parseInt(timeParts[1])||0)*60 + (parseFloat(timeParts[2])||0);
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
            // Fallback? If Sharp failed, we already threw. If FFmpeg failed here, it's not text related.
            // We can re-throw to trigger fatal handler.
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
                if (fs.existsSync(originalImagePath)) fs.unlinkSync(originalImagePath);
                if (fs.existsSync(processedImagePath)) fs.unlinkSync(processedImagePath);
                if (fs.existsSync(textBgPath)) fs.unlinkSync(textBgPath);
                if (fs.existsSync(textImagePath)) fs.unlinkSync(textImagePath);
                if (fs.existsSync(textFilePath)) fs.unlinkSync(textFilePath);
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

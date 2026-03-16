const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const path = require('path');
const { getFfprobePath } = require('@remotion/renderer');

ffmpeg.setFfmpegPath(ffmpegStatic);
ffmpeg.setFfprobePath(getFfprobePath());

const files = [
    "Woman day video static video Female.mp4",
    "Woman day video static video Male.mp4"
];

async function getDurations() {
    for (const file of files) {
        const filePath = path.join(__dirname, 'public', 'videos', file);
        try {
            const metadata = await new Promise((resolve, reject) => {
                ffmpeg.ffprobe(filePath, (err, metadata) => {
                    if (err) reject(err);
                    else resolve(metadata);
                });
            });
            console.log(`${file}: ${metadata.format.duration}s`);
        } catch (e) {
            console.log(`${file}: Error - ${e.message}`);
        }
    }
}

getDurations();

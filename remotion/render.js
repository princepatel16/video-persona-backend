const { bundle } = require('@remotion/bundler');
const { renderMedia, selectComposition } = require('@remotion/renderer');
const path = require('path');

async function renderLastSlide({ doctorName, photoUrl, theme, imageX, imageY, backgroundVideoPath, outputPath }) {
    console.log('--- REMOTION RENDER START ---');
    console.log('Parameters:', { doctorName, photoUrl, theme, imageX, imageY, backgroundVideoPath, outputPath });
    
    // Diagnostic check for common missing libraries
    try {
        const { execSync } = require('child_process');
        console.log('DIAGNOSTIC: checking for libnspr4...');
        const findNspr = execSync('find /usr/lib /lib -name "libnspr4.so*" 2>/dev/null || true').toString().trim();
        console.log('DIAGNOSTIC: libnspr4 location:', findNspr || 'NOT FOUND');
    } catch (e) {
        console.log('DIAGNOSTIC: could not run find command');
    }

    try {
        console.log('Step 1: Starting Remotion Bundling...');
    const bundledData = await bundle({
        entryPoint: path.resolve(__dirname, 'Root.tsx'),
        // Optional: specify caching and other webpack options
    });

    console.log('Selecting Composition...');
    // Extract the composition to render
    const composition = await selectComposition({
        serveUrl: bundledData,
        id: 'LastSlide',
        inputProps: {
            doctorName,
            photoUrl,
            theme,
            imageX,
            imageY,
            backgroundVideoPath,
        },
    });

    console.log('Step 3: Rendering Media...', outputPath);
    // Render to MP4
    await renderMedia({
        composition,
        serveUrl: bundledData,
        codec: 'h264',
        outputLocation: outputPath,
        inputProps: {
            doctorName,
            photoUrl,
            theme,
            imageX,
            imageY,
            backgroundVideoPath,
        },
        verbose: true,
        concurrency: 1, // Use 1 CPU core to avoid memory/OOM issues on Railway
    });

    console.log('--- REMOTION RENDER COMPLETE ---');
    console.log('Output Path:', outputPath);
    return outputPath;
} catch (error) {
    console.error('!!! REMOTION RENDER ERROR !!!');
    console.error('Error Name:', error.name);
    console.error('Error Message:', error.message);
    if (error.stack) console.error('Stack Trace:', error.stack);
    throw error;
}
}

module.exports = { renderLastSlide };

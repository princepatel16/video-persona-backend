const { bundle } = require('@remotion/bundler');
const { renderMedia, selectComposition } = require('@remotion/renderer');
const path = require('path');

async function renderLastSlide({ doctorName, photoUrl, nameImageUrl, theme, imageX, imageY, backgroundVideoPath, outputPath }) {
    console.log('--- REMOTION RENDER START ---');
    console.log('Parameters:', { doctorName, photoUrl, nameImageUrl, theme, imageX, imageY, backgroundVideoPath, outputPath });
    
    try {
        console.log('Step 1: Starting Remotion Bundling...');
        const bundledData = await bundle({
            entryPoint: path.resolve(__dirname, 'Root.tsx'),
            publicDir: path.resolve(__dirname, '..', 'public'), // Point to the global public folder
        });

        console.log('Step 2: Selecting Composition...');
        // Extract the composition to render
        const composition = await selectComposition({
            serveUrl: bundledData,
            id: 'LastSlide',
            inputProps: {
                doctorName,
                photoUrl,
                nameImageUrl,
                theme,
                imageX,
                imageY,
                backgroundVideoPath,
            },
            browserLaunchTimeout: 60000, // Increase timeout for Railway
        });

    console.log('Step 3: Rendering Media...', outputPath);
    // Render to MP4
    await renderMedia({
        composition,
        serveUrl: bundledData,
        codec: 'h264',
        audioCodec: 'aac',
        outputLocation: outputPath,
        inputProps: {
            doctorName,
            photoUrl,
            nameImageUrl,
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
